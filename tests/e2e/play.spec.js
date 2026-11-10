// Wiedergabe-Schnittstelle: play() in echter Zeit auf der Harness-Seite (schnelle Tempi, Toleranzen).
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { resolveTimbre } from '../../src/core/timbre.js';

const CHORDS = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']];
// Standardtrack Am Am Dm E, 4 Schläge je Takt; bei bpm 240 dauert ein Takt 1 s
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' },
  bpm: 240,
  bars: CHORDS.map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  length: 4,
  tags: { ...STYLE_PRESETS[0].tags, development: ['fullFromStart'] },
  seed: 1,
  ...extra,
});
// Abstände zwischen Takten sind robust gegen Anlaufverzögerung; ein falsches Tempo verfehlt sie um 500 ms und mehr
const SPACING_TOLERANCE = 200;
// erster Takt gegen startPerf: Gerätestart und Timer unter Last (4 Worker) brauchen mehr Spielraum
const START_TOLERANCE = 400;

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    window.__openContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
        window.__openContexts++;
      }
      close() {
        window.__openContexts--;
        return super.close();
      }
    };
    // Spion-Instrumente: zeichnen trigger- und setMuted-Aufrufe auf, Ausgang ist ein stiller GainNode
    window.__spy = () => {
      const calls = { factory: [], trigger: [], muted: [] };
      calls.create = (ctx, opts) => {
        calls.factory.push(opts);
        const layers = {};
        for (const name of ['drums', 'bass', 'chords', 'pad']) {
          layers[name] = {
            trigger: (e, when) => calls.trigger.push({ name, t: e.t, type: e.type, dur: e.dur, when, now: ctx.currentTime }),
            setMuted: (muted) => calls.muted.push({ name, muted }),
          };
        }
        return { output: ctx.createGain(), layers };
      };
      return calls;
    };
  });
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

test('kein AudioContext beim Laden', async ({ page }) => {
  expect(await page.evaluate(() => window.__audioContexts)).toBe(0);
});

test('startPerf liegt kurz nach performance.now() beim Aufruf', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const before = performance.now();
    const h = play(ctx, input);
    const after = performance.now();
    h.stop();
    await ctx.close();
    return { startPerf: h.startPerf, before, after };
  }, track());
  expect(r.after - r.before).toBeLessThan(250);
  expect(r.startPerf - r.after).toBeGreaterThan(-50);
  expect(r.startPerf - r.after).toBeLessThan(300);
});

test('onBar in Takt-Reihenfolge mit Akkorden und Zeiten, onEnd am Ende', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const bars = [];
    let ends = 0;
    let done;
    const ended = new Promise((resolve) => (done = resolve));
    const h = play(ctx, input, { onBar: (b) => bars.push({ ...b, at: performance.now() }), onEnd: () => (ends++, done()) });
    await ended;
    const endAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 300));
    h.stop();
    await ctx.close();
    return { startPerf: h.startPerf, bars, ends, endAt };
  }, track());
  expect(r.bars.map((b) => b.bar)).toEqual([0, 1, 2, 3]);
  expect(r.bars.map((b) => b.chord)).toEqual(CHORDS.map(([root, quality]) => ({ root, quality })));
  const first = r.bars[0].at;
  expect(Math.abs(first - r.startPerf)).toBeLessThan(START_TOLERANCE);
  for (const b of r.bars) expect(Math.abs(b.at - first - b.bar * 1000), `bar ${b.bar}`).toBeLessThan(SPACING_TOLERANCE);
  expect(r.ends).toBe(1);
  expect(Math.abs(r.endAt - first - 4000)).toBeLessThan(SPACING_TOLERANCE);
});

