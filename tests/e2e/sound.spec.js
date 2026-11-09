// Messwerkzeug für die Klangformung: compareRenders, Spektralschwerpunkt im Offline-Render, timbre-Option.
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';

const LAYERS = ['drums', 'bass', 'chords', 'pad'];
// Basistrack wie in levels.spec.js: Am Am Dm E, 100 bpm, Seed 1, alle Schichten ab Takt 1
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

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/render-harness.html');
  await page.waitForFunction(() => typeof window.__render === 'function' && typeof window.__compare === 'function');
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const compare = (page, a, b, seconds, options) => page.evaluate(([x, y, s, o]) => window.__compare(x, y, s, o), [a, b, seconds, options]);

test('compareRenders: identische Tracks ergeben diff ~0 und gleiche Schwerpunkte (Summe und Schicht)', async ({ page }) => {
  test.setTimeout(120_000);
  for (const options of [undefined, { layer: 'bass' }, { layer: 'pad', limiter: false }]) {
    const r = await compare(page, track(), track(), 6, options);
    const label = JSON.stringify(options);
    expect(r.diff, label).toBeLessThan(1e-6);
    expect(r.rmsA, label).toBeGreaterThan(0.005);
    expect(Math.abs(r.rmsB - r.rmsA), label).toBeLessThanOrEqual(1e-6 * r.rmsA);
    expect(r.centroidA, label).toBeGreaterThan(0);
    expect(Math.abs(r.centroidB - r.centroidA), label).toBeLessThanOrEqual(1e-6 * r.centroidA);
  }
});

test('compareRenders: anderes Tempo ergibt diff > 0.25', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await compare(page, track(), track({ bpm: 130 }), 6);
  expect(r.diff).toBeGreaterThan(0.25);
  const solo = await compare(page, track(), track({ bpm: 130 }), 6, { layer: 'drums' });
  expect(solo.diff).toBeGreaterThan(0.25);
});

test('compareRenders: Schicht allein unterscheidet sich von der Summe', async ({ page }) => {
  test.setTimeout(120_000);
  const sum = await compare(page, track(), track(), 6);
  const bass = await compare(page, track(), track(), 6, { layer: 'bass' });
  expect(bass.rmsA).toBeLessThan(sum.rmsA);
  // Bass allein hat einen tieferen Schwerpunkt als die Summe mit Hi-Hats und Akkorden
  expect(bass.centroidA).toBeLessThan(sum.centroidA);
});

test('compareRenders: unbekannte Schicht wirft RangeError mit ihrem Namen', async ({ page }) => {
  // nur ein fehlendes layer (undefined) heißt Summe; leerer Text und null sind ungültig
  for (const [layer, shown] of [['cowbell', '"cowbell"'], ['', '""'], [null, 'null']]) {
    await expect(compare(page, track(), track(), 1, { layer }), shown).rejects.toThrow(`RangeError: Unknown layer: ${shown}`);
  }
});

test('renderOffline: Schwerpunkt endlich und > 0 für Summe und jede Schicht', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate((t) => window.__render(t, 16), track());
  expect(Number.isFinite(r.centroid) && r.centroid > 0, String(r.centroid)).toBe(true);
  for (const layer of LAYERS) {
    const c = r.perLayer[layer].centroid;
    expect(Number.isFinite(c) && c > 0, `${layer}: ${c}`).toBe(true);
  }
});

test('renderOffline: abgeschaltete Schicht meldet peak, rms und Schwerpunkt 0', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await page.evaluate((t) => window.__render(t, 6), track({ layers: { drums: true, bass: true, chords: false, pad: true } }));
  expect(r.perLayer.chords).toEqual({ peak: 0, rms: 0, centroid: 0 });
  expect(r.perLayer.bass.centroid).toBeGreaterThan(0);
});

test('createInstruments verträgt unvollständiges oder ungültiges timbre', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const results = [];
    for (const timbre of [undefined, null, 3, 'x', [], {}, { bass: { fuzz: 0.6 } }, { bass: { fuzz: NaN }, nope: {} }]) {
      try {
        const inst = createInstruments(new OfflineAudioContext(2, 4410, 44100), { bpm: 100, timbre });
        results.push(Object.keys(inst.layers).join());
      } catch (err) {
        results.push(err.message);
      }
    }
    return results;
  });
  expect(r).toEqual(Array(8).fill(LAYERS.join()));
});

// Bassklang: Basistrack (16 s) mit genau einem Schlagwort gegen den Standard, nur Bass-Schicht.
const withTags = (tags) => track({ tags: { development: ['fullFromStart'], ...tags } });
const BASS_SECONDS = 16;
// Bass-rms vor dem Begrenzer im Standardklang (levels.spec.js, BASELINE.pre.bass, gleicher Track und gleiche Länge)
const DEFAULT_BASS_PRE_RMS = 0.09297909625210916;
// [Name, Schlagworte, Mindest-diff, Richtung des Schwerpunkts: -1 tiefer, +1 höher, 0 egal]
// Gemessen 2026-11-08 (Bass allein, mit Begrenzer, Schwerpunkt Standard 525 Hz):
//   sub diff 0.473 / 216 Hz, fuzz 0.360 / 1505 Hz, plucky 0.494 / 757 Hz, round 0.341 / 229 Hz,
//   resonant 0.378 / 1064 Hz, gritty 0.259 / 1003 Hz (warm, nur Bass: 0.089 / 470 Hz)
const BASS_TAGS = [
  ['sub', { bassSound: ['sub'] }, 0.25, -1],
  ['fuzz', { bassSound: ['fuzz'] }, 0.25, 1],
  ['plucky', { bassSound: ['plucky'] }, 0.25, 0],
  ['round', { bassSound: ['round'] }, 0.25, -1],
  ['resonant', { bassSound: ['resonant'] }, 0.25, 1],
  ['gritty', { bass: ['gritty'] }, 0.15, 1],
];

for (const [name, tags, minDiff, direction] of BASS_TAGS) {
  test(`Bassklang ${name}: Bass-Schicht deutlich anders, Schwerpunkt in Richtung`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(), withTags(tags), BASS_SECONDS, { layer: 'bass' });
    const label = `${name}: ${JSON.stringify(r)}`;
    expect(r.diff, label).toBeGreaterThanOrEqual(minDiff);
    if (direction < 0) expect(r.centroidB, label).toBeLessThan(r.centroidA);
    if (direction > 0) expect(r.centroidB, label).toBeGreaterThan(r.centroidA);
  });
}

