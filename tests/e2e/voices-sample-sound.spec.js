// Sample-Stimmen (Packs aus MuseScore_General) im Browser: Tonhöhe, Pegel, Determinismus, Laden mit Rückfall auf den Synth, Hüllkurve,
// Live-Wechsel, Feinwerte. Harness: /ui/render-harness.html
import { test, expect } from '@playwright/test';
import { TUNABLES } from '../../src/audio/voices/tunables.js';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { drums: true, bass: true, chords: true, pad: true }, seed: 1, length: 24,
  tags: { development: ['fullFromStart'] }, ...extra,
});
// [Instrument, Variante, Töne für die Prüfung, Tonhöhe prüfen?]
const SAMPLES = [
  ['bass', 'finger', [28, 40, 52], true],
  ['bass', 'pick', [28, 40, 52], true],
  ['chords', 'guitar', [40, 57, 76, 100], true],
  ['chords', 'epiano', [24, 40, 60, 84, 100], true],
  ['pad', 'strings', [24, 48, 72, 100], false],
  ['pad', 'warm', [24, 48, 72, 100], false],
];
const voiceOf = (layer, variant) => ({ [layer]: { id: 'sample', variant } });
const key = (layer, variant) => `${layer}/sample/${variant}`;

let problems;
let allowLoadErrors = false; // nur die Tests mit absichtlich scheiterndem Laden dürfen Ladefehler in der Konsole haben

