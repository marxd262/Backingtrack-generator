// Sample-Stimmen (Packs aus MuseScore_General) im Browser: Tonhöhe, Pegel, Determinismus, Laden mit Rückfall auf den Synth, Hüllkurve,
// Live-Wechsel, Feinwerte. Harness: /ui/render-harness.html
import { test, expect } from '@playwright/test';
import { TUNABLES } from '../../src/audio/voices/tunables.js';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { drums: true, bass: true, chords: true, pad: true }, seed: 1, length: 24,
  tags: { development: ['fullFromStart'] }, ...extra,
});
// [Instrument, Variante, Töne für die Prüfung, Tonhöhe prüfen?, erlaubte Abweichung in Cent (Standard 15)]
// Gemessen 2026-11-10 (Cent am Grundton): upright 5 / -1 / 6; organ 7 / 2 / 1 / 1 / 1; muted -11 / -1 / -20 / 2 / 5; flute 7 / 4 / 2 / -2;
// sax -15 / -7 / -2 / 1; synth je 4. Die gedämpfte Gitarre und das Saxofon tragen ihre Verstimmung im Sample selbst (Feinstimmung der Zonen angewandt)
const SAMPLES = [
  ['bass', 'finger', [28, 40, 52], true],
  ['bass', 'pick', [28, 40, 52], true],
  ['chords', 'guitar', [40, 57, 76, 100], true],
  ['chords', 'epiano', [24, 40, 60, 84, 100], true],
  ['pad', 'strings', [24, 48, 72, 100], false],
  ['pad', 'warm', [24, 48, 72, 100], false],
  ['bass', 'upright', [28, 40, 52], true],
  ['chords', 'organ', [24, 40, 60, 84, 100], true],
  ['chords', 'muted', [40, 52, 64, 76, 90], true, 25],
  ['chords', 'jazz', [40, 52, 64, 76, 90], true],
  ['chords', 'funk', [40, 52, 64, 76, 90], true],
  ['chords', 'steel', [40, 52, 64, 76, 90], true],
  ['chords', 'nylon', [40, 52, 64, 76, 90], true],
  // 12-Saiter ohne Ton 40: dort misst die Tonhöhenerkennung +150 Cent (Oktav- und Einklangpaare der Saiten); unbeurteilt, ob es hörbar verstimmt ist
  ['chords', 'twelve', [52, 64, 76, 90], true],
  ['lead', 'flute', [60, 72, 84, 90], true],
  ['lead', 'sax', [55, 67, 79, 85], true, 20],
  ['lead', 'synth', [55, 67, 79, 90], true],
];
const voiceOf = (layer, variant) => ({ [layer]: { id: 'sample', variant } });
// Lead spielt nur mit Schicht und Aufgabe (Job melody)
const base = (layer) => (layer === 'lead' ? { layers: { drums: true, bass: true, chords: true, pad: true, lead: true }, jobs: { lead: 'melody' } } : {});
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

