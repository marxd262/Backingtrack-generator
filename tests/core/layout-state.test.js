import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWS } from '../../src/ui/views.js';
import { LAYOUT_KEY, DEFAULT_LAYOUT, loadLayout, saveLayout } from '../../src/ui/layout-state.js';

// Standardzustand der einklappbaren Gruppen (Seitenleisten); Klang-Gruppen starten zu
const GROUPS = {
  style: true, tempo: true, rhythm: true, triad: true, seventh: false, extended: false, drums: false, bass: false, chords: false, pad: false, master: false,
  key: true, progression: true, views: true,
};

// Minimaler Speicher mit fester Rückgabe für getItem
const storageWith = (raw) => ({ getItem: () => raw });
const throwing = {
  getItem() { throw new Error('gesperrt'); },
  setItem() { throw new Error('gesperrt'); },
};

test('Schlüssel und Standardwerte', () => {
  assert.equal(LAYOUT_KEY, 'backingtrack.layout');
  assert.deepEqual(DEFAULT_LAYOUT, {
    sidebars: { left: false, right: false },
    views: { fretboard: true, wheel: true },
    groups: GROUPS,
    labels: 'names',
  });
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT));
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT.groups));
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT.sidebars));
  assert.ok(Object.isFrozen(DEFAULT_LAYOUT.views));
});

test('leerer Speicher liefert tief gleiche, aber neue Standardwerte', () => {
  const a = loadLayout(storageWith(null));
  assert.deepEqual(a, DEFAULT_LAYOUT);
  assert.notEqual(a, DEFAULT_LAYOUT);
  assert.notEqual(a.sidebars, DEFAULT_LAYOUT.sidebars);
  a.sidebars.left = true;
  a.views.wheel = false;
  assert.deepEqual(loadLayout(storageWith(null)), DEFAULT_LAYOUT);
});

test('Rundreise saveLayout -> loadLayout', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const layout = {
    sidebars: { left: true, right: false },
    views: { fretboard: false, wheel: true },
    groups: { ...GROUPS, style: false, drums: true },
    labels: 'degrees',
  };
  saveLayout(storage, layout);
  assert.ok(map.has(LAYOUT_KEY));
  assert.deepEqual(loadLayout(storage), layout);
});

test('saveLayout schreibt nur bekannte, gültige Felder', () => {
  const map = new Map();
  const storage = { setItem: (k, v) => map.set(k, v) };
  saveLayout(storage, {
    sidebars: { left: true, x: 1 },
    views: { lanes: false, wheel: 'no' },
    labels: 'x',
    extra: 1,
  });
  assert.deepEqual(JSON.parse(map.get(LAYOUT_KEY)), {
    sidebars: { left: true, right: false },
    views: { fretboard: true, wheel: true },
    groups: GROUPS,
    labels: 'names',
  });
});

test('ungültiges JSON und Nicht-Objekte liefern Standardwerte', () => {
  for (const raw of ['{', 'null', '5', '[]', '"x"', 'true', '', 42, undefined]) {
    assert.deepEqual(loadLayout(storageWith(raw)), DEFAULT_LAYOUT, String(raw));
  }
});

test('Felder werden einzeln geprüft', () => {
  assert.equal(loadLayout(storageWith('{"labels":"x"}')).labels, 'names');
  assert.equal(loadLayout(storageWith('{"labels":"degrees"}')).labels, 'degrees');
  assert.equal(loadLayout(storageWith('{"sidebars":{"left":"yes"}}')).sidebars.left, false);
  const mixed = loadLayout(storageWith('{"labels":"x","sidebars":{"left":true}}'));
  assert.equal(mixed.sidebars.left, true);
  assert.equal(mixed.labels, 'names');
});

test('Teilangaben werden aufgefüllt, unbekannte Schlüssel verworfen', () => {
  const l = loadLayout(storageWith('{"views":{"lanes":false,"fretboard":false,"foo":1},"bar":2,"sidebars":5}'));
  assert.deepEqual(l, {
    sidebars: { left: false, right: false },
    views: { fretboard: false, wheel: true },
    groups: GROUPS,
    labels: 'names',
  });
  assert.ok(!('lanes' in l.views));
});

test('Gruppen: unbekannte Schlüssel fallen weg, Nicht-Boolesches fällt auf den Standard', () => {
  const l = loadLayout(storageWith('{"groups":{"style":false,"tempo":"x","nope":true,"bass":1}}'));
  assert.deepEqual(l.groups, { ...GROUPS, style: false });
  assert.ok(!('nope' in l.groups));
  assert.deepEqual(loadLayout(storageWith('{"groups":5}')).groups, GROUPS);
});

test('Gruppen: Rundreise merkt offen und zu', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  saveLayout(storage, { ...DEFAULT_LAYOUT, groups: { ...GROUPS, style: false, bass: true } });
  assert.deepEqual(loadLayout(storage).groups, { ...GROUPS, style: false, bass: true });
});

test('fehlender oder werfender Speicher wirft nie', () => {
  assert.deepEqual(loadLayout(), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(throwing), DEFAULT_LAYOUT);
  assert.doesNotThrow(() => saveLayout(undefined, DEFAULT_LAYOUT));
  assert.doesNotThrow(() => saveLayout(throwing, DEFAULT_LAYOUT));
  assert.doesNotThrow(() => saveLayout({ setItem() {} }, null));
});

const hideableIds = VIEWS.filter((v) => v.hideable).map((v) => v.id);

test('Standard-Ansichten sind genau die ausblendbaren Ansichten der Registry', () => {
  assert.deepEqual(Object.keys(DEFAULT_LAYOUT.views).sort(), [...hideableIds].sort());
  assert.ok(Object.values(DEFAULT_LAYOUT.views).every((v) => v === true));
});

test('jede ausblendbare Ansicht der Registry überlebt saveLayout -> loadLayout', () => {
  for (const id of hideableIds) {
    const map = new Map();
    const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
    saveLayout(storage, { ...DEFAULT_LAYOUT, views: { ...DEFAULT_LAYOUT.views, [id]: false } });
    const loaded = loadLayout(storage);
    assert.equal(loaded.views[id], false, id);
    for (const other of hideableIds.filter((o) => o !== id)) assert.equal(loaded.views[other], true, other);
  }
});

test('nicht ausblendbare und unbekannte Ansichten werden verworfen', () => {
  const raw = JSON.stringify({ views: { lanes: false, unknown: false } });
  assert.deepEqual(loadLayout({ getItem: () => raw }).views, DEFAULT_LAYOUT.views);
});