// Pegelsicherheit: auch warm (runderer Bass) gehört dazu. Gemessen 2026-11-08, 16 s
// (Bass-rms vor dem Begrenzer / Standard, Summe Spitze vor / nach dem Begrenzer, Bass-rms nach dem Begrenzer):
//   sub 1.338, 0.751 / 0.700, 0.240; fuzz 1.114, 0.734 / 0.704, 0.200; plucky 0.618, 0.669 / 0.692, 0.111;
//   round 1.159, 0.732 / 0.700, 0.208; resonant 0.772, 0.692 / 0.702, 0.138; gritty 1.079, 0.703 / 0.698, 0.193;
//   warm 1.026, 0.698 / 0.695, 0.184. Ohne Ausgleich lag fuzz bei 2.45 (vor dem Begrenzer Spitze 0.875), gritty bei 2.31.
for (const [name, tags] of [...BASS_TAGS, ['warm', { synths: ['warm'] }]]) {
  test(`Bassklang ${name}: Pegel sicher (Bass hörbar und im Rahmen, Summe ohne Übersteuern)`, async ({ page }) => {
    test.setTimeout(120_000);
    const input = withTags(tags);
    const pre = await page.evaluate(([i, s]) => window.__render(i, s, { limiter: false }), [input, BASS_SECONDS]);
    const post = await page.evaluate(([i, s]) => window.__render(i, s), [input, BASS_SECONDS]);
    const ratio = pre.perLayer.bass.rms / DEFAULT_BASS_PRE_RMS;
    const label = `${name}: ratio ${ratio}, pre peak ${pre.peak}, post peak ${post.peak}, bass rms ${post.perLayer.bass.rms}`;
    expect(post.perLayer.bass.rms, label).toBeGreaterThan(0.005);
    expect(ratio, label).toBeGreaterThanOrEqual(0.25);
    expect(ratio, label).toBeLessThanOrEqual(3);
    expect(post.peak, label).toBeLessThan(0.9);
    expect(pre.peak, label).toBeLessThan(0.95);
  });
}

// gemessen 2026-11-08: Spitze nach dem Begrenzer 0.706 (davor 0.733), Bass-rms 0.122
test('Bassklang: alle fünf Bass-Schlagworte und gritty zugleich bleiben endlich und sicher', async ({ page }) => {
  test.setTimeout(120_000);
  const input = withTags({ bassSound: ['sub', 'fuzz', 'plucky', 'round', 'resonant'], bass: ['gritty'] });
  const r = await page.evaluate(([i, s]) => window.__render(i, s), [input, BASS_SECONDS]);
  const values = [r.peak, r.rms, r.centroid, ...LAYERS.flatMap((l) => Object.values(r.perLayer[l]))];
  expect(values.every(Number.isFinite), JSON.stringify(r)).toBe(true);
  expect(r.peak).toBeLessThan(0.9);
  expect(r.perLayer.bass.rms).toBeGreaterThan(0.005);
});

test('Bassklang: stummer Bass bleibt mit fuzz exakt still (abgeschaltet und über setMuted)', async ({ page }) => {
  test.setTimeout(120_000);
  const fuzz = { bassSound: ['fuzz'] };
  const off = await page.evaluate(([i, s]) => window.__render(i, s), [track({ layers: { drums: true, bass: false, chords: true, pad: true }, tags: { development: ['fullFromStart'], ...fuzz } }), 6]);
  expect(off.perLayer.bass).toEqual({ peak: 0, rms: 0, centroid: 0 });
  // Schlagzeug allein: der Bass spielt mit fuzz, ist aber über setMuted stumm geschaltet; nur Float-Rundung erlaubt
  const drums = await compare(page, track(), withTags(fuzz), 6, { layer: 'drums' });
  expect(drums.diff).toBeLessThan(1e-6);
});

// Schlagzeugklang: gleicher Basistrack (16 s), genau ein Schlagwort aus drumSound gegen den Standard, nur Schlagzeug-Schicht.
const DRUM_SECONDS = 16;
// Schlagzeug-rms vor dem Begrenzer im Standardklang (levels.spec.js, BASELINE.pre.drums, gleicher Track und gleiche Länge)
const DEFAULT_DRUMS_PRE_RMS = 0.05009726748802992;
// Gemessen 2026-11-08 (Schlagzeug allein, mit Begrenzer; diff / Schwerpunkt Standard 5641 Hz -> mit Schlagwort / rms 0.0933 -> mit Schlagwort):
//   punchy 1.232 / 6075 Hz / 0.0783, boomy 1.337 / 5550 Hz / 0.1083, snappy 0.269 / 6385 Hz / 0.0958,
//   crisp 0.309 / 9346 Hz / 0.0889, roomy 0.348 / 5516 Hz / 0.1024 (Hall: rms steigt, Schwerpunkt fast gleich)
// Der Kick trägt fast die ganze Energie (rms 0.093 von 0.0935 gesamt, Snare 0.019, Hi-Hats 0.007 und 0.007): Snare und Hi-Hat
// müssen deshalb stark eingreifen, damit diff 0.25 erreicht wird (Rauschen gleicher Quelle bleibt in den Filtern korreliert).
const DRUM_TAGS = ['punchy', 'boomy', 'snappy', 'crisp', 'roomy'];
// Schwerpunkt dominieren die breitbandigen Hi-Hats (betragsgewichtet); Richtung des Schwerpunkts: -1 tiefer, +1 höher, 0 egal (roomy: der Hall verschiebt ihn nicht verlässlich, dort zählt rms)
const DRUM_DIRECTION = { punchy: 0, boomy: -1, snappy: 1, crisp: 1, roomy: 0 };
const drumTag = (name) => withTags({ drumSound: [name] });

