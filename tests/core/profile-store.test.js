import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureParts, PART_IDS } from '../../src/core/profile-parts.js';
import { newTree, countNodes, find, addFolder, addProfile, importNode } from '../../src/core/profile-tree.js';
import { LIMITS } from '../../src/core/profile.js';
import { PROFILES_KEY, loadTree, saveTree, isReservedId } from '../../src/ui/profile-store.js';

const bars = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['A', 'min']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 96, bars: structuredClone(bars), tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
  length: 48, meter: [4, 4], layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true },
  voices: { chords: { id: 'sample', variant: 'jazz' } }, jobs: { lead: 'melody', percussion: 'congas' }, complexity: 0.7, ...extra,
});
const session = (extra = {}) => ({ track: track(), scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 }, ...extra });
// Profil im Altformat (Version 1, wie es die alte Oberfläche von Commit 561bc10 schrieb)
const legacyProfile = (s) => structuredClone({ format: 'backingtrack-profile', version: 1, ...s });
const parts = () => captureParts({ ...session(), track: track({ groove: 'straight' }) });
const makeStore = (initial) => {
  const calls = [];
  return { calls, data: initial === undefined ? {} : { [PROFILES_KEY]: initial }, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { calls.push(k); this.data[k] = v; } };
};
const prof = (name, extra = {}) => ({ id: `p-${name}`, type: 'profile', name, parts: parts(), ...extra });
const fold = (name, items, extra = {}) => ({ id: `f-${name}`, type: 'folder', name, items, ...extra });
const stored = (items) => JSON.stringify({ version: 2, items });

// ---------- neuer Baum ----------

test('Rundlauf: saveTree und loadTree ergeben denselben Baum, gespeichert wird { version: 2, items }', () => {
  const tree = { items: [fold('Ordner', [fold('Leer', []), prof('B')]), prof('Funk')] };
  const store = makeStore();
  assert.equal(saveTree(store, tree), true);
  const raw = JSON.parse(store.data[PROFILES_KEY]);
  assert.deepEqual(Object.keys(raw), ['version', 'items']);
  assert.equal(raw.version, 2);
  assert.deepEqual(loadTree(store), tree);
});

test('leerer oder fehlender Speicher ergibt einen leeren Baum', () => {
  assert.deepEqual(loadTree(makeStore()), newTree());
  assert.deepEqual(loadTree(makeStore(stored([]))), newTree());
});

test('kaputter Speicherinhalt ergibt einen leeren Baum', () => {
  for (const raw of ['kaputt', '{}', 'null', '"x"', '5', '{"items":5}', '{"version":2}', '{"version":2,"items":{}}', '']) {
    assert.deepEqual(loadTree(makeStore(raw)), newTree(), raw);
  }
});

test('ohne Speicher: laden ergibt einen leeren Baum, speichern false, nichts wirft', () => {
  const broken = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('voll'); } };
  for (const s of [null, undefined, broken]) {
    assert.deepEqual(loadTree(s), newTree());
    assert.equal(saveTree(s, newTree()), false);
  }
});

test('defekte Knoten werden einzeln übersprungen, gute bleiben', () => {
  const noParts = { id: 'x1', type: 'profile', name: 'ohne Teile' };
  const badParts = { id: 'x2', type: 'profile', name: 'schlecht', parts: { tempo: { bpm: 5 } } };
  const noItems = { id: 'x3', type: 'folder', name: 'ohne Inhalt' };
  const raw = [prof('Gut'), null, 5, 'x', [], noParts, badParts, noItems, { id: 'x4', type: 'zukunft', name: 'Z' }, fold('Ordner', [prof('Innen'), null, noParts])];
  const t = loadTree(makeStore(stored(raw)));
  assert.deepEqual(t.items.map((n) => n.name), ['Ordner', 'Gut']);
  assert.deepEqual(t.items[0].items.map((n) => n.name), ['Innen']);
});

test('fehlende oder doppelte Ids werden neu vergeben, Namen bereinigt und eindeutig gemacht', () => {
  const a = prof('Funk', { id: 'dup' });
  const b = prof('funk', { id: 'dup' });
  const c = prof('  Rock  ', { id: undefined });
  const d = prof('x'.repeat(80), { id: 7 });
  const e = prof('   ', { id: 'e' });
  const t = loadTree(makeStore(stored([a, b, c, d, e, fold('Ordner', [prof('Funk', { id: 'dup' }), prof('Funk', { id: 'dup' })])])));
  const all = [];
  const walk = (items) => items.forEach((n) => { all.push(n); if (n.type === 'folder') walk(n.items); });
  walk(t.items);
  assert.equal(all.length, 8);
  assert.equal(new Set(all.map((n) => n.id)).size, 8);
  assert.ok(all.every((n) => typeof n.id === 'string' && n.id));
  assert.deepEqual(t.items.map((n) => n.name).sort(), ['Funk', 'Importiert', 'Ordner', 'Rock', 'funk (2)', 'x'.repeat(60)].sort());
  assert.deepEqual(find(t, t.items.find((n) => n.name === 'Ordner').id).node.items.map((n) => n.name).sort(), ['Funk', 'Funk (2)']);
});

