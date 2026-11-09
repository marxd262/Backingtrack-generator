// Track-Format: Standardwerte und sprachfreie Validierung (nur Codes + Parameter).
import { noteToPc, isNoteName, isValidKey, allowedChords } from './music.js';
import { CHORDS, isChordQuality, chordName } from './chords.js';
import { TAG_CATEGORIES } from './tags.js';


/**
 * Alle Codes, die validateTrack melden kann; die Oberfläche übersetzt sie über `err.<code>`.
 * @type {readonly ('emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar'|'badTags')[]}
 */
export const VALIDATION_CODES = Object.freeze([
  'emptyBars', 'chordNotInKey', 'badBpm', 'unknownQuality', 'badBeats', 'badLength', 'badKey', 'badBar', 'badTags',
]);

/** Obergrenze für `length` (Takte); schützt Arrangement und Audio vor riesigen Eingaben. */
export const MAX_LENGTH = 512;
/** Obergrenze für `beats` je Takt; mehr Schläge erzeugen unhandlich viele Ereignisse je Takt. */
export const MAX_BEATS = 16;
const MIN_BPM = 20;
const MAX_BPM = 400;

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

// tags: fehlend/null oder {Kategorie: [Schlagwort-IDs]}; meldet Kategorie und Schlagwort, soweit bekannt
function checkTags(tags, add) {
  if (tags == null) return;
  if (!isObject(tags) || Array.isArray(tags)) {
    add('badTags');
    return;
  }
  for (const [category, list] of Object.entries(tags)) {
    const known = TAG_CATEGORIES.find((c) => c.id === category);
    if (!known || !Array.isArray(list)) add('badTags', { category });
    else for (const tag of list) if (!known.tags.includes(tag)) add('badTags', { category, tag: show(tag) });
  }
}

/**
 * Sammelt Meldungen, wirft nie (leer = gültig). bpm muss in [20, 400] liegen, length in [1, MAX_LENGTH],
 * beats in [1, MAX_BEATS].
 * @returns {{ code: 'emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar'|'badTags',
 *             params: Record<string, string|number> }[]}
 */
export function validateTrack(track) {
  const t = isObject(track) ? track : {};
  const errors = [];
  const add = (code, params = {}) => errors.push({ code, params });

  if (!(Number.isFinite(t.bpm) && t.bpm >= MIN_BPM && t.bpm <= MAX_BPM)) add('badBpm', { bpm: show(t.bpm) });
  if (!isPosInt(t.length) || t.length > MAX_LENGTH) add('badLength', { length: show(t.length) });
  const keyOk = isValidKey(t.key);
  if (!keyOk) add('badKey');
  checkTags(t.tags, add);
  if (!Array.isArray(t.bars) || t.bars.length === 0) {
    add('emptyBars');
    return errors;
  }

  // Tonart ungültig: Akkord-in-Tonart-Prüfung entfällt, badKey ist schon gemeldet
  // Stufen der Tonart als [Tonhöhe, Grundart]; eine Akkordart darf auf einer Stufe stehen, wenn ihr `on` die Grundart enthält
  const steps = keyOk ? allowedChords(t.key).map((c) => [noteToPc(c.root), c.quality]) : null;

  for (let i = 0; i < t.bars.length; i++) {
    const b = t.bars[i];
    const bar = i + 1;
    if (!isObject(b) || !isObject(b.chord) || typeof b.chord.root !== 'string') {
      add('badBar', { bar });
      continue;
    }
    const { root, quality } = b.chord;
    const known = isChordQuality(quality);
    const chord = known ? chordName({ root, quality }) : root + show(quality);
    if (!isPosInt(b.beats) || b.beats > MAX_BEATS) add('badBeats', { bar, beats: show(b.beats) });
    if (!known) add('unknownQuality', { bar, chord });
    else if (steps && !(isNoteName(root) && steps.some(([pc, base]) => pc === noteToPc(root) && CHORDS[quality].on.includes(base)))) {
      add('chordNotInKey', { bar, chord });
    }
  }
  return errors;
}
