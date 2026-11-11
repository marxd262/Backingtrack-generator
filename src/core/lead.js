// Lead-Stimme: eine Aufgabe (Job) je Track, gespielt Takt für Takt. Einstimmig, MIDI 72 bis 88 (eine Oktave über den Akkorden),
// Töne aus der Skala der Tonart oder dem Akkord des Takts. Stärke folgt drive und syncopation, das Timing swing (über `at`).
// Reine Logik ohne Audio.
import { chordTones, scalePcs } from './music.js';
import { at, note, humanVel } from './event-helpers.js';

const LEAD_MIN = 72;
const LEAD_MAX = 88;
const HOME = 79; // Ruhelage der Linie (G5), Mitte des Umfangs; die Linie wird sanft dorthin zurückgezogen

/**
 * Skala des Leads je Modus. Die Skalenwahl der Oberfläche liegt außerhalb des Tracks, darum hier ein fester Standard:
 * Moll -> Moll-Pentatonik, Dur -> Dur-Pentatonik, Dorisch -> dorisch.
 */
export const LEAD_SCALE = Object.freeze({ minor: 'minorPentatonic', major: 'majorPentatonic', dorian: 'dorian' });

const RANGE = Array.from({ length: LEAD_MAX - LEAD_MIN + 1 }, (_, i) => LEAD_MIN + i);
const semitone = (a, b) => (a - b + 12) % 12 === 1 || (b - a + 12) % 12 === 1;
const nearest = (list, target) => list.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best));
const eighth = (b) => (b.sub === 4 ? 2 : 1); // Achtel im Sechzehntel-Raster, Triolenachtel im Raster der zusammengesetzten Taktarten

// Tonvorrat eines Takts im Umfang: Akkordtöne und Skalentöne. Ein Skalenton, der kein Akkordton ist und einen Halbton neben einem
// Akkordton liegt, fällt weg (G gegen G# über E-Dur in A-Moll, F gegen E über C-Dur in D-Dorisch), damit lange Töne nicht reiben.
function tonesOf(b, scale) {
  const chord = chordTones(b.chord, 0).map((m) => m % 12);
  const ok = new Set([...chord, ...scale.filter((pc) => !chord.some((c) => semitone(pc, c)))]);
  return { chord: RANGE.filter((m) => chord.includes(m % 12)), all: RANGE.filter((m) => ok.has(m % 12)) };
}

// Schrittweise Linie über den Vorrat ab dem Ton nahe `from`: meist Nachbartöne, selten ein Sprung über einen, am Rand kehrt sie um
function walk(pool, from, n, rng) {
  let i = pool.indexOf(nearest(pool, from));
  let dir = rng.next() < 0.5 ? -1 : 1;
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push(pool[i]);
    if (rng.next() < 0.25) dir = -dir;
    const size = rng.next() < 0.2 ? 2 : 1;
    if (i + dir * size < 0 || i + dir * size >= pool.length) dir = -dir;
    i = Math.min(pool.length - 1, Math.max(0, i + dir * size));
  }
  return out;
}

// Schritte und Töne -> Noten. Einstimmig: jede Note endet spätestens beim tatsächlichen Start der nächsten (nach Swing und Jitter).
function line(b, rng, params, steps, midis, len, base) {
  const times = steps.map((s) => at(b, s, rng, params.swing));
  return steps.map((s, k) => note(b, 'lead', s, times[k], midis[k], humanVel(base * (s % b.sub ? 0.9 : 1), rng), Math.min(len, (times[k + 1] ?? b.end) - times[k])));
}

const loudness = (params) => 0.55 + 0.25 * params.drive;

// Fill: kurze Phrase (2 bis 5 Töne) in den letzten ein bis zwei Schlägen, als Lauf in einen Akkordton. Nur in der zweiten Hälfte
// der Takte eines Abschnitts: immer im Fill-Takt am Abschnittsende, sonst nicht jedes Mal (mit drive öfter).
function fills(b, v, rng, params, fill, _g, ctx) {
  if (b.index - v.start < v.bars / 2 || (!fill && rng.next() >= 0.35 + 0.4 * params.drive)) return [];
  const tones = tonesOf(b, ctx.scale);
  const span = Math.min(b.beats, rng.next() < 0.3 + 0.4 * params.drive ? 2 : 1);
  const grid = b.sub === 4 && rng.next() < 0.5 * params.syncopation ? 1 : eighth(b);
  const slots = [];
  for (let s = b.steps - span * b.sub; s < b.steps; s += grid) slots.push(s);
  let steps = slots.slice(-Math.min(slots.length, 2 + rng.int(0, 1 + Math.round(2 * params.drive))));
  // Ziel ist ein Akkordton nahe der letzten Lage; der Lauf kommt stufenweise von oben (dir 1) oder unten. Passt er am Rand des
  // Umfangs nicht, kommt er von der anderen Seite oder wird kürzer, damit sich kein Ton wiederholt.
  const target = tones.all.indexOf(nearest(tones.chord, v.last ?? HOME));
  const room = (d) => (d > 0 ? tones.all.length - 1 - target : target);
  let dir = rng.next() < 0.6 ? 1 : -1;
  if (room(dir) < steps.length - 1 && room(-dir) > room(dir)) dir = -dir;
  steps = steps.slice(-Math.min(steps.length, room(dir) + 1));
  const midis = steps.map((_, k) => tones.all[target + dir * (steps.length - 1 - k)]);
  v.last = midis.at(-1);
  return line(b, rng, params, steps, midis, grid * b.stepSec * 0.9, loudness(params));
}

