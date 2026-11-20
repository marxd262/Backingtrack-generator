// Sound comparison: renders the same tracks with the web app and with the native core and checks level, octave bands and envelope.
//   node native/tools/sound-compare.mjs <cases.json> [output folder]   (default folder: .superpowers/audio-ab/compare)
//   node native/tools/sound-compare.mjs --self-check                  (the measuring itself: must pass, and must catch -2 dB and a treble tilt)
// cases.json: array of { name, track, sound?, tuning?, dry?, limiter?, tail?, kind?, peakBelow? }
//   track  path to a track JSON (relative to cases.json) or the track object
//   sound  timbre overrides like track.timbre ({ master: { brightness: 0.3 } }), laid over the track's own; both renders read the result
//          (the web render resolves it in the browser, the native one gets resolveTrackTimbre(track) as btg_render --sound, as play.js sends it)
//   tuning fine values as setTuning takes them ({ 'mix/room': { wet: 0 } }), given to both renders (btg_render --tuning)
//   dry    no limiter, master.reverb 0, master.echo 0, mix/room wet 0, on both sides
//   limiter  default true; dry turns it off (false: both renders without the limiter, the native one as btg_render --dry)
//   tail   seconds the renders ring past the song, both sides, default 0.2
//   kind   "sample" (default) or "synth": chooses the limits
//   peakBelow  a bound in dBFS for the native render's own largest sample (not relative to the web render; judged whatever the limiter): the
//          case FAILs, with the figure, when that peak is not below it (the plan's "below full scale": 0)
// Exit code 1 if a case fails (also one that cannot render, or whose renders differ in length by more than 50 ms).
// balance = (right minus left level of the native render) minus (the same of the web render); limit as the level limit.
// stereo = L/R correlation of each render: printed on every line, never judged; it shows a chorus (a mono layer: 1.000, chorus 1: about 0.83).
// diff = power of (native - web) over the power of web, dB: printed below every case, never judged and no part of the verdict. It is the
// sample-by-sample disagreement of the two renders and is dominated by the dry voices' own: with every effect off it already lies at about
// -31 dB (the bass) to about -3 dB (the lead guitar); the voices are matched by level, bands and envelope, not by waveform. It
// can show an effect that is missing where that floor is low (a bass without its vibrato: +3.4 dB against -31 dB with it), never where it is
// high, and never say that an effect that is there is right; the chains are judged sample by sample in fx-compare.mjs.
// peak = the native render's largest sample minus the web render's, in dB; printed on every line, judged (+-1 dB, the plan's limit for the
// full mix) only for cases rendered with the limiter.
// The listening files (<name>-web.wav, <name>-nativ.wav, 16 bit) of a pair above full scale are turned down by one common gain;
// the measurement uses the unscaled floats. A run of cases ends with the A/B page index.html in the output folder (ab-page.mjs).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fft, renderWeb, wavBytes } from './web-render.mjs';
import { writeAbPage } from './ab-page.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { resolveTrackTimbre } = await import(pathToFileURL(join(repo, 'src/core/timbre.js')).href);
const RATE = 48000;
const BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const LIMITS = { sample: { level: 0.5, band: 1.5, env: 0.98, peak: 1 }, synth: { level: 1, band: 3, env: 0.95, peak: 1 } };
const UNJUDGED_DB = -70; // a band below this (relative to the web render's full band) in both renders is not judged
const WINDOW = 0.05; // envelope window in seconds
const MAX_LENGTH_GAP = 0.05; // seconds the two renders may differ in length
const SILENT = 1e-12; // mean square of a channel below which it counts as silent

const db = (x) => 10 * Math.log10(Math.max(x, 1e-30)); // of a power
const signed = (x) => (x < 0 ? '' : '+') + x.toFixed(2);

