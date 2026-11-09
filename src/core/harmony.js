// Akkordfarbe: schreibt die Akkordarten einer Folge um (Dreiklänge, Septakkorde, Erweiterungen, Powerchords). Die Art ergibt sich aus
// der Grundart der Stufe in der Tonart (stepBase in music.js); die Dominante bekommt Dominant-Septakkord bzw. -None statt Dur-Septakkord.
// Reine Logik ohne Audio und DOM.
import { dominantRoot, noteToPc, stepBase } from './music.js';

export const CHORD_COLORS = Object.freeze(['triads', 'sevenths', 'extended', 'power']);

// Art je Farbe und Grundart der Stufe
const TABLE = {
  triads: { maj: 'maj', min: 'min', dim: 'dim' },
  sevenths: { maj: 'maj7', min: 'min7', dim: 'm7b5' },
  extended: { maj: 'add9', min: 'min9', dim: 'dim7' },
  power: { maj: 'power', min: 'power', dim: 'power' },
};
// Art der Dominante (Dur-Stufe auf dem Grundton von dominantRoot) statt der Dur-Spalte
const DOMINANT = { sevenths: 'dom7', extended: 'dom9' };

/**
 * Akkord in der Farbe, als neues Objekt. Unbekannte Farbe, unbekannte Art, ungültiger Grundton und ein Grundton ohne Stufe in der
 * Tonart bleiben unverändert (ohne Ausnahme).
 */
export function colorChord(chord, color, key) {
  if (!Object.hasOwn(TABLE, color)) return { ...chord };
  try {
    const base = stepBase(chord, key);
    if (!base) return { ...chord };
    const dominant = base === 'maj' && Object.hasOwn(DOMINANT, color) && noteToPc(chord.root) === noteToPc(dominantRoot(key));
    return { root: chord.root, quality: dominant ? DOMINANT[color] : TABLE[color][base] };
  } catch {
    return { ...chord };
  }
}

/** Alle Takte einer Folge in der Farbe (neue Takte, `beats` und alles Weitere bleibt). */
export const colorProgression = (bars, color, key) => bars.map((bar) => ({ ...bar, chord: colorChord(bar.chord, color, key) }));