for (const name of DRUM_TAGS) {
  test(`Schlagzeugklang ${name}: Schlagzeug-Schicht deutlich anders, Schwerpunkt in Richtung`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(), drumTag(name), DRUM_SECONDS, { layer: 'drums' });
    const label = `${name}: ${JSON.stringify(r)}`;
    expect(r.diff, label).toBeGreaterThanOrEqual(0.25);
    if (DRUM_DIRECTION[name] < 0) expect(r.centroidB, label).toBeLessThan(r.centroidA);
    if (DRUM_DIRECTION[name] > 0) expect(r.centroidB, label).toBeGreaterThan(r.centroidA);
    if (name === 'roomy') expect(r.rmsB, label).toBeGreaterThan(r.rmsA); // der Hallanteil bringt Energie
  });

  // Gemessen 2026-11-08, 16 s (Schlagzeug-rms vor dem Begrenzer / Standard, Summe Spitze vor / nach dem Begrenzer):
  //   punchy 0.884, 0.719 / 0.706; boomy 1.119, 0.755 / 0.713; snappy 1.041, 0.869 / 0.735;
  //   crisp 1.068, 0.721 / 0.722; roomy 1.104, 0.699 / 0.697. Ohne Ausgleich lag die Spitze von snappy bei 0.99.
  test(`Schlagzeugklang ${name}: Pegel sicher (Schlagzeug hörbar und im Rahmen, Summe ohne Übersteuern)`, async ({ page }) => {
    test.setTimeout(120_000);
    const input = drumTag(name);
    const pre = await page.evaluate(([i, s]) => window.__render(i, s, { limiter: false }), [input, DRUM_SECONDS]);
    const post = await page.evaluate(([i, s]) => window.__render(i, s), [input, DRUM_SECONDS]);
    const ratio = pre.perLayer.drums.rms / DEFAULT_DRUMS_PRE_RMS;
    const label = `${name}: ratio ${ratio}, pre peak ${pre.peak}, post peak ${post.peak}, drums rms ${post.perLayer.drums.rms}`;
    expect(post.perLayer.drums.rms, label).toBeGreaterThan(0.005);
    expect(ratio, label).toBeGreaterThanOrEqual(0.25);
    expect(ratio, label).toBeLessThanOrEqual(3);
    expect(post.peak, label).toBeLessThan(0.9);
    expect(pre.peak, label).toBeLessThan(0.95);
  });
}

// gemessen 2026-11-08: Spitze nach dem Begrenzer 0.792 (davor 1.193), Schlagzeug-rms 0.1094 (1.329 x Standard)
// Mood-Schlagworte dark/bright (hatBright -/+0.15): diff 0.030 / 0.071, Spitze 0.688 / 0.703, ohne Wirkung auf die Pegelgrenzen
test('Schlagzeugklang: alle fünf Schlagworte zugleich bleiben endlich und sicher', async ({ page }) => {
  test.setTimeout(120_000);
  const input = withTags({ drumSound: DRUM_TAGS });
  const r = await page.evaluate(([i, s]) => window.__render(i, s), [input, DRUM_SECONDS]);
  const values = [r.peak, r.rms, r.centroid, ...LAYERS.flatMap((l) => Object.values(r.perLayer[l]))];
  expect(values.every(Number.isFinite), JSON.stringify(r)).toBe(true);
  expect(r.peak).toBeLessThan(0.9);
  expect(r.perLayer.drums.rms).toBeGreaterThan(0.005);
});

test('Schlagzeugklang: stilles Schlagzeug bleibt mit roomy exakt still (abgeschaltet und über setMuted)', async ({ page }) => {
  test.setTimeout(120_000);
  const roomy = { drumSound: ['roomy'] };
  const off = { drums: false, bass: true, chords: true, pad: true };
  const without = await page.evaluate(([i, s]) => window.__render(i, s), [track({ layers: off }), 6]);
  const withRoom = await page.evaluate(([i, s]) => window.__render(i, s), [track({ layers: off, tags: { development: ['fullFromStart'], ...roomy } }), 6]);
  expect(withRoom.perLayer.drums).toEqual({ peak: 0, rms: 0, centroid: 0 });
  expect(Math.abs(withRoom.rms - without.rms), 'Summe').toBeLessThanOrEqual(1e-6 * without.rms);
  expect(Math.abs(withRoom.peak - without.peak), 'Spitze').toBeLessThanOrEqual(1e-6 * without.peak);
  // eine andere Schicht allein: das Schlagzeug spielt mit roomy, ist aber über setMuted stumm geschaltet; nur Float-Rundung erlaubt
  for (const layer of ['bass', 'chords', 'pad']) {
    const solo = await compare(page, track(), withTags(roomy), 6, { layer });
    expect(solo.diff, layer).toBeLessThan(1e-6);
  }
});

// Akkorde, Pad und Gesamtklang: gleicher Basistrack (16 s), Schlagworte gegen den Standard, Schicht allein bzw. Summe.
const SOUND_SECONDS = 16;
// Rms vor dem Begrenzer im Standardklang (levels.spec.js, BASELINE.pre, gleicher Track und gleiche Länge)
const DEFAULT_PRE_RMS = { drums: 0.05009726748802992, bass: 0.09297909625210916, chords: 0.0683636709576798, pad: 0.04085044316844499 };
// [Name, Schlagworte, Schicht ('' = Summe), Mindest-diff, Richtung des Schwerpunkts: -1 tiefer, +1 höher, 0 egal]
// Gemessen 2026-11-08 (16 s, mit Begrenzer; diff / Schwerpunkt Standard -> mit Schlagwort / rms Standard -> mit Schlagwort):
//   Akkorde (1237 Hz, rms 0.121): mellow 0.497 / 633 Hz / 0.135 (Tiefpass-Ende nie unter 450 Hz; vorher 0.560 / 602 Hz), biting 0.398 / 1697 Hz / 0.103, chorused 0.311 / 1293 Hz / 0.106,
//     tremolo 0.290 / 1255 Hz / 0.109, ringing 0.892 / 1246 Hz / 0.166
//   Pad (1014 Hz, rms 0.079): swelling 0.258 / 1018 Hz / 0.069 (vor der kürzeren Haltezeit 0.566: der Akkord hing in den nächsten Takt), airy 0.828 / 1166 Hz / 0.085, glassy 1.299 / 1493 Hz / 0.081,
//     thick 1.247 / 786 Hz / 0.078, moving 0.671 / 949 Hz / 0.077 (LFO-Tiefe höchstens 0.8 x cutoff; vorher 0.714), dreamy 1.083 / 1130 Hz / 0.097 (Hall)
//   Summe (2992 Hz, rms 0.219): dark 0.302 / 1360 Hz / 0.220, bright 0.285 / 5119 Hz / 0.181, psychedelic 0.333 / 2748 Hz / 0.230
//   warm: Akkorde 0.298 / 750 Hz (vorher 0.335 / 731 Hz), Pad 0.375 / 741 Hz
// Die Summe wird von Schlagzeug und Bass getragen: dark und bright brauchten dafür ein Hochregal bei 800 Hz (bei 3 kHz lag diff nur bei 0.12).
const SHAPING_TAGS = [
  ['mellow', { chordSound: ['mellow'] }, 'chords', 0.25, -1],
  ['biting', { chordSound: ['biting'] }, 'chords', 0.25, 1],
  ['chorused', { chordSound: ['chorused'] }, 'chords', 0.25, 0],
  ['tremolo', { chordSound: ['tremolo'] }, 'chords', 0.25, 0],
  ['ringing', { chordSound: ['ringing'] }, 'chords', 0.25, 0],
  ['swelling', { padSound: ['swelling'] }, 'pad', 0.25, 0],
  ['airy', { padSound: ['airy'] }, 'pad', 0.25, 1],
  ['glassy', { padSound: ['glassy'] }, 'pad', 0.25, 1],
  ['thick', { padSound: ['thick'] }, 'pad', 0.25, -1],
  ['moving', { padSound: ['moving'] }, 'pad', 0.25, 0],
  ['dark', { mood: ['dark'] }, '', 0.25, -1],
  ['bright', { mood: ['bright'] }, '', 0.25, 1],
  ['psychedelic', { mood: ['psychedelic'] }, '', 0.25, 0],
  ['dreamy', { mood: ['dreamy'] }, 'pad', 0.15, 0],
];