function readWav(file) {
  const wav = readFileSync(file);
  let format, bits, at = 12;
  for (; at + 8 <= wav.length; at += 8 + wav.readUInt32LE(at + 4) + (wav.readUInt32LE(at + 4) & 1)) {
    const id = wav.toString('latin1', at, at + 4), size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') { format = wav.readUInt16LE(at + 8); bits = wav.readUInt16LE(at + 22); if (wav.readUInt16LE(at + 10) !== 2 || wav.readUInt32LE(at + 12) !== RATE) throw new Error(`${file}: not stereo ${RATE} Hz`); }
    if (id === 'data') {
      const data = wav.subarray(at + 8, at + 8 + size);
      if (format === 3 && bits === 32) return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + size));
      if (format === 1 && bits === 16) return Float32Array.from({ length: size / 2 }, (_, i) => data.readInt16LE(2 * i) / 32768);
      throw new Error(`${file}: unsupported WAV format ${format}/${bits}`);
    }
  }
  throw new Error(`${file}: no data chunk`);
}

// Power in the eight octave bands (edges at centre / sqrt 2 and centre * sqrt 2, both channels summed) and in the full band.
// One FFT of the whole signal: left in the real part, right in the imaginary part; |XL|^2 + |XR|^2 = (|Z[k]|^2 + |Z[N-k]|^2) / 2.
function bandPower(x) {
  const frames = x.length / 2;
  let n = 1;
  while (n < frames) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < frames; i++) { re[i] = x[2 * i]; im[i] = x[2 * i + 1]; }
  fft(re, im);
  const bands = BANDS.map(() => 0);
  let total = 0;
  for (let k = 0; k <= n / 2; k++) {
    const m = (n - k) % n, p = (re[k] ** 2 + im[k] ** 2 + re[m] ** 2 + im[m] ** 2) / 2, hz = k * RATE / n;
    total += p;
    const band = BANDS.findIndex((c) => hz >= c / Math.SQRT2 && hz < c * Math.SQRT2);
    if (band >= 0) bands[band] += p;
  }
  return { bands, total };
}

const meanSquare = (x) => x.reduce((s, v) => s + v * v, 0) / x.length;

function envelope(x) {
  const size = Math.round(WINDOW * RATE) * 2, out = [];
  for (let i = 0; i + size <= x.length; i += size) out.push(Math.sqrt(meanSquare(x.subarray(i, i + size))));
  return out;
}

function pearson(a, b) {
  const mean = (s) => s.reduce((p, v) => p + v, 0) / s.length, ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  a.forEach((v, i) => { ab += (v - ma) * (b[i] - mb); aa += (v - ma) ** 2; bb += (b[i] - mb) ** 2; });
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

const power = (x, channel) => { let s = 0; for (let i = channel; i < x.length; i += 2) s += x[i] * x[i]; return s / (x.length / 2); };
// every limit check is written `!(x <= limit)` so that a NaN fails it on its own
const over = (x, limit) => !(Math.abs(x) <= limit);

const peakOf = (x) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; }; // a NaN stays NaN
const peakDb = (x) => 20 * Math.log10(Math.max(peakOf(x), 1e-15)); // Math.max keeps the NaN