// Arpeggio: gleichmäßiger Lauf auf und ab über vier Akkordtöne nahe der letzten Lage, im arpStep-Raster des Grooves (ruhig: halb so oft)
function arpeggio(b, v, rng, params, _fill, g, ctx) {
  const tones = tonesOf(b, ctx.scale).chord;
  const rate = g.chords.arpStep * (params.drive < 0.35 ? 2 : 1);
  const width = Math.min(4, tones.length);
  const lo = Math.max(0, Math.min(tones.indexOf(nearest(tones, v.last ?? HOME)) - 1, tones.length - width));
  const down = rng.next() < 0.3;
  const period = 2 * (width - 1);
  const steps = [];
  const midis = [];
  for (let s = 0, k = 0; s < b.steps; s += rate, k++) {
    const p = k % period;
    const idx = p < width ? p : period - p;
    steps.push(s);
    midis.push(tones[lo + (down ? width - 1 - idx : idx)]);
  }
  v.last = midis.at(-1);
  return line(b, rng, params, steps, midis, rate * b.stepSec * 0.85, loudness(params) * 0.9);
}

// Melodie: lange Töne, ein Akkordton auf der Eins (nahe der letzten Lage), mit drive öfter ein zweiter Ton zur Taktmitte
// (mit syncopation eine Achtel vorgezogen)
function melody(b, v, rng, params, _fill, _g, ctx) {
  const tones = tonesOf(b, ctx.scale);
  const prev = v.last ?? HOME;
  const target = prev + (HOME - prev) * 0.5;
  const near = [...tones.chord].sort((x, y) => Math.abs(x - target) - Math.abs(y - target) || x - y).slice(0, 2);
  const midis = [rng.pick(near)];
  const steps = [0];
  const half = Math.floor(b.beats / 2) * b.sub;
  if (half > 0 && rng.next() < 0.2 + 0.5 * params.drive) {
    steps.push(rng.next() < 0.6 * params.syncopation ? half - eighth(b) : half);
    midis.push(walk(tones.all, midis[0], 2 + rng.int(0, 1), rng).at(-1));
  }
  v.last = midis.at(-1);
  return line(b, rng, params, steps, midis, Infinity, loudness(params));
}

// Rhythmus einer Ruf-Phrase: 2 bis 4 Achtel in der ersten Takthälfte, mit syncopation auf der Zwei-und begonnen, eine Lücke darin
function phrase(b, rng, params) {
  const slots = [];
  for (let s = 0; s < Math.max(1, Math.ceil(b.beats / 2)) * b.sub; s += eighth(b)) slots.push(s);
  const n = 2 + rng.int(0, 1 + Math.round(params.drive));
  const from = rng.next() < 0.6 * params.syncopation ? 1 : 0;
  const pick = slots.slice(from, from + n + 1);
  if (pick.length > n) pick.splice(rng.int(1, pick.length - 1), 1);
  return pick.length ? pick : [0];
}

// Ruf und Antwort: Ruf im geraden Takt, Antwort im ungeraden mit demselben Rhythmus, endet auf einem Akkordton. Fehlt der Ruf
// (Abschnitt beginnt im ungeraden Takt), spielt die Antwort einen eigenen Rhythmus.
function callResponse(b, v, rng, params, _fill, _g, ctx) {
  const tones = tonesOf(b, ctx.scale);
  const answer = b.index % 2 === 1;
  const heard = answer && v.call?.bar === b.index - 1 ? v.call.rhythm.filter((s) => s < b.steps) : [];
  const steps = heard.length ? heard : phrase(b, rng, params);
  const midis = walk(tones.all, v.last ?? HOME, steps.length, rng);
  if (answer) midis[midis.length - 1] = nearest(tones.chord, midis.at(-1));
  else v.call = { bar: b.index, rhythm: steps };
  v.last = midis.at(-1);
  return line(b, rng, params, steps, midis, b.sub * b.stepSec, loudness(params) * (answer ? 0.92 : 1));
}

/** Aufgaben des Leads (ohne `off`): (Takt, Abschnittszustand, rng, params, Fill-Takt, Groove, { scale }) -> Noten. */
export const LEAD_JOBS = Object.freeze({ fills, arpeggio, melody, callResponse });

/**
 * Spieler für events.js: je Abschnitt ein frischer Zustand (Abschnittsanfang und -länge, letzte Lage, Ruf), `off` spielt nichts und zieht keine Zufallszahl.
 * Die Skala kommt aus der Tonart des Tracks (LEAD_SCALE).
 */
export const leadPlayer = Object.freeze({
  section: (_params, _rng, _g, sec) => ({ start: sec.start, bars: sec.bars }),
  play: (b, v, rng, params, fill, g, job, track) => {
    if (!Object.hasOwn(LEAD_JOBS, job)) return [];
    return LEAD_JOBS[job](b, v, rng, params, fill, g, { scale: scalePcs(track.key, LEAD_SCALE[track.key.mode]) });
  },
});
