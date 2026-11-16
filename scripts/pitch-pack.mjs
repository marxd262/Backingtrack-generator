// Tonhöhe durch den Sampler: je Pack die Töne MIDI 28, 33, 40, 45, 52 rendern und den Grundton messen (Autokorrelation, 0,15–0,45 s).
// Aufruf: node scripts/pitch-pack.mjs <pack-id> …
import { start } from './serve.js';
import { chromium } from '@playwright/test';

const server = await start(0), browser = await chromium.launch(), page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
for (const id of process.argv.slice(2)) {
  const rows = await page.evaluate(async (id) => {
    const { sampleVoice } = await import('/audio/voices/sample.js');
    const { loadPack } = await import('/audio/voices/sampler.js');
    await loadPack(id);
    const out = [];
    for (const midi of [28, 33, 40, 45, 52]) {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      let seed = 5;
      const voice = sampleVoice(id, 'bass', ctx, { getTimbre: () => ({ cutoff: 0.5 }), tuned: (n) => ({ level: 1 })[n] ?? NaN, classic() {}, setStatus() {}, track() {}, rng: { next: () => (seed = (seed * 16807) % 2147483647) / 2147483647 } });
      voice(ctx.destination, 0.01, { type: 'note', midi, dur: 0.8, vel: 0.8 });
      const x = (await ctx.startRendering()).getChannelData(0).subarray(6615, 19845);
      let best = 0, lag = 0;
      for (let l = 40; l < 2000; l++) { let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; if (s > best) { best = s; lag = l; } }
      for (let d = 2; d <= 4; d++) { const l = Math.round(lag / d); let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; if (s > 0.9 * best) lag = l; }
      out.push([midi, 69 + 12 * Math.log2(44100 / lag / 440)]);
    }
    return out;
  }, id);
  console.log(id, rows.map(([m, f]) => `${m}: ${f.toFixed(1)}`).join('  '));
}
await browser.close(); server.close();
