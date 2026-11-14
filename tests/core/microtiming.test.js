// Mikrotiming (Klang v2, Schritt 4): aus = unveränderter Strom; an = gleiche Ereignisse, im Takt, sortiert, reproduzierbar, Snare hinter dem Kick,
// Akkordtöne bleiben zusammen; das Feld `art` wird durchgereicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../../src/index.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { applyMicrotiming, completeTiming, jitterScale, timingOf, TIMING_DEFAULTS } from '../../src/core/microtiming.js';
import { createRng } from '../../src/core/rng.js';
import { DRUM_FALLBACK } from '../../src/core/event-helpers.js';

const TRACK = {
  key: { root: 'A', mode: 'minor' }, bpm: 100, seed: 3, length: 8,
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  layers: { drums: true, bass: true, chords: true, pad: true },
  tags: { rhythm: ['straight'], development: ['fullFromStart'] },
};
const ON = {}; // Standard: Lockerheit 0,5 = Stärke 1,5
const OFF = { timing: { amount: 0, tight: 1 } }; // Strom wie vor Klang v2
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

test('Lockerheit: 0,5 ist der Standard, 0 liegt exakt auf dem Raster, 1 ist sehr locker, ungültig wirft', () => {
  assert.deepEqual(buildEvents({ ...TRACK, loose: 0.5 }), buildEvents(TRACK));
  assert.deepEqual([timingOf(0), timingOf(0.5), timingOf(1)], [{ amount: 0, tight: 0 }, { amount: 1.5, tight: 0.3 }, { amount: 5, tight: 1 }]);
  assert.deepEqual({ amount: TIMING_DEFAULTS.amount, tight: TIMING_DEFAULTS.tight }, timingOf(0.5));
  const beat = 60 / TRACK.bpm, off = (e) => Math.abs(e.t - (e.bar * 4 + e.beat) * beat);
  const drums = (loose) => buildEvents({ ...TRACK, loose }).filter((e) => e.layer === 'drums');
  assert.ok(drums(0).every((e) => off(e) < 1e-6), 'bei 0 liegt jeder Schlag auf dem Raster');
  assert.ok(Math.max(...drums(1).map(off)) > 0.02, 'bei 1 weit weg vom Raster');
  assert.notDeepEqual(buildEvents({ ...TRACK, loose: 1 }), buildEvents(TRACK));
  assert.equal(jitterScale(completeTiming({ tight: 1 })), 1);
  assert.deepEqual(completeTiming({ amount: -1, tight: 'x' }), TIMING_DEFAULTS);
  assert.throws(() => buildEvents({ ...TRACK, loose: 2 }), /badLoose/);
});

test('Standard: gleiche Ereignisse, sortiert, im Takt, höchstens 20 ms vom alten Platz, reproduzierbar', () => {
  const off = buildEvents(TRACK, OFF), on = buildEvents(TRACK, ON);
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

test('Standard: die Backbeat-Snare liegt im Mittel hinter dem Raster, der Kick nicht; Akkordtöne eines Stabs bleiben zusammen', () => {
  const on = buildEvents(TRACK, ON), beat = 60 / TRACK.bpm;
  const late = (name) => mean(on.filter((e) => e.layer === 'drums' && (DRUM_FALLBACK[e.name] ?? e.name) === name && e.vel >= 0.3 && Number.isInteger(e.beat * 2)).map((e) => e.t - (e.bar * 4 + e.beat) * beat));
  assert.ok(late('snare') > 0.003, `snare ${late('snare')}`);
  assert.ok(late('snare') > late('kick') + 0.002, `snare ${late('snare')} kick ${late('kick')}`);
  const off = buildEvents(TRACK, OFF);
  const stabs = (events) => new Set(events.filter((e) => e.layer === 'chords').map((e) => `${e.bar}|${e.beat}|${e.t}`)).size;
  assert.equal(stabs(on), stabs(off));
});

test('art: wird durchgereicht, Lautstärke und Notenende bleiben (die setzt articulation.js)', () => {
  const bars = barTimeline(checkedTrack(TRACK));
  const e = { t: 0.3, bar: 0, beat: 0.5, type: 'note', layer: 'bass', midi: 40, vel: 0.8, dur: 0.2 };
  const run = (art, amount) => applyMicrotiming([{ ...e, art }], TRACK, bars, createRng(1), completeTiming({ amount }))[0];
  assert.deepEqual(run(undefined, 0), { ...e, art: undefined });
  for (const amount of [0, 1]) {
    const dead = run('dead', amount);
    assert.equal(dead.art, 'dead');
    assert.equal(dead.vel, e.vel);
    assert.ok(Math.abs(dead.t + dead.dur - e.t - e.dur) < 1e-5, JSON.stringify(dead));
  }
});

test('Lockerheit 0 und 1: sortiert, im Takt, Bass und Lead einstimmig, keine negative Dauer (Stile, Seeds)', () => {
  for (const rhythm of [['straight'], ['funky'], ['swing']]) for (const seed of [1, 2, 3, 4, 5]) for (const loose of [0, 1]) {
    const track = { ...TRACK, seed, loose, layers: { ...TRACK.layers, lead: true, percussion: true }, jobs: { lead: 'melody', percussion: 'mixed' }, tags: { rhythm, development: ['fullFromStart'] } };
    const events = buildEvents(track), bars = barTimeline(checkedTrack(track)), label = `${rhythm} s=${seed} loose=${loose}`;
    for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `${label}: sortiert`);
    for (const e of events.filter((x) => x.layer)) {
      assert.ok(e.t >= bars[e.bar].start && e.t < bars[e.bar].end, `${label}: im Takt ${JSON.stringify(e)}`);
      if (e.dur !== undefined) assert.ok(e.dur >= 0 && e.t + e.dur <= bars[e.bar].end + 1e-6, `${label}: Dauer ${JSON.stringify(e)}`);
    }
    for (const layer of ['bass', 'lead']) {
      const notes = events.filter((e) => e.layer === layer);
      for (let i = 1; i < notes.length; i++) assert.ok(notes[i - 1].t + notes[i - 1].dur <= notes[i].t + 1e-6, `${label}: ${layer} einstimmig bei ${i}`);
    }
  }
});
