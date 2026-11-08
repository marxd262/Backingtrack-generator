// Mischpult im Klang: Schichtpegel und Gesamtlautstärke durch die echten Instrumente (Offline-Render auf der Harness-Seite).
import { test, expect } from '@playwright/test';

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const SECONDS = 6;
// Basistrack wie in sound.spec.js: Am Am Dm E, 100 bpm, Seed 1, alle Schichten ab Takt 1
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
const ONE = { levels: { drums: 1, bass: 1, chords: 1, pad: 1 }, master: 1 };

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const render = (page, input, options) => page.evaluate(([i, s, o]) => window.__render(i, s, o), [input, SECONDS, options]);

test('Alle Pegel 1: Render identisch zum Standard (Summe und jede Schicht)', async ({ page }) => {
  test.setTimeout(120_000);
  const base = await render(page, track());
  const one = await render(page, track(), ONE);
  const rel = (a, b) => Math.abs(a - b) / a;
  for (const [a, b, label] of [[base, one, 'Summe'], ...LAYERS.map((l) => [base.perLayer[l], one.perLayer[l], l])]) {
    expect(a.rms, label).toBeGreaterThan(0.005);
    expect(rel(a.rms, b.rms), label).toBeLessThanOrEqual(1e-6);
    expect(rel(a.peak, b.peak), label).toBeLessThanOrEqual(1e-6);
  }
});

test('Bass 0.5: Bass-rms etwa 0.25-fach, andere Schichten unverändert (ohne und mit Begrenzer)', async ({ page }) => {
  test.setTimeout(120_000);
  // ohne Begrenzer ist die Kette linear: Verhältnis 0.25 auf 1e-3 genau (Gleitkomma in float32)
  const base = await render(page, track(), { limiter: false });
  const half = await render(page, track(), { limiter: false, levels: { bass: 0.5 } });
  expect(half.perLayer.bass.rms / base.perLayer.bass.rms).toBeCloseTo(0.25, 3);
  for (const l of ['drums', 'chords', 'pad']) expect(Math.abs(half.perLayer[l].rms - base.perLayer[l].rms), l).toBeLessThanOrEqual(1e-6 * base.perLayer[l].rms);
  // mit Begrenzer: gemessen ebenfalls 0.25 (die Bass-Schicht allein bleibt unter der Schwelle); Toleranz 1e-3, die anderen 1e-6 relativ
  const lim = await render(page, track());
  const limHalf = await render(page, track(), { levels: { bass: 0.5 } });
  expect(limHalf.perLayer.bass.rms / lim.perLayer.bass.rms).toBeCloseTo(0.25, 3);
  for (const l of ['drums', 'chords', 'pad']) expect(Math.abs(limHalf.perLayer[l].rms - lim.perLayer[l].rms), l).toBeLessThanOrEqual(1e-6 * lim.perLayer[l].rms);
});

test('Gesamtlautstärke 0.5: Ausgabe 0.25-fach samt Echo- und Hallfahnen, auch mit Begrenzer', async ({ page }) => {
  test.setTimeout(120_000);
  const base = await render(page, track());
  const half = await render(page, track(), { master: 0.5 });
  // sie liegt hinter dem Begrenzer: das Verhältnis ist trotz Begrenzer exakt (Toleranz 1e-4)
  expect(half.rms / base.rms).toBeCloseTo(0.25, 4);
  expect(half.peak / base.peak).toBeCloseTo(0.25, 4);
  for (const l of LAYERS) expect(half.perLayer[l].rms / base.perLayer[l].rms, l).toBeCloseTo(0.25, 4);
});

test('Pegel 0: Schicht ist still samt Echo und Hall, Rest unverändert; Stummschalten im Track bleibt still', async ({ page }) => {
  test.setTimeout(120_000);
  const base = await render(page, track());
  const r = await render(page, track(), { levels: Object.fromEntries(LAYERS.map((l) => [l, l === 'chords' || l === 'drums' ? 0 : 1])) });
  expect(r.perLayer.chords).toEqual({ peak: 0, rms: 0, centroid: 0 }); // Echo-Sendeweg
  expect(r.perLayer.drums).toEqual({ peak: 0, rms: 0, centroid: 0 }); // Raum-Sendeweg
  for (const l of ['bass', 'pad']) expect(Math.abs(r.perLayer[l].rms - base.perLayer[l].rms), l).toBeLessThanOrEqual(1e-6 * base.perLayer[l].rms);
  const muted = await render(page, track({ layers: { drums: true, bass: false, chords: true, pad: true } }), { levels: { bass: 0.5 } });
  expect(muted.perLayer.bass).toEqual({ peak: 0, rms: 0, centroid: 0 });
});

test('Ungültige Pegel: RangeError, unbekannte Schicht wirft; setLevel/setMaster der Instrumente wirken live', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await page.evaluate(async (t) => {
    const out = {};
    for (const [name, opts] of [['nan', { levels: { bass: NaN } }], ['neg', { master: -0.1 }], ['big', { levels: { pad: 1.5 } }], ['unknown', { levels: { horn: 1 } }]]) {
      try { await window.__render(t, 1, opts); out[name] = 'kein Fehler'; } catch (e) { out[name] = e.constructor.name; }
    }
    return out;
  }, track());
  expect(errors).toEqual({ nan: 'RangeError', neg: 'RangeError', big: 'RangeError', unknown: 'Error' });

  // setLevel/setMaster vor dem Rendern gesetzt: nach der Rampe (< 0.2 s) gilt v*v, Noten erst bei 0.5 s
  const rms = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const note = { layer: 'bass', type: 'note', midi: 45, dur: 0.4, vel: 1 };
    const run = async (setup) => {
      const ctx = new OfflineAudioContext(2, 44100, 44100);
      const inst = createInstruments(ctx, { limiter: false });
      inst.output.connect(ctx.destination);
      setup(inst);
      inst.layers.bass.trigger(note, 0.5);
      const d = (await ctx.startRendering()).getChannelData(0);
      let s = 0;
      for (const v of d) s += v * v;
      return Math.sqrt(s / d.length);
    };
    const bad = [];
    await run((i) => { for (const f of [() => i.setLevel('bass', NaN), () => i.setMaster(2), () => i.setLevel('horn', 1)]) { try { f(); bad.push('kein Fehler'); } catch (e) { bad.push(e.constructor.name); } } });
    return { base: await run(() => {}), level: await run((i) => i.setLevel('bass', 0.5)), master: await run((i) => i.setMaster(0.5)), both: await run((i) => { i.setLevel('bass', 0.5); i.setMaster(0.5); }), bad };
  });
  expect(rms.bad).toEqual(['RangeError', 'RangeError', 'Error']);
  expect(rms.level / rms.base).toBeCloseTo(0.25, 3);
  expect(rms.master / rms.base).toBeCloseTo(0.25, 3);
  expect(rms.both / rms.base).toBeCloseTo(0.0625, 3);
});
