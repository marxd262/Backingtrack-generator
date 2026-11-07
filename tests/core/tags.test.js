import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { TAG_CATEGORIES, STYLE_PRESETS, INERT_TAGS, resolveTags } from '../../src/core/tags.js';
import { resolveTimbre } from '../../src/core/timbre.js';

const NUMBERS = ['drive', 'swing', 'syncopation', 'bassLow', 'bassMovement', 'padWidth'];
const seeds = Array.from({ length: 40 }, (_, i) => i + 1);

test('Kategorien in fester Reihenfolge', () => {
  assert.deepEqual(
    TAG_CATEGORIES.map((c) => c.id),
    ['drums', 'bass', 'synths', 'rhythm', 'mood', 'development', 'drumSound', 'bassSound', 'chordSound', 'padSound'],
  );
});

test('ohne Schlagworte gelten die Standardwerte (auch bei undefined/null)', () => {
  const expected = {
    drive: 0.5, swing: 0, syncopation: 0.5, bassLow: 0.5, bassMovement: 0.5,
    arp: false, padWidth: 0.5, buildUp: 'normal',
  };
  for (const input of [{}, undefined, null]) {
    assert.deepEqual(resolveTags(input, createRng(1)), expected);
  }
});

test('driving erhöht drive gegenüber dem Standard', () => {
  const base = resolveTags({}, createRng(1));
  assert.ok(resolveTags({ drums: ['driving'] }, createRng(1)).drive > base.drive);
});

test('mehrere Schlagworte in einer Kategorie werfen nicht', () => {
  assert.doesNotThrow(() => resolveTags({ drums: ['driving', 'dry'] }, createRng(1)));
});

test('unbekanntes Schlagwort wirft Error mit der Id', () => {
  assert.throws(() => resolveTags({ drums: ['nope'] }, createRng(1)), (e) => e instanceof Error && /nope/.test(e.message));
});

test('unbekannte Kategorie wirft Error mit der Id', () => {
  assert.throws(() => resolveTags({ nope: ['driving'] }, createRng(1)), (e) => e instanceof Error && /nope/.test(e.message));
});

test('Schlagwort aus fremder Kategorie ist unbekannt', () => {
  assert.throws(() => resolveTags({ bass: ['driving'] }, createRng(1)), /driving/);
});

test('arpeggio setzt arp, Entwicklung setzt buildUp', () => {
  assert.equal(resolveTags({ synths: ['arpeggio'] }, createRng(1)).arp, true);
  assert.equal(resolveTags({ development: ['buildsSlowly'] }, createRng(1)).buildUp, 'slow');
  assert.equal(resolveTags({ development: ['fullFromStart'] }, createRng(1)).buildUp, 'instant');
  assert.equal(resolveTags({ development: ['withBreakouts'] }, createRng(1)).buildUp, 'normal');
});

test('straight setzt swing auf 0 und senkt syncopation', () => {
  const p = resolveTags({ rhythm: ['straight'] }, createRng(1));
  assert.equal(p.swing, 0);
  assert.ok(p.syncopation < 0.5);
});

test('alle Kombinationen liefern zulässige Parameter', () => {
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  for (const seed of seeds) {
    const p = resolveTags(all, createRng(seed));
    for (const k of NUMBERS) assert.ok(p[k] >= 0 && p[k] <= 1, `${k}=${p[k]}`);
    assert.ok(['slow', 'normal', 'instant'].includes(p.buildUp));
  }
});

test('gegensätzliche Schlagworte: beide Ausgänge kommen vor, je Seed reproduzierbar', () => {
  const tags = { drums: ['driving', 'loose'] };
  const drives = seeds.map((s) => resolveTags(tags, createRng(s)).drive);
  assert.ok(drives.some((d) => d > 0.5));
  assert.ok(drives.some((d) => d < 0.5));
  assert.deepEqual(drives, seeds.map((s) => resolveTags(tags, createRng(s)).drive));

  const builds = seeds.map((s) => resolveTags({ development: ['buildsSlowly', 'fullFromStart'] }, createRng(s)).buildUp);
  assert.ok(builds.includes('slow') && builds.includes('instant'));
});

test('verändert die Eingabe nicht', () => {
  const tags = { drums: ['driving', 'loose'], synths: ['arpeggio'] };
  const copy = structuredClone(tags);
  resolveTags(tags, createRng(1));
  assert.deepEqual(tags, copy);
});

test('INERT_TAGS: genau die Schlagworte ohne Wirkung, alle gültig', () => {
  const ids = TAG_CATEGORIES.flatMap((c) => c.tags);
  for (const tag of INERT_TAGS) assert.ok(ids.includes(tag), tag);
  assert.deepEqual([...INERT_TAGS].sort(), ['withBreakouts']);
  // unabhängig von der Liste: ohne Wirkung heißt, allein gewählt ergibt es die Standardwerte (Muster und Klang)
  const defaults = JSON.stringify([resolveTags({}, createRng(1)), resolveTimbre({})]);
  for (const c of TAG_CATEGORIES) {
    for (const tag of c.tags) {
      const inert = JSON.stringify([resolveTags({ [c.id]: [tag] }, createRng(1)), resolveTimbre({ [c.id]: [tag] })]) === defaults;
      assert.equal(INERT_TAGS.includes(tag), inert, tag);
    }
  }
});

test('Presets: bpm und nur bekannte Schlagworte', () => {
  assert.deepEqual(STYLE_PRESETS.map((p) => [p.id, p.bpm]), [['funk', 100], ['psych', 112], ['dreamy', 80]]);
  const known = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  for (const preset of STYLE_PRESETS) {
    for (const [cat, list] of Object.entries(preset.tags)) {
      assert.ok(known[cat], `Kategorie ${cat}`);
      for (const t of list) assert.ok(known[cat].includes(t), `${preset.id}: ${t}`);
    }
    assert.doesNotThrow(() => resolveTags(preset.tags, createRng(1)));
  }
});
