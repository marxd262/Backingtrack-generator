import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { MAX_LENGTH } from '../../src/core/track.js';
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

test('gleicher Seed ergibt gleiches Ergebnis, verschiedene Seeds variieren bei slow (Akkorde oder Pad zuerst)', () => {
  assert.deepEqual(build(24, 'slow', 9), build(24, 'slow', 9));
  const variants = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(build(24, 'slow', i + 1))));
  assert.ok(variants.size >= 2);
  // nur die zwei gemischten Schichten wechseln: zweiter Abschnitt bringt je Seed Akkorde oder Pad
  const second = new Set(Array.from({ length: 30 }, (_, i) => {
    const { sections } = build(24, 'slow', i + 1);
    return LAYERS.filter((l) => sections[1].layers[l] && !sections[0].layers[l]).join();
  }));
  assert.deepEqual([...second].sort(), ['chords', 'pad']);
});

test('slow: Bass und Schlagzeug ab Abschnitt 0, dann eines von Akkorden/Pad, ab Abschnitt 2 alles (Seeds 1..50)', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { sections } = build(40, 'slow', seed);
    assert.deepEqual(sections[0].layers, { drums: true, bass: true, chords: false, pad: false }, `seed ${seed}`);
    assert.equal(active(sections[1]), 3, `seed ${seed}`);
    for (const s of sections.slice(2)) assert.equal(active(s), 4, `seed ${seed}`);
  }
});

test('length über MAX_LENGTH fällt auf 24 Takte zurück (kein Speicher-Absturz)', () => {
  for (const length of [MAX_LENGTH + 1, 1e9, Number.MAX_SAFE_INTEGER]) {
    const { sections } = buildArrangement({ length }, { buildUp: 'normal' }, createRng(1));
    assert.equal(sections.reduce((n, s) => n + s.bars, 0), 24, String(length));
  }
  const max = buildArrangement({ length: MAX_LENGTH }, { buildUp: 'normal' }, createRng(1));
  assert.equal(max.sections.reduce((n, s) => n + s.bars, 0), MAX_LENGTH);
});

test('mutiert die Eingaben nicht', () => {
  const track = { length: 24, layers: { drums: true } };
  const params = { buildUp: 'slow' };
  const rng = createRng(1);
  const before = structuredClone({ track, params });
  buildArrangement(track, params, rng);
  assert.deepEqual({ track, params }, before);
});
