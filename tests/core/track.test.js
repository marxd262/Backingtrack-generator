import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack, validateTrack } from '../../src/core/track.js';

const bar = (root, quality = 'maj', beats = 4) => ({ chord: { root, quality }, beats });
const am = (root, quality) => bar(root, quality);
const good = () => ({
  key: { root: 'A', mode: 'minor' }, bpm: 90, meter: [4, 4], tags: {}, length: 24, seed: 1,
  layers: { drums: true, bass: true, chords: true, pad: true },
  bars: [am('A', 'min'), am('A', 'min'), am('D', 'min'), am('E', 'maj')],
});
const codes = (t) => validateTrack(t).map((e) => e.code);

test('normalizeTrack setzt Standardwerte', () => {
  const t = normalizeTrack({ key: { root: 'A', mode: 'minor' }, bpm: 90, bars: [] });
  assert.deepEqual(t.meter, [4, 4]);
  assert.equal(t.length, 24);
  assert.deepEqual(t.layers, { drums: true, bass: true, chords: true, pad: true });
  assert.deepEqual(t.tags, {});
  assert.equal(t.seed, 1);
});

test('normalizeTrack behält Angaben und Progression, verändert die Eingabe nicht', () => {
  const input = { key: { root: 'A', mode: 'minor' }, bpm: 80, length: 8, seed: 7,
    layers: { drums: false }, bars: [am('A', 'min')] };
  const frozen = structuredClone(input);
  const t = normalizeTrack(input);
  assert.deepEqual(input, frozen);
  assert.equal(t.length, 8);
  assert.equal(t.seed, 7);
  assert.deepEqual(t.layers, { drums: false, bass: true, chords: true, pad: true });
  assert.deepEqual(t.bars, input.bars);
  t.layers.bass = false;
  t.bars[0].beats = 9;
  assert.deepEqual(input, frozen);
});

test('validateTrack: gültiger Track meldet nichts (Am Am Dm E)', () => {
  assert.deepEqual(validateTrack(good()), []);
});

test('validateTrack: emptyBars', () => {
  assert.deepEqual(codes({ ...good(), bars: [] }), ['emptyBars']);
});

test('validateTrack: chordNotInKey mit params.chord', () => {
  const errs = validateTrack({ ...good(), bars: [am('C#', 'maj')] });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, 'chordNotInKey');
  assert.equal(errs[0].params.chord, 'C#');
});

test('validateTrack: Akkorde werden nach Tonhöhe verglichen (Bb = A#)', () => {
  const t = { ...good(), key: { root: 'D', mode: 'minor' }, bars: [am('A#', 'maj'), am('Bb', 'maj')] };
  assert.deepEqual(validateTrack(t), []);
});

test('validateTrack: Akkordsymbole in params.chord', () => {
  const errs = validateTrack({ ...good(), bars: [am('C#', 'min'), am('C#', 'dim')] });
  assert.deepEqual(errs.map((e) => e.params.chord), ['C#m', 'C#dim']);
});

test('validateTrack: badBpm', () => {
  assert.deepEqual(codes({ ...good(), bpm: 0 }), ['badBpm']);
  assert.deepEqual(codes({ ...good(), bpm: NaN }), ['badBpm']);
});

test('validateTrack: unknownQuality (ohne zusätzliches chordNotInKey)', () => {
  const errs = validateTrack({ ...good(), bars: [am('A', 'xyz')] });
  assert.deepEqual(errs.map((e) => e.code), ['unknownQuality']);
  assert.equal(errs[0].params.chord, 'Axyz');
});

test('validateTrack: badBeats', () => {
  for (const beats of [0, -1, 2.5, '4', undefined]) {
    assert.deepEqual(codes({ ...good(), bars: [{ chord: { root: 'A', quality: 'min' }, beats }] }), ['badBeats'], String(beats));
  }
});

test('validateTrack: badLength', () => {
  for (const length of [0, -4, 1.5, '24', undefined]) {
    assert.deepEqual(codes({ ...good(), length }), ['badLength'], String(length));
  }
});

test('validateTrack: sammelt mehrere Meldungen und wirft nicht', () => {
  assert.deepEqual(codes({ ...good(), bpm: 0, length: 0, bars: [] }), ['badBpm', 'badLength', 'emptyBars']);
  assert.doesNotThrow(() => validateTrack({ ...good(), bars: [am('H', 'maj')] }));
});
