// Klangmodell: Schlagworte -> Klangwerte je Instrument (alle in [0,1]). Reine Logik, kein Audio/DOM, kein Zufall.
import { collectTags } from './tags.js';
import { TIMBRE_EFFECTS } from './timbre-effects.js';

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

export const DEFAULT_TIMBRE = deepFreeze({
  drums: { kickPunch: 0.5, kickLength: 0.5, snareTone: 0.5, snareSnap: 0.5, hatBright: 0.5, hatLength: 0.5, room: 0 },
  bass: { sub: 0, fuzz: 0, pluck: 0.5, cutoff: 0.5, resonance: 0.5, roundness: 0 },
  chords: { brightness: 0.5, length: 0.5, chorus: 0, tremolo: 0 },
  pad: { attack: 0.5, cutoff: 0.5, lfoSpeed: 0.5, lfoDepth: 0.5, shimmer: 0, thickness: 0.5 },
  master: { brightness: 0.5, echo: 0.5, reverb: 0.5 },
});

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Gleiche Eingaben wie resolveTags; Schlagworte addieren sich, Ergebnis ist eine neue, begrenzte Kopie. */
export function resolveTimbre(tags) {
  const timbre = structuredClone(DEFAULT_TIMBRE);
  for (const tag of collectTags(tags)) {
    for (const [path, delta] of Object.entries(TIMBRE_EFFECTS[tag] ?? {})) {
      const [group, field] = path.split('.');
      timbre[group][field] += delta;
    }
  }
  for (const fields of Object.values(timbre)) {
    for (const key of Object.keys(fields)) fields[key] = clamp01(fields[key]);
  }
  return timbre;
}
