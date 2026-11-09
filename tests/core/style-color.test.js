// Akkordfarbe der Stil-Vorlagen: chordColor je Stil, mit variety wählt der Seed in etwa jeder vierten Variante die Ausweichfarbe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLE_PRESETS, styleChordColor } from '../../src/core/tags.js';
import { CHORD_COLORS } from '../../src/core/harmony.js';

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

test('Farben der Vorlagen: nur bekannte Farben, nur die drei Stile mit eigener Farbe', () => {
  const withColor = Object.fromEntries(STYLE_PRESETS.filter((p) => p.chordColor).map((p) => [p.id, [p.chordColor, p.chordColorAlt]]));
  assert.deepEqual(withColor, { blues: ['sevenths', 'extended'], hardrock: ['power', 'triads'], poppunk: ['power', 'triads'] });
  for (const p of STYLE_PRESETS) {
    for (const c of [p.chordColor, p.chordColorAlt]) assert.ok(c === undefined || CHORD_COLORS.includes(c), `${p.id}: ${c}`);
    if (p.chordColorAlt) assert.notEqual(p.chordColorAlt, p.chordColor, `${p.id}: Ausweichfarbe unterscheidet sich`);
  }
});

test('styleChordColor ohne variety: die Farbe des Stils, ohne Angabe Dreiklänge', () => {
  for (const p of STYLE_PRESETS) {
    for (const seed of [1, 2, 3, 4, 50]) assert.equal(styleChordColor(p, seed, false), p.chordColor ?? 'triads', `${p.id} ${seed}`);
  }
  assert.equal(styleChordColor(undefined, 1, true), 'triads');
  assert.equal(styleChordColor({}, 1, true), 'triads');
});

test('styleChordColor mit variety: deterministisch, nur Stile mit Ausweichfarbe ändern sich, in etwa jeder vierten Variante', () => {
  for (const p of STYLE_PRESETS) {
    const colors = SEEDS.map((seed) => styleChordColor(p, seed, true));
    assert.deepEqual(colors, SEEDS.map((seed) => styleChordColor(p, seed, true)), `${p.id}: deterministisch`);
    if (!p.chordColorAlt) {
      assert.ok(colors.every((c) => c === (p.chordColor ?? 'triads')), `${p.id}: unverändert`);
      continue;
    }
    const alt = colors.filter((c) => c === p.chordColorAlt).length;
    assert.ok(alt >= 0.15 * SEEDS.length && alt <= 0.35 * SEEDS.length, `${p.id}: ${alt} von ${SEEDS.length} mit Ausweichfarbe`);
    assert.ok(colors.every((c) => c === p.chordColor || c === p.chordColorAlt), `${p.id}: nur die beiden Farben`);
  }
});
