// Messwerkzeug für die Klangformung: compareRenders, Spektralschwerpunkt im Offline-Render, timbre-Option.
import { test, expect } from '@playwright/test';

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
// Basistrack wie in levels.spec.js: Am Am Dm E, 100 bpm, Seed 1, alle Schichten ab Takt 1
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' },
  bpm: 100,
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  layers: { drums: true, bass: true, chords: true, pad: true },
  seed: 1,
  length: 24,
  tags: { development: ['fullFromStart'] },
  ...extra,
});

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function' && typeof window.__compare === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const compare = (page, a, b, seconds, options) => page.evaluate(([x, y, s, o]) => window.__compare(x, y, s, o), [a, b, seconds, options]);

test('compareRenders: identische Tracks ergeben diff ~0 und gleiche Schwerpunkte (Summe und Schicht)', async ({ page }) => {
  test.setTimeout(120_000);
  for (const options of [undefined, { layer: 'bass' }, { layer: 'pad', limiter: false }]) {
    const r = await compare(page, track(), track(), 6, options);
    const label = JSON.stringify(options);
    expect(r.diff, label).toBeLessThan(1e-6);
    expect(r.rmsA, label).toBeGreaterThan(0.005);
    expect(Math.abs(r.rmsB - r.rmsA), label).toBeLessThanOrEqual(1e-6 * r.rmsA);
    expect(r.centroidA, label).toBeGreaterThan(0);
    expect(Math.abs(r.centroidB - r.centroidA), label).toBeLessThanOrEqual(1e-6 * r.centroidA);
  }
});

test('compareRenders: anderes Tempo ergibt diff > 0.25', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await compare(page, track(), track({ bpm: 130 }), 6);
  expect(r.diff).toBeGreaterThan(0.25);
  const solo = await compare(page, track(), track({ bpm: 130 }), 6, { layer: 'drums' });
  expect(solo.diff).toBeGreaterThan(0.25);
});

test('compareRenders: Schicht allein unterscheidet sich von der Summe', async ({ page }) => {
  test.setTimeout(120_000);
  const sum = await compare(page, track(), track(), 6);
  const bass = await compare(page, track(), track(), 6, { layer: 'bass' });
  expect(bass.rmsA).toBeLessThan(sum.rmsA);
  // Bass allein hat einen tieferen Schwerpunkt als die Summe mit Hi-Hats und Akkorden
  expect(bass.centroidA).toBeLessThan(sum.centroidA);
});

test('renderOffline: Schwerpunkt endlich und > 0 für Summe und jede Schicht', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate((t) => window.__render(t, 16), track());
  expect(Number.isFinite(r.centroid) && r.centroid > 0, String(r.centroid)).toBe(true);
  for (const layer of LAYERS) {
    const c = r.perLayer[layer].centroid;
    expect(Number.isFinite(c) && c > 0, `${layer}: ${c}`).toBe(true);
  }
});

test('renderOffline: abgeschaltete Schicht meldet peak, rms und Schwerpunkt 0', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate((t) => window.__render(t, 6), track({ layers: { drums: true, bass: true, chords: false, pad: true } }));
  expect(r.perLayer.chords).toEqual({ peak: 0, rms: 0, centroid: 0 });
  expect(r.perLayer.bass.centroid).toBeGreaterThan(0);
});

test('createInstruments verträgt unvollständiges oder ungültiges timbre', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const results = [];
    for (const timbre of [undefined, null, 3, 'x', [], {}, { bass: { fuzz: 0.6 } }, { bass: { fuzz: NaN }, nope: {} }]) {
      try {
        const inst = createInstruments(new OfflineAudioContext(2, 4410, 44100), { bpm: 100, timbre });
        results.push(Object.keys(inst.layers).join());
      } catch (err) {
        results.push(err.message);
      }
    }
    return results;
  });
  expect(r).toEqual(Array(8).fill(LAYERS.join()));
});
