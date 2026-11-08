// Merkt die Mischpult-Regler (Schichten und Gesamt, je 0..1); Stummschaltungen nicht. Der Speicher wird übergeben.
import { MIX_NAMES } from '../audio/mix.js';

export const MIX_KEY = 'backingtrack.mix';
export const DEFAULT_MIX = Object.freeze(Object.fromEntries(MIX_NAMES.map((n) => [n, 1])));

// Je Wert: Zahl in 0..1 bleibt, alles andere fällt auf 1 zurück
const sanitize = (raw) => Object.fromEntries(MIX_NAMES.map((n) => {
  const v = raw !== null && typeof raw === 'object' ? raw[n] : undefined;
  return [n, typeof v === 'number' && v >= 0 && v <= 1 ? v : 1];
}));

export function loadMix(storage) {
  try {
    const raw = storage.getItem(MIX_KEY);
    return sanitize(typeof raw === 'string' ? JSON.parse(raw) : null);
  } catch { /* kein Speicher oder kaputtes JSON: alles auf 100 % */ }
  return sanitize(null);
}

export function saveMix(storage, mix) {
  try {
    storage.setItem(MIX_KEY, JSON.stringify(sanitize(mix)));
  } catch { /* ohne Speicher gilt der Mix nur bis zum Neuladen */ }
}
