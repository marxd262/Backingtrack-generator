// Percussion-Aufgaben (Jobs): Instrumentvorrat je Aufgabe, im Takt, leise hinter dem Schlagzeug, deterministisch, Raster aller Grooves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, PERCUSSION_NAMES } from '../../src/index.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { GROOVES, METERS } from '../../src/core/grooves.js';

const SET = {
  shaker: ['shaker'], tambourine: ['tambourine'], congas: ['congaHigh', 'congaLow'], bongos: ['bongoHigh', 'bongoLow'], claves: ['claves'], cowbell: ['cowbell'],
  mixed: ['shaker', 'tambourine', 'congaHigh', 'congaLow'],
};
const JOBS = Object.keys(SET);
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const chords = [['A', 'min'], ['F', 'maj'], ['D', 'min'], ['E', 'maj']];
const make = (job, id, over = {}) => {
  const g = GROOVES[id];
  return {
    key: { root: 'A', mode: 'minor' }, bpm: 100, seed: 1, length: 8, meter: g.meter.split('/').map(Number), groove: id,
    bars: chords.map(([root, quality]) => ({ chord: { root, quality }, beats: METERS[g.meter].beats })),
    tags: { development: ['fullFromStart'] }, layers: { percussion: true }, jobs: { percussion: job }, ...over,
  };
};
const percOf = (t) => buildEvents(t).filter((e) => e.layer === 'percussion');
const IDS = Object.keys(GROOVES);

test('Vokabular: PERCUSSION_NAMES', () => {
  assert.deepEqual(PERCUSSION_NAMES, ['shaker', 'tambourine', 'congaHigh', 'congaLow', 'bongoHigh', 'bongoLow', 'claves', 'cowbell']);
});

test('jede Aufgabe, alle Grooves, Seeds 1 bis 10: nur ihre Instrumente, im Takt, leise, gleicher Seed gleicher Strom', () => {
  for (const job of JOBS) for (const id of IDS) for (const seed of SEEDS) {
    const t = make(job, id, { seed });
    const bars = barTimeline(checkedTrack(t));
    const ev = percOf(t);
    const label = `${job} ${id} seed ${seed}`;
    assert.ok(ev.length > 0, label);
    for (const e of ev) {
      assert.equal(e.type, 'hit', label);
      assert.ok(SET[job].includes(e.name), `${label}: ${e.name}`);
      assert.ok(e.vel > 0 && e.vel <= 0.8, `${label}: vel ${e.vel}`);
      assert.ok(e.t >= bars[e.bar].start - 1e-9 && e.t < bars[e.bar].end, `${label}: t ${e.t}`);
    }
    assert.deepEqual(percOf(make(job, id, { seed })), ev, label);
  }
});

test('mixed spielt alle vier Instrumente', () => {
  const names = new Set(percOf(make('mixed', 'straight', { tags: { development: ['fullFromStart'], drums: ['driving', 'heavy'] } })).map((e) => e.name));
  assert.deepEqual([...names].sort(), [...SET.mixed].sort());
});

test('shaker: ein Treffer je Rasterschritt, Schlag lauter als dazwischen', () => {
  for (const id of IDS) {
    const t = make('shaker', id);
    const steps = METERS[GROOVES[id].meter].beats * METERS[GROOVES[id].meter].sub;
    const ev = percOf(t);
    assert.equal(ev.length, steps * 8, id);
    const sum = (f) => ev.filter(f).reduce((a, e) => a + e.vel, 0) / ev.filter(f).length;
    assert.ok(sum((e) => Number.isInteger(e.beat)) > sum((e) => !Number.isInteger(e.beat)), id);
  }
});

test('tambourine sitzt auf den Backbeat-Schritten der Groove-Tabelle', () => {
  for (const id of IDS) {
    const g = GROOVES[id];
    const back = new Set(g.drums.tiers[1].snare);
    const sub = METERS[g.meter].sub;
    const ev = percOf(make('tambourine', id)).filter((e) => e.vel > 0.5); // die leisen Zwischen-Achtel ausgenommen
    assert.ok(ev.length > 0, id);
    for (const e of ev) assert.ok(back.has(Math.round(e.beat * sub) % (METERS[g.meter].beats * sub)), `${id}: beat ${e.beat}`);
  }
});

test('claves: Son-Clave, in 4/4 auf 0, 3, 6, 10, 12 bei voller Dichte', () => {
  const ev = percOf(make('claves', 'straight', { tags: { development: ['fullFromStart'], drums: ['driving', 'heavy'] }, length: 4 }));
  const steps = [...new Set(ev.filter((e) => e.bar === 0).map((e) => Math.round(e.beat * 4)))];
  assert.ok(steps.every((s) => [0, 3, 6, 10, 12].includes(s)), steps.join());
  assert.ok(steps.length >= 3, steps.join());
});

test('weniger drive: weniger Treffer', () => {
  const n = (energy) => percOf(make('cowbell', 'straight', { tags: { development: ['fullFromStart'], drums: energy } })).length;
  assert.ok(n(['driving', 'heavy']) > n(['loose']));
});

test('ohne Schalter keine Percussion, mit Schalter Ereignisse', () => {
  const t = make('mixed', 'straight');
  assert.equal(percOf({ ...t, layers: undefined }).length, 0);
  assert.equal(percOf({ ...t, layers: { percussion: false } }).length, 0);
  assert.ok(percOf(t).length > 0);
});

test('die anderen Schichten bleiben gleich, wenn die Percussion spielt', () => {
  const t = make('mixed', 'straight');
  const others = (x) => buildEvents(x).filter((e) => e.layer !== 'percussion');
  assert.deepEqual(others(t), others({ ...t, layers: undefined }));
});