for (const [name, tags, layer, minDiff, direction] of SHAPING_TAGS) {
  test(`Klang ${name}: ${layer || 'Summe'} deutlich anders, Schwerpunkt in Richtung`, async ({ page }) => {
    test.setTimeout(120_000);
    const r = await compare(page, track(), withTags(tags), SOUND_SECONDS, layer ? { layer } : undefined);
    const label = `${name}: ${JSON.stringify(r)}`;
    expect(r.diff, label).toBeGreaterThanOrEqual(minDiff);
    if (direction < 0) expect(r.centroidB, label).toBeLessThan(r.centroidA);
    if (direction > 0) expect(r.centroidB, label).toBeGreaterThan(r.centroidA);
    if (name === 'ringing') expect(r.rmsB, label).toBeGreaterThan(r.rmsA); // längeres Ausklingen bringt Energie
  });
}

test('Klang warm: Akkorde und Pad dunkler, mindestens eine Schicht deutlich anders', async ({ page }) => {
  test.setTimeout(120_000);
  const warm = withTags({ synths: ['warm'] });
  const chords = await compare(page, track(), warm, SOUND_SECONDS, { layer: 'chords' });
  const pad = await compare(page, track(), warm, SOUND_SECONDS, { layer: 'pad' });
  const label = `chords ${JSON.stringify(chords)} pad ${JSON.stringify(pad)}`;
  expect(chords.centroidB, label).toBeLessThan(chords.centroidA);
  expect(pad.centroidB, label).toBeLessThan(pad.centroidA);
  expect(Math.max(chords.diff, pad.diff), label).toBeGreaterThanOrEqual(0.25);
});

// Eigener Offline-Render im Browser (wie renderLeft in render.js, linker Kanal, ohne Begrenzer): Spitze der ersten 0,5 s nach dem
// ersten Ereignis und rms im Ausklang über 3 s, gemessen ab 1 s nach dem Ende des letzten Ereignisses (Note samt Dauer): dann sind
// die trockenen Töne verklungen (Pad-Ausklang 0,9 s), es bleiben Echo und Hall.
async function measureWindows(page, input, layer) {
  return page.evaluate(async ([track, solo]) => {
    const { buildEvents } = await import('/core/events.js');
    const { resolveTimbre } = await import('/core/timbre.js');
    const { createInstruments } = await import('/audio/synth.js');
    const rate = 44100, offset = 0.1, seconds = 8, tail = 3;
    const events = buildEvents(track).filter((e) => e.layer && e.t < seconds);
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * (offset + seconds + tail + 3)), rate);
    const { output, layers } = createInstruments(ctx, { bpm: track.bpm, limiter: false, timbre: resolveTimbre(track.tags) });
    output.connect(ctx.destination);
    if (solo) for (const name of Object.keys(layers)) layers[name].setMuted(name !== solo);
    for (const e of events) layers[e.layer].trigger(e, offset + e.t);
    const d = (await ctx.startRendering()).getChannelData(0);
    const last = Math.max(...events.map((e) => e.t + (e.dur ?? 0)));
    let firstPeak = 0, sum = 0;
    const from = Math.round(rate * (offset + last + 1));
    for (let i = Math.round(rate * offset); i < Math.round(rate * (offset + 0.5)); i++) firstPeak = Math.max(firstPeak, Math.abs(d[i]));
    for (let i = from; i < from + rate * tail; i++) sum += d[i] * d[i];
    return { firstPeak, tailRms: Math.sqrt(sum / (rate * tail)), last };
  }, [input, layer]);
}

// Gemessen 2026-11-08 (Pad allein, ohne Begrenzer, erste 0,5 s nach dem ersten Ereignis): Spitze Standard 0.0909, swelling 0.0342.
test('Klang swelling: langsamerer Einsatz, Pad-Spitze der ersten 0,5 s niedriger als im Standard', async ({ page }) => {
  test.setTimeout(120_000);
  const base = await measureWindows(page, track(), 'pad');
  const swell = await measureWindows(page, withTags({ padSound: ['swelling'] }), 'pad');
  const label = `Standard ${JSON.stringify(base)} swelling ${JSON.stringify(swell)}`;
  expect(base.firstPeak, label).toBeGreaterThan(0.01);
  expect(swell.firstPeak, label).toBeLessThan(0.7 * base.firstPeak);
});

// Eine einzelne taktlange Pad-Note (A3, vel 0.8) durch die echten Instrumente, Offline, ohne Begrenzer. Echo und Hall im
// Klangmodell auf 0 (echoWet und reverbWet 0): gemessen wird so genau der trockene Pad-Weg (Pad -> Trim -> Summe), linker Kanal.
// Ergebnis: rms im Fenster [Taktende + 0,3 s, + 0,6 s] relativ zum Haltepegel im Fenster [Taktende - 0,6 s, - 0,3 s].
async function padLateRatio(page, tags, bpm) {
  return page.evaluate(async ([tags, bpm]) => {
    const { resolveTimbre } = await import('/core/timbre.js');
    const { createInstruments } = await import('/audio/synth.js');
    const rate = 44100, offset = 0.1, dur = (4 * 60) / bpm;
    const timbre = resolveTimbre(tags);
    timbre.master = { ...timbre.master, echo: 0, reverb: 0 };
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * (offset + dur + 2)), rate);
    const { output, layers } = createInstruments(ctx, { bpm, limiter: false, timbre });
    output.connect(ctx.destination);
    layers.pad.trigger({ type: 'note', layer: 'pad', midi: 57, vel: 0.8, dur }, offset);
    const d = (await ctx.startRendering()).getChannelData(0);
    const end = offset + dur;
    const rmsIn = (a, b) => {
      let sum = 0, n = 0;
      for (let i = Math.round(rate * a); i < Math.round(rate * b); i++, n++) sum += d[i] * d[i];
      return Math.sqrt(sum / n);
    };
    const sustain = rmsIn(end - 0.6, end - 0.3);
    return { sustain, late: rmsIn(end + 0.3, end + 0.6), ratio: rmsIn(end + 0.3, end + 0.6) / sustain };
  }, [tags, bpm]);
}

