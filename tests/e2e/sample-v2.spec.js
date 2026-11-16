// Sample-Packs im Format 2 (FLAC, scripts/import-sfz.mjs) im Browser, auch in Firefox und WebKit (playwright.config.js): verlustfrei und ohne
// Versatz dekodiert (gegen ffmpeg), Round-Robins, Anschlagstufen, Release-Samples, Artikulations-Zonen, Raum-Mikrofon, Choke-Gruppen.
// Die Packs kommen aus tests/e2e/fixtures/samples (erzeugt mit make-sample-fixtures.mjs), ausgeliefert über page.route.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const DIR = new URL('./fixtures/samples/', import.meta.url);
const EXPECT = Object.fromEntries(['test-notes', 'test-hits'].map((id) => [id, JSON.parse(readFileSync(new URL(`${id}.expect.json`, DIR), 'utf8'))]));

test.beforeEach(async ({ page }) => {
  await page.route('**/assets/samples/test-*', (route) => route.fulfill({ body: readFileSync(new URL(new URL(route.request().url()).pathname.split('/').pop(), DIR)) }));
  await page.goto('/ui/render-harness.html');
  // Playwright-WebKit unter Windows hat kein Web Audio (geprüft 2026-11-15); unter macOS und Linux läuft der Test
  test.skip(!(await page.evaluate(() => typeof OfflineAudioContext === 'function')), 'kein Web Audio in diesem Browser-Build');
});

test('FLAC wird verlustfrei und ohne Versatz dekodiert, mono und stereo, je Sample ein Puffer', async ({ page }) => {
  const result = await page.evaluate(async (expects) => {
    const { loadPack } = await import('/audio/voices/sampler.js');
    const out = {};
    for (const [id, spots] of Object.entries(expects)) {
      const pack = await loadPack(id);
      out[id] = {
        channels: [...new Set(pack.buffers.map((b) => b.numberOfChannels))], lengths: pack.buffers.map((b) => b.length), frames: pack.meta.samples.map((s) => s.frames),
        // Toleranz 1,5 Stufen: manche Decoder teilen durch 32767 statt 32768; ein Versatz um ein Frame wäre bei diesen Sinustönen viel größer
        off: spots.filter(([k, f, c, v]) => Math.abs(pack.buffers[k].getChannelData(c)[f] - v / 32768) > 1.5 / 32768),
      };
    }
    return out;
  }, EXPECT);
  expect(result['test-notes'].channels).toEqual([1]);
  expect(result['test-hits'].channels).toEqual([2]);
  for (const r of Object.values(result)) { expect(r.lengths).toEqual(r.frames); expect(r.off).toEqual([]); }
});

/** Im Browser: rendert Ereignisse durch eine Sample-Stimme (sample.js oder sample-hits.js) und misst die Frequenz je Zeitfenster. */
async function render(page, kind, events, tunables, windows) {
  return page.evaluate(async ([kind, events, tunables, windows]) => {
    const { sampleVoice } = await import('/audio/voices/sample.js');
    const { sampleHitVoice } = await import('/audio/voices/sample-hits.js');
    const { loadPack } = await import('/audio/voices/sampler.js');
    const id = kind === 'notes' ? 'test-notes' : 'test-hits';
    await loadPack(id);
    const ctx = new OfflineAudioContext(2, 44100 * 3, 44100);
    let seed = 7;
    const deps = {
      getTimbre: () => ({}), tuned: (name) => ({ level: 1, ...tunables })[name] ?? NaN, classic: () => { throw new Error('Rückfall auf den Synth'); },
      setStatus() {}, track() {}, rng: { next: () => (seed = (seed * 16807) % 2147483647) / 2147483647 },
    };
    const voice = kind === 'notes' ? sampleVoice(id, 'lead', ctx, deps) : sampleHitVoice(id, {}, ctx, deps);
    for (const e of events) voice(ctx.destination, e.t, kind === 'notes' ? { type: 'note', midi: 60, dur: 0.2, vel: 0.8, ...e } : { type: 'hit', vel: 0.8, ...e });
    const buf = await ctx.startRendering();
    // Frequenz aus den Nulldurchgängen (auf 50 Hz gerundet) und Pegel je Fenster und Kanal
    return windows.map(([from, to]) => [0, 1].map((c) => {
      const d = buf.getChannelData(c), a = Math.round(from * 44100), b = Math.round(to * 44100);
      let cross = 0, sum = 0;
      for (let i = a + 1; i < b; i++) { if ((d[i - 1] < 0) !== (d[i] < 0)) cross++; sum += d[i] * d[i]; }
      return { hz: Math.round(cross / 2 / (to - from) / 50) * 50, rms: Math.sqrt(sum / (b - a)) };
    }));
  }, [kind, events, tunables, windows]);
}

test('Töne: Round-Robins wechseln je Taste, die Anschlagstufe wählt die Samples, Staccato nimmt seine eigene Zone', async ({ page }) => {
  const at = [0.1, 0.5, 0.9, 1.3, 1.7];
  const loud = (await render(page, 'notes', at.map((t) => ({ t })), {}, at.map((t) => [t + 0.05, t + 0.15]))).map(([l]) => l.hz);
  for (const hz of loud) expect([500, 600]).toContain(hz);
  for (let i = 1; i < loud.length; i++) expect(loud[i]).not.toBe(loud[i - 1]);
  const soft = (await render(page, 'notes', at.map((t) => ({ t, vel: 0.3 })), {}, at.map((t) => [t + 0.05, t + 0.15]))).map(([l]) => l.hz);
  for (const hz of soft) expect([300, 400]).toContain(hz);
  const [[staccato]] = await render(page, 'notes', [{ t: 0.1, art: 'staccato' }], {}, [[0.15, 0.25]]);
  expect(staccato.hz).toBe(1000);
});

test('Töne: das Release-Sample klingt am Notenende, nur mit Feinwert release > 0', async ({ page }) => {
  const [[on]] = await render(page, 'notes', [{ t: 0.1 }], { release: 1 }, [[0.36, 0.46]]);
  expect(on.hz).toBe(800);
  const [[off]] = await render(page, 'notes', [{ t: 0.1 }], {}, [[0.36, 0.46]]);
  expect(off.rms).toBeLessThan(1e-4);
});

test('Schläge: Direkt und Raum klingen zusammen (Raum mit roomMic), die geschlossene Hi-Hat würgt die offene ab, Round-Robins wechseln', async ({ page }) => {
  const [[closeL, roomR]] = await render(page, 'hits', [{ t: 0.1, name: 'hat' }], {}, [[0.15, 0.25]]);
  expect([closeL.hz, roomR.hz]).toEqual([2000, 2500]);
  const [[, silentRoom]] = await render(page, 'hits', [{ t: 0.1, name: 'hat' }], { roomMic: 0 }, [[0.15, 0.25]]);
  expect(silentRoom.rms).toBeLessThan(1e-4);
  const [[ringing], [first], [second]] = await render(page, 'hits', [{ t: 0.1, name: 'openHat' }, { t: 1.5, name: 'openHat' }], {}, [[0.9, 1.0], [0.2, 0.3], [1.6, 1.7]]);
  expect(ringing.rms).toBeGreaterThan(0.05);
  expect([first.hz, second.hz].sort()).toEqual([1000, 1100]);
  const [[choked]] = await render(page, 'hits', [{ t: 0.1, name: 'openHat' }, { t: 0.6, name: 'hat' }], {}, [[0.9, 1.0]]);
  expect(choked.rms).toBeLessThan(1e-3);
});
