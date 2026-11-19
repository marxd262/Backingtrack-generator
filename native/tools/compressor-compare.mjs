// The core's compressor (native/core/src/compressor.cpp) against Chromium's DynamicsCompressorNode, sample by sample:
//   node native/tools/compressor-compare.mjs    -> one line per parameter set; exit code 1 when one differs by more than LIMIT
// The test signal is made here (noise and a sine at levels from -60 to +6 dBFS); Playwright's Chromium renders it through the node
// (OfflineAudioContext on about:blank: buffer source -> DynamicsCompressorNode -> destination), btg_compressor through the core.
// Every line says where the largest difference lies (seconds into the signal and the segment's level), so that a difference above the
// limit can be traced to its statement.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LIMIT = 1e-4; // largest difference of one sample (estimate: both compute in float, each with its own libm)
const LIMIT_WINDOWS = 0.01; // dB, of 10 ms windows
// name, rate, threshold, knee, ratio, attack, release: the glue and the limiter of synth.js (mix/bus), the old limiter (mix/bus on 0),
// the browser's defaults (with a knee)
const SETS = [['glue', 48000, -14, 0, 2, 0.03, 0.25], ['limiter', 48000, -2, 0, 20, 0.001, 0.1], ['old limiter', 48000, -10, 0, 20, 0.001, 0.1],
  ['browser defaults', 48000, -24, 30, 12, 0.003, 0.25], ['limiter 44.1 kHz', 44100, -2, 0, 20, 0.001, 0.1], ['limiter 96 kHz', 96000, -2, 0, 20, 0.001, 0.1]];
const SEGMENTS = [[0.3, -40], [0.4, -6], [0.3, 0], [0.2, 6], [0.5, -20], [0.5, -3, true], [0.3, -60], [0.5, -10]];

function signal(rate) { // stereo interleaved: [seconds, dBFS, sine?] one after the other; the right channel is other noise, 4.4 dB lower
  let seed = 1;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const out = [], starts = [];
  for (const [seconds, db, sine] of SEGMENTS) {
    const a = 10 ** (db / 20);
    starts.push(out.length / 2);
    for (let i = 0; i < Math.round(seconds * rate); i++) out.push(sine ? a * Math.sin((2 * Math.PI * 220 * i) / rate) : a * noise(), 0.6 * a * noise());
  }
  return { samples: Float32Array.from(out), starts };
}

// the same signal through Chromium's node
async function renderWeb(page, samples, rate, [threshold, knee, ratio, attack, release]) {
  const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const base64 = await page.evaluate(async ([input, r, params]) => {
    const raw = Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
    const both = new Float32Array(raw.buffer);
    const frames = both.length / 2;
    const ctx = new OfflineAudioContext(2, frames, r);
    const buffer = ctx.createBuffer(2, frames, r);
    for (let c = 0; c < 2; c++) buffer.copyToChannel(both.filter((_, i) => i % 2 === c), c);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const node = ctx.createDynamicsCompressor();
    for (const [name, value] of Object.entries(params)) node[name].value = value;
    source.connect(node).connect(ctx.destination);
    source.start(0);
    const rendered = await ctx.startRendering();
    const out = new Float32Array(frames * 2);
    for (let c = 0; c < 2; c++) rendered.getChannelData(c).forEach((v, i) => { out[2 * i + c] = v; });
    const outBytes = new Uint8Array(out.buffer);
    let text = '';
    for (let i = 0; i < outBytes.length; i += 0x8000) text += String.fromCharCode(...outBytes.subarray(i, i + 0x8000));
    return btoa(text);
  }, [bytes.toString('base64'), rate, { threshold, knee, ratio, attack, release }]);
  const raw = Buffer.from(base64, 'base64');
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

const exe = ['native/build/core/Release/btg_compressor.exe', 'native/build/core/btg_compressor'].map((p) => join(repo, p)).find(existsSync);
if (!exe) { console.log('btg_compressor not built (native/build.ps1)'); process.exit(1); }
const temp = mkdtempSync(join(tmpdir(), 'btg-compressor-'));
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  for (const [name, rate, threshold, knee, ratio, attack, release] of SETS) {
    const { samples, starts } = signal(rate);
    const web = await renderWeb(page, samples, rate, [threshold, knee, ratio, attack, release]);
    const input = join(temp, 'in.f32'), output = join(temp, 'out.f32');
    writeFileSync(input, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    execFileSync(exe, [input, output, String(rate), String(threshold), String(knee), String(ratio), String(attack), String(release)], { encoding: 'utf8', stdio: 'pipe' });
    const raw = readFileSync(output);
    const core = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    let largest = 0, at = 0;
    if (core.length !== web.length) largest = Infinity;
    else for (let i = 0; i < web.length; i++) { const d = Math.abs(web[i] - core[i]); if (!(d <= largest)) { largest = d; at = i; } } // a NaN is the largest
    // the level of 10 ms windows (both channels) above -80 dBFS
    let windows = 0;
    const size = Math.round(0.01 * rate);
    for (let from = 0; from + size <= web.length / 2; from += size) {
      let a = 0, b = 0;
      for (let i = 2 * from; i < 2 * (from + size); i++) { a += web[i] * web[i]; b += core[i] * core[i]; }
      const la = 10 * Math.log10(a / (2 * size)), lb = 10 * Math.log10(b / (2 * size));
      if (la > -80) windows = Math.max(windows, Math.abs(la - lb));
    }
    const frame = at >> 1, segment = starts.findLastIndex((s) => s <= frame), [, db, sine] = SEGMENTS[segment];
    const pass = largest <= LIMIT && windows <= LIMIT_WINDOWS;
    failed ||= !pass;
    console.log(`${name}  max difference ${largest.toExponential(1)}  windows ${windows.toFixed(4)} dB  at ${(frame / rate).toFixed(3)} s (${sine ? 'sine' : 'noise'} ${db} dBFS, channel ${at & 1 ? 'right' : 'left'}, web ${web[at].toExponential(3)} core ${core[at].toExponential(3)})  ${pass ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
