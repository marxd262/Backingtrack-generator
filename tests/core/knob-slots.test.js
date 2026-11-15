import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOB_SLOTS, RESET_SLOT, SLOT_ROWS, SLOT_COLS } from '../../src/ui/knob-slots.js';
import { DEFAULT_TIMBRE } from '../../src/core/timbre.js';
import { LAYER_IDS } from '../../src/core/layers.js';

test('Knopfraster: jedes Klangfeld jedes Instruments hat genau einen Platz im Raster, kein Platz doppelt, Zurücksetzen unten rechts frei', () => {
  for (const layer of LAYER_IDS.filter((id) => DEFAULT_TIMBRE[id])) {
    const slots = KNOB_SLOTS[layer];
    assert.deepEqual(Object.keys(slots).sort(), Object.keys(DEFAULT_TIMBRE[layer]).sort(), layer);
    const taken = Object.values(slots).map(([row, col]) => `${row}/${col}`);
    assert.equal(new Set(taken).size, taken.length, `${layer}: doppelter Platz`);
    assert.ok(!taken.includes(RESET_SLOT.join('/')), `${layer}: Platz von Zurücksetzen belegt`);
    for (const [row, col] of Object.values(slots)) assert.ok(row >= 1 && row <= SLOT_ROWS && col >= 1 && col <= SLOT_COLS, `${layer}: ${row}/${col}`);
  }
  assert.deepEqual(RESET_SLOT, [SLOT_ROWS, SLOT_COLS]);
});

test('Knopfraster: Verzerrer, Vibrato und Chorus stehen in jedem Instrument, das sie hat, am selben Platz', () => {
  for (const field of ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']) {
    const places = Object.values(KNOB_SLOTS).filter((slots) => slots[field]).map((slots) => slots[field].join('/'));
    assert.ok(places.length >= 4, field);
    assert.equal(new Set(places).size, 1, field);
  }
});
