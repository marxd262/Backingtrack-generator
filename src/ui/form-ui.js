// Songform-Oberfläche, reine Helfer ohne DOM: Geometrie der Blöcke, Beschriftungen und die Bearbeitungen der Teile (Form rein, Form raus).
// Jede Bearbeitung liefert { form, index } (index = neue Auswahl) oder null, wenn sie nicht erlaubt ist. Der Aufrufer setzt Länge und Zustand.
import { t } from '../i18n/index.js';
import { PART_TYPES, TRANSITIONS, FORM_LIMITS, resolveSection } from '../core/form-types.js';
import { formLength, isValidForm } from '../core/form.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = ([a, b]) => (a + b) / 2;
/** Höhe eines Blocks (Anteil 0.4..1) aus dem mittleren Pegel in dB: Refrain (0 dB) ganz, ab -12 dB die Mindesthöhe. */
export const levelHeight = (db) => 0.4 + 0.6 * clamp(1 + db / 12, 0, 1);

/** dB mit echtem Minuszeichen, ganzzahlig: -3 -> "−3 dB". */
const num = (n) => String(Math.round(n)).replace('-', '−');
const dbText = (n) => `${num(n)} dB`;
const range = ([a, b], unit) => (Math.round(a) === Math.round(b) ? `${num(a)}${unit}` : `${num(a)} … ${num(b)}${unit}`);

/** Takte mit Einheit: "8 Takte", "1 Takt". */
export const barsText = (n) => t(n === 1 ? 'form.bars.one' : 'ui.barsCount', { n });

/**
 * Blöcke des Streifens: Breite (Anteil an der Gesamtlänge), Höhe (Anteil, nach mittlerem Pegel), Takte von/bis (1-basiert).
 * Eine ungültige Form liefert keine Blöcke (der Streifen zeigt dann einen Hinweis).
 */
export function stripBlocks(form) {
  if (!isValidForm(form)) return [];
  const total = formLength(form);
  let start = 0;
  return form.sections.map((section, index) => {
    const r = resolveSection(section, form.feel);
    const block = { index, type: section.type, bars: section.bars, from: start + 1, to: start + section.bars, width: section.bars / total, height: levelHeight(mean(r.level)), locked: r.locked };
    start += section.bars;
    return block;
  });
}

/** Beschriftung des Pegels: "Standard (−3 dB)" solange nicht gesetzt (Anstieg: "−4 … −1 dB"), sonst der gesetzte Wert. */
export function levelLabel(section, feel) {
  if (section.level != null) return dbText(section.level);
  return t('form.insp.default', { v: `${range(resolveSection(section, feel).level, '')} dB` });
}

/** Beschriftung der Dichte in Prozent, gleiche Regeln wie beim Pegel. */
export function densityLabel(section, feel) {
  const pct = (list) => list.map((x) => x * 100);
  if (section.density != null) return t('ui.percent', { n: num(section.density * 100) });
  return t('form.insp.default', { v: t('ui.percent', { n: range(pct(resolveSection(section, feel).density), '') }) });
}

/** Wert für den Regler: der gesetzte, sonst der Mittelwert des Standards (gerundet). */
export const levelValue = (section, feel) => Math.round(section.level ?? mean(resolveSection(section, feel).level));
export const densityValue = (section, feel) => Math.round((section.density ?? mean(resolveSection(section, feel).density)) * 100);

/** Was geht gerade? `reasons` nennt die Gründe der gesperrten Knöpfe (Schlüssel der Texte). */
export function limits(form, index) {
  const parts = form.sections.length;
  const total = formLength(form);
  const bars = form.sections[index]?.bars ?? 0;
  const roomParts = parts < FORM_LIMITS.parts;
  const canAdd = roomParts && total + 8 <= FORM_LIMITS.length;
  const canCopy = roomParts && total + bars <= FORM_LIMITS.length;
  const canLonger = bars < FORM_LIMITS.bars && total < FORM_LIMITS.length;
  const reasons = [];
  if (!roomParts) reasons.push('form.limit.parts');
  else if (!canAdd || !canCopy || total >= FORM_LIMITS.length) reasons.push('form.limit.length');
  if (bars >= FORM_LIMITS.bars) reasons.push('form.limit.part');
  if (parts === 1) reasons.push('form.limit.last');
  return { canAdd, canCopy, canLonger, canShorter: bars > 1, canDelete: parts > 1, canLeft: index > 0, canRight: index < parts - 1, reasons };
}

