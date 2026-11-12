// Track-Format: Standardwerte und sprachfreie Validierung (nur Codes + Parameter).
import { noteToPc, isNoteName, isValidKey, allowedChords } from './music.js';
import { CHORDS, isChordQuality, chordName } from './chords.js';
import { isMeter, GROOVES } from './grooves.js';
import { TAG_CATEGORIES } from './tags.js';
import { layerDefaults, completeJobs, isJob } from './layers.js';
import { VOICE_LAYERS, isVoice } from './voices.js';
import { normalizeForm, checkForm, isValidForm, formLength } from './form.js';

/**
 * Alle Codes, die validateTrack melden kann; die Oberfläche übersetzt sie über `err.<code>`.
 * @type {readonly ('emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar'|'badTags'|'badMeter'|'badComplexity'|'badGroove'|'badVoice'|'badJob'|'badForm')[]}
 */
export const VALIDATION_CODES = Object.freeze([
  'emptyBars', 'chordNotInKey', 'badBpm', 'unknownQuality', 'badBeats', 'badLength', 'badKey', 'badBar', 'badTags', 'badMeter', 'badComplexity', 'badGroove', 'badVoice', 'badJob', 'badForm',
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

// Standard-Aufgaben, darüber die gegebenen (null zählt als fehlend). Ungültiges bleibt stehen, damit validateTrack es meldet
// (completeJobs allein würde es still durch den Standard ersetzen).
function normalizeJobs(jobs) {
  if (jobs != null && (!isObject(jobs) || Array.isArray(jobs))) return jobs;
  return { ...completeJobs(), ...Object.fromEntries(Object.entries(jobs ?? {}).filter(([, v]) => v != null)) };
}

export function normalizeTrack(track) {
  const t = isObject(track) ? structuredClone(track) : {};
  // Songform: bei gültiger Form ist die Länge abgeleitet (Summe der Teile); ohne Form bleibt alles wie bisher
  const form = normalizeForm(t.form);
  return {
    ...t,
    ...(form !== undefined && { form }),
    meter: t.meter ?? [4, 4],
    length: isValidForm(form) ? formLength(form) : t.length ?? 24,
    layers: { ...layerDefaults(), ...t.layers },
    jobs: normalizeJobs(t.jobs),
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

// voices: fehlend/null oder { Schicht aus VOICE_LAYERS: fehlend/null | Stimmen-ID | { id?, variant? } }; meldet Schicht und Stimme (id oder id/variant)
function checkVoices(voices, add) {
  if (voices == null) return;
  if (!isObject(voices) || Array.isArray(voices)) {
    add('badVoice', { layer: '?', voice: show(voices) });
    return;
  }
  for (const [layer, given] of Object.entries(voices)) {
    if (!VOICE_LAYERS.includes(layer)) { add('badVoice', { layer, voice: given == null ? '?' : show(isObject(given) ? given.id : given) }); continue; }
    if (given == null) continue;
    const rec = isObject(given) && !Array.isArray(given) ? given : null;
    const id = rec ? rec.id : given;
    const variant = rec ? rec.variant : undefined;
    const ok = rec ? (id === undefined ? variant === undefined : isVoice(layer, id) && (variant === undefined || isVoice(layer, id, variant))) : isVoice(layer, id);
    if (!ok) add('badVoice', { layer, voice: variant === undefined ? show(id) : `${show(id)}/${show(variant)}` });
  }
}

// jobs: fehlend/null oder { Schicht: Aufgabe }; meldet Schicht und Aufgabe (null je Schicht zählt als fehlend und gibt die erste Aufgabe)
function checkJobs(jobs, add) {
  if (jobs == null) return;
  if (!isObject(jobs) || Array.isArray(jobs)) {
    add('badJob', { layer: '?', job: show(jobs) });
    return;
  }
  for (const [layer, job] of Object.entries(jobs)) if (job != null && !isJob(layer, job)) add('badJob', { layer, job: show(job) });
}

/**
 * Sammelt Meldungen, wirft nie (leer = gültig). bpm muss in [20, 400] liegen, length in [1, MAX_LENGTH],
 * beats in [1, MAX_BEATS].
 * @returns {{ code: 'emptyBars'|'chordNotInKey'|'badBpm'|'unknownQuality'|'badBeats'|'badLength'|'badKey'|'badBar'|'badTags'|'badMeter'|'badComplexity'|'badGroove'|'badVoice'|'badJob'|'badForm',
 *             params: Record<string, string|number> }[]}
 */
export function validateTrack(track) {
  const t = isObject(track) ? track : {};
  const errors = [];
  const add = (code, params = {}) => errors.push({ code, params });

  if (!(Number.isFinite(t.bpm) && t.bpm >= MIN_BPM && t.bpm <= MAX_BPM)) add('badBpm', { bpm: show(t.bpm) });
  if (!isPosInt(t.length) || t.length > MAX_LENGTH) add('badLength', { length: show(t.length) });
  // Taktart: fehlend oder null gilt 4/4; sonst eine der unterstützten (Text für die Meldung '2/4', bei Unbrauchbarem '?')
  if (t.meter != null && !isMeter(t.meter)) add('badMeter', { meter: Array.isArray(t.meter) && t.meter.length === 2 ? t.meter.join('/') : '?' });
  // Groove: fehlend oder null gilt der Standard der Taktart; sonst eine ID des Registers (einer anderen Taktart wird durch den Standard ersetzt)
  if (t.groove != null && !(typeof t.groove === 'string' && Object.hasOwn(GROOVES, t.groove))) add('badGroove', { groove: show(t.groove) });
  // Komplexität: fehlend oder null gilt 0,5; sonst eine endliche Zahl von 0 bis 1
  if (t.complexity != null && !(Number.isFinite(t.complexity) && t.complexity >= 0 && t.complexity <= 1)) add('badComplexity', { complexity: show(t.complexity) });
  checkVoices(t.voices, add);
  checkJobs(t.jobs, add);
  checkForm(t.form, add);
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
