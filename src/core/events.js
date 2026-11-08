// Ereignisstrom: Track -> zeitlich sortierte Ereignisse (Akkorde, Marker, Schlagzeug, Bass, Akkorde, Pad).
// Reine Logik ohne Audio: gleicher Track mit gleichem Seed ergibt denselben Strom.
import { createRng } from './rng.js';
import { CHORD_QUALITIES, chordMidi, noteToPc } from './music.js';
import { checkedTrack, barTimeline, r6 } from './timeline.js';
import { resolveTags, driftParams } from './tags.js';
import { buildArrangement } from './arrange.js';

/** Schlagzeug-Vokabular (Task 6 ordnet jedem Namen eine Stimme zu); Geisternoten sind `snare` mit vel < 0.3. */
export const DRUM_NAMES = ['kick', 'snare', 'hat', 'openHat', 'tomHigh', 'tomMid', 'tomLow'];

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const STEPS = 16; // Muster sind für 4 Schläge in Sechzehnteln geschrieben
const JITTER = 0.007; // typische Timing-Abweichung in s, Vertrag erlaubt höchstens 0.02
const END_GAP = 0.001; // Abstand zum Taktende, damit auch gerundete Zeiten im Takt bleiben
const BASS_MIN = 28;
const BASS_MAX = 52;

const r3 = (x) => Math.round(x * 1e3) / 1e3;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Stufe eines Parameters: 0 wenig, 1 mittel, 2 viel
const level = (x) => (x < 0.35 ? 0 : x < 0.7 ? 1 : 2);

// Schlagzeug je drive-Stufe: Kick-Varianten, Snare-Schritte, Hi-Hat-Lautstärke je Sechzehntel einer Zählzeit
const DRUMS = [
  { kicks: [[0, 10], [0, 11], [0, 7, 10]], snare: [8], ghosts: [], hat: [0.3, 0, 0.2, 0] }, // Halbzeit
  { kicks: [[0, 8], [0, 8, 10], [0, 6, 8], [0, 8, 11]], snare: [4, 12], ghosts: [7, 9, 15], hat: [0.5, 0, 0.3, 0] },
  { kicks: [[0, 3, 8, 10], [0, 3, 10], [0, 3, 8, 11], [0, 6, 8, 10]], snare: [4, 12], ghosts: [7, 9, 15], hat: [0.6, 0.25, 0.45, 0.25] },
];
// Zusätzliche Muster, die erst mit dem Track-Schalter `variety` (params.variety) in die Listen kommen; die bisherigen Einträge bleiben
// die ersten, ohne den Schalter ändert sich nichts (auch nicht, welche Zufallszahl welches Muster wählt)
const pool = (base, extra, params) => (params.variety ? [...base, ...extra] : base);
const EXTRA_KICKS = [[[0, 7], [0, 10, 14]], [[0, 5, 8], [0, 8, 13]], [[0, 3, 6, 10], [0, 3, 8, 14]]];
const EXTRA_FILLS = [
  ['snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomMid', 'tomLow', 'tomLow'],
  [null, 'snare', null, 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
];
const OFFBEAT_KICKS = [3, 6, 7, 11, 14];
// Fills über 2 Zählzeiten (8 Sechzehntel), Toms absteigend; kürzere Fills nehmen das Ende
const FILLS = [
  ['snare', 'snare', 'snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
  ['snare', null, 'snare', 'snare', 'tomHigh', 'tomMid', 'tomMid', 'tomLow'],
  ['tomHigh', null, 'tomHigh', 'tomMid', 'snare', 'tomMid', 'tomLow', 'tomLow'],
];

// Bass je bassMovement-Stufe als [Schritt, Stufe, Länge]: r Grundton, 5 Quinte, o Oktave, b7 kleine Septime,
// ap chromatischer Anlauf zum nächsten Grundton (immer am Taktende verankert)
const BASS = [
  [[[0, 'r', 16]], [[0, 'r', 8], [8, 'r', 8]], [[0, 'r', 8], [8, '5', 6], [14, 'ap', 2]]],
  [
    [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 8 === 6 ? 'o' : 'r', 2]),
    [[0, 'r', 4], [4, 'r', 2], [6, '5', 2], [8, 'r', 4], [12, 'o', 2], [14, 'ap', 2]],
    [[0, 'r', 6], [6, 'r', 2], [8, '5', 6], [14, 'ap', 2]],
  ],
  [
    [[0, 'r', 2], [3, 'r', 1], [6, 'o', 1], [8, '5', 1], [10, 'r', 2], [13, 'b7', 1], [15, 'ap', 1]],
    [[0, 'r', 2], [3, 'o', 1], [4, 'r', 1], [7, '5', 1], [8, 'r', 2], [10, 'b7', 1], [11, 'o', 1], [13, '5', 1], [15, 'ap', 1]],
    [[0, 'r', 3], [3, '5', 1], [6, 'o', 2], [8, 'r', 1], [10, 'b7', 2], [12, '5', 1], [14, 'o', 1], [15, 'ap', 1]],
  ],
];

// zusätzliche Bassmuster je bassMovement-Stufe (Zählzeit 1 immer Grundton, Anlauf 'ap' am Taktende, wie die bisherigen)
const EXTRA_BASS = [
  [[[0, 'r', 8], [8, 'r', 4], [12, '5', 4]]],
  [
    [[0, 'r', 4], [4, '5', 4], [8, 'r', 4], [12, 'o', 2], [14, 'ap', 2]],
    [[0, 'r', 2], [2, 'r', 2], [4, 'o', 2], [6, 'r', 2], [8, '5', 4], [12, 'b7', 2], [14, 'ap', 2]],
  ],
  [[[0, 'r', 2], [2, 'r', 1], [4, '5', 1], [6, 'o', 1], [8, 'r', 2], [11, 'b7', 1], [12, '5', 1], [14, 'o', 1], [15, 'ap', 1]]],
];

const STABS = [[0, 8], [4, 12], [0, 6, 10], [2, 8, 14]];
const EXTRA_STABS = [[0, 10], [4, 10], [0, 4, 10]];
const EXTRA_ARPS = [[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 0, 2, 0, 3, 2, 1]];
const OFFBEAT_STABS = [3, 6, 7, 10, 14];
// Arpeggio-Folgen über [Grundton, Terz, Quinte, Oktave]
const ARPS = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 3], [3, 2, 1, 0, 1, 2, 3, 2]];

