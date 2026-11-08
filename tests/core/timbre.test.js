import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { TAG_CATEGORIES, resolveTags } from '../../src/core/tags.js';
import { TIMBRE_EFFECTS } from '../../src/core/timbre-effects.js';
import { DEFAULT_TIMBRE, completeTimbre, resolveTimbre, resolveTrackTimbre } from '../../src/core/timbre.js';

const EPS = 1e-9;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, `${msg ?? ''} ${a} != ${b}`);
const categoryOf = (tag) => TAG_CATEGORIES.find((c) => c.tags.includes(tag)).id;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object' || v === null || deepFrozen(v));

test('ohne Schlagworte: Standardwerte, auch bei {}, null, undefined; jedes Mal eine neue Kopie', () => {
  for (const input of [{}, null, undefined]) assert.deepEqual(resolveTimbre(input), DEFAULT_TIMBRE);
  const a = resolveTimbre({});
  assert.notEqual(a, DEFAULT_TIMBRE);
  assert.notEqual(a.drums, DEFAULT_TIMBRE.drums);
  a.drums.kickPunch = 0.99;
  assert.deepEqual(resolveTimbre({}), DEFAULT_TIMBRE);
  assert.equal(DEFAULT_TIMBRE.drums.kickPunch, 0.5);
});

test('DEFAULT_TIMBRE und TIMBRE_EFFECTS sind tief eingefroren', () => {
  assert.ok(deepFrozen(DEFAULT_TIMBRE));
  assert.ok(deepFrozen(TIMBRE_EFFECTS));
});

test('jedes Schlagwort der Tabelle ist gültig, jeder Pfad existiert in DEFAULT_TIMBRE', () => {
  for (const [tag, effect] of Object.entries(TIMBRE_EFFECTS)) {
    assert.ok(TAG_CATEGORIES.some((c) => c.tags.includes(tag)), tag);
    for (const path of Object.keys(effect)) {
      assert.equal(typeof get(DEFAULT_TIMBRE, path), 'number', `${tag}: ${path}`);
    }
  }
});

test('jedes Schlagwort verschiebt genau seine Felder um die genannten Beträge', () => {
  for (const [tag, effect] of Object.entries(TIMBRE_EFFECTS)) {
    const t = resolveTimbre({ [categoryOf(tag)]: [tag] });
    for (const [group, fields] of Object.entries(DEFAULT_TIMBRE)) {
      for (const field of Object.keys(fields)) {
        const path = `${group}.${field}`;
        const expected = clamp01(get(DEFAULT_TIMBRE, path) + (effect[path] ?? 0));
        near(get(t, path), expected, `${tag} ${path}`);
      }
    }
  }
});

test('ausdrückliche Werte', () => {
  near(resolveTimbre({ bassSound: ['fuzz'] }).bass.fuzz, 0.6);
  near(resolveTimbre({ mood: ['dark'] }).master.brightness, 0.15);
  near(resolveTimbre({ bassSound: ['sub'] }).bass.cutoff, 0.25);
});

test('Addition und Begrenzung', () => {
  const cancel = resolveTimbre({ bassSound: ['fuzz', 'plucky'], mood: ['dark', 'bright'] });
  near(cancel.master.brightness, 0.5);
  near(resolveTimbre({ drumSound: ['punchy', 'boomy'] }).drums.kickLength, 0.75);
  const t = resolveTimbre({ padSound: ['swelling', 'thick'], mood: ['dreamy'] });
  for (const fields of Object.values(t)) for (const v of Object.values(fields)) assert.ok(v >= 0 && v <= 1);
});

test('alle Schlagworte gleichzeitig: alle Felder endlich und in [0,1]', () => {
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  const t = resolveTimbre(all);
  for (const fields of Object.values(t)) {
    for (const v of Object.values(fields)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, String(v));
  }
});

test('ungültige Eingaben werfen dieselben Fehler wie resolveTags', () => {
  const bad = [{ nope: ['punchy'] }, { drumSound: ['nope'] }, { drumSound: 'punchy' }, { bassSound: ['punchy'] }];
  for (const input of bad) {
    let fromTags;
    assert.throws(() => resolveTags(input, createRng(1)), (e) => { fromTags = e; return e instanceof Error; });
    assert.throws(() => resolveTimbre(input), (e) => e instanceof Error && e.message === fromTags.message);
  }
});

test('resolveTimbre verändert die Eingabe nicht', () => {
  const tags = { drumSound: ['punchy'], mood: ['dark'] };
  const copy = structuredClone(tags);
  resolveTimbre(tags);
  assert.deepEqual(tags, copy);
});