// both over the length of the shorter one (a length difference above MAX_LENGTH_GAP fails); differences are native minus web
function measure(web, native, kind = 'sample', judgePeak = false, peakBelow = null) {
  const limit = LIMITS[kind];
  if (!limit) throw new Error(`unknown kind: ${kind}`);
  const seconds = [web.length / 2 / RATE, native.length / 2 / RATE];
  const n = Math.min(web.length, native.length) & ~1;
  const w = web.subarray(0, n), v = native.subarray(0, n);
  const level = db(meanSquare(v)) - db(meanSquare(w));
  // balance: right minus left of the native render, less the same of the web render; not judged when a channel is silent in both
  const [wl, wr, nl, nr] = [power(w, 0), power(w, 1), power(v, 0), power(v, 1)];
  const balance = (wl < SILENT && nl < SILENT) || (wr < SILENT && nr < SILENT) ? null : (db(nr) - db(nl)) - (db(wr) - db(wl));
  const bw = bandPower(w), bn = bandPower(v);
  const bands = BANDS.map((_, i) => {
    const a = db(bw.bands[i] / bw.total), b = db(bn.bands[i] / bw.total);
    return a < UNJUDGED_DB && b < UNJUDGED_DB ? null : b - a;
  });
  let worst = -1;
  const size = (d) => (Number.isNaN(d) ? Infinity : Math.abs(d)); // a NaN band is the worst one
  bands.forEach((d, i) => { if (d !== null && (worst < 0 || size(d) > size(bands[worst]))) worst = i; });
  const env = pearson(envelope(w), envelope(v));
  const peaks = [peakDb(w), peakDb(v)], peak = peaks[1] - peaks[0];
  // printed, not judged (phase-4-design.md 6.2): diff = power of (native - web) over that of web; stereo = L/R correlation of each render
  let dd = 0, ww = 0;
  const s = [0, 0, 0, 0, 0, 0]; // web LL, RR, LR, native LL, RR, LR
  for (let i = 0; i < n; i += 2) {
    const a = w[i], b = w[i + 1], c = v[i], d = v[i + 1];
    dd += (c - a) ** 2 + (d - b) ** 2; ww += a * a + b * b;
    s[0] += a * a; s[1] += b * b; s[2] += a * b; s[3] += c * c; s[4] += d * d; s[5] += c * d;
  }
  const diff = dd === 0 ? -Infinity : db(dd / ww), stereo = [s[2] / Math.sqrt(s[0] * s[1]), s[5] / Math.sqrt(s[3] * s[4])];
  const failed = {
    level: over(level, limit.level), balance: balance !== null && over(balance, limit.level), bands: bands.some((d) => d !== null && over(d, limit.band)),
    envelope: !(env >= limit.env), length: !(Math.abs(seconds[0] - seconds[1]) <= MAX_LENGTH_GAP), peak: judgePeak && over(peak, limit.peak),
    peakBelow: peakBelow !== null && !(peaks[1] < peakBelow), // a NaN fails
  };
  return { level, balance, peak, peaks, peakBelow, diff, stereo, bands, bandMax: worst >= 0 ? bands[worst] : null, bandHz: worst >= 0 ? BANDS[worst] : null, env, seconds, failed, pass: !Object.values(failed).some(Boolean) };
}

function line(name, m) {
  const max = m.bandMax === null ? '-' : signed(m.bandMax), at = m.bandHz ?? '-', balance = m.balance === null ? '-' : signed(m.balance);
  const length = m.failed.length ? `  LENGTH web ${m.seconds[0].toFixed(2)} s, native ${m.seconds[1].toFixed(2)} s` : '';
  const peak = `peak ${signed(m.peak)} dB (web ${signed(m.peaks[0])}, native ${signed(m.peaks[1])} dBFS)${m.peakBelow === null ? '' : m.failed.peakBelow ? `  NATIVE PEAK ${signed(m.peaks[1])} dBFS NOT BELOW ${m.peakBelow}` : ` (native below ${m.peakBelow})`}`;
  let text = `${name}  level ${signed(m.level)} dB  balance ${balance} dB  ${peak}  bands max ${max} dB at ${at}  envelope ${m.env.toFixed(3)}  stereo web ${m.stereo[0].toFixed(3)} native ${m.stereo[1].toFixed(3)}${length}  ${m.pass ? 'PASS' : 'FAIL'}`;
  text += `\n    diff ${Number.isFinite(m.diff) ? m.diff.toFixed(1) : m.diff} dB (not judged)`; // below the verdict: it is no part of it
  if (!m.pass) text += `\n    failed: ${Object.keys(m.failed).filter((k) => m.failed[k]).join(', ')}\n    bands ${BANDS.map((hz, i) => `${hz}: ${m.bands[i] === null ? '-' : signed(m.bands[i])}`).join('  ')}`;
  return text;
}

// --- rendering ---
const lay = (base, over) => ({ ...base, ...Object.fromEntries(Object.entries(over ?? {}).map(([group, fields]) => [group, { ...base?.[group], ...fields }])) });

