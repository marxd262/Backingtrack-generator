// Pegeltests: rendert Tracks offline auf der Harness-Seite und prüft Spitze, Hörbarkeit und Stummschaltung.
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';

const SECONDS = 18;
const LAYERS = ['drums', 'bass', 'chords', 'pad'];

// fullFromStart: alle vier Schichten spielen ab Takt 1, sonst schweigen Akkorde und Pad im Aufbau
const track = (id, extra = {}) => {
  const preset = STYLE_PRESETS.find((p) => p.id === id);
  return {
    key: { root: 'A', mode: 'minor' },
    bpm: preset.bpm,
    bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
    tags: { ...preset.tags, development: ['fullFromStart'] },
    seed: 1,
    ...extra,
  };
};

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  // zählt echte AudioContexts; OfflineAudioContext bleibt unberührt
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
  });
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const render = (page, input, seconds = SECONDS) => page.evaluate(([i, s]) => window.__render(i, s), [input, seconds]);

test('Seite erzeugt beim Laden keinen AudioContext', async ({ page }) => {
  expect(await page.evaluate(() => window.__audioContexts)).toBe(0);
});

test('Hörprobe-Knöpfe starten und stoppen ohne Fehler', async ({ page }) => {
  await page.getByRole('button', { name: 'Funk' }).click();
  await expect.poll(() => page.evaluate(() => window.__audioContexts)).toBe(1);
  await page.getByRole('button', { name: 'Stopp' }).click();
});

test('Funk: Summe clippt nicht, jede Schicht hörbar, Verhältnisse im Rahmen', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await render(page, track('funk'));
  expect(r.peak).toBeLessThan(0.9);
  for (const layer of LAYERS) expect(r.perLayer[layer].rms, layer).toBeGreaterThan(0.005);
  // Gemessen (funk, 18 s, Seed 1), rms je Schicht / lauteste: drums 0.705, bass 0.875, chords 1, pad 0.550
  // (psych: 0.586 / 1 / 0.683 / 0.532, dreamy: 0.425 / 0.789 / 1 / 0.600). Untergrenze 0.4 mit Abstand zum Minimum 0.55;
  // ein Bass 3-5x zu laut oder kaum hörbare Akkorde wie in backing-demo.html drücken andere Schichten darunter.
  const loudest = Math.max(...LAYERS.map((l) => r.perLayer[l].rms));
  for (const layer of LAYERS) {
    const ratio = r.perLayer[layer].rms / loudest;
    expect(ratio, layer).toBeGreaterThanOrEqual(0.4);
    expect(ratio, layer).toBeLessThanOrEqual(1);
  }
});

test('Funk ohne Bass: Bass exakt still, Rest hörbar', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await render(page, track('funk', { layers: { drums: true, bass: false, chords: true, pad: true } }));
  expect(r.perLayer.bass).toEqual({ peak: 0, rms: 0 });
  for (const layer of ['drums', 'chords', 'pad']) expect(r.perLayer[layer].rms, layer).toBeGreaterThan(0.005);
  expect(r.peak).toBeLessThan(0.9);
});

for (const id of ['psych', 'dreamy']) {
  test(`${id}: Summe clippt nicht, jede Schicht hörbar`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await render(page, track(id));
    expect(r.peak).toBeLessThan(0.9);
    for (const layer of LAYERS) expect(r.perLayer[layer].rms, layer).toBeGreaterThan(0.005);
  });
}

test('gleiche Eingabe ergibt identischen Render', async ({ page }) => {
  test.setTimeout(120_000);
  const a = await render(page, track('funk'), 6);
  const b = await render(page, track('funk'), 6);
  // Chrome summiert viele Eingänge eines Knotens in wechselnder Reihenfolge: Abweichung ~1e-9 (Float-Rundung).
  // Exakter Vergleich ist damit unmöglich; Math.random im Rauschen würde um Prozente abweichen.
  const same = (x, y) => expect(Math.abs(x - y)).toBeLessThan(1e-6);
  same(b.peak, a.peak);
  same(b.rms, a.rms);
  for (const layer of LAYERS) {
    same(b.perLayer[layer].peak, a.perLayer[layer].peak);
    same(b.perLayer[layer].rms, a.perLayer[layer].rms);
  }
});
