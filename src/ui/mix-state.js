// Merkt die Mischpult-Regler (Schichten und Gesamt, je 0..1) und die Lage je Schicht im Panorama (pan, -1 links .. 1 rechts);
// Stummschaltungen nicht. Der Speicher wird übergeben.
import { MIX_NAMES } from '../audio/mix.js';
import { MIX_TUNABLES } from '../audio/voices/tunables.js';
import { LAYER_IDS } from '../core/layers.js';

export const MIX_KEY = 'backingtrack.mix';
export const DEFAULT_MIX = Object.freeze(Object.fromEntries(MIX_NAMES.map((n) => [n, 1])));
/** Lage je Schicht, solange niemand den Pan-Knopf bewegt: die Feinwerte 'mix/pan' (derselbe Klang wie ohne Angabe). */
export const DEFAULT_PAN = Object.freeze(Object.fromEntries(LAYER_IDS.map((n) => [n, MIX_TUNABLES['mix/pan'][n].value])));

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

// Je Schicht: Zahl in -1..1 bleibt, alles andere fällt auf den Standard zurück
const sanitizePan = (raw) => Object.fromEntries(LAYER_IDS.map((n) => {
  const v = raw !== null && typeof raw === 'object' ? raw[n] : undefined;
  return [n, typeof v === 'number' && v >= -1 && v <= 1 ? v : DEFAULT_PAN[n]];
}));

/** Lage je Schicht aus demselben Speichereintrag (Feld pan); fehlt sie (älterer Eintrag), gilt der Standard. */
export function loadPan(storage) {
  try {
    const raw = storage.getItem(MIX_KEY);
    return sanitizePan(typeof raw === 'string' ? JSON.parse(raw)?.pan : null);
  } catch { /* kein Speicher oder kaputtes JSON */ }
  return sanitizePan(null);
}

/** pan (optional): die Lage je Schicht, im selben Eintrag unter pan gemerkt. */
export function saveMix(storage, mix, pan) {
  try {
    storage.setItem(MIX_KEY, JSON.stringify(pan ? { ...sanitize(mix), pan: sanitizePan(pan) } : sanitize(mix)));
  } catch { /* ohne Speicher gilt der Mix nur bis zum Neuladen */ }
}