test('Ids, die wie die festen Baum-Schlüssel heißen (session, mine, factory, factory:…), werden ersetzt; andere bleiben, alle eindeutig', () => {
  const reserved = ['session', 'mine', 'factory', 'factory:reggae', 'factory:'];
  const raw = [prof('A', { id: 'session' }), prof('B', { id: 'factory:reggae' }), prof('C', { id: 'keep-me' }),
    fold('F', [prof('Innen', { id: 'session' }), fold('Unter', [], { id: 'factory' }), prof('X', { id: 'factory:' })], { id: 'mine' })];
  const t = loadTree(makeStore(stored(raw)));
  const all = [];
  const walk = (items) => items.forEach((n) => { all.push(n); if (n.type === 'folder') walk(n.items); });
  walk(t.items);
  assert.equal(all.length, 7);
  assert.equal(new Set(all.map((n) => n.id)).size, 7);
  for (const n of all) assert.ok(!isReservedId(n.id) && !reserved.includes(n.id), n.id);
  assert.equal(all.find((n) => n.name === 'C').id, 'keep-me');
  for (const id of reserved) assert.equal(isReservedId(id), true, id);
  for (const id of ['p-1', 'sessions', 'my', 'factoryx', 'Factory:a']) assert.equal(isReservedId(id), false, id);
});

test('Ids aus den Baum-Operationen (zufällig) treffen nie einen festen Schlüssel', () => {
  let tree = newTree();
  for (let i = 0; i < 50; i++) {
    const r = i % 2 ? addFolder(tree, null, `F${i}`) : addProfile(tree, null, `P${i}`, parts());
    assert.ok(r.ok && !isReservedId(r.id), r.id);
    tree = r.tree;
  }
  const imported = importNode(tree, null, { type: 'folder', name: 'I', items: [{ type: 'profile', name: 'x', parts: parts() }] });
  for (const id of imported.ids) assert.ok(!isReservedId(id), id);
});

test('unbekannte Felder werden ignoriert, Teile bereinigt', () => {
  const p = prof('A', { extra: 1, selected: true });
  p.parts.futurePart = { a: 1 };
  p.parts.tempo.future = 1;
  const t = loadTree(makeStore(JSON.stringify({ version: 2, extra: [1], items: [p, fold('F', [], { open: true })] })));
  assert.deepEqual(t, { items: [fold('F', []), prof('A')] });
});

test('Grenzen: nichts tiefer als Ebene 8, höchstens 1000 Knoten', () => {
  let n = prof('tief');
  for (let i = 10; i >= 1; i--) n = fold(`F${i}`, [n]);
  const t = loadTree(makeStore(stored([n])));
  let depth = 0;
  for (let x = t.items[0]; x?.type === 'folder'; x = x.items[0]) depth++;
  assert.equal(depth, LIMITS.depth);
  assert.equal(countNodes(t), 8);
  const many = Array.from({ length: 1500 }, (_, i) => prof(`P${i}`, { id: `i${i}` }));
  assert.equal(countNodes(loadTree(makeStore(stored(many)))), LIMITS.nodes);
});

test('feindliches JSON: Prototyp bleibt sauber', () => {
  const raw = '{"version":2,"__proto__":{"polluted":1},"items":[{"id":"a","type":"profile","name":"__proto__","__proto__":{"polluted":2},"parts":{"__proto__":{"polluted":3},"tempo":{"bpm":100}}}]}';
  const t = loadTree(makeStore(raw));
  assert.equal(({}).polluted, undefined);
  assert.equal(t.items[0].name, '__proto__');
  assert.equal(t.items[0].parts.tempo.bpm, 100);
});

// ---------- Migration der alten flachen Liste ----------

test('Altliste wandert mit allen 9 alten Teilen (ohne form) in die oberste Ebene, beim Laden wird nichts geschrieben', () => {
  const other = legacyProfile(session({ track: track({ bpm: 120 }), style: 'rock' }));
  const store = makeStore(JSON.stringify([{ name: 'Funk', profile: legacyProfile(session()) }, { name: 'Rock', profile: other }]));
  const before = store.data[PROFILES_KEY];
  const t = loadTree(store);
  assert.deepEqual(t.items.map((n) => n.name), ['Funk', 'Rock']);
  for (const n of t.items) {
    assert.equal(n.type, 'profile');
    assert.ok(n.id && typeof n.id === 'string');
    assert.deepEqual(Object.keys(n.parts), PART_IDS.filter((id) => id !== 'form'));
  }
  assert.equal(t.items[0].parts.tempo.bpm, 96);
  assert.equal(t.items[0].parts.harmony.scale, 'blues');
  assert.equal(t.items[1].parts.tempo.bpm, 120);
  assert.equal(t.items[1].parts.style.style, 'rock');
  assert.equal(store.calls.length, 0, 'setItem wurde nicht aufgerufen');
  assert.equal(store.data[PROFILES_KEY], before);
});

test('Altliste: Unbrauchbares wird übersprungen, doppelte Namen eindeutig, Rest bleibt', () => {
  const good = legacyProfile(session());
  const list = [{ name: 'ok', profile: good }, { name: '', profile: good }, { name: 'Ok', profile: good }, { name: 'bad', profile: { format: 'x' } }, { name: 'ohne', profile: null }, null, 5,
    { name: 'kaputt', profile: { ...good, track: { ...good.track, bars: [] } } }];
  const t = loadTree(makeStore(JSON.stringify(list)));
  assert.deepEqual(t.items.map((n) => n.name), ['ok', 'Ok (2)']);
  assert.equal(new Set(t.items.map((n) => n.id)).size, 2);
  assert.deepEqual(loadTree(makeStore('[]')), newTree());
});

test('Altliste ohne meter im Track: wird mit 4/4 übernommen', () => {
  const p = legacyProfile(session());
  delete p.track.meter;
  const t = loadTree(makeStore(JSON.stringify([{ name: 'alt', profile: p }])));
  assert.equal(t.items.length, 1);
  assert.deepEqual(t.items[0].parts.harmony.meter, [4, 4]);
});