test.beforeEach(async ({ page }) => {
  problems = [];
  allowLoadErrors = false;
  page.on('console', (msg) => msg.type() === 'error' && !(allowLoadErrors && /Failed to load resource|Sample pack/.test(msg.text())) && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function' && typeof window.__renderNote === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const compare = (page, a, b, seconds, options) => page.evaluate(([x, y, s, o]) => window.__compare(x, y, s, o), [a, b, seconds, options]);

for (const [layer, variant, notes, checkPitch] of SAMPLES) {
  test(`${key(layer, variant)}: hörbar, endlich, unter 1, im ganzen Tonumfang${checkPitch ? ', Grundton innerhalb von 15 Cent' : ''}`, async ({ page }) => {
    test.setTimeout(120_000);
    const rows = await page.evaluate(async ([layerName, variantName, midis]) => {
      const { pitchCents } = await import('/audio/analysis.js');
      const { createInstruments } = await import('/audio/synth.js');
      const out = [];
      // das Pack muss wirklich geladen sein (sonst spielt der Rückfall-Synth und alle Prüfungen unten bestünden trotzdem)
      const probe = createInstruments(new OfflineAudioContext(1, 4410, 44100), { voices: { [layerName]: { id: 'sample', variant: variantName } } });
      await probe.whenReady();
      out.push({ status: probe.voiceStatus()[layerName] });
      for (const midi of midis) {
        const d = await window.__renderNote(layerName, { midi, dur: 0.8, seconds: 1.4, voices: { [layerName]: { id: 'sample', variant: variantName } } });
        let peak = 0, sum = 0, finite = true;
        for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
        out.push({ midi, cents: pitchCents(d, 44100, midi), peak, rms: Math.sqrt(sum / d.length), finite });
      }
      return out;
    }, [layer, variant, notes]);
    expect(rows[0], 'Pack geladen').toEqual({ status: 'ready' });
    for (const r of rows.slice(1)) {
      const label = JSON.stringify(r);
      expect(r.finite, label).toBe(true);
      expect(r.rms, label).toBeGreaterThan(0.003);
      expect(r.peak, label).toBeLessThan(1);
      // an den äußersten Tönen (MIDI 24 und 100 bei den Akkorden) sind die Samples um mehr als eine Oktave verschoben und der Grundton ist schwach: 30 Cent
      const extreme = layer === 'chords' && (r.midi === 24 || r.midi === 100);
      if (checkPitch) expect(Math.abs(r.cents), label).toBeLessThanOrEqual(extreme ? 30 : 15); // gemessen höchstens 10 Cent: die GM-Samples sind von Haus aus bis etwa 10 Cent verstimmt (Roh-Messung der Samples); die Gitarren-Samples tragen Feinstimmungen von -24 bis -6 Cent, ohne sie wäre die Prüfung nicht erfüllt
    }
  });

  test(`${key(layer, variant)}: Pegel gegen den klassischen Synth im Band 0,7 bis 1,4`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(), track({ voices: voiceOf(layer, variant) }), 8, { layer, limiter: false });
    const ratio = r.rmsB / r.rmsA;
    expect(ratio, JSON.stringify(r)).toBeGreaterThan(0.7);
    expect(ratio, JSON.stringify(r)).toBeLessThan(1.4);
  });

  test(`${key(layer, variant)}: gleicher Track zweimal gerendert gleich; stumme Schicht bleibt stumm`, async ({ page }) => {
    test.setTimeout(120_000);
    const withVoice = track({ voices: voiceOf(layer, variant) });
    expect((await compare(page, withVoice, withVoice, 6, { layer })).diff).toBeLessThan(1e-5);
    const off = await page.evaluate((t) => window.__render(t, 4), track({ voices: voiceOf(layer, variant), layers: { drums: true, bass: layer !== 'bass', chords: layer !== 'chords', pad: layer !== 'pad' } }));
    expect(off.perLayer[layer]).toEqual({ peak: 0, rms: 0, centroid: 0 });
  });

  test(`${key(layer, variant)}: Hüllkurve: sehr kurze, sehr lange Note und Ton außerhalb der Zonen enden sauber`, async ({ page }) => {
    test.setTimeout(120_000);
    const bad = await page.evaluate(async ([layerName, variantName]) => {
      const out = [];
      const voices = { [layerName]: { id: 'sample', variant: variantName } };
      const low = layerName === 'bass' ? 28 : 24, high = layerName === 'bass' ? 52 : 100;
      // im Tonumfang des Generators bleibt die Spitze unter 1; weit außerhalb (12 Halbtöne darunter, 20 darüber) gibt es keine Garantie, aber unter 1,5
      for (const [midi, dur, limit] of [[low + 12, 0.02, 1], [low + 12, 4, 1], [low - 12, 0.5, 1.5], [high + 20, 0.5, 1.5]]) {
        const d = await window.__renderNote(layerName, { midi, dur, seconds: dur + 4, voices });
        let peak = 0, finite = true, tail = 0;
        for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); }
        for (let i = Math.round((dur + 3) * 44100); i < d.length; i++) tail = Math.max(tail, Math.abs(d[i]));
        if (!finite || peak > limit || tail > 1e-3) out.push(`${midi}/${dur}: finite ${finite} peak ${peak.toFixed(3)} tail ${tail.toExponential(1)}`);
      }
      return out;
    }, [layer, variant]);
    expect(bad).toEqual([]);
  });

  test(`${key(layer, variant)}: Wechsel mitten im Render (vorher gleich Synth, danach anders, nie über 1)`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await page.evaluate(async ([layerName, variantName]) => {
      const { createInstruments } = await import('/audio/synth.js');
      const voices = { [layerName]: { id: 'sample', variant: variantName } };
      const warm = createInstruments(new OfflineAudioContext(1, 4410, 44100), { voices }); // lädt das Pack in den Zwischenspeicher
      await warm.whenReady();
      const render = async (live) => {
        const ctx = new OfflineAudioContext(1, 44100, 44100);
        const inst = createInstruments(ctx, { limiter: false, timbre: { master: { echo: 0, reverb: 0 } } });
        inst.output.connect(ctx.destination);
        const note = (midi) => ({ type: 'note', layer: layerName, midi, dur: 0.3, vel: 0.8 });
        const notes = layerName === 'bass' ? [40] : [57, 64];
        for (const m of notes) inst.layers[layerName].trigger(note(m), 0.05);
        ctx.suspend(0.3).then(() => {
          if (live) inst.setVoices(voices);
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
    }, [layer, variant]);
    expect(r.before, JSON.stringify(r)).toBeLessThan(1e-6);
    expect(r.after, JSON.stringify(r)).toBeGreaterThan(1e-3);
    expect(r.peak, JSON.stringify(r)).toBeLessThan(1);
  });

  test(`${key(layer, variant)}: jeder Feinwert ändert die Ausgabe (Minimum gegen Maximum)`, async ({ page }) => {
    test.setTimeout(120_000);
    const k = key(layer, variant);
    const names = Object.keys(TUNABLES[k] ?? {});
    expect(names.length, `Feinwerte für ${k}`).toBeGreaterThan(0);
    const rows = await page.evaluate(async ([layerName, variantName, tunableKey, list]) => {
      const { createInstruments } = await import('/audio/synth.js');
      const out = [];
      for (const [name, min, max] of list) {
        const run = async (value) => {
          const ctx = new OfflineAudioContext(1, 44100, 44100);
          const inst = createInstruments(ctx, { limiter: false, voices: { [layerName]: { id: 'sample', variant: variantName } }, tuning: { [tunableKey]: { [name]: value } }, timbre: { master: { echo: 0, reverb: 0 } } });
          await inst.whenReady();
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
    }, [layer, variant, k, names.map((n) => [n, TUNABLES[k][n].min, TUNABLES[k][n].max])]);
    for (const [name, diff] of rows) expect(diff, `${k}.${name}`).toBeGreaterThan(1e-3);
  });
}

test('Laden: ohne auf whenReady zu warten spielt der Synth (gleich dem klassischen Klang), danach das Sample; voiceStatus folgt', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const note = { type: 'note', layer: 'bass', midi: 40, dur: 0.4, vel: 0.8 };
    const render = async (voices, waitFor) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const inst = createInstruments(ctx, { limiter: false, voices, timbre: { master: { echo: 0, reverb: 0 } } });
      const status = [inst.voiceStatus().bass];
      if (waitFor) { await inst.whenReady(); status.push(inst.voiceStatus().bass); }
      inst.output.connect(ctx.destination);
      inst.layers.bass.trigger(note, 0.05);
      return { data: (await ctx.startRendering()).getChannelData(0), status };
    };
    const classic = await render(undefined, false);
    const early = await render({ bass: { id: 'sample', variant: 'finger' } }, false);
    const late = await render({ bass: { id: 'sample', variant: 'pick' } }, true); // anderes Pack: 'finger' ist durch den frühen Render schon geladen
    let same = 0, diff = 0;
    for (let i = 0; i < classic.data.length; i++) { same = Math.max(same, Math.abs(classic.data[i] - early.data[i])); diff += Math.abs(classic.data[i] - late.data[i]); }
    return { same, diff: diff / classic.data.length, classic: classic.status, early: early.status, late: late.status };
  });
  expect(r.classic).toEqual(['none']);
  expect(r.early[0]).toBe('loading');
  expect(r.same, JSON.stringify(r)).toBeLessThan(1e-6);
  expect(r.late).toEqual(['loading', 'ready']);
  expect(r.diff, JSON.stringify(r)).toBeGreaterThan(1e-4);
});

