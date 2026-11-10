// Wählbare Stimmen im Browser (Harness /ui/render-harness.html): Verdrahtung, Standard bitgleich, Fallbacks, Live-Umschaltung.
import { test, expect } from '@playwright/test';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { drums: true, bass: true, chords: true, pad: true }, seed: 1, length: 24,
  tags: { development: ['fullFromStart'] }, ...extra,
});

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

test('Standardstimme: renderNote ohne voices, mit synth/classic und mit Unbrauchbarem ist gleich (alle drei Instrumente; Chrome-Summenrauschen unter 1e-6)', async ({ page }) => {
  const same = await page.evaluate(async () => {
    const out = [];
    for (const [layer, midi] of [['bass', 40], ['chords', 57], ['pad', 60]]) {
      const base = await window.__renderNote(layer, { midi });
      for (const voices of [{ [layer]: { id: 'synth', variant: 'classic' } }, { [layer]: { id: 'nope' } }, null, 3, [], 'x']) {
        const other = await window.__renderNote(layer, { midi, voices });
        out.push(`${layer} ${JSON.stringify(voices)}: ${base.length === other.length && base.every((v, i) => Math.abs(v - other[i]) < 1e-6)}`);
      }
    }
    return out;
  });
  expect(same.filter((line) => !line.endsWith('true')), same.join('\n')).toEqual([]);
});

test('Stimmen im Track: gültige Formen ohne Wirkung auf den Standard (voices fehlt, null, {}, nur synth) rendern gleich (rms-Differenz unter 1e-5, Chrome-Summenrauschen)', async ({ page }) => {
  test.setTimeout(120_000);
  for (const voices of [null, {}, { bass: { id: 'synth' } }, { chords: 'synth', pad: { id: 'synth', variant: 'classic' } }]) {
    const r = await compare(page, track(), track({ voices }), 6);
    expect(r.diff, JSON.stringify(voices)).toBeLessThan(1e-5);
  }
});

test('Unbrauchbare Eingaben an die Instrumente werfen nicht: voices, setVoices, setTuning', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const results = [];
    for (const voices of [undefined, null, 3, 'x', [], {}, { bass: { id: 'nope' } }, { drums: { id: 'string' } }, { bass: { id: 'string', variant: 'nope' } }]) {
      try {
        const inst = createInstruments(new OfflineAudioContext(2, 4410, 44100), { bpm: 100, voices, tuning: voices });
        inst.setVoices(voices);
        inst.setTuning(voices);
        inst.setTuning(7);
        results.push('ok');
      } catch (err) {
        results.push(err.message);
      }
    }
    return results;
  });
  expect(r).toEqual(Array(9).fill('ok'));
});

test('setVoices mitten im Render: kein Fehler, vor dem Wechsel gleich dem Standard', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const render = async (switchTo) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const inst = createInstruments(ctx, { bpm: 100, limiter: false });
      inst.output.connect(ctx.destination);
      const note = (layer, midi) => ({ type: 'note', layer, midi, dur: 0.3, vel: 1 });
      for (const layer of ['bass', 'chords', 'pad']) inst.layers[layer].trigger(note(layer, layer === 'bass' ? 40 : 57), 0.05);
      ctx.suspend(0.3).then(() => {
        if (switchTo) inst.setVoices(switchTo);
        for (const layer of ['bass', 'chords', 'pad']) inst.layers[layer].trigger(note(layer, layer === 'bass' ? 43 : 60), 0.5);
        ctx.resume();
      });
      return (await ctx.startRendering()).getChannelData(0);
    };
    const clean = await render(null);
    const other = await render({ bass: { id: 'nope' }, chords: 'synth' });
    return { same: clean.length === other.length && clean.every((v, i) => Math.abs(v - other[i]) < 1e-6) };
  });
  expect(r.same).toBe(true);
});
