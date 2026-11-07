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

const MODES = {
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], qualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'] },
  major: { steps: [0, 2, 4, 5, 7, 9, 11], qualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'] },
};

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function noteToPc(name) {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) throw new Error(`Unknown note name: ${name}`);
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

export function diatonicChords(key) {
  const root = noteToPc(key.root);
  const { steps, qualities } = MODES[key.mode];
  // Schreibweise der Tonart folgt: Bs-Tonarten und F bekommen Bs, sonst Kreuze
  const names = key.root.includes('b') || key.root === 'F' ? FLAT_NAMES : SHARP_NAMES;
  return steps.map((s, i) => ({ root: names[(root + s) % 12], quality: qualities[i] }));
}

// Diatonisch plus Dur-Dominante in Moll (harmonisch Moll, z. B. E in A-Moll)
export function allowedChords(key) {
  const chords = diatonicChords(key);
  if (key.mode === 'minor') chords.push({ root: chords[4].root, quality: 'maj' });
  return chords;
}
