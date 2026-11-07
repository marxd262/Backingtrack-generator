// Musikbasis: Töne, Akkorde, Skalen. Reine Logik, kein Audio, kein DOM.

// Neue Akkordart = ein Eintrag hier, sonst keine Änderung.
export const CHORD_QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
};

const SCALES = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// parentMajor: Abstand zum Grundton der Dur-Tonart mit derselben Vorzeichnung (für die Schreibweise)
const MODES = {
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], qualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'], parentMajor: 3 },
  major: { steps: [0, 2, 4, 5, 7, 9, 11], qualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'], parentMajor: 0 },
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10], qualities: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'], parentMajor: -2 },
};

// Namen für Beschriftungen (i18n) und deren Tests
export const SCALE_NAMES = Object.keys(SCALES);
export const MODE_NAMES = Object.keys(MODES);

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
export function chordMidi(chord, octave) {
  const base = 12 * (octave + 1) + noteToPc(chord.root);
  return CHORD_QUALITIES[chord.quality].map((i) => base + i);
}

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

// Notenname einer Tonhöhenklasse in der Schreibweise der Tonart (wie bei den Akkorden)
export function noteName(key, pc) {
  return spelling(key, noteToPc(key.root))[((pc % 12) + 12) % 12];
}