// Musikalische Probe: der Akkord eines Takts darf nicht in den nächsten Takt hinein auf vollem Pegel weiterklingen
// (sonst liegt z. B. das E von Am noch über F-Dur). Fälle: Standard, swelling, die Pad-Schlagworte von psych und dreamy bei deren Tempo.
// Gemessen 2026-11-08, Verhältnis spät / Halten: Standard 0.041, swelling 0.041, psych 0.060, dreamy 0.036, swelling bei 200 bpm 0.034;
// vor der Korrektur (Haltezeit unabhängig vom Einsatz) swelling 0.911, psych 1.743, dreamy 1.126, swelling bei 200 bpm 1.629.
for (const [name, tags, bpm] of [
  ['Standard', {}, 100],
  ['swelling', { padSound: ['swelling'] }, 100],
  ['psych (swelling + glassy)', { padSound: ['swelling', 'glassy'] }, 112],
  ['dreamy (airy + swelling)', { padSound: ['airy', 'swelling'] }, 80],
  ['swelling, kurzer Takt', { padSound: ['swelling'] }, 200],
]) {
  test(`Pad ${name}: der Akkord ist 0,3-0,6 s nach dem Taktstrich höchstens ein Viertel so laut wie davor`, async ({ page }) => {
    const r = await padLateRatio(page, tags, bpm);
    const label = `${name}: ${JSON.stringify(r)}`;
    expect(r.sustain, label).toBeGreaterThan(0.005);
    expect(r.ratio, label).toBeLessThanOrEqual(0.25);
  });
}

// Gemessen 2026-11-08 (Summe ohne Begrenzer, 3 s ab 1 s nach dem Ende des letzten Ereignisses bei 9.6 s): Ausklang-rms Standard 0.00091,
// psychedelic 0.00655 (7.2x), dreamy 0.00121 (1.33x). Das Fenster begann früher direkt am Ende des letzten Ereignisses (dreamy 1.9x):
// dort zählte das in den nächsten Takt hängende Pad mit (langsamerer Einsatz ohne kürzere Haltezeit); seit der Korrektur klingt es
// wie im Standard vor dem Taktstrich aus, im alten Fenster bliebe dreamy bei 1.14x, obwohl Echo und Hall unverändert sind.
test('Klang psychedelic und dreamy: mehr Echo und Hall, Summen-rms im Ausklang nach dem letzten Ereignis größer als im Standard', async ({ page }) => {
  test.setTimeout(120_000);
  const base = await measureWindows(page, track());
  const label = (n, r) => `Standard ${JSON.stringify(base)} ${n} ${JSON.stringify(r)}`;
  const psychedelic = await measureWindows(page, withTags({ mood: ['psychedelic'] }));
  expect(psychedelic.tailRms, label('psychedelic', psychedelic)).toBeGreaterThan(base.tailRms * 1.2);
  const dreamy = await measureWindows(page, withTags({ mood: ['dreamy'] }));
  expect(dreamy.tailRms, label('dreamy', dreamy)).toBeGreaterThan(base.tailRms * 1.2); // gemessen 1.33x
});

// Gemessen 2026-11-08 (Akkorde-rms / Pad-rms vor dem Begrenzer relativ zum Standard; Schichtverhältnis kleinster / größter rms; Summe Spitze vor / nach dem Begrenzer):
//   mellow 1.127 / 1.000; 0.439; 0.789 / 0.704    biting 0.864 / 1.000; 0.439; 0.691 / 0.698    chorused 0.814 / 1.000; 0.439; 0.631 / 0.685
//   tremolo 1.099 / 1.000; 0.439; 0.822 / 0.704   ringing 1.422 / 1.000; 0.420; 0.769 / 0.709   swelling 1.000 / 0.876; 0.464; 0.693 / 0.690
//   airy 1.000 / 1.081; 0.475; 0.692 / 0.697      glassy 1.000 / 1.026; 0.451; 0.652 / 0.695    thick 1.000 / 0.993; 0.436; 0.704 / 0.697
//   moving 1.000 / 0.979; 0.423; 0.702 / 0.704    dark 0.938 / 0.880; 0.388; 0.651 / 0.672       bright 0.851 / 0.906; 0.520; 0.675 / 0.706
//   psychedelic 1.211 / 1.260; 0.546; 0.815 / 0.725   dreamy 0.992 / 1.228; 0.538; 0.750 / 0.699   warm 0.985 / 0.960; 0.412; 0.695 / 0.690
// Schichtverhältnis im Standard: 0.44 (Pad / Bass). Ohne den Summenpegel-Faktor (masterParams.level) lag die Spitze von bright vor dem Begrenzer bei 0.888.
// Pegelsicherheit je Schlagwort. Verhältnis = Schicht-rms vor dem Begrenzer / Standard (Akkorde und Pad; die anderen Schichten
// bleiben bis auf den Hall unverändert), Schichtverhältnis = kleinster / größter Schicht-rms der Mischung vor dem Begrenzer.
const LEVEL_TAGS = [...SHAPING_TAGS.map(([name, tags]) => [name, tags]), ['warm', { synths: ['warm'] }]];
for (const [name, tags] of LEVEL_TAGS) {
  test(`Klang ${name}: Pegel sicher (Akkorde und Pad hörbar und im Rahmen, Summe ohne Übersteuern)`, async ({ page }) => {
    test.setTimeout(120_000);
    const input = withTags(tags);
    const pre = await page.evaluate(([i, s]) => window.__render(i, s, { limiter: false }), [input, SOUND_SECONDS]);
    const post = await page.evaluate(([i, s]) => window.__render(i, s), [input, SOUND_SECONDS]);
    const ratios = Object.fromEntries(['chords', 'pad'].map((l) => [l, pre.perLayer[l].rms / DEFAULT_PRE_RMS[l]]));
    const rms = LAYERS.map((l) => pre.perLayer[l].rms);
    const spread = Math.min(...rms) / Math.max(...rms);
    const label = `${name}: ratios ${JSON.stringify(ratios)}, layer spread ${spread}, pre peak ${pre.peak}, post peak ${post.peak}, post rms ${JSON.stringify(Object.fromEntries(LAYERS.map((l) => [l, post.perLayer[l].rms])))}`;
    for (const l of LAYERS) expect(post.perLayer[l].rms, label).toBeGreaterThan(0.005);
    for (const r of Object.values(ratios)) {
      expect(r, label).toBeGreaterThanOrEqual(0.25);
      expect(r, label).toBeLessThanOrEqual(3);
    }
    expect(spread, label).toBeGreaterThanOrEqual(0.2);
    expect(post.peak, label).toBeLessThan(0.9);
    expect(pre.peak, label).toBeLessThan(0.95);
  });
}

