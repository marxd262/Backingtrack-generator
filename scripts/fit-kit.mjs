// Anschlagkurve von Muldjord an das bisherige Standard-Kit anlehnen (die Anschläge des Generators wurden mit ihm gehört):
// je velCurve die Spitzenpegel bei vel 0,2 / 0,4 / 0,6 / 0,8 relativ zu vel 1, mittlere Abweichung zum Standard-Kit über die Schläge.
import { start } from './serve.js';
import { chromium } from '@playwright/test';

const server = await start(0), browser = await chromium.launch(), page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
// Aufruf: node scripts/fit-kit.mjs [pack-id]   (Standard drums-muldjord; Bezug ist immer das MuseScore-Standard-Kit drums-standard)
const result = await page.evaluate(async (packB) => {
  const { sampleHitVoice, HIT_KEYS } = await import('/audio/voices/sample-hits.js');
  const { loadPack } = await import('/audio/voices/sampler.js');
  const NAMES = ['kick', 'snare', 'hat', 'openHat', 'tomMid', 'crash', 'ride'], VELS = [1, 0.2, 0.4, 0.6, 0.8];
  const levels = async (id, tunables) => {
    await loadPack(id);
    const out = {};
    for (const name of NAMES) {
      const row = [];
      for (const vel of VELS) {
        const ctx = new OfflineAudioContext(2, 44100, 44100);
        let seed = 3;
        const voice = sampleHitVoice(id, HIT_KEYS.drums, ctx, { tuned: (n) => ({ level: 1, choke: 1, ...tunables })[n] ?? NaN, classic() {}, setStatus() {}, track() {}, rng: { next: () => (seed = (seed * 16807) % 2147483647) / 2147483647 } });
        voice(ctx.destination, 0.01, { type: 'hit', name, vel });
        const b = await ctx.startRendering();
        let p = 0; for (const c of [0, 1]) for (const x of b.getChannelData(c)) p = Math.max(p, Math.abs(x));
        row.push(20 * Math.log10(p));
      }
      out[name] = row.slice(1).map((x) => x - row[0]);
    }
    return out;
  };
  const ref = await levels('drums-standard', {}), rows = [];
  for (const velCurve of [1, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const mine = await levels(packB, { velCurve });
    const dev = NAMES.map((n) => mine[n].reduce((a, x, i) => a + Math.abs(x - ref[n][i]), 0) / 4);
    rows.push({ velCurve, mean: dev.reduce((a, b) => a + b, 0) / dev.length, perName: Object.fromEntries(NAMES.map((n, i) => [n, dev[i]])), mine });
  }
  return { ref, rows };
}, process.argv[2] ?? 'drums-muldjord');
console.log('Standard-Kit (vel 0,2/0,4/0,6/0,8 gegen 1):', Object.entries(result.ref).map(([n, r]) => `${n} ${r.map((x) => x.toFixed(1)).join('/')}`).join('  '));
for (const r of result.rows) console.log(`velCurve ${r.velCurve}: mittlere Abweichung ${r.mean.toFixed(1)} dB; ${Object.entries(r.perName).map(([n, d]) => `${n} ${d.toFixed(1)}`).join(', ')}; hat ${r.mine.hat.map((x) => x.toFixed(1)).join('/')}, snare ${r.mine.snare.map((x) => x.toFixed(1)).join('/')}`);
await browser.close(); server.close();
