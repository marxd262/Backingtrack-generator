// E-Piano (chords/epiano/rhodes, FM) im Browser: Stimmgenauigkeit, Pegel, Anschlagstärke, Klangregler, Feinwerte, Tonumfang.
import { test, expect } from '@playwright/test';
import { TUNABLES } from '../../src/audio/voices/tunables.js';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { drums: true, bass: true, chords: true, pad: true }, seed: 1, length: 24,
  tags: { development: ['fullFromStart'] }, ...extra,
});
const KEY = 'chords/epiano/rhodes';
const VOICES = { chords: { id: 'epiano', variant: 'rhodes' } };



let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function' && typeof window.__renderNote === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('E-Piano: Grundton innerhalb von 10 Cent, endlich, hörbar, begrenzt', async ({ page }) => {
  const rows = await page.evaluate(async (voices) => {
    const { pitchCents: pitch } = await import('/audio/analysis.js');
    const out = [];
    for (const midi of [40, 57, 76]) {
      const d = await window.__renderNote('chords', { midi, dur: 0.8, seconds: 1.2, voices });
      let peak = 0, sum = 0, finite = true;
      for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      out.push({ midi, cents: pitch(d, 44100, midi), peak, rms: Math.sqrt(sum / d.length), finite });
    }
    return out;
  }, VOICES);
  for (const r of rows) {
    const label = JSON.stringify(r);
    expect(r.finite, label).toBe(true);
    expect(Math.abs(r.cents), label).toBeLessThanOrEqual(10);
    expect(r.rms, label).toBeGreaterThan(0.005);
    expect(r.peak, label).toBeLessThan(1);
  }
});

test('E-Piano: Pegel gegen die klassischen Akkorde im Band 0,7 bis 1,4', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate(([a, b]) => window.__compare(a, b, 8, { layer: 'chords', limiter: false }), [track(), track({ voices: VOICES })]);
  const ratio = r.rmsB / r.rmsA;
  expect(ratio, JSON.stringify(r)).toBeGreaterThan(0.7);
  expect(ratio, JSON.stringify(r)).toBeLessThan(1.4);
});

test('E-Piano: härterer Anschlag ist heller; Helligkeit und Länge wirken; Tremolo wirkt', async ({ page }) => {
  const r = await page.evaluate(async (voices) => {
    const { spectralCentroid } = await import('/audio/spectrum.js');
    const centroid = (d) => spectralCentroid(d.subarray(2205), 44100);
    const diff = (a, b) => { let s = 0, e = 0; for (let i = 0; i < a.length; i++) { s += (a[i] - b[i]) ** 2; e += a[i] ** 2; } return Math.sqrt(s / (e + 1e-12)); };
    const note = (extra) => window.__renderNote('chords', { midi: 57, dur: 1.0, seconds: 1.5, voices, ...extra });
    const soft = await note({ vel: 0.2 }), hard = await note({ vel: 1 });
    return {
      softC: centroid(soft), hardC: centroid(hard),
      brightness: diff(await note({ timbre: { chords: { brightness: 0.1 } } }), await note({ timbre: { chords: { brightness: 0.9 } } })),
      length: diff(await note({ timbre: { chords: { length: 0.1 } } }), await note({ timbre: { chords: { length: 0.9 } } })),
      tremolo: diff(await note({ timbre: { chords: { tremolo: 0 } } }), await note({ timbre: { chords: { tremolo: 1 } } })),
    };
  }, VOICES);
  const label = JSON.stringify(r);
  expect(r.hardC, label).toBeGreaterThan(r.softC);
  expect(r.brightness, label).toBeGreaterThan(0.05);
  expect(r.length, label).toBeGreaterThan(0.05);
  expect(r.tremolo, label).toBeGreaterThan(0.05);
});

test('E-Piano: jeder Feinwert ändert die Ausgabe (Minimum gegen Maximum)', async ({ page }) => {
  test.setTimeout(120_000);
  const names = Object.keys(TUNABLES[KEY] ?? {});
  expect(names.length, `Feinwerte für ${KEY}`).toBeGreaterThan(4);
  const rows = await page.evaluate(async ([voices, tunableKey, list]) => {
    const out = [];
    for (const [name, min, max] of list) {
      const a = await window.__renderNote('chords', { midi: 57, dur: 0.8, seconds: 1.2, voices, tuning: { [tunableKey]: { [name]: min } } });
      const b = await window.__renderNote('chords', { midi: 57, dur: 0.8, seconds: 1.2, voices, tuning: { [tunableKey]: { [name]: max } } });
      let diff = 0, energy = 0;
      for (let i = 0; i < a.length; i++) { diff += (a[i] - b[i]) ** 2; energy += a[i] * a[i] + b[i] * b[i]; }
      out.push([name, Math.sqrt(diff / (energy / 2 + 1e-12))]);
    }
    return out;
  }, [VOICES, KEY, names.map((n) => [n, TUNABLES[KEY][n].min, TUNABLES[KEY][n].max])]);
  for (const [name, diff] of rows) expect(diff, `${KEY}.${name}`).toBeGreaterThan(1e-3);
});

test('E-Piano: Tonumfang 24 bis 100, auch sehr kurze und lange Töne, bleibt endlich und begrenzt', async ({ page }) => {
  const bad = await page.evaluate(async (voices) => {
    const out = [];
    for (const midi of [24, 36, 60, 84, 100]) {
      for (const dur of [0.02, 0.5, 4]) {
        const d = await window.__renderNote('chords', { midi, dur, seconds: 1.0, vel: 1, voices });
        let peak = 0, finite = true;
        for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); }
        if (!finite || peak > 1 || peak < 1e-4) out.push(`${midi}/${dur}: finite ${finite} peak ${peak}`);
      }
    }
    return out;
  }, VOICES);
  expect(bad).toEqual([]);
});