test('nach stop() mitten im Track keine Aufrufe mehr, kein onEnd, doppeltes stop() harmlos', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const n = { bar: 0, event: 0, end: 0 };
    let reached;
    const twoBars = new Promise((resolve) => (reached = resolve));
    const h = play(ctx, input, {
      createInstruments: spy.create,
      onBar: () => ++n.bar === 2 && reached(),
      onEvent: () => n.event++,
      onEnd: () => n.end++,
    });
    await twoBars;
    h.stop();
    const atStop = { ...n, trigger: spy.trigger.length };
    h.stop();
    // bis deutlich nach dem regulären Ende (4 Takte = 4 s) warten
    await new Promise((resolve) => setTimeout(resolve, h.startPerf + 4500 - performance.now()));
    const later = { ...n, trigger: spy.trigger.length };
    await ctx.close();
    return { atStop, later, factory: spy.factory };
  }, track());
  expect(r.factory).toEqual([{ bpm: 240, timbre: resolveTimbre(track().tags), voices: STANDARD_VOICES }]);
  expect(r.atStop.bar).toBe(2);
  expect(r.atStop.event).toBeGreaterThan(0);
  expect(r.atStop.trigger).toBeGreaterThan(0);
  expect(r.atStop.end).toBe(0);
  expect(r.later).toEqual(r.atStop);
});

test('stop() kurz vor dem Ende verhindert das schon geplante onEnd', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    let ends = 0;
    const startCtx = ctx.currentTime + 0.15;
    const h = play(ctx, input, { onEnd: () => ends++ });
    // 50 ms vor dem Ende (ctx-Zeit): der Planer (100 ms voraus) hat den End-Timer schon gestellt
    while (ctx.currentTime < startCtx + 2 - 0.05) await new Promise((resolve) => setTimeout(resolve, 5));
    const endsAtStop = ends;
    h.stop();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.close();
    return { endsAtStop, ends };
  }, track({ length: 2 }));
  expect(r).toEqual({ endsAtStop: 0, ends: 0 });
});

test('setLayer schaltet Schichten über setMuted, onEvent meldet Schlagzeug weiter', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    let hitsWhileOff = 0, off = false;
    const h = play(ctx, input, {
      loops: Infinity,
      createInstruments: spy.create,
      onEvent: (e) => off && e.type === 'hit' && hitsWhileOff++,
    });
    h.setLayer('drums', false);
    off = true;
    const afterOff = structuredClone(spy.muted);
    await new Promise((resolve) => setTimeout(resolve, 700));
    off = false;
    h.setLayer('drums', true);
    let unknown = null;
    try { h.setLayer('cowbell', true); } catch (err) { unknown = err.constructor.name; }
    h.stop();
    await ctx.close();
    return { afterOff, muted: spy.muted, hitsWhileOff, unknown };
  }, track());
  expect(r.afterOff).toEqual([{ name: 'drums', muted: true }]);
  expect(r.muted).toEqual([{ name: 'drums', muted: true }, { name: 'drums', muted: false }]);
  expect(r.hitsWhileOff).toBeGreaterThan(0);
  expect(r.unknown).toBe('Error');
});

test('setTempo beschleunigt spätere Takte ohne Auslassen, Wiederholen oder Umordnen', async ({ page }) => {
  test.setTimeout(30_000);
  // bpm 80: Takt 3 s; nach setTempo(120) 2 s
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const { buildEvents } = await import('/core/events.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const bars = [];
    let done;
    const reached = new Promise((resolve) => (done = resolve));
    const h = play(ctx, input, {
      createInstruments: spy.create,
      onBar: (b) => {
        bars.push({ bar: b.bar, at: performance.now() });
        if (b.bar === 1) h.setTempo(120);
        if (b.bar === 3) done();
      },
    });
    const errors = [10, NaN, 401].map((bpm) => {
      try { h.setTempo(bpm); return null; } catch (err) { return err.constructor.name; }
    });
    await reached;
    h.stop();
    await ctx.close();
    const expected = buildEvents(input).filter((e) => e.layer).slice(0, spy.trigger.length).map(({ t, dur }) => ({ t, dur }));
    return { bars, errors, trigger: spy.trigger, expected };
  }, track({ bpm: 80 }));
  expect(r.errors).toEqual(['RangeError', 'RangeError', 'RangeError']);
  expect(r.bars.map((b) => b.bar)).toEqual([0, 1, 2, 3]);
  const before = r.bars[1].at - r.bars[0].at;
  const after = r.bars[3].at - r.bars[2].at;
  expect(Math.abs(before - 3000)).toBeLessThan(SPACING_TOLERANCE);
  expect(Math.abs(after - 2000)).toBeLessThan(SPACING_TOLERANCE);
  // Reihenfolge und Vollständigkeit: trigger-Aufrufe folgen exakt dem Strom, Zeiten steigen nie und liegen nie in der Vergangenheit
  expect(r.trigger.map((c) => c.t)).toEqual(r.expected.map((e) => e.t));
  for (let i = 1; i < r.trigger.length; i++) expect(r.trigger[i].when).toBeGreaterThanOrEqual(r.trigger[i - 1].when);
  for (const c of r.trigger) expect(c.when).toBeGreaterThanOrEqual(c.now);
  // Noten ab Takt 2 (Liedzeit 6 s) klingen dur / 1.5, Noten in Takt 0 unverändert
  const notes = r.trigger.map((c, i) => ({ ...c, original: r.expected[i].dur })).filter((c) => c.type === 'note');
  const early = notes.filter((c) => c.t < 3), late = notes.filter((c) => c.t >= 6);
  expect(early.length).toBeGreaterThan(0);
  expect(late.length).toBeGreaterThan(0);
  for (const c of early) expect(c.dur).toBe(c.original);
  for (const c of late) expect(c.dur).toBeCloseTo(c.original / 1.5, 9);
});

