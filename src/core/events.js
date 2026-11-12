// Ereignisstrom: Track -> zeitlich sortierte Ereignisse (Akkorde, Marker und die Schichten aus layers.js: Schlagzeug, Bass, Akkorde, Pad, Lead, Percussion).
// Reine Logik ohne Audio: gleicher Track mit gleichem Seed ergibt denselben Strom.
import { createRng } from './rng.js';
import { chordTones, noteToPc } from './music.js';
import { CHORDS } from './chords.js';
import { checkedTrack, barTimeline, r6 } from './timeline.js';
import { resolveTags, driftParams } from './tags.js';
import { buildArrangement } from './arrange.js';
import { LAYER_IDS, LAYERS } from './layers.js';
import { buildFormArrangement, withSection, phrasesOf } from './form-arrange.js';
import { densityAt } from './form-types.js';
import { grooveFor, grooveCycle, levelOf, applyComplexity } from './grooves.js';
import { at, note, humanVel } from './event-helpers.js';
import { leadPlayer } from './lead.js';
import { percussionPlayer } from './percussion.js';

/** Schlagzeug-Vokabular (Task 6 ordnet jedem Namen eine Stimme zu); Geisternoten sind `snare` mit vel < 0.3. */
export const DRUM_NAMES = ['kick', 'snare', 'hat', 'openHat', 'tomHigh', 'tomMid', 'tomLow', 'crash'];

/** Percussion-Vokabular (Treffer der Schicht `percussion`). */
export const PERCUSSION_NAMES = ['shaker', 'tambourine', 'congaHigh', 'congaLow', 'bongoHigh', 'bongoLow', 'claves', 'cowbell'];

const BASS_MIN = 28;
const BASS_MAX = 52;

// Mit dem Track-Schalter `variety` (params.variety) kommen die zusätzlichen Muster des Grooves in die Listen; die bisherigen Einträge
// bleiben die ersten, ohne den Schalter ändert sich nichts (auch nicht, welche Zufallszahl welches Muster wählt)
const pool = (base, extra, params) => (params.variety ? [...base, ...extra] : base);

// Mit Form (sec.kind) steht die offene Hi-Hat im Refrain fest und fehlt in Strophe, Break und Intro; die Ziehung bleibt (gleiche Zahl an Zufallszahlen)
const OPEN_HAT = { chorus: true, verse: false, break: false, intro: false };

const drumSection = (params, rng, g, sec) => {
  const step = levelOf(params.drive, g.drums.thresholds);
  const tier = g.drums.tiers[step];
  const kicks = pool(tier.kicks, g.drums.extraKicks[step], params);
  const picked = [rng.pick(kicks), rng.pick(kicks)];
  const drawn = rng.next() < 0.5;
  return { tier, kicks: picked, openHat: OPEN_HAT[sec?.kind] ?? drawn, fill: rng.pick(pool(g.drums.fills, g.drums.extraFills, params)) };
};

function playDrums(b, v, rng, params, fill, g) {
  const cycle = grooveCycle(g);
  const fillStart = fill ? b.steps - b.sub * Math.min(g.fillBeats, b.beats) : b.steps;
  const kicks = new Set(v.kicks[b.index % 2]);
  if (rng.next() < 0.6 * params.syncopation) kicks.add(rng.pick(g.drums.offbeatKicks));
  const hits = [];
  for (let s = 0; s < b.steps; s++) {
    const p = s % cycle;
    const hat = v.tier.hat[s % b.sub];
    if (s >= fillStart) { // unter dem Fill hält die geschlossene Hi-Hat das Tempo
      if (hat > 0) hits.push([s, 'hat', hat]);
      continue;
    }
    if (kicks.has(p)) hits.push([s, 'kick', 1]);
    if (v.tier.snare.includes(p)) hits.push([s, 'snare', 0.9]);
    else if (v.tier.ghosts.includes(p) && rng.next() < 0.6 * params.syncopation) hits.push([s, 'snare', 0.2]);
    if (hat > 0) hits.push(v.openHat && p === g.drums.openHatStep ? [s, 'openHat', 0.5] : [s, 'hat', hat]);
  }
  if (fill) {
    const shape = v.fill.slice(g.fillBeats * b.sub - (b.steps - fillStart));
    shape.forEach((name, k) => name && hits.push([fillStart + k, name, 0.7 + (0.25 * k) / (shape.length - 1)]));
    hits.push([fillStart, 'kick', 0.9], [b.steps - 1, 'kick', 0.9]);
  }
  return hits.map(([s, name, vel]) => {
    const t = at(b, s, rng, params.swing);
    return { t, bar: b.index, beat: s / b.sub, type: 'hit', layer: 'drums', name, vel: humanVel(vel, rng) };
  });
}

