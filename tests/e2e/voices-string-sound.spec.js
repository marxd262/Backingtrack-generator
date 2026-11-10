// Saitenstimmen (E-Bass finger, E-Gitarre electric) im Browser: Stimmgenauigkeit, Pegel, Determinismus, Live-Wechsel, Feinwerte, Rechenzeit.
import { test, expect } from '@playwright/test';
import { TUNABLES } from '../../src/audio/voices/tunables.js';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { drums: true, bass: true, chords: true, pad: true }, seed: 1, length: 24,
  tags: { development: ['fullFromStart'] }, ...extra,
});
const STRINGS = [['bass', 'string', 'finger', [28, 40, 52]], ['chords', 'string', 'electric', [40, 57, 76]]];
const key = (layer, id, variant) => `${layer}/${id}/${variant}`;



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

const compare = (page, a, b, seconds, options) => page.evaluate(([x, y, s, o]) => window.__compare(x, y, s, o), [a, b, seconds, options]);

for (const [layer, id, variant, midis] of STRINGS) {
  test(`${key(layer, id, variant)}: Grundton innerhalb von 3 Cent, endlich, hörbar, begrenzt`, async ({ page }) => {
    const rows = await page.evaluate(async ([layerName, voiceId, variantName, notes]) => {
      const { pitchCents: pitch } = await import('/audio/analysis.js');
      const out = [];
      for (const midi of notes) {
        const d = await window.__renderNote(layerName, { midi, dur: 0.8, seconds: 1.2, voices: { [layerName]: { id: voiceId, variant: variantName } } });
        let peak = 0, sum = 0, finite = true;
        for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
        out.push({ midi, cents: pitch(d, 44100, midi), peak, rms: Math.sqrt(sum / d.length), finite });
      }
      return out;
    }, [layer, id, variant, midis]);
    for (const r of rows) {
      const label = JSON.stringify(r);
      expect(r.finite, label).toBe(true);
      expect(Math.abs(r.cents), label).toBeLessThanOrEqual(3); // mit Korpus-Resonanzen und Tonabnehmer gemessen (das Modell allein: unter 0,5)
      expect(r.rms, label).toBeGreaterThan(0.005);
      expect(r.peak, label).toBeLessThan(1);
    }
  });

  test(`${key(layer, id, variant)}: Pegel gegen den klassischen Synth im Band 0,7 bis 1,4`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(), track({ voices: { [layer]: { id, variant } } }), 8, { layer, limiter: false });
    const ratio = r.rmsB / r.rmsA;
    expect(ratio, JSON.stringify(r)).toBeGreaterThan(0.7);
    expect(ratio, JSON.stringify(r)).toBeLessThan(1.4);
  });

  test(`${key(layer, id, variant)}: gleicher Track zweimal gerendert gleich; stumme Schicht bleibt stumm`, async ({ page }) => {
    test.setTimeout(120_000);
    const withVoice = track({ voices: { [layer]: { id, variant } } });
    const r = await compare(page, withVoice, withVoice, 6, { layer });
    expect(r.diff).toBeLessThan(1e-5);
    const off = await page.evaluate((t) => window.__render(t, 4), track({ voices: { [layer]: { id, variant } }, layers: { drums: true, bass: layer !== 'bass', chords: layer !== 'chords', pad: true } }));
    expect(off.perLayer[layer]).toEqual({ peak: 0, rms: 0, centroid: 0 });
  });

  test(`${key(layer, id, variant)}: Wechsel mitten im Render (vorher gleich Synth, danach anders, nie über 1)`, async ({ page }) => {
    const r = await page.evaluate(async ([layerName, voiceId, variantName]) => {
      const { createInstruments } = await import('/audio/synth.js');
      const render = async (live) => {
        const ctx = new OfflineAudioContext(1, 44100, 44100);
        const inst = createInstruments(ctx, { bpm: 100, limiter: false });
        inst.output.connect(ctx.destination);
        const note = (midi) => ({ type: 'note', layer: layerName, midi, dur: 0.3, vel: 0.8 });
        for (const m of layerName === 'bass' ? [40] : [57, 64]) inst.layers[layerName].trigger(note(m), 0.05);
        // der Planer löst Töne kurz vor ihrem Zeitpunkt aus: die späteren Töne kommen darum erst nach dem Wechsel
        ctx.suspend(0.3).then(() => {
          if (live) inst.setVoices({ [layerName]: { id: voiceId, variant: variantName } });
          for (const m of layerName === 'bass' ? [43] : [60, 67]) inst.layers[layerName].trigger(note(m), 0.5);
          ctx.resume();
        });
        return (await ctx.startRendering()).getChannelData(0);
      };
      const clean = await render(false), live = await render(true);
      const mean = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += Math.abs(live[i] - clean[i]); return s / (to - from); };
      let peak = 0;
      for (const v of live) peak = Math.max(peak, Math.abs(v));
      return { before: mean(0, 13000), after: mean(22050, 40000), peak };
    }, [layer, id, variant]);
    expect(r.before, JSON.stringify(r)).toBeLessThan(1e-6);
    expect(r.after, JSON.stringify(r)).toBeGreaterThan(1e-3);
    expect(r.peak, JSON.stringify(r)).toBeLessThan(1);
  });

  test(`${key(layer, id, variant)}: jeder Feinwert ändert die Ausgabe (Minimum gegen Maximum)`, async ({ page }) => {
    test.setTimeout(120_000);
    const k = key(layer, id, variant);
    const names = Object.keys(TUNABLES[k] ?? {});
    expect(names.length, `Feinwerte für ${k}`).toBeGreaterThan(5);
    const rows = await page.evaluate(async ([layerName, voiceId, variantName, tunableKey, list]) => {
      const { createInstruments } = await import('/audio/synth.js');
      const out = [];
      for (const [name, min, max] of list) {
        const run = async (value) => {
          const ctx = new OfflineAudioContext(1, 44100, 44100);
          const inst = createInstruments(ctx, { limiter: false, voices: { [layerName]: { id: voiceId, variant: variantName } }, tuning: { [tunableKey]: { [name]: value } } });
          inst.output.connect(ctx.destination);
          for (const n of layerName === 'bass' ? [40] : [52, 59, 64]) inst.layers[layerName].trigger({ type: 'note', layer: layerName, midi: n, dur: 0.5, vel: 0.8 }, 0.05);
          return (await ctx.startRendering()).getChannelData(0);
        };
        const a = await run(min), b = await run(max);
        let diff = 0, energy = 0;
        for (let i = 0; i < a.length; i++) { diff += (a[i] - b[i]) ** 2; energy += a[i] * a[i] + b[i] * b[i]; }
        out.push([name, Math.sqrt(diff / (energy / 2 + 1e-12))]);
      }
      return out;
    }, [layer, id, variant, k, names.map((n) => [n, TUNABLES[k][n].min, TUNABLES[k][n].max])]);
    for (const [name, diff] of rows) expect(diff, `${k}.${name}`).toBeGreaterThan(1e-3);
  });
}

test('Saitenstimme Akkorde: sechs gleichzeitige Töne im Planer-Takt berechnet, beim wiederholten Anschlag aus dem Zwischenspeicher', async ({ page }) => {
  const times = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const ctx = new OfflineAudioContext(1, 44100 * 8, 44100);
    const inst = createInstruments(ctx, { limiter: false, voices: { chords: { id: 'string', variant: 'electric' } } });
    inst.output.connect(ctx.destination);
    const chord = [40, 47, 52, 56, 59, 64];
    const timeOf = (t) => {
      const start = performance.now();
      for (const midi of chord) inst.layers.chords.trigger({ type: 'note', layer: 'chords', midi, dur: 1.0, vel: 0.8 }, t);
      return performance.now() - start;
    };
    return [0, 1, 2, 3, 4].map((i) => timeOf(0.1 + i * 1.2));
  });
  expect(times[0], `kalt ${times.map((x) => x.toFixed(1))}`).toBeLessThan(100); // der Planer löst Töne 100 ms vor ihrem Zeitpunkt aus
  expect(Math.min(...times.slice(3)), `warm ${times.map((x) => x.toFixed(1))}`).toBeLessThan(10);
});
