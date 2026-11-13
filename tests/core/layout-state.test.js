import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT_KEY, DEFAULT_LAYOUT, loadLayout, saveLayout } from '../../src/ui/layout-state.js';

// Minimaler Speicher mit fester Rückgabe für getItem
const storageWith = (raw) => ({ getItem: () => raw });
const memory = () => {
  const map = new Map();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
};
const throwing = {
  getItem() { throw new Error('gesperrt'); },
  setItem() { throw new Error('gesperrt'); },
};

test('Schlüssel und Standardwerte', () => {
  assert.equal(LAYOUT_KEY, 'backingtrack.layout');
  assert.deepEqual(DEFAULT_LAYOUT, { mode: 'focus', labels: 'names', frets: 'real' });
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT));
});

test('leerer Speicher liefert gleiche, aber neue Standardwerte', () => {
  const a = loadLayout(storageWith(null));
  assert.deepEqual(a, DEFAULT_LAYOUT);
  assert.notEqual(a, DEFAULT_LAYOUT);
  a.mode = 'setup';
  assert.deepEqual(loadLayout(storageWith(null)), DEFAULT_LAYOUT);
});

test('Rundreise saveLayout -> loadLayout', () => {
  const storage = memory();
  const layout = { mode: 'setup', labels: 'degrees', frets: 'even' };
  saveLayout(storage, layout);
  assert.ok(storage.map.has(LAYOUT_KEY));
  assert.deepEqual(loadLayout(storage), layout);
});

test('alte Felder (Leisten, Ansichten, Gruppen) werden verworfen', () => {
  const old = JSON.stringify({
    sidebars: { left: true, right: true },
    views: { fretboard: false, wheel: true },
    groups: { style: false },
    labels: 'degrees',
  });
  assert.deepEqual(loadLayout(storageWith(old)), { mode: 'focus', labels: 'degrees', frets: 'real' });
  const storage = memory();
  saveLayout(storage, { ...JSON.parse(old), mode: 'setup', extra: 1 });
  assert.deepEqual(JSON.parse(storage.map.get(LAYOUT_KEY)), { mode: 'setup', labels: 'degrees', frets: 'real' });
});

test('ungültige Werte fallen einzeln auf den Standard', () => {
  assert.equal(loadLayout(storageWith('{"mode":"x"}')).mode, 'focus');
  assert.equal(loadLayout(storageWith('{"mode":true}')).mode, 'focus');
  assert.equal(loadLayout(storageWith('{"mode":"setup"}')).mode, 'setup');
  assert.equal(loadLayout(storageWith('{"frets":"x"}')).frets, 'real');
  assert.equal(loadLayout(storageWith('{"frets":"even"}')).frets, 'even');
  assert.equal(loadLayout(storageWith('{"labels":"x"}')).labels, 'names');
  const mixed = loadLayout(storageWith('{"labels":"x","mode":"setup","frets":5}'));
  assert.deepEqual(mixed, { mode: 'setup', labels: 'names', frets: 'real' });
});

test('ungültiges JSON und Nicht-Objekte liefern Standardwerte', () => {
  for (const raw of ['{', 'null', '5', '[]', '"x"', 'true', '', 42, undefined]) {
    assert.deepEqual(loadLayout(storageWith(raw)), DEFAULT_LAYOUT, String(raw));
  }
});

test('fehlender oder werfender Speicher wirft nie', () => {
  assert.deepEqual(loadLayout(), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(throwing), DEFAULT_LAYOUT);
  assert.doesNotThrow(() => saveLayout(undefined, DEFAULT_LAYOUT));
  assert.doesNotThrow(() => saveLayout(throwing, DEFAULT_LAYOUT));
  assert.doesNotThrow(() => saveLayout({ setItem() {} }, null));
});