// Zeit eines Rasterschritts mit Swing und Jitter, bleibt in [Taktstart, Taktende)
function at(b, step, rng, swing) {
  const shift = step % 2 ? (swing * b.stepSec) / 3 : 0; // swing 1 = Triolen-Gefühl
  const t = b.start + step * b.stepSec + shift + (rng.next() * 2 - 1) * JITTER;
  return r6(clamp(t, b.start, b.end - END_GAP));
}

const humanVel = (base, rng) => r3(clamp(base * (0.94 + rng.next() * 0.12), 0.05, 1));

const note = (b, layer, step, t, midi, vel, dur) =>
  ({ t, bar: b.index, beat: step / 4, type: 'note', layer, midi, vel, dur: r6(Math.min(dur, b.end - t)) });

const drumSection = (params, rng) => {
  const step = level(params.drive);
  const tier = DRUMS[step];
  const kicks = pool(tier.kicks, EXTRA_KICKS[step], params);
  return { tier, kicks: [rng.pick(kicks), rng.pick(kicks)], openHat: rng.next() < 0.5, fill: rng.pick(pool(FILLS, EXTRA_FILLS, params)) };
};

function playDrums(b, v, rng, params, fill) {
  const fillStart = fill ? b.steps - 4 * Math.min(2, b.beats) : b.steps;
  const kicks = new Set(v.kicks[b.index % 2]);
  if (rng.next() < 0.6 * params.syncopation) kicks.add(rng.pick(OFFBEAT_KICKS));
  const hits = [];
  for (let s = 0; s < b.steps; s++) {
    const p = s % STEPS;
    const hat = v.tier.hat[s % 4];
    if (s >= fillStart) { // unter dem Fill hält die geschlossene Hi-Hat das Tempo
      if (hat > 0) hits.push([s, 'hat', hat]);
      continue;
    }
    if (kicks.has(p)) hits.push([s, 'kick', 1]);
    if (v.tier.snare.includes(p)) hits.push([s, 'snare', 0.9]);
    else if (v.tier.ghosts.includes(p) && rng.next() < 0.6 * params.syncopation) hits.push([s, 'snare', 0.2]);
    if (hat > 0) hits.push(v.openHat && p === 14 ? [s, 'openHat', 0.5] : [s, 'hat', hat]);
  }
  if (fill) {
    const shape = v.fill.slice(8 - (b.steps - fillStart));
    shape.forEach((name, k) => name && hits.push([fillStart + k, name, 0.7 + (0.25 * k) / (shape.length - 1)]));
    hits.push([fillStart, 'kick', 0.9], [b.steps - 1, 'kick', 0.9]);
  }
  return hits.map(([s, name, vel]) => {
    const t = at(b, s, rng, params.swing);
    return { t, bar: b.index, beat: s / 4, type: 'hit', layer: 'drums', name, vel: humanVel(vel, rng) };
  });
}