for (const [layer, variant, notes, checkPitch, cents = 15] of SAMPLES) {
  test(`${key(layer, variant)}: hörbar, endlich, unter 1, im ganzen Tonumfang${checkPitch ? `, Grundton innerhalb von ${cents} Cent` : ''}`, async ({ page }) => {
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
      if (checkPitch) expect(Math.abs(r.cents), label).toBeLessThanOrEqual(extreme ? Math.max(30, cents) : cents); // gemessen höchstens 10 Cent: die GM-Samples sind von Haus aus bis etwa 10 Cent verstimmt (Roh-Messung der Samples); die Gitarren-Samples tragen Feinstimmungen von -24 bis -6 Cent, ohne sie wäre die Prüfung nicht erfüllt
    }
  });

  test(`${key(layer, variant)}: Pegel gegen den klassischen Synth im Band 0,7 bis 1,4`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(base(layer)), track({ ...base(layer), voices: voiceOf(layer, variant) }), 8, { layer, limiter: false });
    const ratio = r.rmsB / r.rmsA;
    expect(ratio, JSON.stringify(r)).toBeGreaterThan(0.7);
    expect(ratio, JSON.stringify(r)).toBeLessThan(1.4);
  });

  test(`${key(layer, variant)}: gleicher Track zweimal gerendert gleich; stumme Schicht bleibt stumm`, async ({ page }) => {
    test.setTimeout(120_000);
    const withVoice = track({ ...base(layer), voices: voiceOf(layer, variant) });
    expect((await compare(page, withVoice, withVoice, 6, { layer })).diff).toBeLessThan(1e-5);
    const off = await page.evaluate((t) => window.__render(t, 4), track({ voices: voiceOf(layer, variant), jobs: { lead: 'melody' }, layers: { drums: true, bass: layer !== 'bass', chords: layer !== 'chords', pad: layer !== 'pad', lead: false } }));
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

// Orgel: ein Sample (Grundton 72, Feinstimmung -2400 Cent, wie in der SoundFont). Das Sample enthält nur Oktaven (C5, C6, C7, C8 ...);
// mit der Feinstimmung liegt der gespielte Ton auf seinem C7-Anteil, darunter klingen zwei Suboktaven (16- und 32-Fuß-Lage). Ohne die
// Feinstimmung läge der tiefste starke Anteil auf dem gespielten Ton selbst. Gemessen 2026-11-10: der tiefste Anteil bis 12 dB unter dem
// stärksten liegt bei allen Tönen zwei Oktaven unter dem Ton, der Ton selbst ist vorhanden und auf 1 bis 7 Cent genau (pitchCents oben).
test('chords/sample/organ: Feinstimmung der Zone wirkt (Spektrum mit FFT: tiefster starker Anteil zwei Oktaven unter dem Ton, Ton selbst vorhanden)', async ({ page }) => {
  test.setTimeout(120_000);
  const rows = await page.evaluate(async () => {
    const { fft } = await import('/audio/spectrum.js');
    const n = 2 ** 15, cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / n); sin[i] = Math.sin((-2 * Math.PI * i) / n); }
    const out = [];
    for (const midi of [48, 60, 72]) {
      const d = await window.__renderNote('chords', { midi, dur: 0.9, seconds: 1, voices: { chords: { id: 'sample', variant: 'organ' } } });
      const re = new Float64Array(n), im = new Float64Array(n);
      for (let i = 0; i < n && 2205 + i < d.length; i++) re[i] = d[2205 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      fft(re, im, cos, sin);
      const mag = (k) => Math.hypot(re[k], im[k]);
      // stärkster Bin innerhalb eines Halbtons um f
      const around = (f) => { let best = 0; for (let k = Math.floor((f / 1.06 / 44100) * n); k <= Math.ceil(((f * 1.06) / 44100) * n); k++) best = Math.max(best, mag(k)); return best; };
      const f0 = 440 * 2 ** ((midi - 69) / 12);
      const steps = [-3, -2, -1, 0, 1, 2];
      const octaves = steps.map((o) => around(f0 * 2 ** o));
      const max = Math.max(...octaves);
      out.push({ midi, lowest: steps[octaves.findIndex((m) => m >= max / 4)], atNote: octaves[3] / max });
    }
    return out;
  });
  for (const r of rows) {
    expect(r.lowest, JSON.stringify(rows)).toBe(-2);
    expect(r.atNote, JSON.stringify(rows)).toBeGreaterThan(0.05);
  }
});

// Schlagzeug-Kits und Percussion aus Samples. Pegel gegen den Synth: Folge aus je einem Schlag pro Name (Abstand 0,8 s, vel 0.8), rms der
// Schicht allein ohne Begrenzer, Hall und Raum. Einzeln (rms Sample / rms Synth gleichen Namens) weicht die Balance innerhalb der Kits vom
// Synth ab (Messwerte in tunables.js); geprüft wird darum die Folge (0,5 bis 2), je Schlag nur hörbar, endlich und Spitze.
const KITS = [
  ...['standard', 'brushes', 'rimshot', 'jazz', 'electronic', '808'].map((v) => ['drums', v]),
  ['percussion', 'studio'],
];
const renderHits = (page, layer, voice, names, { seconds = 1, gap = 0.8 } = {}) => page.evaluate(async ([layerName, v, list, s, step]) => {
  const { createInstruments } = await import('/audio/synth.js');
  const ctx = new OfflineAudioContext(1, Math.ceil(44100 * (s + step * (list.length - 1))), 44100);
  const inst = createInstruments(ctx, { limiter: false, voices: v ? { [layerName]: v } : undefined, timbre: { master: { echo: 0, reverb: 0 }, drums: { room: 0 } } });
  await inst.whenReady();
  inst.output.connect(ctx.destination);
  list.forEach((name, i) => inst.layers[layerName].trigger({ type: 'hit', layer: layerName, name, vel: 0.8 }, 0.05 + i * step));
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0, sum = 0, finite = true;
  for (const x of d) { if (!Number.isFinite(x)) finite = false; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
  return { status: inst.voiceStatus()[layerName], peak, rms: Math.sqrt(sum / d.length), finite, data: Array.from(d.subarray(0, 44100)) };
}, [layer, voice, names, seconds, gap]);
const namesOf = (page, layer) => page.evaluate(async (l) => (await import('/core/events.js'))[l === 'drums' ? 'DRUM_NAMES' : 'PERCUSSION_NAMES'], layer);

for (const [layer, variant] of KITS) {
  test(`${key(layer, variant)}: jeder Schlag hörbar, endlich, Spitze unter 0,95; Folge aller Schläge im Pegel 0,5 bis 2 gegen den Synth`, async ({ page }) => {
    test.setTimeout(120_000);
    const names = await namesOf(page, layer);
    const voice = { id: 'sample', variant };
    const bad = [];
    for (const name of names) {
      const r = await renderHits(page, layer, voice, [name]);
      if (r.status !== 'ready' || !r.finite || !(r.rms > 0.001) || !(r.peak < 0.95)) bad.push(`${name}: ${JSON.stringify({ ...r, data: undefined })}`);
    }
    expect(bad).toEqual([]);
    const synth = await renderHits(page, layer, null, names), sample = await renderHits(page, layer, voice, names);
    const ratio = sample.rms / synth.rms;
    expect(ratio, `${synth.rms} ${sample.rms}`).toBeGreaterThan(0.5);
    expect(ratio, `${synth.rms} ${sample.rms}`).toBeLessThan(2);
    expect(sample.peak).toBeLessThan(0.95);
  });

  test(`${key(layer, variant)}: Pegel gegen den Synth über den Track im Band 0,7 bis 1,4; zweimal gerendert gleich`, async ({ page }) => {
    test.setTimeout(120_000);
    const extra = layer === 'percussion' ? { layers: { drums: true, bass: true, chords: true, pad: true, percussion: true }, jobs: { percussion: 'mixed' } } : {};
    const withVoice = track({ ...extra, voices: voiceOf(layer, variant) });
    const r = await compare(page, track(extra), withVoice, 8, { layer, limiter: false });
    expect(r.rmsB / r.rmsA, JSON.stringify(r)).toBeGreaterThan(0.7);
    expect(r.rmsB / r.rmsA, JSON.stringify(r)).toBeLessThan(1.4);
    expect((await compare(page, withVoice, withVoice, 4, { layer })).diff).toBeLessThan(1e-5);
  });
}

test('drums/sample/rimshot: die Snare ist der Seitenschlag (Taste 37), anders als die Snare des Standard-Kits; der Kick ist derselbe', async ({ page }) => {
  test.setTimeout(120_000);
  const diff = async (name) => {
    const a = (await renderHits(page, 'drums', { id: 'sample', variant: 'standard' }, [name])).data;
    const b = (await renderHits(page, 'drums', { id: 'sample', variant: 'rimshot' }, [name])).data;
    let d = 0, e = 0;
    for (let i = 0; i < a.length; i++) { d += (a[i] - b[i]) ** 2; e += a[i] * a[i]; }
    return Math.sqrt(d / e);
  };
  expect(await diff('snare')).toBeGreaterThan(0.5);
  // gleiches Sample, nur der Pegel (level) des Kits unterscheidet sich: die Abweichung ist das Pegelverhältnis
  const level = TUNABLES['drums/sample/rimshot'].level.value / TUNABLES['drums/sample/standard'].level.value;
  expect(Math.abs((await diff('kick')) - Math.abs(level - 1))).toBeLessThan(1e-3);
});

test('Ladefehler bei Schlag-Stimmen: fetch lehnt ab, Schlagzeug und Percussion spielen genau den Synth, Status error', async ({ page }) => {
  allowLoadErrors = true;
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const realFetch = window.fetch;
    const render = async (voices) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const inst = createInstruments(ctx, { limiter: false, voices, timbre: { master: { echo: 0, reverb: 0 } } });
      await inst.whenReady();
      inst.output.connect(ctx.destination);
      inst.layers.drums.trigger({ type: 'hit', layer: 'drums', name: 'snare', vel: 0.8 }, 0.05);
      inst.layers.percussion.trigger({ type: 'hit', layer: 'percussion', name: 'cowbell', vel: 0.8 }, 0.3);
      return { data: (await ctx.startRendering()).getChannelData(0), status: inst.voiceStatus() };
    };
    window.fetch = () => Promise.reject(new Error('offline'));
    // in diesem Test noch nicht geladene Packs (ein geladenes Pack bleibt im Zwischenspeicher der Seite)
    const failed = await render({ drums: { id: 'sample', variant: 'jazz' }, percussion: { id: 'sample', variant: 'studio' } });
    window.fetch = realFetch;
    const synth = await render(undefined);
    let peak = 0, same = 0;
    for (let i = 0; i < failed.data.length; i++) { peak = Math.max(peak, Math.abs(failed.data[i])); same = Math.max(same, Math.abs(failed.data[i] - synth.data[i])); }
    return { status: failed.status, peak, same };
  });
  expect(r.status.drums).toBe('error');
  expect(r.status.percussion).toBe('error');
  expect(r.peak, JSON.stringify(r)).toBeGreaterThan(0.05);
  expect(r.same, JSON.stringify(r)).toBeLessThan(1e-6);
});