function prepareCase(c, baseDir) {
  if (!/^[\w.-]+$/.test(c.name ?? '')) throw new Error(`bad case name: ${JSON.stringify(c.name)}`);
  const track = typeof c.track === 'string' ? JSON.parse(readFileSync(resolve(baseDir, c.track), 'utf8')) : structuredClone(c.track);
  let timbre = lay(track.timbre, c.sound);
  if (c.dry) timbre = lay(timbre, { master: { reverb: 0, echo: 0 } });
  if (c.sound || c.dry) track.timbre = timbre;
  const tuning = c.dry ? lay(c.tuning, { 'mix/room': { wet: 0 } }) : c.tuning;
  const limiter = c.dry ? false : c.limiter !== false;
  if (c.peakBelow !== undefined && !Number.isFinite(c.peakBelow)) throw new Error(`bad peakBelow: ${JSON.stringify(c.peakBelow)}`);
  return { name: c.name, kind: c.kind ?? 'sample', dry: !!c.dry, limiter, peakBelow: c.peakBelow ?? null, track, options: { tuning, limiter: limiter ? undefined : false, tail: c.tail ?? 0.2 } };
}

// One case after the other, each in its own browser, so that a case that cannot render costs only itself. Throws with the reason.
async function renderCase(c) {
  const render = ['native/build/core/Release/btg_render.exe', 'native/build/core/btg_render'].map((p) => join(repo, p)).find(existsSync);
  if (!render) throw new Error('btg_render not built (native/build.ps1)');
  const [web] = await renderWeb(repo, [c.track], RATE, [], [c.options]);
  const temp = mkdtempSync(join(tmpdir(), 'btg-compare-'));
  try {
    const trackFile = join(temp, `${c.name}.json`), wavFile = join(temp, `${c.name}.wav`);
    writeFileSync(trackFile, JSON.stringify(c.track));
    const tuningFile = join(temp, `${c.name}-tuning.json`), soundFile = join(temp, `${c.name}-sound.json`);
    if (c.options.tuning) writeFileSync(tuningFile, JSON.stringify(c.options.tuning));
    writeFileSync(soundFile, JSON.stringify(resolveTrackTimbre(c.track))); // what play.js sends; web-render.mjs resolves the same in the browser
    try {
      execFileSync(render, [trackFile, join(repo, 'src/assets/samples'), wavFile, String(RATE), '--tail', String(c.options.tail), ...(!c.limiter ? ['--dry'] : []), '--sound', soundFile, ...(c.options.tuning ? ['--tuning', tuningFile] : [])], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) { // btg_render says why on stdout (also on its legitimate exit 1 for a silent render)
      throw new Error(`btg_render: ${[error.stdout, error.stderr].filter(Boolean).join(' ').trim() || error.message}`);
    }
    return { web, native: readWav(wavFile) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

// The listening files of a pair. When a render goes above full scale, both get one common gain that puts the larger peak at 0.98,
// so that neither clips and the two stay comparable; a pair inside full scale is written unchanged. Returns the gain.
function writePair(out, name, web, native) {
  let peak = 0;
  for (const x of [web, native]) for (const v of x) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 1 ? 0.98 / peak : 1;
  writeFileSync(join(out, `${name}-web.wav`), wavBytes(web, RATE, gain));
  writeFileSync(join(out, `${name}-nativ.wav`), wavBytes(native, RATE, gain));
  return gain;
}
const turnedDown = (gain, dry) => `    listening files turned down by ${(-20 * Math.log10(gain)).toFixed(1)} dB (${dry ? 'dry sum' : 'render'} above full scale)`;

// Renders, writes the WAVs, measures and prints one line per case; a case that fails to render prints RENDER FAILED and counts as failed.
async function runCases(raw, baseDir, out) {
  const results = [];
  for (const [i, entry] of raw.entries()) {
    const name = entry?.name ?? `case-${i}`;
    try {
      const c = prepareCase(entry, baseDir);
      const { web, native } = await renderCase(c);
      const gain = writePair(out, c.name, web, native);
      const m = measure(web, native, c.kind, c.limiter, c.peakBelow);
      console.log(line(c.name, m));
      if (gain < 1) console.log(turnedDown(gain, c.dry));
      results.push({ name, m });
    } catch (error) {
      const reason = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 400);
      console.log(`${name}  RENDER FAILED: ${reason}  FAIL`);
      results.push({ name, error: reason });
    }
  }
  return results;
}

// --- self check: the measuring has to see a quieter bass and a dull or bright top end ---
function tilt(x, hz, gainDb) { // RBJ high shelf, slope 1
  const A = 10 ** (gainDb / 40), w = 2 * Math.PI * hz / RATE, cos = Math.cos(w), alpha = Math.sin(w) / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * alpha;
  const a0 = (A + 1) - (A - 1) * cos + s;
  const b = [A * ((A + 1) + (A - 1) * cos + s), -2 * A * ((A - 1) + (A + 1) * cos), A * ((A + 1) + (A - 1) * cos - s)].map((v) => v / a0);
  const a = [2 * ((A - 1) - (A + 1) * cos) / a0, ((A + 1) - (A - 1) * cos - s) / a0];
  const out = new Float32Array(x.length);
  for (let c = 0; c < 2; c++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = c; i < x.length; i += 2) {
      const y = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      [x2, x1, y2, y1] = [x1, x[i], y1, y]; out[i] = y;
    }
  }
  return out;
}

async function selfCheck(out) {
  const c = prepareCase({ name: 'selfcheck-funk', track: join(repo, 'native/core/tests/track-funk.json'), dry: true }, repo);
  const { web, native } = await renderCase(c);
  writePair(out, c.name, web, native);
  let top = 0, topAt = 0; // the native render's largest sample, raised by 1.5 dB: only the peak notices (judged here as for a case with the limiter)
  native.forEach((v, i) => { if (Math.abs(v) > top) { top = Math.abs(v); topAt = i; } });
  const raised = native.map((v, i) => (i === topAt ? v * 10 ** (1.5 / 20) : v));
  const checks = [
    ['as it is', native, 'must PASS', (m) => m.pass],
    ['web against itself', web, 'must give diff -Infinity and equal stereo figures', (m) => m.diff === -Infinity && m.stereo[0] === m.stereo[1]],
    ['native 2 dB quieter', native.map((v) => v * 10 ** (-2 / 20)), 'must FAIL on level', (m) => m.failed.level],
    ['native +3 dB above 2 kHz', tilt(native, 2000, 3), 'must FAIL on bands', (m) => m.failed.bands],
    ['native 1 s short', native.subarray(0, native.length - 2 * RATE), 'must FAIL on length', (m) => m.failed.length],
    ['native left -2 dB, right +2 dB', native.map((v, i) => v * 10 ** ((i % 2 ? 2 : -2) / 20)), 'must FAIL on balance', (m) => m.failed.balance],
    ['native with a NaN', native.map((v, i) => (i === 1000 ? NaN : v)), 'must FAIL on level, balance and bands', (m) => m.failed.level && m.failed.balance && m.failed.bands],
    ['native peak +1.5 dB (its largest sample)', raised, 'must FAIL on peak', (m) => m.failed.peak, true],
    ['native peak 0.1 dB above its bound (peakBelow)', native, 'must FAIL on peakBelow', (m) => m.failed.peakBelow && !m.pass && !Object.entries(m.failed).some(([k, v]) => v && k !== 'peakBelow'), false, peakDb(native) - 0.1],
    ['native peak 0.1 dB below its bound (peakBelow)', native, 'must PASS', (m) => m.pass && m.peakBelow !== null, false, peakDb(native) + 0.1],
  ];
  let ok = true;
  for (const [what, samples, want, good, judgePeak = false, peakBelow = null] of checks) {
    const m = measure(web, samples, c.kind, judgePeak, peakBelow);
    console.log(line(`${c.name} (${what})`, m));
    console.log(`  ${good(m) ? 'ok' : 'WRONG'}: ${want}`);
    ok &&= good(m);
  }
  // listening files of a pair above full scale (the funk pair raised to a peak of 2, native 1 dB below web): one common gain,
  // nothing clips, the level difference of the files is that of the floats
  const loud = mkdtempSync(join(tmpdir(), 'btg-listen-'));
  try {
    const top = native.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
    const [w, n] = [web, native].map((x, i) => x.map((v) => v * (2 / top) * (i ? 10 ** (-1 / 20) : 1)));
    const gain = writePair(loud, 'loud', w, n);
    const [fw, fn] = ['web', 'nativ'].map((side) => readWav(join(loud, `loud-${side}.wav`)));
    const inside = [fw, fn].every((x) => x.every((v) => Math.abs(v) < 32767 / 32768));
    const gap = (db(meanSquare(fn)) - db(meanSquare(fw))) - (db(meanSquare(n)) - db(meanSquare(w)));
    const listen = gain < 1 && inside && Math.abs(gap) <= 0.01;
    console.log(`listening files of a pair above full scale\n${turnedDown(gain, true)}; level difference of the files minus that of the floats ${signed(gap)} dB, ${inside ? 'nothing clips' : 'CLIPS'}`);
    console.log(`  ${listen ? 'ok' : 'WRONG'}: must turn both down by one gain, clip nothing and keep the level difference within 0.01 dB`);
    ok &&= listen;
  } finally {
    rmSync(loud, { recursive: true, force: true });
  }
  // a case that cannot render (a file that is no track) must not take the next one with it
  console.log('two cases, the first cannot render:');
  const broken = join(out, 'selfcheck-broken.json');
  writeFileSync(broken, '{ "not": "a track" }');
  const results = await runCases([{ name: 'selfcheck-broken', track: broken }, { name: c.name, track: join(repo, 'native/core/tests/track-funk.json'), dry: true }], repo, out);
  const good = results[0].error && results[1].m?.pass && results.filter((r) => !r.m?.pass).length === 1;
  console.log(`  ${good ? 'ok' : 'WRONG'}: must print RENDER FAILED for the first, measure the second, one failed case`);
  // a case's tuning reaches both renders: the bass alone, its voice's level 4 -> 2 is -6.02 dB on both sides, so the case still passes
  // and the native render is 6.02 dB (within 0.1) quieter than the same case without the tuning
  const bassTrack = JSON.parse(readFileSync(join(repo, 'native/core/tests/track-funk.json'), 'utf8'));
  bassTrack.layers.drums = false;
  const bass = (name, tuning) => prepareCase({ name, track: bassTrack, dry: true, tuning }, repo);
  const plain = await renderCase(bass('selfcheck-bass', undefined));
  const tuned = bass('selfcheck-bass-tuned', { 'bass/sample/finger': { level: 2 } });
  const quieter = await renderCase(tuned);
  const m = measure(quieter.web, quieter.native, tuned.kind);
  const drop = db(meanSquare(quieter.native)) - db(meanSquare(plain.native));
  const reaches = m.pass && Math.abs(drop + 6.02) <= 0.1;
  console.log(line(tuned.name, m));
  console.log(`  native level with the tuning minus without: ${signed(drop)} dB (expected -6.02)
  ${reaches ? 'ok' : 'WRONG'}: tuning must reach both renders: the case passes, the native render is 6.02 dB quieter`);
  // an empty set of cases is no pass: the run exits 1 and says so
  const empty = join(out, 'selfcheck-empty.json');
  writeFileSync(empty, '[]');
  const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), empty, out], { encoding: 'utf8' });
  const none = run.status === 1 && /no cases/.test(run.stdout);
  console.log(`an empty set of cases: exit ${run.status}, "${run.stdout.trim()}"
  ${none ? 'ok' : 'WRONG'}: must exit 1 and say there were no cases`);
  return ok && !!good && reaches && none;
}

// --- main ---
const args = process.argv.slice(2).filter((a) => a !== '--self-check');
const self = process.argv.includes('--self-check');
const casesFile = self ? null : args[0];
if (!self && !casesFile) { console.log('usage: sound-compare.mjs <cases.json> [output folder] | --self-check'); process.exit(2); }
const out = resolve(args[self ? 0 : 1] ?? join(repo, '.superpowers/audio-ab/compare'));
mkdirSync(out, { recursive: true });

if (self) process.exit(await selfCheck(out) ? 0 : 1);

const baseDir = dirname(resolve(casesFile));
const cases = JSON.parse(readFileSync(resolve(casesFile), 'utf8'));
if (!Array.isArray(cases) || cases.length === 0) { console.log(`${casesFile}: no cases, nothing was checked  FAIL`); process.exit(1); } // a gate must not pass on nothing
const results = await runCases(cases, baseDir, out);
if (results.some((r) => r.m)) console.log(`A/B page: ${writeAbPage(out).page}`);
process.exit(results.every((r) => r.m?.pass) ? 0 : 1);
