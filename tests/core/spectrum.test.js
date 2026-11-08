import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spectralCentroid } from '../../src/audio/spectrum.js';

const RATE = 44100;
const FADE = Math.round(RATE * 0.01);
// Ton mit 10 ms Ein- und Ausblendung: ein harter Rand wäre ein Knack mit breitem Spektrum, den der Schwerpunkt
// über die ganze Eingabe mitzählt (ein harter 1-s-Sinus misst so etwa 1190 Hz)
const sine = (freq, seconds = 1) => {
  const n = Math.round(RATE * seconds);
  return Float32Array.from({ length: n }, (_, i) => {
    const edge = Math.min(1, i / FADE, (n - 1 - i) / FADE);
    return Math.sin((2 * Math.PI * freq * i) / RATE) * (0.5 - 0.5 * Math.cos(Math.PI * edge));
  });
};

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

test('einzelner Impuls: endlich, ohne NaN; auch am Anfang einer langen Eingabe zählt er', () => {
  const d = new Float32Array(4096);
  d[2048] = 1;
  const c = spectralCentroid(d, RATE);
  assert.ok(Number.isFinite(c) && c > 0, String(c));
  // Fenster beginnen vor der Eingabe (mit Nullen aufgefüllt): ein Einsatz bei Abtastwert 0 geht nicht verloren
  const onset = new Float32Array(RATE);
  onset[0] = 1;
  const first = spectralCentroid(onset, RATE);
  assert.ok(Number.isFinite(first) && first > 0, String(first));
});

test('ganze Eingabe zählt: eine Hälfte 500 Hz, die andere 4000 Hz ergibt die Mitte, in beiden Reihenfolgen', () => {
  // gleich laute Hälften: Mitte 2250 Hz (gemessen 2237); ein einzelnes Fenster am Anfang läge bei 1868 bzw. 2634
  for (const [a, b] of [[500, 4000], [4000, 500]]) {
    const d = new Float32Array(2 * RATE);
    d.set(sine(a));
    d.set(sine(b), RATE);
    const c = spectralCentroid(d, RATE);
    assert.ok(c > 500 && c < 4000, String(c));
    assert.ok(Math.abs(c - 2250) < 0.05 * 2250, `${a}/${b}: ${c}`);
  }
});

test('lange Eingabe (5 s): 1000-Hz-Sinus innerhalb 2 %, schnell', () => {
  const d = sine(1000, 5);
  const t0 = performance.now();
  const c = spectralCentroid(d, RATE);
  const ms = performance.now() - t0;
  assert.ok(Math.abs(c - 1000) < 20, String(c));
  assert.ok(ms < 1000, `${ms} ms`);
});

test('Signal am Ende einer langen Eingabe zählt mit', () => {
  const d = new Float32Array(5 * RATE);
  d.set(sine(1000, 1), 4 * RATE); // nur die letzte Sekunde klingt
  const c = spectralCentroid(d, RATE);
  assert.ok(Math.abs(c - 1000) < 20, String(c));
});