test('Klang: alle Klang-Schlagworte zugleich (auch dark und bright) bleiben endlich und sicher', async ({ page }) => {
  test.setTimeout(120_000);
  const input = withTags({
    drumSound: ['punchy', 'boomy', 'snappy', 'crisp', 'roomy'], bassSound: ['sub', 'fuzz', 'plucky', 'round', 'resonant'],
    chordSound: ['mellow', 'biting', 'chorused', 'tremolo', 'ringing'], padSound: ['swelling', 'airy', 'glassy', 'thick', 'moving'],
    mood: ['dark', 'bright', 'psychedelic', 'dreamy'], bass: ['gritty'], synths: ['warm'],
  });
  const r = await page.evaluate(([i, s]) => window.__render(i, s), [input, SOUND_SECONDS]);
  const values = [r.peak, r.rms, r.centroid, ...LAYERS.flatMap((l) => Object.values(r.perLayer[l]))];
  expect(values.every(Number.isFinite), JSON.stringify(r)).toBe(true);
  expect(r.peak, JSON.stringify(r)).toBeLessThan(0.9);
  for (const l of LAYERS) expect(r.perLayer[l].rms, `${l}: ${JSON.stringify(r)}`).toBeGreaterThan(0.005);
});

test('Klang: stumme Akkorde und stummes Pad bleiben mit chorused, tremolo und airy exakt still (abgeschaltet und über setMuted)', async ({ page }) => {
  test.setTimeout(120_000);
  const tags = { chordSound: ['chorused', 'tremolo'], padSound: ['airy'] };
  const off = await page.evaluate(([i, s]) => window.__render(i, s), [track({ layers: { drums: true, bass: true, chords: false, pad: false }, tags: { development: ['fullFromStart'], ...tags } }), 6]);
  expect(off.perLayer.chords).toEqual({ peak: 0, rms: 0, centroid: 0 });
  expect(off.perLayer.pad).toEqual({ peak: 0, rms: 0, centroid: 0 });
  // andere Schicht allein: Akkorde und Pad spielen mit den Effekten, sind aber über setMuted stumm (Echo und Effektknoten hängen dahinter)
  for (const layer of ['drums', 'bass']) {
    const solo = await compare(page, track(), withTags(tags), 6, { layer });
    expect(solo.diff, layer).toBeLessThan(1e-6);
  }
});

// Stile: gleiche Muster (Schlagworte von funk, gleiche Akkorde, Tempo, Seed), nur die Schlagworte der vier Klang-Kategorien
// von funk, psych und dreamy. Der Unterschied kommt also allein vom Klang. development ist fullFromStart (wie track()), nicht
// funks buildsSlowly: sonst schweigen Akkorde und Pad in den ersten 16 s und ihre Klang-Schlagworte blieben ungeprüft.
// Gemessen 2026-11-08 (16 s, mit Begrenzer), diff je Paar funk/psych, funk/dreamy, psych/dreamy (funk ohne warm, also auch das
// gemeinsame Muster ohne warm; Pad-Haltezeit, LFO-Grenze und Akkord-Filteruntergrenze eingerechnet):
//   Summe 1.018 / 1.035 / 0.550, nur Akkorde 0.508 / 0.845 / 0.673, nur Pad 1.215 / 0.788 / 0.943
//   (vorher, funk mit warm: Summe 1.023 / 1.085 / 0.616, nur Akkorde 0.518 / 0.944 / 0.830, nur Pad 1.317 / 0.943 / 0.940)
// (Pegel der echten Presets: levels.spec.js, die Presets enthalten die Klang-Schlagworte.)
const SOUND_CATEGORIES = ['drumSound', 'bassSound', 'chordSound', 'padSound'];
const presetOf = (id) => STYLE_PRESETS.find((p) => p.id === id);
const sharedPattern = {
  ...Object.fromEntries(Object.entries(presetOf('funk').tags).filter(([c]) => !SOUND_CATEGORIES.includes(c))),
  development: ['fullFromStart'],
};
const styleSound = (id) => track({ tags: { ...sharedPattern, ...Object.fromEntries(SOUND_CATEGORIES.map((c) => [c, presetOf(id).tags[c]])) } });