test('Ladefehler: fetch lehnt ab oder liefert 404: kein Fehler, Status error, der Synth spielt weiter, ein neuer Versuch lädt', async ({ page }) => {
  allowLoadErrors = true;
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const realFetch = window.fetch;
    const results = {};
    // je Fehlerart ein anderes Pack: ein einmal geladenes Pack bleibt im Zwischenspeicher
    for (const [name, fake, variant] of [['reject', () => Promise.reject(new Error('offline')), 'guitar'], ['404', () => Promise.resolve(new Response('nope', { status: 404 })), 'epiano']]) {
      window.fetch = fake;
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const inst = createInstruments(ctx, { limiter: false, voices: { chords: { id: 'sample', variant } }, timbre: { master: { echo: 0, reverb: 0 } } });
      inst.output.connect(ctx.destination);
      await inst.whenReady();
      inst.layers.chords.trigger({ type: 'note', layer: 'chords', midi: 57, dur: 0.4, vel: 0.8 }, 0.05);
      const d = (await ctx.startRendering()).getChannelData(0);
      let peak = 0;
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      results[name] = { status: inst.voiceStatus().chords, peak };
      window.fetch = realFetch;
      inst.setVoices({ chords: { id: 'sample', variant } }); // gleicher Wunsch: neuer Versuch
      results[`${name}-retry`] = inst.voiceStatus().chords;
      await inst.whenReady();
      results[`${name}-after`] = inst.voiceStatus().chords;
    }
    return results;
  });
  for (const name of ['reject', '404']) {
    expect(r[name].status, JSON.stringify(r)).toBe('error');
    expect(r[name].peak, JSON.stringify(r)).toBeGreaterThan(0.005);
    expect(r[`${name}-retry`], JSON.stringify(r)).toBe('loading');
    expect(r[`${name}-after`], JSON.stringify(r)).toBe('ready');
  }
});

test('Wechsel vor dem Laden und zurück: kein Fehler, voiceStatus stimmt, nur ein Ladevorgang je Pack', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const realFetch = window.fetch;
    let packFetches = 0;
    window.fetch = (...args) => { if (String(args[0]).includes('/bass-pick.json')) packFetches++; return realFetch(...args); };
    const inst = createInstruments(new OfflineAudioContext(1, 4410, 44100), { limiter: false });
    const log = [];
    for (let i = 0; i < 3; i++) {
      inst.setVoices({ bass: { id: 'sample', variant: 'pick' } });
      log.push(inst.voiceStatus().bass);
      inst.setVoices({});
      log.push(inst.voiceStatus().bass);
    }
    inst.setVoices({ bass: { id: 'sample', variant: 'pick' } });
    await inst.whenReady();
    log.push(inst.voiceStatus().bass);
    inst.setVoices({ bass: { id: 'sample', variant: 'pick' } }); // gleiche Stimme: nichts neu bauen
    window.fetch = realFetch;
    return { log, packFetches };
  });
  expect(r.log).toEqual(['loading', 'none', 'loading', 'none', 'loading', 'none', 'ready']);
  expect(r.packFetches).toBe(1);
});