function playBass(b, pattern, rng, params, _fill, g) {
  const cycle = grooveCycle(g);
  const lowest = BASS_MIN + Math.round((1 - params.bassLow) * 8);
  const inRange = (name) => lowest + (((noteToPc(name) - lowest) % 12) + 12) % 12;
  const fold = (m) => (m > BASS_MAX ? m - 12 : m);
  const root = inRange(b.chord.root);
  const nextRoot = inRange(b.next.root);
  const up = rng.next() < 0.3 || nextRoot - 1 < BASS_MIN;
  const degree = {
    r: root,
    5: root + CHORDS[b.chord.quality].fifth, // Quinte aus dem Akkord selbst (dim: Tritonus, aug: übermäßig)
    o: root + 12,
    b7: root + (CHORDS[b.chord.quality].seventh ?? 10), // Septime des Akkords (maj7: groß, dim7: vermindert), sonst die kleine
    ap: nextRoot === root ? root + 10 : up ? nextRoot + 1 : nextRoot - 1,
  };
  const ap = pattern.find(([, d]) => d === 'ap');
  const apStep = ap ? b.steps - cycle + ap[0] : b.steps;
  const steps = [];
  for (const [p, d, len] of pattern) {
    if (d === 'ap') steps.push([apStep, d, len]);
    else for (let s = p; s < apStep; s += cycle) steps.push([s, d, len]); // kürzere Takte abschneiden, längere wiederholen
  }
  steps.sort((x, y) => x[0] - y[0]);
  // einstimmig: jede Note endet spätestens beim tatsächlichen Start der nächsten (nach Swing und Jitter)
  const times = steps.map(([s]) => at(b, s, rng, params.swing));
  return steps.map(([s, d, len], k) =>
    note(b, 'bass', s, times[k], fold(degree[d]), humanVel(0.95, rng), Math.min(len * b.stepSec, (times[k + 1] ?? b.end) - times[k])));
}

const chordsSection = (params, rng, g) => (params.arp
  ? { arp: rng.pick(pool(g.chords.arps, g.chords.extraArps, params)) }
  : { stabs: rng.pick(pool(g.chords.stabs, g.chords.extraStabs, params)) });

/**
 * Vorrat der Arpeggio-Muster (Index 0..3): die Akkordtöne zyklisch über die Oktaven, eine Oktave höher. Dreiklänge ergeben Grundton,
 * Terz, Quinte, Grundton + Oktave (wie bisher), Septakkorde die Septime als vierten Ton, ein Powerchord Grundton, Quinte und beide
 * eine Oktave höher.
 */
export const arpPool = (tones) => Array.from({ length: 4 }, (_, i) => tones[i % tones.length] + 12 * Math.floor(i / tones.length) + 12);

function playChords(b, v, rng, params, _fill, g) {
  const cycle = grooveCycle(g);
  const { arpStep } = g.chords;
  const tones = chordTones(b.chord, 3);
  const out = [];
  if (v.arp) {
    const notes = arpPool(tones);
    for (let s = 0; s < b.steps; s += arpStep) {
      const t = at(b, s, rng, params.swing);
      out.push(note(b, 'chords', s, t, notes[v.arp[(s / arpStep) % 8]], humanVel(s % b.sub ? 0.7 : 0.85, rng), arpStep * b.stepSec));
    }
    return out;
  }
  const len = (params.drive < 0.35 ? 4 : 1.5) * b.stepSec * (b.sub / 4);
  for (let s = 0; s < b.steps; s++) {
    const p = s % cycle;
    if (!v.stabs.includes(p) && !(g.chords.offbeatStabs.includes(p) && rng.next() < 0.5 * params.syncopation)) continue;
    const t = at(b, s, rng, params.swing);
    const vel = humanVel(0.8, rng);
    for (const m of tones) out.push(note(b, 'chords', s, t, m, vel, len));
  }
  return out;
}

function playPad(b, v, rng, params) {
  const tones = chordTones(b.chord, 3);
  const midis = params.padWidth > 0.6 ? [...tones, ...tones.map((m) => m + 12)] : tones;
  const t = r6(b.start);
  return midis.map((m) => note(b, 'pad', 0, t, m, humanVel(0.6, rng), b.end - b.start));
}

