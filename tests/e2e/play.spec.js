// Wiedergabe-Schnittstelle: play() in echter Zeit auf der Harness-Seite (schnelle Tempi, Toleranzen).
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';

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
  expect(r.factory).toEqual([{ bpm: 240 }]);
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
