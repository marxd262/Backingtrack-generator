// Track-Format: Standardwerte und sprachfreie Validierung (nur Codes + Parameter).
import { CHORD_QUALITIES, noteToPc, isNoteName, isValidKey, allowedChords } from './music.js';

const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };

/**
 * Alle Codes, die validateTrack melden kann; die Oberfläche übersetzt sie über `err.<code>`.
 * @type {readonly ('emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar')[]}
 */
export const VALIDATION_CODES = Object.freeze([
  'emptyBars', 'chordNotInKey', 'badBpm', 'unknownQuality', 'badBeats', 'badLength', 'badKey', 'badBar',
]);

const isObject = (v) => v !== null && typeof v === 'object';
const isPosInt = (n) => Number.isInteger(n) && n > 0;
// Parameterwert ohne String(): wirft auch bei Object.create(null) nicht
const show = (v) => (typeof v === 'number' || typeof v === 'string' ? v : v === null ? 'null' : typeof v);

export function normalizeTrack(track) {
  const t = isObject(track) ? structuredClone(track) : {};
  return {
    ...t,
    meter: t.meter ?? [4, 4],
    length: t.length ?? 24,
    layers: { drums: true, bass: true, chords: true, pad: true, ...t.layers },
    tags: t.tags ?? {},
    seed: t.seed ?? 1,
  };
}

/**
 * Sammelt Meldungen, wirft nie (leer = gültig).
 * @returns {{ code: 'emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar',
 *             params: Record<string, string|number> }[]}
 */
export function validateTrack(track) {
  const t = isObject(track) ? track : {};
  const errors = [];
  const add = (code, params = {}) => errors.push({ code, params });

  if (!(Number.isFinite(t.bpm) && t.bpm > 0)) add('badBpm', { bpm: show(t.bpm) });
  if (!isPosInt(t.length)) add('badLength', { length: show(t.length) });
  const keyOk = isValidKey(t.key);
  if (!keyOk) add('badKey');
  if (!Array.isArray(t.bars) || t.bars.length === 0) {
    add('emptyBars');
    return errors;
  }

  // Tonart ungültig: Akkord-in-Tonart-Prüfung entfällt, badKey ist schon gemeldet
  const allowed = keyOk ? allowedChords(t.key).map((c) => `${noteToPc(c.root)}:${c.quality}`) : null;

  for (let i = 0; i < t.bars.length; i++) {
    const b = t.bars[i];
    const bar = i + 1;
    if (!isObject(b) || !isObject(b.chord) || typeof b.chord.root !== 'string') {
      add('badBar', { bar });
      continue;
    }
    const { root, quality } = b.chord;
    const known = typeof quality === 'string' && Object.hasOwn(CHORD_QUALITIES, quality);
    const chord = root + (known ? (SYMBOLS[quality] ?? quality) : show(quality));
    if (!isPosInt(b.beats)) add('badBeats', { bar, beats: show(b.beats) });
    if (!known) add('unknownQuality', { bar, chord });
    else if (allowed && !(isNoteName(root) && allowed.includes(`${noteToPc(root)}:${quality}`))) {
      add('chordNotInKey', { bar, chord });
    }
  }
  return errors;
}