const PLAYERS = {
  drums: { section: drumSection, play: playDrums },
  bass: {
    section: (params, rng, g) => { const step = levelOf(params.bassMovement, g.bass.thresholds); return rng.pick(pool(g.bass.tiers[step], g.bass.extra[step], params)); },
    play: playBass,
  },
  chords: { section: chordsSection, play: playChords },
  pad: { section: () => null, play: playPad },
  lead: leadPlayer,
  percussion: percussionPlayer,
};

const RANK = { chord: 0, marker: 1 };

/** Track -> Ereignisse sortiert nach t (bei Gleichstand chord, marker, Rest). Wirft bei ungültigem Track. */
export function buildEvents(input) {
  const track = checkedTrack(input);
  const master = createRng(track.seed);
  let params = resolveTags(track.tags, master.fork('tags'));
  // variety: der Seed streut die Schlagwort-Werte und schaltet zusätzliche Muster frei (der eigene Zweig 'drift' verschiebt nichts)
  if (track.variety === true) params = { ...driftParams(params, master.fork('drift')), variety: true };
  // Komplexität: verschiebt die Parameter nach der Streuung durch variety (bei 0,5 und ohne Angabe bleibt alles gleich)
  params = applyComplexity(params, track.complexity);
  const g = grooveFor(track);
  // Songform: Abschnitte aus den Teilen; ohne Form der bisherige Pfad (buildArrangement, unverändert)
  const form = track.form ?? null;
  const { sections } = form ? buildFormArrangement(track) : buildArrangement(track, params, master.fork('arrangement'));
  const bars = barTimeline(track);

  const events = bars.map((b) => ({ t: r6(b.start), bar: b.index, beat: 0, type: 'chord', chord: { ...b.chord } }));
  for (const sec of sections) {
    const last = sec.start + sec.bars - 1;
    if (form) events.push({ t: r6(bars[sec.start].start), bar: sec.start, beat: 0, type: 'marker', name: 'section', kind: sec.kind, index: sec.index });
    if (sec.fillAtEnd) events.push({ t: r6(bars[last].start), bar: last, type: 'marker', name: 'fill' });
  }
  for (const layer of LAYER_IDS) {
    if (!track.layers[layer] || !PLAYERS[layer]) continue; // ohne Spieler keine Ereignisse
    const rng = master.fork(layer); // eigener Zufall je Schicht, damit Schichten sich nicht verschieben
    const { section, play } = PLAYERS[layer];
    // Mit Form: je 4-Takt-Phrase mit der Wahrscheinlichkeit `randomness` ein neues Muster (die Münze kommt aus einem eigenen Zweig,
    // so verschiebt sie den Schichtstrom nicht); Lead und Percussion halten ihren Zustand (Lage, Ruf) über den ganzen Teil
    const coin = form && !LAYERS[layer].follows ? master.fork(`form:${layer}`) : null;
    for (const sec of sections) {
      if (!sec.layers[layer]) continue;
      const last = sec.start + sec.bars - 1;
      const paramsAt = (i) => (form ? withSection(params, sec.resolved, i - sec.start, form.feel) : params);
      let v;
      let prevDensity;
      for (const ph of form ? phrasesOf(sec) : [sec]) {
        const density = form ? densityAt(sec.resolved, ph.start - sec.start) : 0;
        // die Münze fällt in jeder späteren Phrase (feste Zahl an Ziehungen); rampt die Dichte (Aufbau, Outro), gilt die Phrase als neu (nicht für Lead und Percussion)
        const coinHit = ph.start !== sec.start && coin && coin.next() < form.feel.randomness;
        if (ph.start === sec.start || coinHit || (coin && density !== prevDensity)) v = section(paramsAt(ph.start), rng, g, sec); // der Abschnitt selbst nur für Spieler, die ihre Lage darin brauchen (Lead-Fills)
        prevDensity = density;
        for (let i = ph.start; i < ph.start + ph.bars; i++) for (const e of play(bars[i], v, rng, paramsAt(i), sec.fillAtEnd && i === last, g, track.jobs[layer], track)) events.push(e);
      }
    }
  }
  return events.sort((x, y) => x.t - y.t || (RANK[x.type] ?? 2) - (RANK[y.type] ?? 2));
}
