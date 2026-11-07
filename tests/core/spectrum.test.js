import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spectralCentroid } from '../../src/audio/spectrum.js';

const RATE = 44100;
const sine = (freq, seconds = 1) => Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => Math.sin((2 * Math.PI * freq * i) / RATE));

test('1000-Hz-Sinus (1 s): Schwerpunkt innerhalb 2 % von 1000 Hz', () => {
  const c = spectralCentroid(sine(1000), RATE);
  assert.ok(Math.abs(c - 1000) < 20, String(c));
});

test('höherer Ton ergibt höheren Schwerpunkt', () => {
  assert.ok(spectralCentroid(sine(4000), RATE) > spectralCentroid(sine(500), RATE));
});

test('Stille ergibt 0', () => {
  assert.equal(spectralCentroid(new Float32Array(RATE), RATE), 0);
});

test('sehr kurze Eingabe ergibt 0 ohne Fehler', () => {
  assert.equal(spectralCentroid(new Float32Array(0), RATE), 0);
  assert.equal(spectralCentroid(Float32Array.of(1), RATE), 0);
});

test('einzelner Impuls: endlich, ohne NaN', () => {
  const d = new Float32Array(4096);
  d[2048] = 1;
  const c = spectralCentroid(d, RATE);
  assert.ok(Number.isFinite(c) && c > 0, String(c));
  const edge = new Float32Array(4096);
  edge[0] = 1; // Hann-Fenster ist am Rand 0: wie Stille
  assert.equal(spectralCentroid(edge, RATE), 0);
});

test('Fenster höchstens 2^16 Abtastwerte: lange Eingabe wird nur am Anfang gelesen', () => {
  const d = new Float32Array(2 ** 17);
  d.set(sine(1000, 2 ** 16 / RATE));
  d.fill(1, 2 ** 16); // dahinter Gleichanteil, der den Schwerpunkt verschöbe
  const c = spectralCentroid(d, RATE);
  assert.ok(Math.abs(c - 1000) < 20, String(c));
});
