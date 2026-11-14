// Artikulations-Schicht (Phase 3; Regeln: SPIELREGELN.md, Bauplan: SPEC_PHASE3.md): eigener Schritt auf dem fertigen Ereignisstrom, nach der
// Songform und vor dem Mikrotiming. Reine Logik, per Seed reproduzierbar. Standard seit dem Urteil des Nutzers zu Bass und Gitarre (2026-11-14). Der Schritt setzt Felder am Ereignis (art, artSemi, artTime, ring,
// strumUp), ändert Längen und Lautstärken und fügt Noten ein. Wie eine Artikulation klingt, entscheidet die Stimme (sampler.js: eigene
// Sample-Gruppe des Packs, sonst gerechnet, sonst normal). Alle Zahlen sind Startwerte aus den Regeln, nicht gehört.
// Feinwerte: on (0 = Schicht aus, Strom unverändert), bass, chords (Rhythmusgitarre), drums, keys (Tasten auf der Akkord-Schicht), pad (Faktor auf die
// Wahrscheinlichkeiten der Regelgruppe, 0 = Gruppe ohne Artikulationen). Standard an sind bass und chords; die übrigen warten auf das Urteil des Nutzers. Dazu das Track-Feld `ornaments` (Regler "Verzierungen", 0..1, fehlend 0,5):
// Faktor 2 · ornaments auf jede Wahrscheinlichkeit unter 0,8, höchstens 0,9; 0 = alles aus.
import { r6 } from './timeline.js';
import { byTime, roundVel } from './event-helpers.js';
import { chordTones, diatonicChords, noteToPc } from './music.js';
import { grooveIdFor } from './grooves.js';
import { phrasesOf } from './form-arrange.js';
import { densityAt } from './form-types.js';

export const ART_DEFAULTS = Object.freeze({ on: 1, bass: 1, chords: 1, drums: 0, keys: 0, pad: 0 });
const RULE_LAYER = { keys: 'chords' }; // Regelgruppe -> Schicht, wenn die Namen abweichen

