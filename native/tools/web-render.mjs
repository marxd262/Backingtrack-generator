// Renders tracks with the web app in Playwright's Chromium (OfflineAudioContext), served from src/ (read only).
// Returns per track the stereo samples, interleaved, as play() of the web app would sound them.
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '@playwright/test';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.flac': 'audio/flac' };

// warps (optional, per track): points [seconds as generated, seconds as rendered], ascending: a tempo curve laid
// over the track's steady tempo. Every event starts at its moved time.
// shortcut: note lengths and echo times stay at the track's own tempo, fine for a few percent of change; move them too when the curve gets steep.
// options (optional, per track): { tuning, limiter } as createInstruments takes them (limiter: false renders the mix before the limiter).
export async function renderWeb(repo, tracks, rate, warps = [], options = []) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('http://btg.local/**', (route) => {
      const file = join(repo, 'src', decodeURIComponent(new URL(route.request().url()).pathname));
      if (!file.startsWith(join(repo, 'src')) || !existsSync(file)) return route.fulfill({ status: 404 });
      return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto('http://btg.local/ui/credits.html'); // any page of the origin, for the module imports
    const out = [];
    for (const track of tracks) {
      const base64 = await page.evaluate(async ([t, r, points, extra]) => {
        const warp = (x) => {
          if (!points) return x;
          let i = 1;
          while (i < points.length - 1 && points[i][0] < x) i++;
          const [a, b] = [points[i - 1], points[i]];
          return a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
        };
        const { buildEvents } = await import('/core/events.js');
        const { resolveTrackTimbre } = await import('/core/timbre.js');
        const { resolveVoices } = await import('/core/voices.js');
        const { chordTimeline } = await import('/core/timeline.js');
        const { createInstruments } = await import('/audio/synth.js');
        const events = buildEvents(t);
        const seconds = warp(chordTimeline(t).reduce((sum, bar) => sum + bar.durationSec, 0));
        const ctx = new OfflineAudioContext(2, Math.ceil(r * (seconds + 0.2)), r);
        // as play() does it: timbre and voices of the track, everything else at its defaults
        const { output, layers, whenReady } = createInstruments(ctx, { bpm: t.bpm, timbre: resolveTrackTimbre(t), voices: resolveVoices(t), ...extra });
        await whenReady();
        output.connect(ctx.destination);
        for (const e of events) if (e.layer) layers[e.layer].trigger(e, warp(e.t));
        const buffer = await ctx.startRendering();
        const both = new Float32Array(buffer.length * 2);
        for (let c = 0; c < 2; c++) buffer.getChannelData(c).forEach((v, i) => { both[2 * i + c] = v; });
        const bytes = new Uint8Array(both.buffer);
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(text);
      }, [track, rate, warps[out.length] ?? null, options[out.length] ?? {}]);
      const raw = Buffer.from(base64, 'base64');
      out.push(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
    }
    return out;
  } finally {
    await browser.close();
  }
}

// 16-bit stereo WAV
export function wavBytes(samples, rate, gain = 1) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + 2 * i));
  return data;
}
