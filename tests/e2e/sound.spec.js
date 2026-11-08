// Messwerkzeug für die Klangformung: compareRenders, Spektralschwerpunkt im Offline-Render, timbre-Option.
import { test, expect } from '@playwright/test';

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
