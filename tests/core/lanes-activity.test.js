// Welche Schichten in einem Takt spielen (für die LEDs an Modulen und Spuren).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeLayers } from '../../src/ui/lanes.js';

const note = (layer, bar) => ({ type: 'note', layer, bar, t: bar * 2, beat: 0 });
const events = [
  { type: 'chord', bar: 0, t: 0 }, { type: 'chord', bar: 1, t: 2 },
  note('drums', 0), note('drums', 1), note('bass', 1),
];

test('activeLayers: Schichten mit mindestens einem Ereignis im Takt', () => {
  assert.deepEqual(activeLayers(events, 0), new Set(['drums']));
  assert.deepEqual(activeLayers(events, 1), new Set(['drums', 'bass']));
});

test('activeLayers: Takt ohne Ereignisse ist leer, Akkord- und Markerereignisse zählen nicht', () => {
  assert.deepEqual(activeLayers(events, 7), new Set());
  assert.deepEqual(activeLayers([{ type: 'chord', bar: 0, t: 0 }, { type: 'marker', name: 'fill', bar: 0 }], 0), new Set());
});