test('setTempo erreicht setTempo der Instrumente (Echo), fehlende Methode ist harmlos', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const { createInstruments } = await import('/audio/synth.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const tempos = [];
    const h = play(ctx, input, {
      createInstruments: (c, o) => ({ ...spy.create(c, o), setTempo: (bpm) => tempos.push(bpm) }),
    });
    h.setTempo(120);
    h.setTempo(60);
    let rangeError = null;
    try { h.setTempo(500); } catch (err) { rangeError = err.constructor.name; }
    h.stop();
    // Spion ohne setTempo: kein Fehler
    const plain = play(ctx, input, { createInstruments: spy.create });
    let plainError = null;
    try { plain.setTempo(90); } catch (err) { plainError = err.message; }
    plain.stop();
    // echte Instrumente haben setTempo und vertragen es
    const real = createInstruments(new OfflineAudioContext(2, 4410, 44100), { bpm: 100 });
    const realType = typeof real.setTempo;
    real.setTempo(150);
    await ctx.close();
    return { tempos, rangeError, plainError, realType };
  }, track());
  expect(r).toEqual({ tempos: [120, 60], rangeError: 'RangeError', plainError: null, realType: 'function' });
});

// Standard-Klangmodell als Literal (nicht aus src/core gelesen), damit der Test DEFAULT_TIMBRE mitprüft
// Stimmenwahl, die play ohne Angabe im Track an die Instrumente gibt (heutiger Klang)
const STANDARD_VOICES = { bass: { id: 'synth', variant: 'classic' }, chords: { id: 'synth', variant: 'classic' }, pad: { id: 'synth', variant: 'classic' } };
const DEFAULT_SOUND = {
  drums: { kickPunch: 0.5, kickLength: 0.5, snareTone: 0.5, snareSnap: 0.5, hatBright: 0.5, hatLength: 0.5, room: 0 },
  bass: { sub: 0, fuzz: 0, overdrive: 0, distortion: 0, pluck: 0.5, cutoff: 0.5, resonance: 0.5, roundness: 0 },
  chords: { brightness: 0.5, length: 0.5, chorus: 0, tremolo: 0, fuzz: 0, overdrive: 0, distortion: 0 },
  pad: { attack: 0.5, cutoff: 0.5, lfoSpeed: 0.5, lfoDepth: 0.5, shimmer: 0, thickness: 0.5, fuzz: 0, overdrive: 0, distortion: 0 },
  master: { brightness: 0.5, echo: 0.5, reverb: 0.5 },
};

