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

const render = (page, input, seconds = SECONDS, options) => page.evaluate(([i, s, o]) => window.__render(i, s, o), [input, seconds, options]);

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
  expect(r.perLayer.bass).toEqual({ peak: 0, rms: 0, centroid: 0 });
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

// Vor dem Begrenzer (limiter: false), 18 s, Seed 1, fullFromStart, gemessen 2026-11-07:
//   Summe Spitze: funk 0.736, psych 0.695, dreamy 0.691 (nach dem Begrenzer jeweils ~0.70)
//   rms je Schicht / lauteste: funk 0.670 / 0.793 / 1 / 0.498, psych 0.614 / 1 / 0.682 / 0.532,
//   dreamy 0.406 / 0.728 / 1 / 0.554 (drums / bass / chords / pad)
//   Anteil Samples über der Begrenzer-Schwelle (-10 dB): funk 3.1 %, psych 2.3 %, dreamy 1.9 %; über 0.5: höchstens 0.18 %
// Die Mischung selbst hat also Luft (Spitze unter -2.6 dBFS); der Begrenzer fängt nur Transienten.
const PRE_PEAK_MAX = 0.85; // Abstand ~0.11 zur höchsten Messung, deutlich unter 1.0
const PRE_RATIO_MIN = 0.35; // Abstand ~0.06 zum Minimum (dreamy drums 0.406)

for (const id of ['funk', 'psych', 'dreamy']) {
  test(`${id} vor dem Begrenzer: Summe mit Luft, Schichten im Verhältnis`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await render(page, track(id), SECONDS, { limiter: false });
    expect(r.peak).toBeLessThan(PRE_PEAK_MAX);
    const loudest = Math.max(...LAYERS.map((l) => r.perLayer[l].rms));
    for (const layer of LAYERS) {
      expect(r.perLayer[layer].rms / loudest, layer).toBeGreaterThanOrEqual(PRE_RATIO_MIN);
      expect(r.perLayer[layer].peak, layer).toBeLessThan(PRE_PEAK_MAX);
    }
  });
}

test('limiter: false misst wirklich vor dem Begrenzer (ohne dessen Nachverstärkung)', async ({ page }) => {
  test.setTimeout(120_000);
  // gemessen funk 6 s: rms davor/danach ~0.63; mit Begrenzer wäre das Verhältnis 1
  const pre = await render(page, track('funk'), 6, { limiter: false });
  const post = await render(page, track('funk'), 6);
  expect(pre.rms / post.rms).toBeLessThan(0.8);
  for (const layer of LAYERS) expect(pre.perLayer[layer].rms / post.perLayer[layer].rms, layer).toBeLessThan(0.8);
});

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

// Basistrack ohne klangformende Schlagworte: Am Am Dm E, 100 bpm, Seed 1, 24 Takte, 16 s.
// Basiswerte aufgenommen vor Einführung des Klangmodells (Commit b5467aa) über window.__render:
// je Begrenzer-Einstellung Summe und jede Schicht allein { peak, rms }.
const BASE_TRACK = {
  key: { root: 'A', mode: 'minor' },
  bpm: 100,
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  layers: { drums: true, bass: true, chords: true, pad: true },
  seed: 1,
  length: 24,
  tags: { development: ['fullFromStart'] },
};
const BASELINE = {
  limiter: {
    sum: { peak: 0.6924842596054077, rms: 0.21844540437901838 },
    drums: { peak: 0.6449302434921265, rms: 0.09300502722750302 },
    bass: { peak: 0.40817004442214966, rms: 0.17921658262486775 },
    chords: { peak: 0.6502371430397034, rms: 0.12017539105571275 },
    pad: { peak: 0.34489092230796814, rms: 0.07873770485969132 },
  },
  pre: {
    sum: { peak: 0.688706636428833, rms: 0.1318748606970193 },
    drums: { peak: 0.40511777997016907, rms: 0.05009726748802992 },
    bass: { peak: 0.21176163852214813, rms: 0.09297909625210916 },
    chords: { peak: 0.43066513538360596, rms: 0.0683636709576798 },
    pad: { peak: 0.17893196642398834, rms: 0.04085044316844499 },
  },
};

for (const limiter of [true, false]) {
  test(`Standardklang unverändert: Basiswerte (limiter ${limiter})`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await render(page, BASE_TRACK, 16, { limiter });
    const base = BASELINE[limiter ? 'limiter' : 'pre'];
    // relative Toleranz 1e-6: Chrome summiert Eingänge in wechselnder Reihenfolge (Abweichung ~1e-7 relativ gemessen)
    const same = (actual, expected, msg) => expect(Math.abs(actual - expected), `${msg}: ${actual} vs ${expected}`).toBeLessThanOrEqual(1e-6 * expected);
    same(r.peak, base.sum.peak, 'sum peak');
    same(r.rms, base.sum.rms, 'sum rms');
    for (const layer of LAYERS) {
      same(r.perLayer[layer].peak, base[layer].peak, `${layer} peak`);
      same(r.perLayer[layer].rms, base[layer].rms, `${layer} rms`);
    }
  });
}
