// Songform: Länge, Normalisierung, Prüfung und Teilsuche. Reine Funktionen, werfen nie auf JSON-artigen Eingaben.
import { PART_TYPES, TRANSITIONS, FORM_LIMITS, FEEL_DEFAULTS, DYNAMICS_MAX } from './form-types.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SECTION_KEYS = ['type', 'bars', 'level', 'density', 'transition', 'crash', 'locked'];

/** Gesamtlänge in Takten: Summe der `bars` aller Teile. */
export const formLength = (form) => (Array.isArray(form?.sections) ? form.sections.reduce((sum, s) => sum + (Number.isFinite(s?.bars) ? s.bars : 0), 0) : 0);

// nur bekannte eigene Felder kopieren; Werte bleiben, wie sie sind, damit checkForm Ungültiges sieht
const pick = (src, keys) => {
  const out = {};
  for (const k of keys) if (Object.hasOwn(src, k) && src[k] !== undefined) out[k] = src[k];
  return out;
};

/**
 * Kopie der Form mit Standard-`feel` und nur bekannten Feldern; `undefined` für `undefined`/`null`.
 * Ungültiges (kein Objekt, keine Liste ...) bleibt für `checkForm` erkennbar stehen.
 */
export function normalizeForm(form) {
  if (form == null) return undefined;
  if (!isObject(form)) return form;
  const out = pick(form, ['template', 'auto', 'sections']);
  if (Array.isArray(form.sections)) out.sections = form.sections.map((s) => (isObject(s) ? pick(s, SECTION_KEYS) : s));
  const feel = form.feel;
  out.feel = feel == null ? { ...FEEL_DEFAULTS } : isObject(feel) ? { ...FEEL_DEFAULTS, ...pick(feel, Object.keys(FEEL_DEFAULTS)) } : feel;
  return out;
}

/** Teil, in dem Takt `bar` liegt: `{ index, section, start, barInSection }`; `null` außerhalb (oder bei unbrauchbaren Teilen). */
export function sectionAt(form, bar) {
  if (!Array.isArray(form?.sections) || !Number.isInteger(bar) || bar < 0) return null;
  let start = 0;
  for (let index = 0; index < form.sections.length; index++) {
    const section = form.sections[index];
    if (!Number.isInteger(section?.bars) || section.bars < 1) return null;
    if (bar < start + section.bars) return { index, section, start, barInSection: bar - start };
    start += section.bars;
  }
  return null;
}

/** Index in `track.bars` für den Takt `barIndex`: mit Form beginnt jeder Teil bei 0 (die Form läuft im Kreis), sonst `barIndex mod bars.length`. */
export function chordIndex(track, barIndex) {
  const n = track.bars.length;
  if (!Array.isArray(track.form?.sections)) return barIndex % n;
  const total = formLength(track.form);
  const hit = total > 0 ? sectionAt(track.form, barIndex % total) : null;
  return hit ? hit.barInSection % n : barIndex % n;
}

const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Meldet jeden Fehler der Form als `add('badForm', { reason })` (kurzes englisches Stichwort); wirft nie, gültig = keine Meldung. */
export function checkForm(form, add) {
  if (form == null) return;
  const bad = (reason) => add('badForm', { reason });
  if (!isObject(form)) return bad('form');
  const { sections, feel } = form;
  if (feel != null) {
    if (!isObject(feel)) bad('feel');
    else for (const k of Object.keys(FEEL_DEFAULTS)) if (feel[k] != null && !inRange(feel[k], 0, k === 'dynamics' ? DYNAMICS_MAX : 1)) bad('feel');
  }
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > FORM_LIMITS.parts) return bad('sections');
  for (const s of sections) {
    if (!isObject(s)) { bad('sections'); continue; }
    if (!PART_TYPES.includes(s.type)) bad('type');
    if (!(Number.isInteger(s.bars) && s.bars >= 1 && s.bars <= FORM_LIMITS.bars)) bad('bars');
    if (s.level != null && !inRange(s.level, FORM_LIMITS.levelMin, FORM_LIMITS.levelMax)) bad('level');
    if (s.density != null && !inRange(s.density, FORM_LIMITS.densityMin, FORM_LIMITS.densityMax)) bad('density');
    if (s.transition != null && !TRANSITIONS.includes(s.transition)) bad('transition');
    if (s.crash != null && typeof s.crash !== 'boolean') bad('crash');
    if (s.locked != null && typeof s.locked !== 'boolean') bad('locked');
  }
  if (formLength(form) > FORM_LIMITS.length) bad('length');
}

/** Ist die Form ein Objekt und ganz gültig? Nur dann bestimmt sie die Länge des Tracks. */
export function isValidForm(form) {
  let ok = isObject(form);
  if (ok) checkForm(form, () => { ok = false; });
  return ok;
}
