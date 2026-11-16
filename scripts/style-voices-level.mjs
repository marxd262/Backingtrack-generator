// Pegel der Mischung je Stil: bisherige Standardstimmen (A) gegen die vom Stil vorgeschlagenen (B). Gleicher Track, 12 Takte, mit Begrenzer.
// Aufruf: node scripts/style-voices-level.mjs
import { chromium } from '@playwright/test';
import { start } from './serve.js';

async function inPage() {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { completeVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const out = [];
  for (const p of STYLE_PRESETS) {
    const key = { root: 'A', mode: 'minor' }, seed = 17, RATE = 44100, OFFSET = 0.1;
    const row = { id: p.id, voices: Object.values(p.voices).map((v) => v.variant).join(', ') };
    for (const [name, voices] of [['a', completeVoices()], ['b', completeVoices(p.voices)]]) {
      const track = { key, bpm: p.bpm, seed, variety: true, length: 12, tags: structuredClone(p.tags), voices,
        bars: colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key) };
      const events = buildEvents(track);
      const total = events.filter((e) => e.type === 'chord').at(-1).t + (4 * 60) / track.bpm;
      const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 1.5)), RATE);
      const inst = createInstruments(ctx, { bpm: track.bpm, limiter: true, timbre: resolveTrackTimbre(track), voices });
      await inst.whenReady();
      inst.output.connect(ctx.destination);
      for (const e of events) if (e.layer) inst.layers[e.layer].trigger(e, OFFSET + e.t);
      const buf = await ctx.startRendering();
      let sum = 0, peak = 0, n = 0;
      for (const ch of [0, 1]) for (const x of buf.getChannelData(ch)) { sum += x * x; peak = Math.max(peak, Math.abs(x)); n++; }
      row[name] = { rms: 10 * Math.log10(sum / n), peak, ready: Object.values(inst.voiceStatus()).every((s) => s === 'ready') };
    }
    out.push(row);
  }
  return out;
}

const server = await start(0);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
for (const r of await page.evaluate(inPage)) {
  console.log(`${r.id.padEnd(9)} ${r.voices.padEnd(26)} RMS A ${r.a.rms.toFixed(1)} dB, B ${r.b.rms.toFixed(1)} dB (${(r.b.rms - r.a.rms >= 0 ? '+' : '') + (r.b.rms - r.a.rms).toFixed(1)}), Spitze A ${r.a.peak.toFixed(2)}, B ${r.b.peak.toFixed(2)}${r.a.ready && r.b.ready ? '' : '  PACK FEHLT'}`);
}
await browser.close();
server.close();