test('createInstruments erhält { bpm, timbre } aus den Schlagworten; Fabriken ohne timbre laufen weiter', async ({ page }) => {
  const r = await page.evaluate(async (inputs) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const handles = inputs.map((input) => play(ctx, input, { createInstruments: spy.create }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    for (const h of handles) h.stop();
    await ctx.close();
    return { factory: spy.factory, trigger: spy.trigger.length };
  }, [track({ tags: { bassSound: ['fuzz'] } }), track({ tags: {} })]);
  expect(r.factory).toEqual([
    { bpm: 240, timbre: { ...DEFAULT_SOUND, bass: { ...DEFAULT_SOUND.bass, fuzz: 0.6 } }, voices: STANDARD_VOICES },
    { bpm: 240, timbre: DEFAULT_SOUND, voices: STANDARD_VOICES },
  ]);
  // der Spion wertet timbre nicht aus und wird trotzdem bespielt
  expect(r.trigger).toBeGreaterThan(0);
});

test('setLayer und setTempo mit Klang-Schlagworten: Spion und echte Instrumente', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const tempos = [];
    const h = play(ctx, input, {
      loops: Infinity,
      createInstruments: (c, o) => ({ ...spy.create(c, o), setTempo: (bpm) => tempos.push(bpm) }),
    });
    h.setLayer('bass', false);
    h.setTempo(120);
    h.setLayer('bass', true);
    h.stop();
    // echte Instrumente (Standardfabrik) mit Klangmodell aus den Schlagworten; Echo-Verzögerung abgegriffen
    const delays = [];
    const createDelay = ctx.createDelay.bind(ctx);
    ctx.createDelay = (...args) => {
      const d = createDelay(...args);
      delays.push(d);
      return d;
    };
    const real = play(ctx, input, { loops: Infinity });
    const echoStart = delays[0].delayTime.value;
    await new Promise((resolve) => setTimeout(resolve, 300));
    real.setLayer('pad', false);
    real.setTempo(90);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const echoAfter = delays[0].delayTime.value;
    real.setLayer('pad', true);
    real.stop();
    await ctx.close();
    return { muted: spy.muted, tempos, timbre: spy.factory[0].timbre, delays: delays.length, echoStart, echoAfter };
  }, track({ tags: { mood: ['psychedelic'], bassSound: ['fuzz'] } }));
  expect(r.muted).toEqual([{ name: 'bass', muted: true }, { name: 'bass', muted: false }]);
  expect(r.tempos).toEqual([120]);
  expect(r.timbre.master.echo).toBeCloseTo(0.8, 9);
  expect(r.timbre.bass.fuzz).toBeCloseTo(0.6, 9);
  // punktierte Achtel: 240 bpm -> 0.1875 s, nach setTempo(90) -> 0.5 s (Zeitkonstante 50 ms, 400 ms gewartet)
  expect(r.delays).toBe(1);
  expect(r.echoStart).toBeCloseTo(0.1875, 6);
  expect(Math.abs(r.echoAfter - 0.5)).toBeLessThan(0.01);
});

test('loops: 2 zählt Takte weiter und ruft onEnd einmal nach zwei Durchläufen', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const bars = [];
    const ends = [];
    let done;
    const ended = new Promise((resolve) => (done = resolve));
    const h = play(ctx, input, {
      loops: 2,
      onBar: (b) => bars.push({ ...b, at: performance.now() }),
      onEnd: () => (ends.push(performance.now()), done()),
    });
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 500)); // kein zweites onEnd, keine weiteren Takte
    h.stop();
    await ctx.close();
    return { bars, ends };
  }, track({ length: 2 }));
  expect(r.bars.map((b) => b.bar)).toEqual([0, 1, 2, 3]);
  expect(r.bars.map((b) => b.chord.root)).toEqual(['A', 'A', 'A', 'A']);
  expect(r.ends.length).toBe(1);
  expect(Math.abs(r.ends[0] - r.bars[0].at - 4000)).toBeLessThan(SPACING_TOLERANCE);
});

test('loops muss eine ganze Zahl >= 1 oder Infinity sein', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const touched = [];
    const ctx = new Proxy({}, { get: (_, key) => void touched.push(String(key)) });
    const errors = [0, 1.5, NaN, -Infinity, '2'].map((loops) => {
      try { play(ctx, input, { loops }); return null; } catch (err) { return err.constructor.name; }
    });
    return { errors, touched };
  }, track());
  expect(r).toEqual({ errors: Array(5).fill('RangeError'), touched: [] });
});

