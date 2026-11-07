// Track-Format: Standardwerte und sprachfreie Validierung (nur Codes + Parameter).
import { CHORD_QUALITIES, noteToPc, allowedChords } from './music.js';

const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };

const isPosInt = (n) => Number.isInteger(n) && n > 0;

// Wirft nicht: unbekannter Tonname ergibt null
function pcOrNull(name) {
  try { return noteToPc(name); } catch { return null; }
}

export function normalizeTrack(track) {
  const t = structuredClone(track);
  return {
    ...t,
    meter: t.meter ?? [4, 4],
    length: t.length ?? 24,
    layers: { drums: true, bass: true, chords: true, pad: true, ...t.layers },
    tags: t.tags ?? {},
    seed: t.seed ?? 1,
  };
}

export function validateTrack(track) {
  const errors = [];
  const add = (code, params = {}) => errors.push({ code, params });

  if (!(Number.isFinite(track.bpm) && track.bpm > 0)) add('badBpm', { bpm: String(track.bpm) });
  if (!isPosInt(track.length)) add('badLength', { length: String(track.length) });
  if (!Array.isArray(track.bars) || track.bars.length === 0) {
    add('emptyBars');
    return errors;
  }

  // Schlüssel mit unbekanntem Grundton: keine Tonart-Prüfung möglich, aber auch kein Wurf
  const keyOk = pcOrNull(track.key?.root) !== null && track.key.mode in { minor: 1, major: 1 };
  const allowed = keyOk ? allowedChords(track.key).map((c) => `${noteToPc(c.root)}:${c.quality}`) : null;

  track.bars.forEach((b, i) => {
    const bar = i + 1;
    const { root, quality } = b.chord;
    const chord = root + (SYMBOLS[quality] ?? quality);
    if (!isPosInt(b.beats)) add('badBeats', { bar, beats: String(b.beats) });
    if (!(quality in CHORD_QUALITIES)) return add('unknownQuality', { bar, chord });
    if (allowed && !allowed.includes(`${pcOrNull(root)}:${quality}`)) add('chordNotInKey', { bar, chord });
  });
  return errors;
}