test('Kit wechseln, während ein Schlag klingt: kein Fehler, der klingende Schlag läuft unverändert weiter, neue Schläge im neuen Kit', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const warm = createInstruments(new OfflineAudioContext(1, 4410, 44100), { voices: { drums: { id: 'sample', variant: 'standard' } } });
    await warm.whenReady();
    warm.setVoices({ drums: { id: 'sample', variant: '808' } });
    await warm.whenReady();
    const render = async (switchTo, later) => {
      const ctx = new OfflineAudioContext(1, 2 * 44100, 44100);
      const inst = createInstruments(ctx, { limiter: false, voices: { drums: { id: 'sample', variant: 'standard' } }, timbre: { master: { echo: 0, reverb: 0 }, drums: { room: 0 } } });
      await inst.whenReady();
      inst.output.connect(ctx.destination);
      inst.layers.drums.trigger({ type: 'hit', layer: 'drums', name: 'openHat', vel: 0.8 }, 0.05); // Sample 3,2 s lang
      let error = null;
      ctx.suspend(0.5).then(() => {
        try {
          if (switchTo) inst.setVoices({ drums: { id: 'sample', variant: switchTo } });
          if (later) inst.layers.drums.trigger({ type: 'hit', layer: 'drums', name: 'kick', vel: 0.8 }, 1.2);
        } catch (err) { error = String(err); }
        ctx.resume();
      });
      return { data: (await ctx.startRendering()).getChannelData(0), error };
    };
    const alone = await render(null, false), switched = await render('808', false), withKick = await render('808', true), sameKit = await render(null, true);
    const mean = (a, b, from, to) => { let s = 0; for (let i = from; i < to; i++) s += Math.abs(a[i] - b[i]); return s / (to - from); };
    let tail = 0;
    for (let i = Math.round(1.1 * 44100); i < Math.round(1.19 * 44100); i++) tail = Math.max(tail, Math.abs(switched.data[i]));
    return { errors: [switched.error, withKick.error], ringing: mean(alone.data, switched.data, 0, alone.data.length), tail, newKit: mean(withKick.data, sameKit.data, Math.round(1.2 * 44100), Math.round(1.6 * 44100)) };
  });
  expect(r.errors).toEqual([null, null]);
  expect(r.ringing, JSON.stringify(r)).toBeLessThan(1e-7); // der Wechsel schneidet den klingenden Schlag nicht ab
  expect(r.tail, JSON.stringify(r)).toBeGreaterThan(1e-3); // er klingt nach dem Wechsel noch
  expect(r.newKit, JSON.stringify(r)).toBeGreaterThan(1e-4); // der spätere Kick kommt aus dem 808-Kit
});