function playBass(b, pattern, rng, params) {
  const lowest = BASS_MIN + Math.round((1 - params.bassLow) * 8);
  const inRange = (name) => lowest + (((noteToPc(name) - lowest) % 12) + 12) % 12;
  const fold = (m) => (m > BASS_MAX ? m - 12 : m);
  const root = inRange(b.chord.root);
  const nextRoot = inRange(b.next.root);
  const up = rng.next() < 0.3 || nextRoot - 1 < BASS_MIN;
  const degree = {
    r: root,
    5: root + CHORD_QUALITIES[b.chord.quality][2], // Quinte aus dem Akkord selbst (dim: Tritonus)
    o: root + 12,
    b7: root + 10,
    ap: nextRoot === root ? root + 10 : up ? nextRoot + 1 : nextRoot - 1,
  };
  const ap = pattern.find(([, d]) => d === 'ap');
  const apStep = ap ? b.steps - STEPS + ap[0] : b.steps;
  const steps = [];
  for (const [p, d, len] of pattern) {
    if (d === 'ap') steps.push([apStep, d, len]);
    else for (let s = p; s < apStep; s += STEPS) steps.push([s, d, len]); // kürzere Takte abschneiden, längere wiederholen
  }
  steps.sort((x, y) => x[0] - y[0]);
  // einstimmig: jede Note endet spätestens beim tatsächlichen Start der nächsten (nach Swing und Jitter)
  const times = steps.map(([s]) => at(b, s, rng, params.swing));
  return steps.map(([s, d, len], k) =>
    note(b, 'bass', s, times[k], fold(degree[d]), humanVel(0.95, rng), Math.min(len * b.stepSec, (times[k + 1] ?? b.end) - times[k])));
}

const chordsSection = (params, rng) => (params.arp ? { arp: rng.pick(pool(ARPS, EXTRA_ARPS, params)) } : { stabs: rng.pick(pool(STABS, EXTRA_STABS, params)) });

function playChords(b, v, rng, params) {
  const tones = chordMidi(b.chord, 3);
  const out = [];
  if (v.arp) {
    const pool = [...tones, tones[0] + 12].map((m) => m + 12);
    for (let s = 0; s < b.steps; s += 2) {
      const t = at(b, s, rng, params.swing);
      out.push(note(b, 'chords', s, t, pool[v.arp[(s / 2) % 8]], humanVel(s % 4 ? 0.7 : 0.85, rng), 2 * b.stepSec));
    }
    return out;
  }
  const len = (params.drive < 0.35 ? 4 : 1.5) * b.stepSec;
  for (let s = 0; s < b.steps; s++) {
    const p = s % STEPS;
    if (!v.stabs.includes(p) && !(OFFBEAT_STABS.includes(p) && rng.next() < 0.5 * params.syncopation)) continue;
    const t = at(b, s, rng, params.swing);
    const vel = humanVel(0.8, rng);
    for (const m of tones) out.push(note(b, 'chords', s, t, m, vel, len));
  }
  return out;
}

function playPad(b, v, rng, params) {
  const tones = chordMidi(b.chord, 3);
  const midis = params.padWidth > 0.6 ? [...tones, ...tones.map((m) => m + 12)] : tones;
  const t = r6(b.start);
  return midis.map((m) => note(b, 'pad', 0, t, m, humanVel(0.6, rng), b.end - b.start));
}

const PLAYERS = {
  drums: { section: drumSection, play: playDrums },
  bass: { section: (params, rng) => { const step = level(params.bassMovement); return rng.pick(pool(BASS[step], EXTRA_BASS[step], params)); }, play: playBass },
  chords: { section: chordsSection, play: playChords },
  pad: { section: () => null, play: playPad },
};

const RANK = { chord: 0, marker: 1 };

/** Track -> Ereignisse sortiert nach t (bei Gleichstand chord, marker, Rest). Wirft bei ungültigem Track. */
export function buildEvents(input) {
  const track = checkedTrack(input);
  const master = createRng(track.seed);
  let params = resolveTags(track.tags, master.fork('tags'));
  // variety: der Seed streut die Schlagwort-Werte und schaltet zusätzliche Muster frei (der eigene Zweig 'drift' verschiebt nichts)
  if (track.variety === true) params = { ...driftParams(params, master.fork('drift')), variety: true };
  const { sections } = buildArrangement(track, params, master.fork('arrangement'));
  const bars = barTimeline(track);

  const events = bars.map((b) => ({ t: r6(b.start), bar: b.index, beat: 0, type: 'chord', chord: { ...b.chord } }));
  for (const sec of sections) {
    const last = sec.start + sec.bars - 1;
    if (sec.fillAtEnd) events.push({ t: r6(bars[last].start), bar: last, type: 'marker', name: 'fill' });
  }
  for (const layer of LAYERS) {
    if (!track.layers[layer]) continue;
    const rng = master.fork(layer); // eigener Zufall je Schicht, damit Schichten sich nicht verschieben
    const { section, play } = PLAYERS[layer];
    for (const sec of sections) {
      if (!sec.layers[layer]) continue;
      const v = section(params, rng);
      const last = sec.start + sec.bars - 1;
      for (let i = sec.start; i <= last; i++) for (const e of play(bars[i], v, rng, params, sec.fillAtEnd && i === last)) events.push(e);
    }
  }
  return events.sort((x, y) => x.t - y.t || (RANK[x.type] ?? 2) - (RANK[y.type] ?? 2));
}
