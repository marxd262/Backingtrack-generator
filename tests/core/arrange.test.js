import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { buildArrangement } from '../../src/core/arrange.js';

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const build = (length, buildUp, seed = 1) => buildArrangement({ length }, { buildUp }, createRng(seed));
const active = (s) => LAYERS.filter((l) => s.layers[l]).length;

test('length 24 ergibt drei lückenlose Abschnitte à 8 Takte', () => {
  const { sections } = build(24, 'normal');
  assert.deepEqual(sections.map((s) => [s.start, s.bars]), [[0, 8], [8, 8], [16, 8]]);
});

test('length 4 ergibt einen Abschnitt mit 4 Takten und allen Schichten', () => {
  const { sections } = build(4, 'slow');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].bars, 4);
  assert.equal(active(sections[0]), 4);
  assert.equal(sections[0].fillAtEnd, false);
});

test('length 12 ergibt 8 + 4', () => {
  const { sections } = build(12, 'normal');
  assert.deepEqual(sections.map((s) => [s.start, s.bars]), [[0, 8], [8, 4]]);
});

test('fehlende oder ungültige length fällt auf 24 Takte zurück', () => {
  for (const track of [{}, { length: 0 }, { length: -3 }, { length: 2.5 }, { length: 'x' }]) {
    const { sections } = buildArrangement(track, { buildUp: 'normal' }, createRng(1));
    assert.equal(sections.reduce((n, s) => n + s.bars, 0), 24);
  }
});

test('slow: erster Abschnitt hat weniger Schichten als der letzte, Bass überall an', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { sections } = build(24, 'slow', seed);
    assert.ok(active(sections[0]) < active(sections.at(-1)));
    assert.equal(active(sections.at(-1)), 4);
    assert.ok(sections.every((s) => s.layers.bass));
  }
});

test('slow: Schichten kommen nur hinzu, nie weg', () => {
  const { sections } = build(40, 'slow', 7);
  for (let i = 1; i < sections.length; i++) {
    for (const l of LAYERS) assert.ok(!sections[i - 1].layers[l] || sections[i].layers[l]);
  }
});

test('instant: alle Schichten in allen Abschnitten', () => {
  assert.ok(build(24, 'instant').sections.every((s) => active(s) === 4));
});

test('normal und unbekannte Werte: vor dem Ende kein Pad, am Ende alles', () => {
  for (const buildUp of ['normal', 'whatever']) {
    const { sections } = build(24, buildUp);
    assert.ok(sections.slice(0, -1).every((s) => s.layers.bass && s.layers.drums && s.layers.chords && !s.layers.pad));
    assert.equal(active(sections.at(-1)), 4);
  }
});

test('fillAtEnd ist außer im letzten Abschnitt true', () => {
  const { sections } = build(24, 'normal');
  assert.deepEqual(sections.map((s) => s.fillAtEnd), [true, true, false]);
});

test('gleicher Seed ergibt gleiches Ergebnis, verschiedene Seeds variieren bei slow', () => {
  assert.deepEqual(build(24, 'slow', 9), build(24, 'slow', 9));
  const variants = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(build(24, 'slow', i + 1))));
  assert.ok(variants.size >= 2);
});

test('mutiert die Eingaben nicht', () => {
  const track = Object.freeze({ length: 24 });
  const params = Object.freeze({ buildUp: 'slow' });
  buildArrangement(track, params, createRng(1));
});