test('Stile klingen allein durch Klang-Schlagworte messbar verschieden (Summe, Akkorde, Pad, paarweise diff >= 0.25)', async ({ page }) => {
  test.setTimeout(240_000);
  for (const [a, b] of [['funk', 'psych'], ['funk', 'dreamy'], ['psych', 'dreamy']]) {
    // Akkorde und Pad einzeln: alle drei Paare unterscheiden sich in beiden Schichten, die Prüfung fällt ohne chordSound/padSound
    for (const [label, options] of [['Summe', undefined], ['Akkorde', { layer: 'chords' }], ['Pad', { layer: 'pad' }]]) {
      const r = await compare(page, styleSound(a), styleSound(b), SOUND_SECONDS, options);
      expect(r.diff, `${label} ${a} gegen ${b}: ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(0.25);
    }
  }
  // Gegenprobe Determinismus: derselbe Track zweimal gerendert ergibt keinen Unterschied (die Prüfungen oben messen also Klang, nicht Rauschen)
  const same = await compare(page, styleSound('funk'), styleSound('funk'), 6);
  expect(same.diff).toBeLessThan(1e-6);
});

test('track.timbre wirkt wie ein Schlagwort und schlägt es', async ({ page }) => {
  test.setTimeout(120_000);
  const viaTag = track({ tags: { development: ['fullFromStart'], bassSound: ['fuzz'] } });
  const viaTimbre = track({ timbre: { bass: { fuzz: 0.6 } } });
  expect((await compare(page, viaTag, viaTimbre, 6, { layer: 'bass' })).diff).toBeLessThan(1e-6);
  const loud = track({ timbre: { bass: { fuzz: 1 } } });
  expect((await compare(page, track(), loud, 6, { layer: 'bass' })).diff).toBeGreaterThan(0.25);
  // Überschreibung gewinnt gegen das Schlagwort (fuzz 0.6 gegen 0)
  const off = track({ tags: viaTag.tags, timbre: { bass: { fuzz: 0 } } });
  expect((await compare(page, track(), off, 6, { layer: 'bass' })).diff).toBeLessThan(1e-6);
});

// --- setTimbre: Klang der laufenden Instrumente umstellen (Offline, Ereignisse mit 1 s Vorlauf, verglichen ab 1 s,
// weil die Rampe der festen Knoten nach 0,2 s exakt ist) ---
const LIVE_TAGS = {
  development: ['fullFromStart'],
  bassSound: ['fuzz', 'sub'], drumSound: ['roomy', 'punchy'], chordSound: ['chorused', 'tremolo'],
  padSound: ['airy', 'thick'], mood: ['psychedelic', 'bright'],
};

// Rendert 4 s Ereignisse; make(ctx) liefert die Instrumente, after(inst) wirkt vor dem ersten Ton (z. B. setTimbre)
const renderLive = (page, args) => page.evaluate(async ({ tags, create, after, against, extremes }) => {
  const { createInstruments } = await import('/audio/synth.js');
  const { buildEvents } = await import('/core/events.js');
  const { resolveTimbre, DEFAULT_TIMBRE } = await import('/core/timbre.js');
  const track = {
    key: { root: 'A', mode: 'minor' }, bpm: 100, seed: 1, length: 24, layers: { drums: true, bass: true, chords: true, pad: true },
    bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
    tags,
  };
  const events = buildEvents(track);
  const spec = (s) => (s === 'default' ? DEFAULT_TIMBRE : s === 'tags' ? resolveTimbre(tags)
    : Object.fromEntries(Object.entries(DEFAULT_TIMBRE).map(([g, f]) => [g, Object.fromEntries(Object.keys(f).map((k) => [k, s === 'zeros' ? 0 : 1]))])));
  const run = async (createWith, afterWith) => {
    const ctx = new OfflineAudioContext(2, 44100 * 6, 44100);
    const inst = createInstruments(ctx, { bpm: 100, timbre: spec(createWith) });
    inst.output.connect(ctx.destination);
    if (afterWith) inst.setTimbre(spec(afterWith));
    for (const e of events) if (e.t < 4 && e.layer) inst.layers[e.layer].trigger(e, 1 + e.t);
    return (await ctx.startRendering()).getChannelData(0).slice(44100);
  };
  const a = await run(create, after);
  const stats = (d) => {
    let peak = 0, finite = true;
    for (const v of d) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); }
    return { peak, finite };
  };
  const b = await run(against ?? after, null);
  if (extremes) return { ...stats(a), freshPeak: stats(b).peak };
  let diff = 0, rms = 0;
  for (let i = 0; i < a.length; i++) { diff = Math.max(diff, Math.abs(a[i] - b[i])); rms += b[i] * b[i]; }
  return { diff, rms: Math.sqrt(rms / a.length) };
}, args);

test('setTimbre vor dem ersten Ton klingt wie ein Klang von Anfang an', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await renderLive(page, { tags: LIVE_TAGS, create: 'default', after: 'tags' });
  expect(r.rms).toBeGreaterThan(0.005);
  expect(r.diff).toBeLessThan(1e-5); // Float32-Rauschen liegt bei ~1e-6; eine echte Abweichung ist um Größenordnungen größer
  // Gegenprobe: ohne setTimbre unterscheidet sich der Klang deutlich
  const control = await renderLive(page, { tags: LIVE_TAGS, create: 'default', after: null, against: 'tags' });
  expect(control.diff).toBeGreaterThan(0.01);
});

test('setTimbre zurück auf neutral klingt wie der neutrale Klang (Helligkeit, Raum, Hall, Echo wieder aus)', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await renderLive(page, { tags: LIVE_TAGS, create: 'tags', after: 'default' });
  expect(r.rms).toBeGreaterThan(0.005);
  expect(r.diff).toBeLessThan(1e-5);
});

test('setTimbre zwischen Extremen: nur endliche Werte, Spitze wie bei frisch erzeugten Instrumenten und unter 0,95', async ({ page }) => {
  test.setTimeout(120_000);
  for (const [create, after] of [['zeros', 'ones'], ['ones', 'zeros']]) {
    const r = await renderLive(page, { tags: LIVE_TAGS, create, after, extremes: true });
    expect(r.finite, `${create}->${after}`).toBe(true);
    expect(Math.abs(r.peak - r.freshPeak), `${create}->${after}`).toBeLessThan(1e-3);
    expect(r.peak, `${create}->${after}`).toBeLessThan(0.95);
  }
});

test('Septakkord-, Erweiterungs- und Powerchord-Folgen: Spitze nach dem Begrenzer unter 0,9, jede Schicht hörbar', async ({ page }) => {
  test.setTimeout(180_000);
  const funk = presetOf('funk');
  const folgen = [
    [['A', 'min7'], ['D', 'min7'], ['E', 'dom7'], ['A', 'min9']],
    [['A', 'min9'], ['E', 'dom9'], ['C', 'add9'], ['B', 'dim7']],
    [['A', 'power'], ['D', 'power'], ['E', 'power'], ['A', 'power']],
  ];
  for (const chords of folgen) {
    const input = track({ bars: chords.map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })), bpm: funk.bpm, tags: { ...funk.tags, development: ['fullFromStart'] } });
    const r = await page.evaluate((t) => window.__render(t, 6), input);
    const label = chords.map((c) => c.join(':')).join(' ');
    expect(r.peak, label).toBeLessThan(0.9);
    for (const layer of LAYERS) expect(r.perLayer[layer].rms, `${label} ${layer}`).toBeGreaterThan(0.005);
  }
});

test('Grooves in jeder Taktart bei hoher Komplexität: Spitze nach dem Begrenzer unter 0,9, jede Schicht hörbar', async ({ page }) => {
  test.setTimeout(240_000);
  const { GROOVES, METERS } = await import('../../src/core/grooves.js');
  const funk = presetOf('funk');
  for (const [id, g] of Object.entries(GROOVES)) {
    const beats = METERS[g.meter].beats;
    const input = track({
      meter: g.meter.split('/').map(Number), groove: id, complexity: 1, bpm: g.meter.endsWith('/8') ? 70 : funk.bpm,
      bars: ['A', 'A', 'D', 'E'].map((root, i) => ({ chord: { root, quality: i === 3 ? 'maj' : 'min' }, beats })),
      tags: { ...funk.tags, development: ['fullFromStart'] },
    });
    const r = await page.evaluate((t) => window.__render(t, 6), input);
    expect(r.peak, id).toBeLessThan(0.9);
    for (const layer of LAYERS) expect(r.perLayer[layer].rms, `${id} ${layer}`).toBeGreaterThan(0.005);
  }
});

// Verzerrer (Fuzz, Overdrive, Distortion) für Bass, Akkorde und Pad: je Regler allein auf 0,7, Schicht allein, 6 s.
// Gemessen 2026-11-09 (16 s, Regler 1, vor dem Begrenzer: rms gegen Standard; Schwerpunkt Standard -> mit Effekt):
//   Bass (525 Hz): fuzz 0.91 / 2255 Hz, overdrive 0.94 / 923 Hz, distortion 0.61 / 2799 Hz
//   Akkorde (1239 Hz): fuzz 1.20 / 3700 Hz, overdrive 1.22 / 1742 Hz, distortion 0.80 / 4029 Hz
//   Pad (1020 Hz): fuzz 1.35 / 4396 Hz, overdrive 1.26 / 1455 Hz, distortion 1.14 / 4575 Hz
const FX_SECONDS = 6;
const withTimbre = (timbre) => track({ timbre });
for (const layer of ['bass', 'chords', 'pad']) {
  for (const fx of ['fuzz', 'overdrive', 'distortion']) {
    test(`Verzerrer ${layer}.${fx}: Schicht deutlich anders und obertonreicher, Pegel im Rahmen`, async ({ page }) => {
      test.setTimeout(120_000);
      const r = await compare(page, track(), withTimbre({ [layer]: { [fx]: 0.7 } }), FX_SECONDS, { layer });
      const label = `${layer}.${fx}: ${JSON.stringify(r)}`;
      expect(r.diff, label).toBeGreaterThanOrEqual(0.15);
      expect(r.centroidB, label).toBeGreaterThan(r.centroidA);
      expect(r.rmsB / r.rmsA, label).toBeGreaterThan(0.4);
      expect(r.rmsB / r.rmsA, label).toBeLessThan(2.5);
    });
  }
}

test('Verzerrer: Schlagzeug bleibt unverändert, auch wenn ihm ein Effekt-Feld mitgegeben wird; andere Schichten ändern sich nur durch ihre eigenen Regler', async ({ page }) => {
  test.setTimeout(120_000);
  const drumsTried = withTimbre({ drums: { fuzz: 1, overdrive: 1, distortion: 1 } });
  expect((await compare(page, track(), drumsTried, FX_SECONDS)).diff).toBeLessThan(1e-6);
  const chordsOnly = withTimbre({ chords: { fuzz: 1, overdrive: 1, distortion: 1 } });
  for (const layer of ['drums', 'bass', 'pad']) {
    expect((await compare(page, track(), chordsOnly, FX_SECONDS, { layer })).diff, layer).toBeLessThan(1e-6);
  }
});

test('Verzerrer: alle Effekte aller Instrumente auf 1 bleiben endlich und vor dem Begrenzer unter 1 (kein Gleichanteil vor dem Anschlag)', async ({ page }) => {
  test.setTimeout(120_000);
  const all = { fuzz: 1, overdrive: 1, distortion: 1 };
  const r = await page.evaluate(([t, s]) => window.__render(t, s, { limiter: false }), [withTimbre({ bass: all, chords: all, pad: all }), FX_SECONDS]);
  expect([r.peak, r.rms].every(Number.isFinite), JSON.stringify(r)).toBe(true);
  expect(r.peak, JSON.stringify(r)).toBeLessThan(1);
  // jede Schicht für sich: ein Fuzz-Gleichanteil vor dem Anschlag hatte die Spitze auf über 16 getrieben
  for (const layer of ['bass', 'chords', 'pad']) {
    const solo = await page.evaluate(([t, s]) => window.__render(t, s, { limiter: false }), [withTimbre({ [layer]: all }), FX_SECONDS]);
    expect(solo.perLayer[layer].peak, layer).toBeLessThan(1);
  }
});

test('Bass-Fuzz ist deutlich stärker als vorher: bei 1 mehr Obertöne als beim Schlagwort fuzz (0,6)', async ({ page }) => {
  test.setTimeout(120_000);
  const tag = await compare(page, track(), withTags({ bassSound: ['fuzz'] }), FX_SECONDS, { layer: 'bass' });
  const full = await compare(page, track(), withTimbre({ bass: { fuzz: 1 } }), FX_SECONDS, { layer: 'bass' });
  expect(full.centroidB, `${JSON.stringify(full)} gegen ${JSON.stringify(tag)}`).toBeGreaterThan(tag.centroidB);
});

test('createInstruments: setTimbre schaltet die Verzerrer live, auch mitten im Spiel, ohne zu werfen', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const { createInstruments } = await import('/audio/synth.js');
    const all = { fuzz: 1, overdrive: 1, distortion: 1 };
    // gleiche Töne, einmal mit setTimbre vor dem zweiten Satz Töne, einmal ohne; Spitze der Zeit 0,4 bis 0,8 s
    const render = async (live) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const inst = createInstruments(ctx, { bpm: 100, limiter: false });
      inst.output.connect(ctx.destination);
      const note = (layer, midi) => ({ type: 'note', layer, midi, dur: 0.3, vel: 1 });
      for (const layer of ['bass', 'chords', 'pad']) inst.layers[layer].trigger(note(layer, layer === 'bass' ? 40 : 57), 0.05);
      if (live) inst.setTimbre({ bass: all, chords: all, pad: all });
      for (const layer of ['bass', 'chords', 'pad']) inst.layers[layer].trigger(note(layer, layer === 'bass' ? 43 : 60), 0.4);
      const d = (await ctx.startRendering()).getChannelData(0);
      const early = d.slice(0, 17640), late = d.slice(17640, 35280);
      const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      return { early: Array.from(early.slice(0, 2000)), late: Array.from(late), peak: peak(d) };
    };
    const clean = await render(false);
    const live = await render(true);
    const sum = (x) => x.reduce((s, v, i) => s + Math.abs(v - clean.late[i]), 0);
    return { peak: live.peak, earlySame: live.early.every((v, i) => v === clean.early[i]), lateDiff: sum(live.late) / live.late.length };
  });
  expect(Number.isFinite(r.peak) && r.peak > 0 && r.peak < 1, JSON.stringify(r)).toBe(true);
  expect(r.earlySame, 'Töne vor setTimbre bleiben unverändert').toBe(true);
  expect(r.lateDiff, 'Töne nach setTimbre klingen anders').toBeGreaterThan(0.001);
});
