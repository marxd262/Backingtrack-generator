import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEWS } from '../../src/ui/blocks.js';

const html = readFileSync(new URL('../../src/ui/index.html', import.meta.url), 'utf8');
const sections = [...html.matchAll(/<section\b[^>]*\bdata-view="([^"]+)"/g)].map((m) => m[1]);

test('Verlauf ist nicht ausblendbar, Griffbrett und Akkordrad sind es', () => {
  const hideable = Object.fromEntries(VIEWS.map((v) => [v.id, v.hideable]));
  assert.deepEqual(hideable, { fretboard: true, lanes: false, wheel: true });
});

test('ids sind eindeutig', () => {
  assert.equal(new Set(VIEWS.map((v) => v.id)).size, VIEWS.length);
});

test('jede id hat genau einen section[data-view] im HTML und umgekehrt', () => {
  for (const { id } of VIEWS) assert.equal(sections.filter((s) => s === id).length, 1, id);
  for (const id of sections) assert.ok(VIEWS.some((v) => v.id === id), `${id} fehlt in VIEWS`);
});
