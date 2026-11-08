// Klangmodell: Schlagworte -> Klangwerte je Instrument (alle in [0,1]). Reine Logik, kein Audio/DOM, kein Zufall.
import { collectTags } from './tags.js';
import { createRng } from './rng.js';
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

/**
 * Füllt ein unvollständiges oder ungültiges Klangmodell Feld für Feld aus DEFAULT_TIMBRE auf (neue Kopie).
 * Nur endliche Zahlen zählen, begrenzt auf [0,1]; unbekannte Gruppen und Felder fallen weg.
 */
export function completeTimbre(timbre) {
  const result = structuredClone(DEFAULT_TIMBRE);
  // Arrays zählen nicht als Objekt, sonst würde ihr `length` zu chords.length
  const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isRecord(timbre)) return result;
  for (const [group, fields] of Object.entries(result)) {
    const given = timbre[group];
    if (!isRecord(given)) continue;
    for (const key of Object.keys(fields)) if (Number.isFinite(given[key])) fields[key] = clamp01(given[key]);
  }
  return result;
}

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

// Felder, die der Seed mit dem Track-Schalter `variety` leicht verschiebt (höchstens ±DRIFT_SPAN)
const DRIFT_FIELDS = ['drums.snareTone', 'drums.hatBright', 'bass.cutoff', 'chords.brightness', 'pad.cutoff', 'pad.lfoSpeed', 'master.echo'];
const DRIFT_SPAN = 0.08;

/**
 * Klangmodell eines Tracks: die Schlagworte (resolveTimbre), mit `variety` und endlichem `seed` ein kleiner Klang-Drift,
 * darüber je Feld die Überschreibungen aus `track.timbre` (die Regler des Nutzers gewinnen immer).
 * Nur endliche Zahlen zählen (auf [0,1] begrenzt); Unbekanntes und Ungültiges wird ignoriert. Neue Kopie.
 */
export function resolveTrackTimbre(track) {
  const timbre = resolveTimbre(track?.tags);
  if (track?.variety === true && Number.isFinite(track.seed)) {
    const rng = createRng(track.seed).fork('timbre-drift');
    for (const path of DRIFT_FIELDS) {
      const [group, field] = path.split('.');
      timbre[group][field] = clamp01(timbre[group][field] + (rng.next() * 2 - 1) * DRIFT_SPAN);
    }
  }
  const over = track?.timbre;
  const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isRecord(over)) return timbre;
  for (const [group, fields] of Object.entries(timbre)) {
    if (!isRecord(over[group])) continue;
    for (const key of Object.keys(fields)) if (Number.isFinite(over[group][key])) fields[key] = clamp01(over[group][key]);
  }
  return timbre;
}
