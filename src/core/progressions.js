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
  // dorisch lebt von der Dur-Subdominante (IV, z. B. D in A-Dorisch)
  dorian: [
    { name: 'i-IV-i-VII', degrees: [0, 3, 0, 6] },
    { name: 'i-IV-VII-IV', degrees: [0, 3, 6, 3] },
    { name: 'i-VII-IV-i', degrees: [0, 6, 3, 0] },
    { name: 'i-i-IV-i', degrees: [0, 0, 3, 0] },
  ],
  // phrygisch lebt von der Dur-Stufe einen Halbton über dem Grundton (bII, z. B. F in E-Phrygisch)
  phrygian: [
    { name: 'i-bII-i-bII', degrees: [0, 1, 0, 1] },
    { name: 'i-bII-bIII-bII', degrees: [0, 1, 2, 1] },
    { name: 'i-bvii-bII-i', degrees: [0, 6, 1, 0] },
    { name: 'i-i-bII-i', degrees: [0, 0, 1, 0] },
  ],
  // lydisch lebt von der Dur-Stufe einen Ganzton über dem Grundton (II, z. B. G in F-Lydisch)
  lydian: [
    { name: 'I-II-I-II', degrees: [0, 1, 0, 1] },
    { name: 'I-II-vii-I', degrees: [0, 1, 6, 0] },
    { name: 'I-II-I-vii', degrees: [0, 1, 0, 6] },
    { name: 'I-I-II-I', degrees: [0, 0, 1, 0] },
  ],
  // mixolydisch lebt von der Dur-Stufe einen Ganzton unter dem Grundton (bVII, z. B. F in G-Mixolydisch)
  mixolydian: [
    { name: 'I-bVII-IV-I', degrees: [0, 6, 3, 0] },
    { name: 'I-bVII-I-bVII', degrees: [0, 6, 0, 6] },
    { name: 'I-IV-bVII-IV', degrees: [0, 3, 6, 3] },
    { name: 'I-I-bVII-IV', degrees: [0, 0, 6, 3] },
  ],
};

/** Vier Akkorde der Tonart, Vorlage per Seed gewählt (gleicher Seed, gleiche Folge). */
export function progressionFor(key, seed) {
  const chords = allowedChords(key);
  const { degrees } = createRng(seed).pick(PROGRESSION_TEMPLATES[key.mode]);
  return degrees.map((i) => ({ ...chords[i] }));
}