// Abspielen ab einem Takt: misst onBar, onEvent, trigger (Spion) und onEnd
const playFrom = (page, input, options) => page.evaluate(async ([input, options]) => {
  const { play } = await import('/audio/play.js');
  const ctx = new AudioContext();
  const spy = window.__spy();
  const bars = [], events = [], ends = [];
  let done;
  const ended = new Promise((resolve) => (done = resolve));
  const h = play(ctx, input, {
    ...options,
    createInstruments: spy.create,
    onBar: (b) => bars.push({ ...b, at: performance.now() }),
    onEvent: (e) => events.push({ type: e.type, bar: e.bar, t: e.t }),
    onEnd: () => (ends.push(performance.now()), done()),
  });
  await ended;
  await new Promise((resolve) => setTimeout(resolve, 400)); // kein zweites onEnd, keine weiteren Takte
  h.stop();
  await ctx.close();
  return { startPerf: h.startPerf, bars, events, ends, trigger: spy.trigger.map((c) => c.t), factory: spy.factory.length };
}, [input, options]);

// frühestes Ereignis nach Liedzeit, bei gleicher Zeit der Akkord (im Strom steht er vor den Tönen seines Takts)
const firstEvent = (events) => {
  const t = Math.min(...events.map((e) => e.t));
  return events.find((e) => e.t === t && e.type === 'chord') ?? events.find((e) => e.t === t);
};

test('startBar: 2 spielt ab Takt 2 mit dessen Akkord, frühere Ereignisse entfallen, loops: 1 endet nach den restlichen Takten', async ({ page }) => {
  test.setTimeout(30_000);
  const input = track();
  const r = await playFrom(page, input, { startBar: 2 });
  const expected = await page.evaluate(async (i) => {
    const { buildEvents } = await import('/core/events.js');
    return buildEvents(i).filter((e) => e.layer && e.bar >= 2).map((e) => e.t);
  }, input);
  expect(r.bars.map((b) => b.bar)).toEqual([2, 3]);
  expect(r.bars.map((b) => b.chord)).toEqual([{ root: 'D', quality: 'min' }, { root: 'E', quality: 'maj' }]);
  // frühestes Ereignis ist der Akkord von Takt 2 zur Liedzeit 2 s (Takt 2 beginnt nach zwei Takten zu 1 s). Nach Liedzeit, nicht nach
  // Ankunft: Rückrufe zur selben Zeit können in anderer Reihenfolge kommen (ctx.currentTime springt zwischen zwei setTimeout-Aufrufen)
  expect(firstEvent(r.events)).toEqual({ type: 'chord', bar: 2, t: 2 });
  expect(r.events.every((e) => e.bar >= 2)).toBe(true);
  expect(r.trigger).toEqual(expected);
  expect(r.factory).toBe(1);
  // startPerf ist der Beginn des ersten gespielten Takts
  const first = r.bars[0].at;
  expect(Math.abs(first - r.startPerf)).toBeLessThan(START_TOLERANCE);
  expect(Math.abs(r.bars[1].at - first - 1000)).toBeLessThan(SPACING_TOLERANCE);
  expect(r.ends.length).toBe(1);
  expect(Math.abs(r.ends[0] - first - 2000)).toBeLessThan(SPACING_TOLERANCE);
});

test('startBar mit loops: 2: der angefangene Durchlauf zählt als erster, Takte zählen weiter', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await playFrom(page, track(), { startBar: 3, loops: 2 });
  expect(r.bars.map((b) => b.bar)).toEqual([3, 4, 5, 6, 7]);
  expect(r.bars.map((b) => b.chord.root)).toEqual(['E', 'A', 'A', 'D', 'E']);
  expect(r.ends.length).toBe(1);
  expect(Math.abs(r.ends[0] - r.bars[0].at - 5000)).toBeLessThan(SPACING_TOLERANCE);
});

test('startBar gleich length - 1 spielt genau einen Takt', async ({ page }) => {
  test.setTimeout(30_000);
  const r = await playFrom(page, track(), { startBar: 3 });
  expect(r.bars.map((b) => b.bar)).toEqual([3]);
  expect(firstEvent(r.events)).toEqual({ type: 'chord', bar: 3, t: 3 });
  expect(r.ends.length).toBe(1);
  expect(Math.abs(r.ends[0] - r.bars[0].at - 1000)).toBeLessThan(SPACING_TOLERANCE);
});