/** Füllt die Feinwerte auf; nur endliche Zahlen >= 0 zählen. */
export function completeArt(options) {
  const out = { ...ART_DEFAULTS };
  for (const key of Object.keys(out)) if (Number.isFinite(options?.[key]) && options[key] >= 0) out[key] = options[key];
  return out;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const has = (track, group, tag) => (track.tags?.[group] ?? []).includes(tag);
const sameChord = (a, b) => a.root === b.root && a.quality === b.quality;

/** Stil-Profil der Regeln aus Groove und Schlagworten (SPEC_PHASE3, Abschnitt 6): der Track kennt seinen Stil nicht. Der erste Treffer gilt. */
export function profileOf(track) {
  const groove = grooveIdFor(track);
  if (groove === 'slowBlues') return 'slowBlues';
  if (groove === 'shuffle') return 'shuffle';
  if (groove === 'latin') return 'latin';
  if (groove === 'ballad68' || groove === 'waltz') return 'ballad';
  if (has(track, 'rhythm', 'swing')) return 'shuffle';
  if (has(track, 'rhythm', 'funky')) return 'funk';
  if (has(track, 'drums', 'halftime') && has(track, 'rhythm', 'syncopated')) return 'reggae';
  if (has(track, 'drums', 'halftime') || has(track, 'mood', 'dreamy')) return 'ballad';
  if (has(track, 'chordSound', 'ringing') && has(track, 'bassSound', 'plucky') && has(track, 'rhythm', 'straight')) return 'country';
  return 'rock';
}

/**
 * Kontext je Takt: kind (Teil-Typ, ohne Songform ''), phrase (Nummer der 4-Takt-Phrase im Teil) und inPhrase (Takt darin), rep (wie oft ein Teil
 * dieser Art schon lief), first/phraseStart (erster Takt des Teils/der Phrase), verse (Strophe im Sinn der Regeln: alles außer dem Refrain; ohne
 * Songform energy < 0,45), energy 0..1, stop/fill/roll (letzter Takt vor einem Stopp, mit Fill, mit Snare-Wirbel), change/nextChange (Akkordwechsel
 * zu Beginn/am Ende des Takts).
 */
function barContexts(bars, sections, params) {
  const ctx = [], seen = {};
  sections.forEach((sec, k) => {
    const rep = seen[sec.kind] ?? 0;
    seen[sec.kind] = rep + 1;
    const last = sec.start + sec.bars - 1, after = sections[k + 1]?.resolved?.transition, stop = after === 'stop';
    phrasesOf(sec).forEach((ph, phrase) => {
      for (let i = ph.start; i < ph.start + ph.bars; i++) {
        const energy = sec.resolved ? clamp(0.5 + densityAt(sec.resolved, i - sec.start), 0, 1) : params.drive;
        ctx[i] = {
          kind: sec.kind ?? '', phrase, inPhrase: i - ph.start, rep, first: i === sec.start, phraseStart: i === ph.start,
          verse: sec.kind ? sec.kind !== 'chorus' : energy < 0.45, energy, stop: stop && i === last, fill: sec.fillAtEnd === true && i === last, roll: after === 'roll' && i === last,
          change: i > 0 && !sameChord(bars[i].chord, bars[i - 1].chord), nextChange: i + 1 < bars.length && !sameChord(bars[i].next, bars[i].chord),
        };
      }
    });
  });
  return ctx;
}

/**
 * Verzierungs-Plan (Regel 4): Zufallszahl 0..1 für die Entscheidung `name`, fest je Teil-Typ, Phrase im Teil und Takt der Phrase (c aus
 * barContexts). Die Wiederholung eines Teils bekommt so denselben Plan; ab der zweiten Runde wird jede Entscheidung mit 0,3 neu gezogen.
 */
export function planRoll(rng, c, name) {
  const key = `${c.kind}:${c.phrase}:${c.inPhrase}:${name}`;
  return rng.fork(c.rep > 0 && rng.fork(`${key}:v${c.rep}`).next() < 0.3 ? `${key}:r${c.rep}` : key).next();
}

/**
 * events: sortierter Strom nach der Songform; bars: barTimeline; sections: Abschnitte; params: aufgelöste Schlagworte; rng: eigener Zweig;
 * options: completeArt(). Liefert einen neuen, sortierten Strom (die Eingabe bleibt unverändert).
 */
export function articulate(events, { track, bars, sections, params, rng, options }) {
  const amount = track.ornaments ?? 0.5;
  if (!options.on || !(amount > 0)) return events;
  const tempo = clamp(110 / track.bpm, 0.5, 1.2); // Regel 7: schnell = weniger und kürzer
  const env = {
    track, bars, params, tempo, profile: profileOf(track), ctx: barContexts(bars, sections, params),
    /** Wahrscheinlichkeit einer Regel nach Regler, Tempo und Feinwert der Schicht; stilprägende Regeln (ab 0,8) werden nicht skaliert. */
    p: (base, layer) => (base >= 0.8 ? base : Math.min(0.9, base * 2 * amount * tempo * options[layer])),
    roll: (c, layer, name, slot = 0) => planRoll(rng, c, `${layer}:${name}:${slot}`),
    /** Zeit eines Rasterschritts mit Swing, ohne Zufall (den Rest macht das Mikrotiming). */
    slotTime: (b, s) => r6(b.start + s * b.stepSec + (b.sub === 4 && s % 2 ? (params.swing * b.stepSec) / 3 : 0)),
  };
  const out = events.map((e) => ({ ...e }));
  for (const [name, rules] of Object.entries(RULES)) if (options[name] > 0 && track.layers[RULE_LAYER[name] ?? name]) rules(out, env);
  // Vorlauf (Regel 6, der Zielton kommt pünktlich): das Ereignis bleibt auf seinem Platz, die Stimme beginnt artTime früher (sampler.js). So gilt
  // der Vertrag des Stroms weiter (Zeit und Dauer im Takt, Bass auf der Eins), und Stimmen ohne Artikulationen (Synth) spielen nicht zu früh
  return out.sort(byTime);
}

// Werte je Stil-Profil (Wahrscheinlichkeiten vor Regler, Tempo und Feinwert; fehlt ein Eintrag, greift die Regel nicht).
// Bass: hold = Grundhaltung der Notenlänge, dead, slideIn, approach (chromatic: Halbton statt Tonleiterton, nur im Blues erlaubt)
// Gitarre: palmMute [Strophe, Refrain], chuck (freie 16tel), backbeatChuck (auf 2 und 4 im Refrain), choke (ab 0,8 jeder Stab, sonst nur auf
// Zählzeiten), ring (jeder Stab klingt aus), ringAccent (die Eins im Refrain klingt aus), arpRing (Arpeggio-Überlappung immer), strumUp (feste Spielweise)
const PROFILES = {
  shuffle: { bass: { hold: 'legato', approach: 0.4, slideIn: 0.25, chromatic: true }, guitar: {} },
  slowBlues: { bass: { hold: 'legato', slideIn: 0.3, chromatic: true }, guitar: { ring: true, arpRing: true } },
  rock: { bass: { slideIn: 0.15, dead: 0.05 }, guitar: { palmMute: [0.7, 0.1], ringAccent: true } },
  funk: { bass: { hold: 'staccato', dead: 0.35, slideIn: 0.15 }, guitar: { chuck: 0.8, choke: 0.6, strumUp: 2 } },
  ballad: { bass: { hold: 'legato', slideIn: 0.1 }, guitar: { ring: true, arpRing: true, backbeatChuck: 0.3 } },
  reggae: { bass: { hold: 'legato', slideIn: 0.15 }, guitar: { choke: 1 } },
  latin: { bass: { hold: 'legato' }, guitar: {} },
  country: { bass: { approach: 0.4, slideIn: 0.1 }, guitar: {} },
};
// Schlagzeug je Profil: stick = Side-Stick statt Snare (always, verse = in der Strophe, quiet = bei energy < 0,4), rimshot = Rimshot im Refrain,
// swap = was im Refrain (nur mit Songform) statt der Hi-Hat spielt (fehlend: ride)
const DRUM_PROFILES = {
  shuffle: { stick: 'quiet' }, slowBlues: { stick: 'quiet' }, rock: { swap: 'hatHalf', rimshot: true }, ballad: { stick: 'verse', rimshot: true },
  reggae: { stick: 'always' }, latin: { stick: 'always' }, country: { stick: 'always' },
};
// Tasten je Profil: pedal (Wahrscheinlichkeit je Takt; Ballade immer, Rock und Blues teilweise), staccato (kurze Stabs)
const KEY_PROFILES = { ballad: { pedal: 1 }, rock: { pedal: 0.5 }, shuffle: { pedal: 0.5 }, slowBlues: { pedal: 0.5 }, funk: { staccato: true } };
const GUITARS = new Set(['guitar', 'muted', 'jazz', 'funk', 'steel', 'nylon', 'twelve', 'freepats', 'freepatsjazz']); // Varianten von chords/sample

/** Regeln je Gruppe (Name = Feinwert): (Ereignisse, env) => void; sie ändern die Ereignisse und hängen neue an. */
const RULES = {
  // Schlagzeug, Priorität A, soweit die Packs es hergeben (SPEC_PHASE3 5.8): Hi-Hat-Akzentmuster, Lautstärke der Geisternoten, Side-Stick und
  // Rimshot statt Snare, im Refrain Ride oder halboffene Hi-Hat statt der geschlossenen, getretene Hi-Hat, Crash mit Choke vor einem Stopp.
  // Schlagarten ohne Sample fallen in der Stimme auf ihren Grundschlag zurück (DRUM_FALLBACK).
  drums(out, { bars, ctx, profile, roll, slotTime }) {
    const P = DRUM_PROFILES[profile] ?? {}, byBar = new Map();
    for (const e of out) if (e.layer === 'drums' && e.type === 'hit') byBar.set(e.bar, [...(byBar.get(e.bar) ?? []), e]);
    const add = (b, s, name, vel) => { const e = { t: slotTime(b, s), bar: b.index, beat: s / b.sub, type: 'hit', layer: 'drums', name, vel }; out.push(e); byBar.get(b.index).push(e); };
    for (const [index, hits] of byBar) {
      const b = bars[index], c = ctx[index], stepOf = (e) => Math.round(e.beat * b.sub), hats = hits.filter((e) => e.name === 'hat');
      // Hi-Hat-Akzentmuster im 16tel-Raster als Faktor auf den lautesten Schlag des Takts: Achtel 1 / 0,7; 16tel 1 / 0,6 / 0,8 / 0,6
      if (b.sub === 4 && hats.length) {
        const top = Math.max(...hats.map((e) => e.vel)), sixteenths = hats.some((e) => stepOf(e) % 2);
        for (const e of hats) { const s = stepOf(e); e.vel = roundVel(top * (s % 4 === 0 ? 1 : s % 2 ? 0.6 : sixteenths ? 0.8 : 0.7) * (0.94 + 0.12 * roll(c, 'drums', 'hat', s))); }
      }
      for (const e of hits) {
        if (e.name !== 'snare') continue;
        if (e.vel < 0.3) { e.vel = roundVel(0.15 + 0.14 * roll(c, 'drums', 'ghost', stepOf(e))); continue; } // Geisternote: 0,15 bis 0,29 statt fest 0,2
        if ((c.fill && e.beat >= b.beats - 2) || (c.roll && e.beat >= b.beats / 2)) continue; // Fill und Wirbel bleiben auf der Snare
        if (P.stick === 'always' || (P.stick === 'verse' && c.verse) || (P.stick === 'quiet' && c.energy < 0.4)) e.name = 'sideStick';
        else if (P.rimshot && !c.verse) e.name = 'rimshot';
      }
      // Refrain (nur mit Songform, sonst gäbe es keinen Kontrast): Becken-Wechsel; zum Ride tritt der Fuß die Hi-Hat auf 2 und 4
      if (c.kind === 'chorus' && hats.length) {
        for (const e of hats) e.name = P.swap ?? 'ride';
        if (!P.swap) for (let beat = 1; beat < b.beats; beat += 2) add(b, beat * b.sub, 'hatPedal', 0.35);
      }
      // vor einem Stopp: Crash auf den letzten Schlag vor der Stille, nach 50 bis 150 ms abgewürgt
      if (c.stop) { const last = hits.reduce((x, y) => (y.t > x.t ? y : x)); hits.push({ ...last, name: 'crash', vel: 0.8, art: 'choke', artTime: r6(0.05 + 0.1 * roll(c, 'drums', 'crashChoke')) }); out.push(hits.at(-1)); }
    }
    // offene Hi-Hat: auf der nächsten Zählzeit schließen; steht dort keine geschlossene, tritt der Fuß sie zu (nicht in die Stille eines Stopps)
    for (const [index, hits] of byBar) {
      const b = bars[index];
      for (const e of hits.filter((x) => x.name === 'openHat')) {
        const s = (Math.floor(Math.round(e.beat * b.sub) / b.sub) + 1) * b.sub, at = s < b.steps ? b : bars[index + 1], step = s < b.steps ? s : 0, there = at && byBar.get(at.index);
        if (there && !ctx[index].stop && !there.some((x) => (x.name === 'hat' || x.name === 'hatPedal') && Math.round(x.beat * at.sub) === step)) add(at, step, 'hatPedal', 0.3);
      }
    }
  },

  // E-Bass, Priorität A (SPEC_PHASE3 5.1), in der Reihenfolge Notenwahl (approach, dead), Länge (staccato, legato), Verzierung (slideIn).
  // Einstimmigkeit: Noten, in die eine neue oder vorgezogene Note fällt, kürzt das Mikrotiming danach.
  bass(out, { track, bars, ctx, profile, tempo, p, roll, slotTime }) {
    const variant = track.voices?.bass?.variant, P = PROFILES[profile].bass;
    if (variant === 'upright') return; // der Kontrabass hat eigene Regeln (Priorität B und C)
    const notes = () => out.filter((e) => e.layer === 'bass' && e.type === 'note').sort(byTime);
    const stepOf = (e) => Math.round(e.beat * bars[e.bar].sub);
    const add = (b, s, fields) => out.push({ t: slotTime(b, s), bar: b.index, beat: s / b.sub, type: 'note', layer: 'bass', ...fields });
    const playing = new Set(notes().map((n) => n.bar)); // Takte, in denen der Bass spielt

    // approach: vor einem Akkordwechsel auf dem letzten Achtel ein Ton einen Schritt unter (60 %) oder über der ersten Note des neuen Takts;
    // ersetzt, was dort liegt. Tonleiterton, im Blues der Halbton
    if (P.approach) {
      const scale = new Set(diatonicChords(track.key).map((c) => noteToPc(c.root)));
      const first = new Map(notes().filter((n) => stepOf(n) === 0).map((n) => [n.bar, n]));
      for (const b of bars) {
        const c = ctx[b.index], target = first.get(b.index + 1), s = b.steps - (b.sub === 4 ? 2 : 1);
        if (!c.nextChange || c.stop || !target || !playing.has(b.index) || !(roll(c, 'bass', 'approach') < p(P.approach, 'bass'))) continue;
        const dir = target.midi > 50 || (target.midi >= 30 && roll(c, 'bass', 'approachDir') < 0.6) ? -1 : 1; // im Tonbereich des Basses bleiben (28..52)
        let midi = target.midi + dir;
        if (!P.chromatic) while (!scale.has(((midi % 12) + 12) % 12)) midi += dir;
        for (let i = out.length - 1; i >= 0; i--) if (out[i].layer === 'bass' && out[i].type === 'note' && out[i].bar === b.index && stepOf(out[i]) >= s) out.splice(i, 1);
        add(b, s, { midi, vel: target.vel, dur: r6(b.end - slotTime(b, s)), art: 'approach' });
      }
    }

    // dead: auf einem freien schwachen 16tel (e oder a) direkt vor einer Note eine Dead Note auf deren Ton
    if (P.dead) {
      const list = notes();
      list.forEach((n, i) => {
        const b = bars[n.bar], s = stepOf(n), prev = list[i - 1];
        if (b.sub !== 4 || s % 2 || n.art) return; // nur vor Zählzeit oder "+": der Platz davor ist ein e oder a
        const at = s > 0 ? b : bars[n.bar - 1], slot = s > 0 ? s - 1 : (at?.steps ?? 0) - 1;
        if (!at || at.sub !== 4 || !playing.has(at.index) || (at !== b && ctx[at.index].stop)) return;
        const c = ctx[at.index];
        if ((prev && prev.bar === at.index && stepOf(prev) >= slot) || !(roll(c, 'bass', 'dead', slot) < p(P.dead, 'bass'))) return; // dort spielt der Bass schon
        add(at, slot, { midi: n.midi, vel: roundVel(0.3 + 0.2 * roll(c, 'bass', 'deadVel', slot)), dur: r6(0.03 + 0.03 * roll(c, 'bass', 'deadDur', slot)), art: 'dead' });
      });
    }

    const list = notes();
    list.forEach((n, i) => {
      if (n.art === 'dead') return;
      const b = bars[n.bar], c = ctx[n.bar], next = list[i + 1];
      // Länge: Grundhaltung des Profils (Rock nur mit Pick kurz); die letzte Note vor einem Stopp ist immer kurz
      const hold = c.stop && next?.bar !== n.bar ? 'staccato' : P.hold ?? (profile === 'rock' && variant === 'pick' ? 'staccato' : null);
      // shortcut: 30–60 % der Notenlänge (die Spec sagt "des Rasterschritts", das wäre bei Vierteln nur ein Tick), je Takt des Plans gezogen; nach dem Hörtest festlegen
      if (hold === 'staccato') { n.dur = r6(Math.max(0.03, n.dur * (0.3 + 0.3 * roll(c, 'bass', 'staccato')))); n.art ??= 'staccato'; }
      if (hold === 'legato') { n.dur = r6(Math.max(n.dur, Math.min(next?.t ?? Infinity, b.end) - n.t)); n.art ??= 'legato'; }
      // slideIn: auf der Eins bei Akkordwechsel, Phrasen- oder Teilbeginn von unten in den Ton, nicht in die Stille eines Stopps hinein
      if (P.slideIn && stepOf(n) === 0 && n.art !== 'approach' && (c.change || c.phraseStart || c.first) && !ctx[n.bar - 1]?.stop && roll(c, 'bass', 'slideIn') < p(P.slideIn, 'bass')) {
        const r = roll(c, 'bass', 'slideSemi'); // meist 1 oder 2 Halbtöne, selten (10 %) ein langer Slide über 5 bis 7
        n.art = 'slideIn';
        n.artSemi = r < 0.1 ? -5 - Math.floor(r * 30) : r < 0.55 ? -1 : -2;
        n.artTime = r6(clamp((0.04 + 0.06 * roll(c, 'bass', 'slideTime')) * tempo, 0.04, Math.min(0.1, 15 / track.bpm))); // höchstens ein 16tel
      }
    });
  },

  // Tasten, Priorität A (SPEC_PHASE3 5.4/5.5), nur E-Piano (Sample und FM; ein Klavier gibt es noch nicht, die Orgel bekommt eigene Regeln):
  // Stimmen-Gewichtung, pedal, staccato. Die Register-Regel (kein Ton unter C3, wenn der Bass spielt) erfüllt die Akkord-Schicht schon (ab MIDI 48).
  keys(out, { track, bars, ctx, profile, p, roll }) {
    const voice = track.voices?.chords, P = KEY_PROFILES[profile] ?? {};
    if (voice?.id !== 'epiano' && !(voice?.id === 'sample' && voice.variant === 'epiano')) return;
    for (const e of out) {
      if (e.layer !== 'chords' || e.type !== 'note') continue;
      const b = bars[e.bar], c = ctx[e.bar];
      // Stimmen-Gewichtung im Stab: oberster Ton (Melodie) 10 % lauter, Mittelstimmen 10 % leiser
      if (e.strum && e.strum[1] > 2) e.vel = roundVel(e.vel * (e.strum[0] === e.strum[1] - 1 ? 1.1 : e.strum[0] > 0 ? 0.9 : 1));
      // pedal (je Takt aus dem Plan): der Ton hält bis zum Taktende; wechselt dort der Akkord, löst das Pedal 20 bis 50 ms vorher. Ein Stopp bleibt still
      if (P.pedal && !c.stop && roll(c, 'keys', 'pedal') < p(P.pedal, 'keys')) {
        const lift = c.nextChange ? 0.02 + 0.03 * roll(c, 'keys', 'lift') : 0;
        Object.assign(e, { art: 'pedal', dur: r6(Math.max(0.02, b.end - lift - e.t)) });
      // staccato: kurze Stabs, ein 16tel bis ein Achtel (je Takt aus dem Plan)
      } else if (P.staccato && e.strum) Object.assign(e, { art: 'staccato', dur: r6(Math.min(e.dur, (15 / track.bpm) * (1 + roll(c, 'keys', 'staccato')))) });
    }
  },

  // Pad und Streicher, Priorität A (SPEC_PHASE3 5.7): Stimmführung und swell. Die Dichte-Regel (Strophen meist leer) erfüllt die Songform schon.
  pad(out, { bars, ctx, profile, tempo, roll }) {
    const byBar = new Map();
    for (const e of out) if (e.layer === 'pad' && e.type === 'note') byBar.set(e.bar, [...(byBar.get(e.bar) ?? []), e]);
    let prev = null, prevBar = -2; // Lage der Grundstimmen im Takt davor
    for (const index of [...byBar.keys()].sort((x, y) => x - y)) {
      const notes = byBar.get(index), c = ctx[index], n = chordTones(bars[index].chord, 3).length, base = notes.slice(0, n);
      // Stimmführung: jeder Akkordton nimmt die Oktavlage, die einem Ton des vorigen Akkords am nächsten liegt (gemeinsame Töne bleiben liegen),
      // im Bereich 48..72; die Oktavverdopplung (breites Pad) folgt. Nach einer Lücke beginnt die Lage neu
      if (prev && prevBar === index - 1) {
        base.forEach((e, k) => {
          let best = e.midi, dist = Infinity;
          for (const m of prev) { const d = ((((e.midi - m) % 12) + 18) % 12) - 6; if (Math.abs(d) < dist) { dist = Math.abs(d); best = m + d; } }
          while (best < 48) best += 12;
          while (best > 72) best -= 12;
          e.midi = best;
          if (notes[n + k]) notes[n + k].midi = best + 12;
        });
      }
      prev = base.map((e) => e.midi);
      prevBar = index;
      // swell: weich einblenden zu Beginn eines Teils, in der Ballade bei jedem Akkordwechsel; 0,3 bis 1,5 s, höchstens die halbe Notenlänge
      if (c.first || (profile === 'ballad' && c.change)) {
        const time = clamp((0.3 + 1.2 * roll(c, 'pad', 'swell')) * tempo, 0.3, 1.5);
        for (const e of notes) Object.assign(e, { art: 'swell', artTime: r6(Math.min(time, e.dur / 2)) });
      }
    }
  },

  // Rhythmusgitarre, Priorität A (SPEC_PHASE3 5.3), nur Sample-Gitarren (Tasten bekommen eigene Regeln). Je Takt: Anschlagrichtung nach Profil
  // und Spielweise, Chucks, dann je Stab höchstens eine Artikulation mit dem Vorrang chuck, choke, letRing, palmMute.
  chords(out, { track, bars, ctx, profile, p, roll, slotTime }) {
    const voice = track.voices?.chords, P = PROFILES[profile].guitar;
    if (voice?.id !== 'sample' || !GUITARS.has(voice.variant)) return;
    const power = track.bars.some((x) => x.chord.quality === 'power'), psych = has(track, 'mood', 'psychedelic'), sixteenth = 15 / track.bpm;
    const stabs = new Map(); // Takt -> Map(Schritt -> Töne des Stabs)
    const playing = new Set(); // Takte, in denen die Gitarre spielt
    for (const e of out) {
      if (e.layer !== 'chords' || e.type !== 'note') continue;
      const b = bars[e.bar], c = ctx[e.bar], s = Math.round(e.beat * b.sub);
      playing.add(e.bar);
      if (e.strum) { if (!stabs.has(e.bar)) stabs.set(e.bar, new Map()); const m = stabs.get(e.bar); m.set(s, [...(m.get(s) ?? []), e]); }
      // Arpeggio-Überlappung: gezupfte Töne klingen bis zum Taktende weiter (Ballade, Psych, ruhige Strophe); ein Stopp bleibt still
      else if ((P.arpRing || psych || (c.verse && c.energy < 0.45)) && !c.stop) Object.assign(e, { ring: true, dur: r6(Math.max(e.dur, b.end - e.t)) });
    }
    for (const [index, bySteps] of stabs) {
      const b = bars[index], c = ctx[index], written = [...bySteps.keys()];
      // Anschlagrichtung (Antwort auf Frage 1): Funk runter-hoch-hoch-hoch (2); sonst im 16tel-Spiel Zählzeit und "+" runter, e und a hoch (1), im
      // Achtel-Spiel Zählzeit runter, "+" hoch (2); Rock ab 160 BPM nur Abschläge (0). Die Stimme liest strumUp am Ereignis (sample.js)
      const mode = P.strumUp ?? (profile === 'rock' && track.bpm >= 160 ? 0 : b.sub === 4 && written.some((s) => s % 2) ? 1 : 2);
      const isUp = (s) => (mode === 2 || b.sub !== 4 ? mode > 0 && s % b.sub !== 0 : mode === 1 && s % 2 === 1);
      const base = bySteps.get(written[0])[0].vel;
      const chuck = (s) => bySteps.set(s, chordTones(b.chord, 3).map((midi, i, all) => {
        const e = { t: slotTime(b, s), bar: index, beat: s / b.sub, type: 'note', layer: 'chords', midi, vel: roundVel(0.5 * base), dur: 0.03, art: 'chuck', strum: [i, all.length] };
        out.push(e);
        return e;
      }));
      // chuck im Funk: gedämpfter Anschlag auf den freien 16teln (die Hand pendelt durch), nicht in die Stille eines Stopps
      if (P.chuck && b.sub === 4) for (let s = 0; s < b.steps; s++) if (!bySteps.has(s) && !(c.stop && s >= b.steps - 2 * b.sub) && roll(c, 'chords', 'chuck', s) < p(P.chuck, 'chords')) chuck(s);
      // chuck im Pop-Refrain: auf 2 und 4, ersetzt einen Stab dort
      const backbeat = new Set(P.backbeatChuck && !c.verse && !c.stop && b.beats === 4 ? [b.sub, 3 * b.sub].filter((s) => roll(c, 'chords', 'backbeat', s) < p(P.backbeatChuck, 'chords')) : []);
      for (const s of backbeat) if (!bySteps.has(s)) chuck(s);
      // palmMute: der ganze Takt gedämpft (Rock: Strophe oft, Refrain selten; Powerchords öfter)
      const muted = P.palmMute && roll(c, 'chords', 'palmMute') < p(c.verse ? (power ? 0.8 : P.palmMute[0]) : P.palmMute[1], 'chords');
      const order = [...bySteps.keys()].sort((x, y) => x - y);
      order.forEach((s, k) => {
        const stab = bySteps.get(s), last = k === order.length - 1, onBeat = s % b.sub === 0;
        const until = last ? b.end : bySteps.get(order[k + 1])[0].t;
        let art = stab[0].art;
        if (!art && backbeat.has(s)) { art = 'chuck'; for (const e of stab) Object.assign(e, { vel: roundVel(0.5 * e.vel), dur: 0.03 }); }
        // choke: letzter Stab vor einem Stopp; Reggae immer (ab 0,8), Funk auf den Zählzeiten
        else if (!art && ((c.stop && last) || (P.choke && (P.choke >= 0.8 || onBeat) && roll(c, 'chords', 'choke', s) < p(P.choke, 'chords')))) art = 'choke';
        // letRing: Profil (Ballade, Slow Blues), letzter Stab vor einer Pause oder dem Ende, Akzent auf der Eins im Refrain (Rock)
        else if (!art && (P.ring || (last && !playing.has(index + 1)) || (P.ringAccent && !c.verse && s === 0))) art = 'letRing';
        else if (!art && muted) art = 'palmMute';
        for (const e of stab) {
          e.strumUp = mode;
          if (isUp(s)) e.vel = roundVel(e.vel * 0.85); // Aufschlag leiser
          if (art) e.art = art;
          if (art === 'choke') e.dur = r6(Math.min(e.dur, sixteenth));
          if (art === 'letRing') Object.assign(e, { ring: true, dur: c.stop ? e.dur : r6(Math.max(e.dur, until - e.t)) });
        }
        // ein Chuck dämpft die Saiten: was davor klingt, endet dort
        if (art === 'chuck' && k > 0) for (const e of bySteps.get(order[k - 1])) e.dur = r6(Math.min(e.dur, Math.max(0.001, stab[0].t - e.t)));
      });
    }
  },
};
