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

test('renderNote lehnt Schlagzeug und Percussion ab (sie spielen Schläge, keine Töne)', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const out = {};
    for (const layer of ['drums', 'percussion']) out[layer] = await window.__renderNote(layer, { midi: 40 }).catch((err) => `${err.name}: ${err.message}`);
    return out;
  });
  expect(r).toEqual({ drums: 'RangeError: Unknown layer: "drums"', percussion: 'RangeError: Unknown layer: "percussion"' });
});

// Percussion (synth/classic): ein Schlag je Name über createInstruments, ohne Begrenzer, nur die Schicht (Hall der Raumsumme aus)
test('Percussion: jeder Name klingt (nicht stumm, Spitze unter 1); Unbekanntes und Nicht-Schläge bleiben stumm', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const { PERCUSSION_NAMES } = await import('/core/events.js');
    const { spectralCentroid } = await import('/audio/spectrum.js');
    const render = async (event) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const { output, layers } = createInstruments(ctx, { limiter: false, timbre: { master: { echo: 0, reverb: 0 } } });
      output.connect(ctx.destination);
      layers.percussion.trigger({ layer: 'percussion', ...event }, 0.05);
      return (await ctx.startRendering()).getChannelData(0);
    };
    const stats = (d) => {
      let peak = 0, sum = 0;
      for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      return { peak, rms: Math.sqrt(sum / d.length), centroid: spectralCentroid(d, 44100) };
    };
    const out = { names: {}, quiet: {} };
    for (const name of PERCUSSION_NAMES) out.names[name] = stats(await render({ type: 'hit', name, vel: 0.6 }));
    const soft = stats(await render({ type: 'hit', name: 'congaHigh', vel: 0.2 })), loud = stats(await render({ type: 'hit', name: 'congaHigh', vel: 0.8 }));
    out.velocity = { soft: soft.peak, loud: loud.peak };
    for (const [key, event] of Object.entries({ unknown: { type: 'hit', name: 'gong', vel: 0.6 }, note: { type: 'note', midi: 60, dur: 0.3, vel: 0.6 }, nameless: { type: 'hit', vel: 0.6 } })) {
      out.quiet[key] = stats(await render(event)).peak;
    }
    return out;
  });
  const label = JSON.stringify(r, null, 1);
  expect(Object.keys(r.names).length, label).toBe(8);
  for (const [name, s] of Object.entries(r.names)) {
    expect(s.peak, `${name} ${label}`).toBeGreaterThan(0.01);
    expect(s.peak, `${name} ${label}`).toBeLessThan(1);
  }
  expect(r.velocity.loud, label).toBeGreaterThan(r.velocity.soft * 2);
  expect(r.quiet, label).toEqual({ unknown: 0, note: 0, nameless: 0 });
});

// Crash (Synth): hörbar, endlich, Spitze unter 1, klingt länger aus als die offene Hi-Hat (rms von 0,5 bis 1 s nach dem Anschlag)
test('Schlagzeug: der Crash klingt, ist endlich, übersteuert nicht und hallt länger nach als die offene Hi-Hat', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const out = {};
    for (const name of ['crash', 'openHat']) {
      const ctx = new OfflineAudioContext(1, 88200, 44100);
      const { output, layers } = createInstruments(ctx, { limiter: false, timbre: { master: { echo: 0, reverb: 0 } } });
      output.connect(ctx.destination);
      layers.drums.trigger({ type: 'hit', layer: 'drums', name, vel: 0.8 }, 0.05);
      const d = (await ctx.startRendering()).getChannelData(0);
      let peak = 0, tail = 0, finite = true;
      d.forEach((v, i) => { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); if (i >= 24255 && i < 46305) tail += v * v; });
      out[name] = { peak, tail: Math.sqrt(tail / 22050), finite };
    }
    return out;
  });
  const label = JSON.stringify(r);
  expect(r.crash.finite, label).toBe(true);
  expect(r.crash.peak, label).toBeGreaterThan(0.05);
  expect(r.crash.peak, label).toBeLessThan(1);
  expect(r.crash.tail, label).toBeGreaterThan(r.openHat.tail * 3);
  expect(r.crash.tail, label).toBeGreaterThan(0.001);
});

// Schlagzeug als Stimme der Registry: Klang unverändert gegenüber dem Stand vor dem Umzug (gemessen mit Standardklang, limiter: false,
// ein Schlag bei vel 0.8 an 0.05 s, 1 s mono: Spitze und Summe der Quadrate). Die Werte halten damit auch LAYER_AUDIO.drums.trim, MASTER und
// den Standardklang (Timbre) fest: ändert sich einer davon, ändern sich diese Zahlen)
test('Schlagzeug: jeder Schlag klingt wie vor dem Umzug in die Registry; Unbekanntes bleibt stumm', async ({ page }) => {
  const expected = {
    kick: [0.278121, 53.1729], snare: [0.191694, 4.2092], hat: [0.125049, 1.4005], openHat: [0.14075, 8.2259],
    tomHigh: [0.216292, 31.4266], tomMid: [0.216292, 31.5652], tomLow: [0.216292, 31.4567], nope: [0, 0],
  };
  const got = await page.evaluate(async (names) => {
    const { createInstruments } = await import('/audio/synth.js');
    const out = {};
    for (const name of names) {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const { output, layers, whenReady } = createInstruments(ctx, { limiter: false });
      await whenReady();
      output.connect(ctx.destination);
      layers.drums.trigger({ type: 'hit', layer: 'drums', name, vel: 0.8 }, 0.05);
      let peak = 0, sq = 0;
      for (const v of (await ctx.startRendering()).getChannelData(0)) { peak = Math.max(peak, Math.abs(v)); sq += v * v; }
      out[name] = [peak, sq];
    }
    return out;
  }, Object.keys(expected));
  for (const [name, [peak, sq]] of Object.entries(expected)) {
    expect(got[name][0], `${name} Spitze`).toBeCloseTo(peak, 5);
    expect(Math.abs(got[name][1] - sq), `${name} Energie`).toBeLessThanOrEqual(1e-3 * Math.max(sq, 1));
  }
});
