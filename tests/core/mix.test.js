import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliderGain, MIX_NAMES } from '../../src/audio/mix.js';
import { MIX_KEY, DEFAULT_MIX, loadMix, saveMix } from '../../src/ui/mix-state.js';
import { stepVariant } from '../../src/ui/variant.js';

const storageWith = (raw) => ({ getItem: () => raw });

test('sliderGain: 0 -> 0, 1 -> genau 1, 0.5 -> 0.25 (Quadrat)', () => {
  assert.equal(sliderGain(0), 0);
  assert.equal(sliderGain(1), 1);
  assert.equal(sliderGain(0.5), 0.25);
});

test('sliderGain: NaN, negativ, über 1, kein Zahlentyp wirft RangeError', () => {
  for (const bad of [NaN, -0.1, 1.01, Infinity, '0.5', null, undefined]) {
    assert.throws(() => sliderGain(bad), RangeError, String(bad));
  }
});

test('Mix: Schlüssel, Namen, Standard alles 1', () => {
  assert.equal(MIX_KEY, 'backingtrack.mix');
  assert.deepEqual(MIX_NAMES, ['drums', 'bass', 'chords', 'pad', 'master']);
  assert.deepEqual(DEFAULT_MIX, { drums: 1, bass: 1, chords: 1, pad: 1, master: 1 });
  assert.ok(Object.isFrozen(DEFAULT_MIX));
});

test('loadMix: leer, kaputtes JSON, Nicht-Objekt und gesperrter Speicher ergeben den Standard (als neues Objekt)', () => {
  const locked = { getItem() { throw new Error('gesperrt'); } };
  for (const s of [storageWith(null), storageWith('{kaputt'), storageWith('[1,2]'), storageWith('7'), storageWith('null'), locked, null]) {
    const m = loadMix(s);
    assert.deepEqual(m, DEFAULT_MIX);
    assert.notEqual(m, DEFAULT_MIX);
  }
});

test('loadMix: gültige Werte bleiben, ungültige einzeln auf 1, unbekannte Schlüssel entfallen', () => {
  const raw = JSON.stringify({ drums: 0.5, bass: 0, chords: 1.5, pad: 'laut', master: -1, extra: 0.2 });
  assert.deepEqual(loadMix(storageWith(raw)), { drums: 0.5, bass: 0, chords: 1, pad: 1, master: 1 });
  assert.deepEqual(loadMix(storageWith('{"master":0.3}')), { ...DEFAULT_MIX, master: 0.3 });
});

test('saveMix -> loadMix Rundreise; gesperrter Speicher wirft nicht', () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  const mix = { drums: 0.2, bass: 0.7, chords: 1, pad: 0, master: 0.9 };
  saveMix(storage, mix);
  assert.ok(map.has(MIX_KEY));
  assert.deepEqual(loadMix(storage), mix);
  assert.doesNotThrow(() => saveMix({ setItem() { throw new Error('gesperrt'); } }, mix));
  assert.doesNotThrow(() => saveMix(null, mix));
});

test('stepVariant: vor, zurück und Umbruch 9999 <-> 1', () => {
  assert.equal(stepVariant(5, 1), 6);
  assert.equal(stepVariant(5, -1), 4);
  assert.equal(stepVariant(9999, 1), 1);
  assert.equal(stepVariant(1, -1), 9999);
  assert.equal(stepVariant(1, 1), 2);
  assert.equal(stepVariant(9999, -1), 9998);
});