const replace = (form, sections) => ({ ...form, sections });
// Feld setzen oder (undefined) entfernen; ein bearbeiteter Teil wird gesperrt
const patched = (section, patch) => {
  const next = { ...section, ...patch, locked: true };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete next[k];
  return next;
};

const EDITABLE = ['type', 'bars', 'level', 'density', 'transition', 'crash'];

/**
 * Felder eines Teils ändern und den Teil sperren. Nur die bekannten Felder; Typ und Übergang aus den festen Listen, Takte 1..64 ganzzahlig und
 * die Summe höchstens 512, Pegel und Dichte werden auf ihre Grenzen geklemmt, `undefined` entfernt das Feld (Zurücksetzen).
 * Die Form muss danach gültig sein, sonst null.
 */
export function editPart(form, index, patch) {
  const s = form.sections[index];
  if (!s || Object.keys(patch).some((k) => !EDITABLE.includes(k))) return null;
  const next = { ...patch };
  const num = (k, lo, hi) => {
    if (next[k] === undefined) return true;
    if (!Number.isFinite(next[k])) return false;
    next[k] = clamp(next[k], lo, hi);
    return true;
  };
  if ('type' in next && !PART_TYPES.includes(next.type)) return null;
  if ('transition' in next && next.transition !== undefined && !TRANSITIONS.includes(next.transition)) return null;
  if ('crash' in next && next.crash !== undefined && typeof next.crash !== 'boolean') return null;
  if (!num('level', FORM_LIMITS.levelMin, FORM_LIMITS.levelMax) || !num('density', FORM_LIMITS.densityMin, FORM_LIMITS.densityMax)) return null;
  if ('bars' in next) {
    const bars = Math.round(next.bars);
    if (!(bars >= 1 && bars <= FORM_LIMITS.bars) || formLength(form) - s.bars + bars > FORM_LIMITS.length) return null;
    next.bars = bars;
  }
  const result = replace(form, form.sections.map((x, i) => (i === index ? patched(x, next) : x)));
  return isValidForm(result) ? { form: result, index } : null;
}

/** Sperre umschalten; das ist keine Bearbeitung und sperrt nichts nebenbei. */
export function setLocked(form, index, locked) {
  if (!form.sections[index]) return null;
  return { form: replace(form, form.sections.map((x, i) => (i === index ? { ...x, locked } : x))), index };
}

/** Neuer Teil am Ende: Strophe, 8 Takte, gesperrt (bleibt beim Neuwürfeln). */
export function addPart(form) {
  if (!limits(form, 0).canAdd) return null;
  return { form: replace(form, [...form.sections, { type: 'verse', bars: 8, locked: true }]), index: form.sections.length };
}

/** Kopie direkt hinter dem Teil (gesperrt). */
export function copyPart(form, index) {
  const s = form.sections[index];
  if (!s || !limits(form, index).canCopy) return null;
  const sections = [...form.sections];
  sections.splice(index + 1, 0, { ...s, locked: true });
  return { form: replace(form, sections), index: index + 1 };
}

/** Löschen; der letzte verbleibende Teil bleibt. Die Auswahl rückt auf den Nachbarn. */
export function deletePart(form, index) {
  if (!form.sections[index] || form.sections.length < 2) return null;
  return { form: replace(form, form.sections.filter((_, i) => i !== index)), index: Math.min(index, form.sections.length - 2) };
}

/** Teil um einen Platz verschieben (dir -1 links, +1 rechts); die Auswahl folgt, der verschobene Teil wird gesperrt (jede Bearbeitung sperrt). */
export function movePart(form, index, dir) {
  const to = index + dir;
  if (!form.sections[index] || !form.sections[to]) return null;
  const sections = [...form.sections];
  [sections[index], sections[to]] = [sections[to], { ...sections[index], locked: true }];
  return { form: replace(form, sections), index: to };
}
