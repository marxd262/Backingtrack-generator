import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';
import { t, setLanguage, getLanguage, detectLanguage } from '../../src/i18n/index.js';
import { TAG_CATEGORIES, STYLE_PRESETS } from '../../src/core/tags.js';
import { VALIDATION_CODES } from '../../src/core/track.js';
import { SCALE_NAMES, MODE_NAMES } from '../../src/core/music.js';
import { CHORDS, CHORD_GROUPS } from '../../src/core/chords.js';
import { GROOVES } from '../../src/core/grooves.js';

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const placeholders = (s) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort();

// Sprache vor jedem Test und am Ende zurücksetzen, damit die Reihenfolge egal ist
beforeEach(() => setLanguage('de'));
after(() => setLanguage('de'));

test('de und en haben exakt dieselben Schlüssel, alle Werte sind nicht leere Strings', () => {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  for (const dict of [de, en]) {
    for (const [k, v] of Object.entries(dict)) assert.ok(typeof v === 'string' && v.trim() !== '', k);
  }
});

test('jede Kategorie, jedes Schlagwort, Stil, Schicht, Skala, Modus und Fehlercode hat einen Schlüssel', () => {
  const keys = [];
  for (const c of TAG_CATEGORIES) {
    keys.push(`category.${c.id}`);
    for (const tag of c.tags) keys.push(`tag.${c.id}.${tag}`);
  }
  for (const s of STYLE_PRESETS) keys.push(`style.${s.id}`, `style.${s.id}.hint`);
  for (const l of LAYERS) keys.push(`layer.${l}`);
  for (const s of SCALE_NAMES) keys.push(`scale.${s}`);
  for (const m of MODE_NAMES) keys.push(`mode.${m}`);
  for (const c of VALIDATION_CODES) keys.push(`err.${c}`);
  assert.ok(keys.length > 40);
  for (const k of keys) {
    assert.ok(Object.hasOwn(de, k), `de: ${k}`);
    assert.ok(Object.hasOwn(en, k), `en: ${k}`);
  }
});

test('jede Akkordart des Registers, jede Gruppe und jede Akkordfarbe hat in beiden Sprachen einen Namen', () => {
  const keys = [
    ...Object.keys(CHORDS).map((id) => `chord.${id}`),
    ...CHORD_GROUPS.map((g) => `chordGroup.${g}`),
    ...['triads', 'sevenths', 'extended', 'power'].map((c) => `chordColor.${c}`),
    'ui.addRoot', 'ui.addQuality', 'ui.chordColor',
  ];
  assert.equal(keys.length, Object.keys(CHORDS).length + 3 + 4 + 3);
  for (const k of keys) {
    for (const [lang, dict] of [['de', de], ['en', en]]) {
      assert.ok(Object.hasOwn(dict, k), `${lang}: ${k}`);
      assert.ok(typeof dict[k] === 'string' && dict[k].trim() !== '' && dict[k] !== k, `${lang}: ${k} leer`);
    }
  }
});

test('jeder Groove des Registers hat in beiden Sprachen einen Namen und die Gruppen- und Reglertexte sind da', () => {
  const keys = [...Object.keys(GROOVES).map((id) => `groove.${id}`), 'group.rhythm', 'ui.meter', 'ui.groove', 'ui.complexity'];
  for (const k of keys) {
    for (const [lang, dict] of [['de', de], ['en', en]]) {
      assert.ok(Object.hasOwn(dict, k), `${lang}: ${k}`);
      assert.ok(typeof dict[k] === 'string' && dict[k].trim() !== '' && dict[k] !== k, `${lang}: ${k} leer`);
    }
  }
});

test('Platzhalter stimmen in beiden Sprachen für jeden Schlüssel überein', () => {
  for (const k of Object.keys(de)) assert.deepEqual(placeholders(de[k]), placeholders(en[k]), k);
});

test('t: Sprachwechsel, Standard de', () => {
  assert.equal(getLanguage(), 'de');
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('ui.go'), 'Go');
  setLanguage('de');
  assert.equal(t('ui.go'), 'Los');
});

test('t: Platzhalter werden ersetzt, fehlende bleiben sichtbar, unbekannter Schlüssel liefert den Schlüssel', () => {
  for (const lang of ['de', 'en']) {
    setLanguage(lang);
    assert.ok(t('err.chordNotInKey', { chord: 'C#', bar: 3 }).includes('C#'), lang);
    assert.ok(t('err.chordNotInKey', { chord: 'C#', bar: 3 }).includes('3'), lang);
    assert.ok(t('err.chordNotInKey', { bar: 3 }).includes('{chord}'), lang);
    assert.ok(!t('err.chordNotInKey').includes('undefined'), lang);
  }
  assert.equal(t('does.not.exist'), 'does.not.exist');
  assert.equal(t('does.not.exist', { a: 1 }), 'does.not.exist');
});

test('t: Platzhalter in ui.keyScale', () => {
  assert.equal(t('ui.keyScale', { root: 'A', scale: 'x' }), 'A-x');
});

test('detectLanguage', () => {
  for (const l of ['de', 'de-AT', 'DE']) assert.equal(detectLanguage(l), 'de', l);
  for (const l of [undefined, null, '', 'fr', 'en-US', 42, {}]) assert.equal(detectLanguage(l), 'en', String(l));
});

test('setLanguage wirft RangeError bei unbekannter Sprache', () => {
  assert.throws(() => setLanguage('fr'), RangeError);
  assert.throws(() => setLanguage(undefined), RangeError);
  assert.equal(getLanguage(), 'de');
});
