// Taktarten und Raster: Tabelle, Schritte je Takt, Zeiten, Validierung, Swing nur im geraden Raster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METERS, meterKey, isMeter, meterGrid } from '../../src/core/grooves.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { buildEvents, chordTimeline } from '../../src/index.js';
import { validateTrack } from '../../src/core/track.js';

const MET = { '4/4': [4, 4], '3/4': [3, 4], '6/8': [6, 8], '12/8': [12, 8], '5/4': [5, 4] };
const GRID = { '4/4': { beats: 4, sub: 4 }, '3/4': { beats: 3, sub: 4 }, '6/8': { beats: 2, sub: 3 }, '12/8': { beats: 4, sub: 3 }, '5/4': { beats: 5, sub: 4 } };
const bars = (beats) => ['A', 'A', 'D', 'E'].map((root, i) => ({ chord: { root, quality: i === 3 ? 'maj' : 'min' }, beats }));
const track = (key, over = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 120, seed: 3, length: 8, meter: MET[key], bars: bars(GRID[key].beats),
  tags: { development: ['fullFromStart'] }, ...over,
});

test('METERS: fünf Taktarten mit Schlägen und Schritten je Schlag, tief eingefroren', () => {
  assert.deepEqual(METERS, GRID);
  assert.ok(Object.isFrozen(METERS) && Object.values(METERS).every(Object.isFrozen));
});

test('meterKey, isMeter und meterGrid', () => {
  for (const [key, m] of Object.entries(MET)) {
    assert.equal(meterKey(m), key);
    assert.equal(isMeter(m), true, key);
    assert.deepEqual(meterGrid(m), GRID[key], key);
  }
  // ein Paar ganzer Zahlen hat einen Schlüssel, ist aber nur unterstützt, wenn METERS ihn kennt
  assert.equal(meterKey([2, 4]), '2/4');
  assert.equal(meterKey([7, 8]), '7/8');
  for (const bad of [[2, 4], [7, 8], [4], [4, 4, 4], '4/4', null, undefined, [4.5, 4], ['4', '4'], {}]) {
    assert.equal(isMeter(bad), false, JSON.stringify(bad));
    assert.deepEqual(meterGrid(bad), GRID['4/4'], 'Unbekanntes: Raster von 4/4');
  }
  for (const notPair of [[4], [4, 4, 4], '4/4', null, undefined, [4.5, 4], ['4', '4'], {}]) assert.equal(meterKey(notPair), '', JSON.stringify(notPair));
});

test('Takt-Raster: Schritte, Schrittdauer und Taktdauer je Taktart', () => {
  for (const key of Object.keys(MET)) {
    const t = checkedTrack(track(key));
    const { beats, sub } = GRID[key];
    for (const b of barTimeline(t)) {
      assert.equal(b.sub, sub, key);
      assert.equal(b.steps, beats * sub, key);
      assert.equal(b.stepSec, 60 / t.bpm / sub, key);
      assert.ok(Math.abs(b.end - b.start - (beats * 60) / t.bpm) < 1e-9, `${key}: Taktdauer`);
    }
    const line = chordTimeline(track(key));
    assert.ok(Math.abs(line[0].durationSec - (beats * 60) / 120) < 1e-6, `${key}: chordTimeline`);
  }
});

test('Ereignisse jeder Taktart liegen im Takt, sind sortiert, endlich und haben beat in [0, Schläge)', () => {
  for (const key of Object.keys(MET)) {
    for (const seed of [1, 2, 3]) {
      for (const variety of [false, true]) {
        const t = track(key, { seed, variety });
        const events = buildEvents(t);
        const timeline = barTimeline(checkedTrack(t));
        let last = -Infinity;
        for (const e of events) {
          assert.ok(Number.isFinite(e.t) && e.t >= last, `${key}: Reihenfolge`);
          last = e.t;
          const b = timeline[e.bar];
          assert.ok(e.t >= b.start - 1e-9 && e.t < b.end, `${key}: Ereignis außerhalb des Takts ${e.bar} (${e.t})`);
          assert.ok(e.beat >= 0 && e.beat < GRID[key].beats + 1e-9, `${key}: beat ${e.beat}`);
        }
      }
    }
  }
});

test('Swing wirkt nur im geraden Raster: in 6/8 und 12/8 bleibt der Strom gleich, in 4/4 ändert er sich', () => {
  for (const key of ['6/8', '12/8']) {
    assert.deepEqual(buildEvents(track(key, { tags: { development: ['fullFromStart'], rhythm: ['swing'] } })), buildEvents(track(key)), key);
  }
  const straight = buildEvents(track('4/4'));
  const swung = buildEvents(track('4/4', { tags: { development: ['fullFromStart'], rhythm: ['swing'] } }));
  assert.notDeepEqual(swung, straight);
});

test('validateTrack: nicht unterstützte Taktarten melden badMeter mit dem Text der Taktart', () => {
  const codes = (meter) => validateTrack({ ...track('4/4'), meter });
  assert.deepEqual(codes([2, 4]), [{ code: 'badMeter', params: { meter: '2/4' } }]);
  assert.deepEqual(codes([7, 8]), [{ code: 'badMeter', params: { meter: '7/8' } }]);
  assert.deepEqual(codes([4]), [{ code: 'badMeter', params: { meter: '?' } }]);
  assert.deepEqual(codes('x'), [{ code: 'badMeter', params: { meter: '?' } }]);
  for (const ok of [[4, 4], [3, 4], [6, 8], [12, 8], [5, 4], undefined, null]) assert.deepEqual(codes(ok), [], JSON.stringify(ok));
  assert.deepEqual(validateTrack({ key: { root: 'A', mode: 'minor' }, bpm: 90, length: 8, bars: bars(4) }), [], 'altes Format ohne meter');
});
