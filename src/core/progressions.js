// Akkordfolgen aus Vorlagen je Modus. Reine Logik, kein Audio, kein DOM.
import { allowedChords } from './music.js';
import { createRng } from './rng.js';

// Stufen als Index in allowedChords(key): 0..6 diatonisch, in Moll ist 7 die Dur-Dominante (V)
export const PROGRESSION_TEMPLATES = {
  minor: [
    { name: 'i-i-iv-V', degrees: [0, 0, 3, 7] },
    { name: 'i-VI-III-VII', degrees: [0, 5, 2, 6] },
    { name: 'i-VII-VI-VII', degrees: [0, 6, 5, 6] },
    { name: 'i-iv-i-V', degrees: [0, 3, 0, 7] },
  ],
  major: [
    { name: 'I-V-vi-IV', degrees: [0, 4, 5, 3] },
    { name: 'I-IV-V-IV', degrees: [0, 3, 4, 3] },
    { name: 'I-vi-IV-V', degrees: [0, 5, 3, 4] },
    { name: 'I-I-IV-V', degrees: [0, 0, 3, 4] },
  ],
};

/** Vier Akkorde der Tonart, Vorlage per Seed gewählt (gleicher Seed, gleiche Folge). */
export function progressionFor(key, seed) {
  const chords = allowedChords(key);
  const { degrees } = createRng(seed).pick(PROGRESSION_TEMPLATES[key.mode]);
  return degrees.map((i) => ({ ...chords[i] }));
}
