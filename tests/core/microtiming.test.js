// Mikrotiming (Klang v2, Schritt 4): aus = unveränderter Strom; an = gleiche Ereignisse, im Takt, sortiert, reproduzierbar, Snare hinter dem Kick,
// Akkordtöne bleiben zusammen; das Feld `art` wird durchgereicht und wirkt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../../src/index.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { applyMicrotiming, completeTiming, jitterScale, TIMING_DEFAULTS } from '../../src/core/microtiming.js';
import { createRng } from '../../src/core/rng.js';

const TRACK = {
  key: { root: 'A', mode: 'minor' }, bpm: 100, seed: 3, length: 8,
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  layers: { drums: true, bass: true, chords: true, pad: true },
  tags: { rhythm: ['straight'], development: ['fullFromStart'] },
};
const ON = { timing: { amount: 1 } };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('amount 0: der Strom ist derselbe wie ohne Angabe', () => {
  assert.deepEqual(buildEvents(TRACK, { timing: { amount: 0 } }), buildEvents(TRACK));
  assert.equal(jitterScale(completeTiming({ amount: 0 })), 1);
  assert.deepEqual(completeTiming({ amount: -1, tight: 'x' }), TIMING_DEFAULTS);
});

test('amount 1: gleiche Ereignisse, sortiert, im Takt, höchstens 20 ms vom alten Platz, reproduzierbar', () => {
  const off = buildEvents(TRACK), on = buildEvents(TRACK, ON);
  assert.deepEqual(on, buildEvents(TRACK, ON));
  assert.equal(on.length, off.length);
  const bars = barTimeline(checkedTrack(TRACK));
  for (let i = 1; i < on.length; i++) assert.ok(on[i].t >= on[i - 1].t, `sortiert bei ${i}`);
  const id = (e) => `${e.type}|${e.layer}|${e.name ?? e.midi}|${e.bar}|${e.beat}`;
  const before = Map.groupBy(off, id);
  for (const e of on) {
    if (!e.layer) continue;
    assert.ok(e.t >= bars[e.bar].start && e.t < bars[e.bar].end, `im Takt: ${JSON.stringify(e)}`);
    assert.ok(before.get(id(e)).some((o) => Math.abs(o.t - e.t) <= 0.02), `Abweichung: ${JSON.stringify(e)}`);
  }
  assert.notDeepEqual(on, off);
});

test('amount 1: die Backbeat-Snare liegt im Mittel hinter dem Raster, der Kick nicht; Akkordtöne eines Stabs bleiben zusammen', () => {
  const on = buildEvents(TRACK, ON), beat = 60 / TRACK.bpm;
  const late = (name) => mean(on.filter((e) => e.layer === 'drums' && e.name === name && e.vel >= 0.3 && Number.isInteger(e.beat * 2)).map((e) => e.t - (e.bar * 4 + e.beat) * beat));
  assert.ok(late('snare') > 0.003, `snare ${late('snare')}`);
  assert.ok(late('snare') > late('kick') + 0.002, `snare ${late('snare')} kick ${late('kick')}`);
  const off = buildEvents(TRACK);
  const stabs = (events) => new Set(events.filter((e) => e.layer === 'chords').map((e) => `${e.bar}|${e.beat}|${e.t}`)).size;
  assert.equal(stabs(on), stabs(off));
});

test('art: wird durchgereicht; dead und mute machen leiser und kürzer, auch bei amount 0', () => {
  const bars = barTimeline(checkedTrack(TRACK));
  const e = { t: 0.3, bar: 0, beat: 0.5, type: 'note', layer: 'bass', midi: 40, vel: 0.8, dur: 0.2 };
  const run = (art, amount) => applyMicrotiming([{ ...e, art }], TRACK, bars, createRng(1), completeTiming({ amount }))[0];
  assert.deepEqual(run(undefined, 0), { ...e, art: undefined });
  for (const amount of [0, 1]) {
    const dead = run('dead', amount);
    assert.equal(dead.art, 'dead');
    assert.ok(dead.vel < e.vel && dead.dur < e.dur, JSON.stringify(dead));
    assert.equal(run('slide', amount).vel, e.vel);
  }
});
