// A/B pair for listening: the same track rendered by the web app (A) and by the engine of the core (B),
// the louder side turned down to the RMS of the other.
//   node native/tools/render-ab.mjs [track.json] [output folder]
// The track is JSON as normalizeTrack writes it (default: native/core/tests/track-funk.json, drums and bass).
// The web side runs in Playwright's Chromium with an OfflineAudioContext, served from src/ (read only).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const trackFile = resolve(process.argv[2] ?? join(repo, 'native/core/tests/track-funk.json'));
const out = resolve(process.argv[3] ?? join(repo, '.superpowers/audio-ab'));
const track = JSON.parse(readFileSync(trackFile, 'utf8'));
const RATE = 48000;
mkdirSync(out, { recursive: true });

// --- A: web app ---
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.flac': 'audio/flac' };
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://btg.local/**', (route) => {
  const file = join(repo, 'src', decodeURIComponent(new URL(route.request().url()).pathname));
  if (!file.startsWith(join(repo, 'src')) || !existsSync(file)) return route.fulfill({ status: 404 });
  return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
});
await page.goto('http://btg.local/ui/credits.html'); // any page of the origin, for the module imports
const base64 = await page.evaluate(async ([t, rate]) => {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices } = await import('/core/voices.js');
  const { chordTimeline } = await import('/core/timeline.js');
  const { createInstruments } = await import('/audio/synth.js');
  const events = buildEvents(t);
  const seconds = chordTimeline(t).reduce((sum, bar) => sum + bar.durationSec, 0);
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * (seconds + 0.2)), rate);
  // as play() does it: timbre and voices of the track, everything else at its defaults
  const { output, layers, whenReady } = createInstruments(ctx, { bpm: t.bpm, timbre: resolveTrackTimbre(t), voices: resolveVoices(t) });
  await whenReady();
  output.connect(ctx.destination);
  for (const e of events) if (e.layer) layers[e.layer].trigger(e, e.t);
  const buffer = await ctx.startRendering();
  const both = new Float32Array(buffer.length * 2);
  for (let c = 0; c < 2; c++) buffer.getChannelData(c).forEach((v, i) => { both[2 * i + c] = v; });
  const bytes = new Uint8Array(both.buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}, [track, RATE]);
await browser.close();
const raw = Buffer.from(base64, 'base64');
const web = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

// --- B: engine of the core ---
const render = ['native/build/core/Release/btg_render.exe', 'native/build/core/btg_render'].map((p) => join(repo, p)).find(existsSync);
if (!render) throw new Error('btg_render not built (native/build.ps1)');
const nativeWav = join(out, 'native-raw.wav');
console.log('native:', execFileSync(render, [trackFile, join(repo, 'src/assets/samples'), nativeWav, String(RATE)], { encoding: 'utf8' }).trim());
const wav = readFileSync(nativeWav);
const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.byteLength - 44) / 2);
const native = Float32Array.from(pcm, (v) => v / 32768);

// --- measure, match, write ---
const { spectralCentroid } = await import(pathToFileURL(join(repo, 'src/audio/spectrum.js')).href);
function measure(samples) {
  let sum = 0, peak = 0;
  for (const v of samples) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(sum / samples.length);
  const left = samples.filter((_, i) => i % 2 === 0);
  const db = (x) => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  return { seconds: +(samples.length / 2 / RATE).toFixed(1), rmsDb: db(rms), peakDb: db(peak), crestDb: +(db(peak) - db(rms)).toFixed(1), centroidHz: Math.round(spectralCentroid(left.subarray(RATE * 10, RATE * 40), RATE)), rms };
}
function writeWav(file, samples, gain) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 4, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + 2 * i));
  writeFileSync(file, data);
}
const a = measure(web), b = measure(native);
const target = Math.min(a.rms, b.rms);
writeWav(join(out, 'native4-A-web.wav'), web, target / a.rms);
writeWav(join(out, 'native4-B-native.wav'), native, target / b.rms);
writeFileSync(join(out, 'native4.html'), `<!doctype html><meta charset="utf-8"><title>A/B: Web und nativ</title>
<h1>Schritt 4: derselbe Song aus Web-Version (A) und nativer Engine (B)</h1>
<p>Gleich laut gestellt (RMS). Nur Schlagzeug und Bass.</p>
<p>A, Web: <audio controls src="native4-A-web.wav"></audio></p>
<p>B, nativ: <audio controls src="native4-B-native.wav"></audio></p>\n`);
delete a.rms; delete b.rms;
console.log(JSON.stringify({ web: a, native: b, matchedBy: +(20 * Math.log10(Math.max(a.rmsDb > b.rmsDb ? 10 ** ((b.rmsDb - a.rmsDb) / 20) : 10 ** ((a.rmsDb - b.rmsDb) / 20), 1e-9))).toFixed(1), files: join(out, 'native4.html') }, null, 2));