test('Klang-Schlagworte der neuen Kategorien ändern die Muster-Parameter nicht', () => {
  const base = resolveTags({}, createRng(1));
  for (const id of ['drumSound', 'bassSound', 'chordSound', 'padSound']) {
    const c = TAG_CATEGORIES.find((x) => x.id === id);
    assert.ok(c, id);
    assert.equal(c.tags.length, 5);
    assert.deepEqual(resolveTags({ [id]: c.tags }, createRng(1)), base);
  }
});

test('completeTimbre: ungültige Eingaben ergeben die Standardwerte als neue Kopie', () => {
  for (const input of [null, undefined, 0, 0.5, 'bass', [], [1, 2], true]) {
    const t = completeTimbre(input);
    assert.deepEqual(t, DEFAULT_TIMBRE, String(input));
    assert.notEqual(t, DEFAULT_TIMBRE);
    assert.ok(!Object.isFrozen(t) && !Object.isFrozen(t.bass));
  }
});

test('completeTimbre: füllt Feld für Feld auf, begrenzt, ignoriert Unbekanntes und Nicht-Zahlen', () => {
  const input = {
    bass: { fuzz: 0.6, cutoff: 2, pluck: -1, sub: NaN, resonance: Infinity, roundness: '0.9', extra: 0.3 },
    drums: null,
    chords: [0.1],
    pad: { attack: 0.2, lfoSpeed: -Infinity },
    nope: { x: 1 },
  };
  const copy = structuredClone(input);
  const t = completeTimbre(input);
  assert.deepEqual(input, copy);
  const expected = structuredClone(DEFAULT_TIMBRE);
  expected.bass.fuzz = 0.6;
  expected.bass.cutoff = 1;
  expected.bass.pluck = 0;
  expected.pad.attack = 0.2;
  assert.deepEqual(t, expected);
});

test('completeTimbre: vollständiges Klangmodell bleibt gleich, Ergebnis ist eine eigene Kopie', () => {
  const full = resolveTimbre({ bassSound: ['fuzz'], mood: ['dark'] });
  const t = completeTimbre(full);
  assert.deepEqual(t, full);
  assert.notEqual(t, full);
  assert.notEqual(t.bass, full.bass);
  assert.deepEqual(completeTimbre(DEFAULT_TIMBRE), DEFAULT_TIMBRE);
});

test('resolveTrackTimbre ohne timbre: gleich resolveTimbre(tags), neue Kopie', () => {
  const tags = { bassSound: ['fuzz'], mood: ['dark'] };
  assert.deepEqual(resolveTrackTimbre({ tags }), resolveTimbre(tags));
  const t = resolveTrackTimbre({ tags });
  assert.notEqual(t.bass, DEFAULT_TIMBRE.bass);
});

test('resolveTrackTimbre: Überschreibung setzt nur ihr Feld und schlägt das Schlagwort', () => {
  const tags = { bassSound: ['fuzz'] };
  const base = resolveTimbre(tags);
  const t = resolveTrackTimbre({ tags, timbre: { bass: { fuzz: 0.9 } } });
  near(t.bass.fuzz, 0.9);
  for (const [group, fields] of Object.entries(base)) {
    for (const key of Object.keys(fields)) if (!(group === 'bass' && key === 'fuzz')) near(t[group][key], base[group][key], `${group}.${key}`);
  }
});

test('resolveTrackTimbre: Werte werden auf [0,1] begrenzt', () => {
  const t = resolveTrackTimbre({ timbre: { bass: { fuzz: 1.5, sub: -1 } } });
  near(t.bass.fuzz, 1);
  near(t.bass.sub, 0);
});

test('resolveTrackTimbre: Ungültiges wird ignoriert und wirft nie', () => {
  const bad = [
    { bass: { fuzz: NaN } }, { bass: { fuzz: 'x' } }, { bass: { fuzz: null } }, { bass: { fuzz: Infinity } },
    { nope: { x: 1 } }, { bass: { nope: 1 } }, { bass: 5 }, { bass: [0.9] }, [], 'text', 7, null,
  ];
  for (const timbre of bad) assert.deepEqual(resolveTrackTimbre({ timbre }), DEFAULT_TIMBRE, JSON.stringify(timbre));
  for (const track of [null, undefined, {}, 'x']) assert.deepEqual(resolveTrackTimbre(track), DEFAULT_TIMBRE);
});

test('resolveTrackTimbre: ungültige Schlagworte werfen wie resolveTimbre', () => {
  assert.throws(() => resolveTrackTimbre({ tags: { nope: ['x'] } }));
  assert.throws(() => resolveTimbre({ nope: ['x'] }));
});