test('startBar muss eine ganze Zahl in 0..length-1 sein, sonst RangeError, bevor ein Knoten entsteht', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const touched = [];
    const ctx = new Proxy({}, { get: (_, key) => void touched.push(String(key)) });
    const spy = window.__spy();
    const errors = [-1, 1.5, 4, NaN, '2', Infinity, null].map((startBar) => {
      try { play(ctx, input, { startBar, createInstruments: spy.create }); return null; } catch (err) { return err.constructor.name; }
    });
    // ungültiger Track: dessen Fehler kommt zuerst
    let track = null;
    try { play(ctx, { bpm: 120, bars: [] }, { startBar: -1 }); } catch (err) { track = err.message; }
    return { errors, touched, factory: spy.factory.length, track };
  }, track());
  expect(r.errors).toEqual(Array(7).fill('RangeError'));
  expect(r).toMatchObject({ touched: [], factory: 0 });
  expect(r.track).toMatch(/Invalid track/);
});

test('fehlende Instrument-Schicht: play wirft, nichts läuft weiter', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const n = { event: 0, bar: 0 };
    let threw = null;
    try {
      play(ctx, input, {
        createInstruments: (c, o) => {
          const instruments = spy.create(c, o);
          delete instruments.layers.drums;
          return instruments;
        },
        onEvent: () => n.event++,
        onBar: () => n.bar++,
      });
    } catch (err) {
      threw = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await ctx.close();
    return { threw, n, trigger: spy.trigger.length };
  }, track());
  expect(r.threw).toMatch(/drums/);
  expect(r).toMatchObject({ n: { event: 0, bar: 0 }, trigger: 0 });
});

test('werfendes trigger hält den Planer an, keine verwaisten Timer', async ({ page }) => {
  const r = await page.evaluate(async (input) => {
    const { play } = await import('/audio/play.js');
    const ctx = new AudioContext();
    const spy = window.__spy();
    const n = { event: 0, bar: 0, trigger: 0 };
    play(ctx, input, {
      createInstruments: (c, o) => {
        const instruments = spy.create(c, o);
        for (const layer of Object.values(instruments.layers)) {
          layer.trigger = () => {
            n.trigger++;
            throw new Error('boom');
          };
        }
        return instruments;
      },
      onEvent: () => n.event++,
      onBar: () => n.bar++,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await ctx.close();
    return n;
  }, track());
  expect(r).toEqual({ event: 0, bar: 0, trigger: 1 });
  // der Fehler selbst landet genau einmal als Seitenfehler (Timer-Rückruf), danach nichts mehr
  expect(problems).toEqual(['pageerror: boom']);
  problems = [];
});

test('ungültiger Track wirft, bevor ein Knoten entsteht oder trigger läuft', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { play } = await import('/audio/play.js');
    const touched = [];
    const ctx = new Proxy({}, { get: (_, key) => void touched.push(String(key)) });
    const spy = window.__spy();
    try {
      play(ctx, { bpm: 120, bars: [] }, { createInstruments: spy.create });
      return { threw: null };
    } catch (err) {
      return { threw: err.message, touched, factory: spy.factory.length, trigger: spy.trigger.length };
    }
  });
  expect(r.threw).toMatch(/Invalid track/);
  expect(r).toMatchObject({ touched: [], factory: 0, trigger: 0 });
  expect(await page.evaluate(() => window.__audioContexts)).toBe(0);
});

test('Hörprobe-Knöpfe spielen über play() ohne gestapelte Contexts', async ({ page }) => {
  await page.getByRole('button', { name: 'Funk' }).click();
  await page.getByRole('button', { name: 'Psych' }).click();
  await expect.poll(() => page.evaluate(() => window.__audioContexts)).toBe(2);
  expect(await page.evaluate(() => window.__openContexts)).toBe(1);
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Stopp' }).click();
  await page.getByRole('button', { name: 'Stopp' }).click();
  expect(await page.evaluate(() => window.__openContexts)).toBe(0);
});
