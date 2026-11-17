// Musikbasis: Töne, Akkorde, Skalen. Reine Logik, kein Audio, kein DOM.

import { CHORDS } from './chords.js';

// Intervalle je Akkordart, abgeleitet aus dem Register: eine neue Akkordart ist ein Eintrag in src/core/chords.js.
export const CHORD_QUALITIES = Object.freeze(Object.fromEntries(Object.entries(CHORDS).map(([id, c]) => [id, c.intervals])));

// Leitern: Stufen ab dem Grundton der Tonart, in der Reihenfolge der Auswahl. Das Griffbrett zeigt jede davon; der Generator
// bietet nur die an, zu denen er eine passende Begleitung baut (SCALE_MODE).
export const SCALES = Object.freeze({
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  majorBlues: [0, 2, 3, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  diminished: [0, 1, 3, 4, 6, 7, 9, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
});

// parentMajor: Abstand zum Grundton der Dur-Tonart mit derselben Vorzeichnung (für die Schreibweise);
// dominant: Index der Dominanten-Stufe in diatonicChords (Dur V, Dorisch IV mit der Dur-Subdominante; Moll V, dort ist die Dur-Dominante ergänzt);
// in den übrigen Kirchentönen die Dur-Stufe, deren Septakkord in der Leiter ein Dominantseptakkord ist (Phrygisch bIII, Lydisch II, Mixolydisch I)
const MODES = {
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], qualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'], parentMajor: 3, dominant: 4 },
  major: { steps: [0, 2, 4, 5, 7, 9, 11], qualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'], parentMajor: 0, dominant: 4 },
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10], qualities: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'], parentMajor: -2, dominant: 3 },
  phrygian: { steps: [0, 1, 3, 5, 7, 8, 10], qualities: ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'], parentMajor: -4, dominant: 2 },
  lydian: { steps: [0, 2, 4, 6, 7, 9, 11], qualities: ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'], parentMajor: -5, dominant: 1 },
  mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], qualities: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'], parentMajor: 5, dominant: 0 },
};

export const MODE_NAMES = Object.keys(MODES);
// Skala ist nur Oberflächen-Zustand; der Generator kennt nur den Modus. Hier stehen die Leitern, die der Generator anbietet, mit dem
// Modus ihrer Begleitung. Die übrigen (Melodisch Moll, Lokrisch, Phrygisch-Dominant, Ganzton, vermindert, alteriert) fehlen: zu ihnen
// baut er keine Akkordfolge, die zur Leiter passt.
export const SCALE_MODE = {
  minorPentatonic: 'minor', majorPentatonic: 'major', blues: 'minor', majorBlues: 'major', major: 'major', minor: 'minor', harmonicMinor: 'minor',
  dorian: 'dorian', phrygian: 'phrygian', lydian: 'lydian', mixolydian: 'mixolydian',
};
// Leitern des Generators: Namen für Auswahl, Beschriftungen (i18n) und deren Tests
export const SCALE_NAMES = Object.keys(SCALE_MODE);

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const NOTE_RE = /^([A-G])([#b]?)$/;

export const isNoteName = (name) => typeof name === 'string' && NOTE_RE.test(name);

// Gültige Tonart: Objekt mit bekanntem Grundton und bekanntem Modus (nur eigene Einträge von MODES)
export const isValidKey = (key) =>
  key !== null && typeof key === 'object' && isNoteName(key.root) && typeof key.mode === 'string' && Object.hasOwn(MODES, key.mode);

export function noteToPc(name) {
  const m = typeof name === 'string' ? NOTE_RE.exec(name) : null;
  if (!m) throw new Error(`Unknown note name: ${String(name)}`);
  return (LETTER_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

// MIDI = 12 * (Oktave + 1) + Tonhöhenklasse + Intervall, also A in Oktave 3 = 57
export function chordTones(chord, octave) {
  const base = 12 * (octave + 1) + noteToPc(chord.root);
  return CHORDS[chord.quality].intervals.map((i) => base + i);
}
export const chordMidi = chordTones; // bisheriger Name

export function scalePcs(key, scale) {
  const root = noteToPc(key.root);
  return SCALES[scale].map((i) => (root + i) % 12);
}

// Dur-Tonarten mit b-Vorzeichnung: F, Bb, Eb, Ab, Db, Gb
const FLAT_MAJOR_PCS = [5, 10, 3, 8, 1, 6];

// Kreuze oder Bs: ein Vorzeichen am Grundton gilt, sonst die Vorzeichnung der zugehörigen Dur-Tonart
function spelling(key, root) {
  if (key.root.endsWith('#')) return SHARP_NAMES;
  if (key.root.endsWith('b')) return FLAT_NAMES;
  return FLAT_MAJOR_PCS.includes((root + MODES[key.mode].parentMajor + 12) % 12) ? FLAT_NAMES : SHARP_NAMES;
}

export function diatonicChords(key) {
  const root = noteToPc(key.root);
  const { steps, qualities } = MODES[key.mode];
  const names = spelling(key, root);
  return steps.map((s, i) => ({ root: names[(root + s) % 12], quality: qualities[i] }));
}

// Diatonisch plus Dur-Dominante in Moll (harmonisch Moll, z. B. E in A-Moll)
export function allowedChords(key) {
  const chords = diatonicChords(key);
  if (key.mode === 'minor') chords.push({ root: chords[4].root, quality: 'maj' });
  return chords;
}

/** Grundton der Dominanten-Stufe in der Schreibweise der Tonart (Dorisch: die Dur-Stufe IV). */
export function dominantRoot(key) {
  return diatonicChords(key)[MODES[key.mode].dominant].root;
}

/**
 * Grundart (maj, min, dim) der Stufe, zu der ein Akkord in der Tonart gehört. Hat die Art nur eine erlaubte Grundart, ist es diese
 * (so bleibt E7 in A-Moll die Dur-Dominante); sonst die Grundart der diatonischen Stufe auf diesem Grundton (E in A-Moll ist Em).
 * null bei unbekannter Art oder einem Grundton, der in der Tonart keine Stufe ist.
 */
export function stepBase(chord, key) {
  const spec = Object.hasOwn(CHORDS, chord.quality) ? CHORDS[chord.quality] : null;
  if (!spec) return null;
  const pc = noteToPc(chord.root);
  const step = diatonicChords(key).find((c) => noteToPc(c.root) === pc);
  if (!step) return null; // der Grundton ist keine Stufe der Tonart
  return spec.on.length === 1 ? spec.on[0] : step.quality;
}

/**
 * Auswahl für die Oberfläche: ein Eintrag je Grundton der Tonart in Stufenreihenfolge, mit den dort erlaubten Akkordarten in
 * Registerreihenfolge. In Moll vereint der Grundton der Dur-Dominante die Arten der Moll-Stufe und der Dur-Stufe.
 */
export function chordOptions(key) {
  const byPc = new Map();
  for (const { root, quality } of allowedChords(key)) {
    const pc = noteToPc(root);
    if (!byPc.has(pc)) byPc.set(pc, { root, bases: new Set() });
    byPc.get(pc).bases.add(quality);
  }
  return [...byPc.values()].map(({ root, bases }) => ({
    root,
    qualities: Object.keys(CHORDS).filter((id) => CHORDS[id].on.some((b) => bases.has(b))),
  }));
}

// Notenname einer Tonhöhenklasse in der Schreibweise der Tonart (wie bei den Akkorden)
export function noteName(key, pc) {
  return spelling(key, noteToPc(key.root))[((pc % 12) + 12) % 12];
}
