// The building blocks of the core's synth voices (native/core/src/osc.cpp, param.cpp, patch.cpp; Task 20a) against Chromium, sample by sample:
//   node native/tools/voice-compare.mjs [--none] [--only=<part of a name>]   -> one line per set; exit code 1 when a set fails
// Each set is rendered by an OfflineAudioContext on a page served from src/ (the same graph written in the page's JavaScript) and by btg_fx
// (osc, param, graph: the graph built with SynthTone's calls), both channels compared. A set passes when the power of the difference is at
// most -60 dB of the power of the web's render (ruling 6; the bar was set before measuring). Printed per set: that figure, the largest sample
// difference, its frame and channel. --none: the core side is zeros (every set must fail, at 0 dB).
//
// What each kind proves:
//   osc: a SynthTone with one oscillator node against an OscillatorNode. Each of these makes a set fail when it is taken out (the mutation
//     runs of Task 20a): the culling of the band-limited tables per range (the 3 520 Hz sets: an unculled table aliases above Nyquist), the
//     detune, the k-rate kernel's float read index (with the index in double the FM sets at a gain of 5000 and of 2640 fail, at -55.2 and
//     -57.2 dB; the other sets show it only in their figure, about -140 dB against -93 to -122 dB), the 5-point interpolation (the sine at
//     1 Hz), a custom wave's real coefficients and its normalisation, with and without disableNormalization (the two custom sets). The sets
//     also play the four types, the a-rate path (the kick's exponential 150 -> 46 Hz in 0.12 s), negative increments (FM through zero), the
//     3-point interpolation (2.5 Hz), the table size by rate (44.1 kHz: 4096, 96 kHz: 16384) and the start and stop frames.
//   param: Param::values against a ConstantSourceNode whose offset carries the automation: adsr (src/audio/nodes.js, called by the page), the
//     epiano's amp envelope (src/audio/voices/epiano.js 24 to 28, fixed numbers), each event kind alone (a first ramp starts from the intrinsic
//     value), a setTarget after a linear ramp, an a-rate input (the noise buffer) added to the intrinsic value.
//   graph: fixed small graphs fed with the noise buffer this tool makes (the same floats on both sides), each node kind in the core first here
//     and not through a voice: 1 noise -> lowpass whose frequency runs an exponential ramp -> a gain with adsr's envelope (coefficients per
//     frame while a param moves); 2 a looped buffer started at a fractional offset and ended by a duration (at rate 1 Chromium rounds the
//     offset to a frame and copies the frames); 3 noise -> bandpass -> gain and noise -> highpass -> gain, static; 4 two oscillators through
//     stereo panners at -0.6 and +0.6, summed (two channels); 5 a sine LFO through a gain into a lowpass's frequency, the lowpass on a sawtooth.
//
// Measured (Chromium 158, Task 20a round 1; 48 kHz unless said), diff and largest sample difference:
//   osc at a constant frequency (every type at 55, 440 and 3 520 Hz, the square at 8 300 Hz, detune +12 and -12 ct, 44.1 and 96 kHz): -139.5
//     to -142.2 dB, at most 4.2e-7. The core renders Chromium's k-rate vector kernel lane by lane, its read index in float
//     (cpu/x86/oscillator_kernel_sse2.cc; osc.cpp). What is left is the tables: an oscillator at 11.71875 Hz (an increment of exactly 1, the
//     crossfade 0) reads a table's entries one by one and differs by at most 3e-7 (sawtooth) and 4.2e-7 (square), the float rounding of the
//     core's transform in double against Chromium's in float. With the read index in double (the core before round 1) these sets measured
//     -93.1 (square 55 Hz, 8.1e-4 at its edge) to -121.7 dB.
//     FM through zero: -132.7 dB, at most 8.4e-7. With the read index in double: -69.2 dB, 6.0e-4 near the end of the set, because the
//     carrier integrates the modulator's error as phase (traced then: a 3 Hz modulator, below 0.3 and so Chromium's scalar path in double,
//     -100.1 dB; a depth of 100 instead of 660 -85.6 dB, linear in the depth). The two FM sets that hold the float index (the e-piano's
//     range of depths): a 440 Hz carrier and modulator through 5000 -109.9 dB (6.4e-6), 220 Hz by 330 Hz through 2640 -124.9 dB (1.5e-6);
//     with the index in double -55.2 and -57.2 dB.
//     The sine at 1 Hz (5-point) -141.6 dB, at 2.5 Hz (3-point) -141.2 dB; the custom wave -140.7 dB normalised and with disableNormalization.
//     The kick's ramp (a-rate): -118.2 dB, 3.4e-6; the a-rate kernel is not rebuilt (osc.cpp).
//     Chromium's first render quantum of an oscillator with an a-rate frequency: Process hands ProcessARate the increments of the quantum
//     from its frame 0 (oscillator_handler.cc 748 to 751) while the output begins at the oscillator's start inside the quantum, so its first
//     frames run at the frequency of the frames before its start (the param's intrinsic value; an FM carrier unmodulated). The core has no
//     quantum grid. Measured with the start 92 frames into a quantum (frame 1500, double index): the kick -51.9 dB, FM through zero +4.3 dB;
//     started on a quantum's first frame -118.2 and -69.2. So every osc set starts at 1536.
//     Setting a param's value from script schedules setValueAtTime(value, currentTime) (Chromium's audio_param.cc, setValue): an oscillator
//     playing in the context's first quantum runs the a-rate path in it (its index in double, not the float lanes). The osc sets start
//     later; graph 4 starts at frame 0 and shows it (below).
//   param: adsr -149.8 dB, the epiano's amp -147.0, linear -137.8, exponential -147.6, setTarget -104.2, setTarget after a linear ramp
//     -110.1 (the largest differences, 4.1e-5 and 3.2e-5, where a setTarget converges: the core tests each frame, Chromium each quantum),
//     the a-rate input bit-identical.
//   graph: 1 -132.9 dB; 2 bit-identical (the offset 12345.6 played from frame 12346); 3 -325.9 dB (denormal tails); 4 -134.7 dB, both
//     channels, at most 1.5e-5, all of it at the waves' edges in the first quantum (the a-rate first quantum above; an oscillator alone
//     started at frame 0: -134.7 dB, the same frames; started at 128: -140.1 dB); 5 -124.6 dB, 4.3e-6 (a lowpass moved by an LFO every
//     frame; not traced further).
//   --none: every set at 0.0 dB.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NONE = process.argv.includes('--none');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const BAR = -60; // dB: the power of (core - web) over the power of web
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

// Times in seconds as the page schedules them; the core gets time * rate (the same double Chromium multiplies) as frames. A source starts on
// a frame (ruling 9: Chromium starts one between frames with a phase offset, the core does not), and every oscillator on a render quantum's
// first frame, 1536 = 12 * 128 at every rate: there the core's blocks of 128 frames, counted from the oscillator's start, are Chromium's
// quanta (osc.cpp, the k-rate read index), and an a-rate oscillator's first quantum is whole (the head of this file).
const osc = (name, wave, hz, cents, extra = {}) => {
  const rate = extra.rate ?? 48000;
  return { name: `osc ${name}`, kind: 'osc', rate, wave, hz, cents, start: 1536 / rate, stop: Math.round(0.4375 * rate) / rate, seconds: 0.5, ...extra };
};
const OSC = [
  ...['sine', 'square', 'sawtooth', 'triangle'].flatMap((w) => [55, 440, 3520].map((hz) => osc(`${w} ${hz} Hz`, w, hz, 0))),
  osc('square 8300 Hz', 'square', 8300, 0),
  osc('sawtooth 440 Hz +12 ct', 'sawtooth', 440, 12), osc('sawtooth 440 Hz -12 ct', 'sawtooth', 440, -12),
  osc('sine 150 -> 46 Hz exponential in 0.12 s (a-rate, the kick)', 'sine', 150, 0, { exp: [46, (1536 + 5760) / 48000] }),
  osc('sine 220 Hz, FM through zero (a 330 Hz sine through a gain of 660)', 'sine', 220, 0, { fm: [330, 660] }),
  // the k-rate kernel's float read index: its error in the modulator, times a depth like the e-piano's, integrated by the carrier past the bar
  osc('sine 440 Hz, FM by a 440 Hz sine through a gain of 5000 (the float read index)', 'sine', 440, 0, { fm: [440, 5000] }),
  osc('sine 220 Hz, FM by a 330 Hz sine through a gain of 2640 (the float read index)', 'sine', 220, 0, { fm: [330, 2640] }),
  osc('sawtooth 440 Hz at 44.1 kHz', 'sawtooth', 440, 0, { rate: 44100 }), osc('sawtooth 440 Hz at 96 kHz', 'sawtooth', 440, 0, { rate: 96000 }),
  // the 5-point and the 3-point interpolation (increments below 0.16 and below 0.3: the pad's LFO)
  osc('sine 1 Hz (5-point interpolation)', 'sine', 1, 0), osc('sine 2.5 Hz (3-point interpolation)', 'sine', 2.5, 0),
  // createPeriodicWave with real and imaginary coefficients (the organ's way), normalised and with disableNormalization (a peak far from 1,
  // so that the two differ)
  ...[false, true].map((raw) => osc(`custom wave 220 Hz${raw ? ', disableNormalization' : ''}`, 'custom', 220, 0,
    { custom: { real: [0, 0.3, 0, 0.15, 0, 0.05], imag: [0, 0, 0.2, 0, 0.1, 0], raw } })),
];
// events: [kind, value, time, tc]; adsr: the arguments of nodes.js adsr after the param (t, a, peak, hold, rel), the page calls it
const param = (name, value, events, extra = {}) => ({ name: `param ${name}`, kind: 'param', rate: 48000, seconds: 1, value, events, ...extra });
const adsrEvents = ([t, a, peak, hold, rel]) => [['set', 0.0001, t], ['linear', peak, t + a], ['set', peak, t + a + hold], ['exp', 0.0001, t + a + hold + rel]]; // nodes.js 15 to 20
const EPIANO = { t: 0.03125, peak: 0.6, dur: 0.5, decay: 1.2, rel: 0.18 };
const PARAM = [
  param('adsr', 1, [], { adsr: [0.03125, 0.0078125, 0.8, 0.125, 0.25] }),
  param('epiano amp', 1, [['set', 0.0001, EPIANO.t], ['linear', EPIANO.peak, EPIANO.t + 0.003],
    ['exp', Math.max(0.0001, EPIANO.peak * Math.exp(-EPIANO.dur / EPIANO.decay)), EPIANO.t + EPIANO.dur], ['exp', 0.0001, EPIANO.t + EPIANO.dur + EPIANO.rel]]),
  // 2 ms of ramp in 5 ms: the ramp is most of the set's power, so the frame it begins at shows (one frame late: -45 dB, estimated)
  param('linear alone (from the intrinsic 0.2), 2 ms', 0.2, [['linear', 0.9, 0.002]], { seconds: 0.005 }),
  param('exponential alone (from the intrinsic 1)', 1, [['exp', 0.01, 0.25]]),
  param('setTarget alone', 1, [['target', 0.1, 0.0625, 0.025]]),
  param('setTarget after a linear ramp', 1, [['set', 0, 0.03125], ['linear', 1, 0.125], ['target', 0.3, 0.25, 0.05]]),
  param('a-rate input (the noise) added to 0.5', 0.5, [], { input: true }),
];
const graph = (n, name, seconds) => ({ name: `graph ${n}: ${name}`, kind: 'graph', rate: 48000, graph: n, seconds });
const GRAPH = [
  graph(1, 'noise -> lowpass with an exponential frequency ramp -> adsr gain', 1),
  graph(2, 'buffer at a fractional offset, looped, ended by a duration', 1.75),
  graph(3, 'noise -> bandpass -> gain and noise -> highpass -> gain, static', 0.875),
  graph(4, 'two oscillators -> stereo panners at -0.6 and +0.6, summed', 0.5625),
  graph(5, 'sine LFO -> gain -> lowpass frequency, the lowpass on a sawtooth', 0.875),
];
const SETS = [...OSC, ...PARAM, ...GRAPH];

function noise(rate) { // 1 s, mono, in [-0.5, 0.5)
  let seed = 1;
  return Float32Array.from({ length: rate }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return 0.5 * (seed / 2147483648 - 1); });
}

const f32 = (buffer) => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const b64 = (floats) => Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');

// in the page: one set through Chromium; both channels as base64
async function renderWeb(page, set, samples) {
  return page.evaluate(async ([set, input]) => {
    const toF32 = (text) => new Float32Array(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer);
    const toB64 = (floats) => {
      const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    };
    const { adsr } = await import('/audio/nodes.js');
    const r = set.rate, ctx = new OfflineAudioContext(2, Math.round(set.seconds * r), r), out = ctx.destination;
    const noise = ctx.createBuffer(1, r, r);
    noise.copyToChannel(toF32(input), 0);
    const source = (start, stop, offset = 0, duration) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      if (duration === undefined) { s.start(start, offset); s.stop(stop); } else s.start(start, offset, duration);
      return s;
    };
    const oscillator = (type, hz, start, stop) => {
      const o = ctx.createOscillator();
      if (type === 'custom') o.setPeriodicWave(ctx.createPeriodicWave(Float32Array.from(set.custom.real), Float32Array.from(set.custom.imag), { disableNormalization: set.custom.raw }));
      else o.type = type;
      o.frequency.value = hz;
      o.start(start);
      o.stop(stop);
      return o;
    };
    const gain = (value) => { const g = ctx.createGain(); g.gain.value = value; return g; };
    const filter = (type, hz, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    const panner = (pan) => { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
    if (set.kind === 'osc') {
      const o = oscillator(set.wave, set.hz, set.start, set.stop);
      o.detune.value = set.cents;
      if (set.exp) { o.frequency.setValueAtTime(set.hz, set.start); o.frequency.exponentialRampToValueAtTime(set.exp[0], set.exp[1]); }
      if (set.fm) oscillator('sine', set.fm[0], set.start, set.stop).connect(gain(set.fm[1])).connect(o.frequency);
      o.connect(out);
    } else if (set.kind === 'param') {
      const c = ctx.createConstantSource(), p = c.offset;
      p.value = set.value;
      for (const [kind, v, t, tc] of set.events) {
        if (kind === 'set') p.setValueAtTime(v, t);
        else if (kind === 'linear') p.linearRampToValueAtTime(v, t);
        else if (kind === 'exp') p.exponentialRampToValueAtTime(v, t);
        else p.setTargetAtTime(v, t, tc);
      }
      if (set.adsr) adsr({ gain: p }, ...set.adsr);
      if (set.input) source(0, 1).connect(p);
      c.connect(out);
      c.start(0);
    } else if (set.graph === 1) { // fx.cpp buildGraph: the same numbers
      const lp = filter('lowpass', 6000, 3), a = ctx.createGain();
      lp.frequency.setValueAtTime(6000, 0.0625);
      lp.frequency.exponentialRampToValueAtTime(200, 0.4375);
      adsr(a, 0.0625, 0.0078125, 0.8, 0.09375, 0.3125);
      source(0.0625, 0.75).connect(lp).connect(a).connect(out);
    } else if (set.graph === 2) {
      const s = source(0.03125, 0, 12345.6 / r, 1.5);
      s.loop = true;
      s.connect(out);
    } else if (set.graph === 3) {
      const s = source(0, 0.75);
      s.connect(filter('bandpass', 1800, 0.8)).connect(gain(0.7)).connect(out);
      s.connect(filter('highpass', 6000, 0.7)).connect(gain(0.4)).connect(out);
    } else if (set.graph === 4) {
      oscillator('sawtooth', 330, 0, 0.5).connect(panner(-0.6)).connect(out);
      oscillator('square', 495, 0, 0.5).connect(panner(0.6)).connect(out);
    } else if (set.graph === 5) {
      const lp = filter('lowpass', 2000, 6);
      oscillator('sine', 2.5, 0, 0.75).connect(gain(1500)).connect(lp.frequency);
      oscillator('sawtooth', 110, 0, 0.75).connect(lp).connect(out);
    }
    const rendered = await ctx.startRendering();
    return [toB64(rendered.getChannelData(0)), toB64(rendered.getChannelData(1))];
  }, [set, b64(samples)]);
}

// btg_fx's arguments after <in> <out> <rate>: times in frames, as time * rate
function coreArgs(set) {
  const r = set.rate, frames = String(Math.round(set.seconds * r));
  if (set.kind === 'osc') {
    return ['osc', frames, set.wave, String(set.hz), String(set.cents), String(set.start * r), String(set.stop * r),
      ...(set.exp ? ['--exp', String(set.exp[0]), String(set.exp[1] * r)] : []), ...(set.fm ? ['--fm', ...set.fm.map(String)] : []),
      ...(set.custom ? ['--custom', set.custom.real.join(','), set.custom.imag.join(','), set.custom.raw ? 'raw' : 'normalized'] : [])];
  }
  if (set.kind === 'param') {
    const events = set.adsr ? adsrEvents(set.adsr) : set.events;
    return ['param', frames, String(set.value), ...events.flatMap(([kind, v, t, tc]) => [kind, String(v), String(t * r), ...(kind === 'target' ? [String(tc * r)] : [])]),
      ...(set.input ? ['--input'] : [])];
  }
  return ['graph', frames, String(set.graph)];
}

const exe = ['native/build/core/Release/btg_fx.exe', 'native/build/core/btg_fx'].map((p) => join(repo, p)).find(existsSync);
if (!exe) { console.log('btg_fx not built (native/build.ps1)'); process.exit(1); }
const temp = mkdtempSync(join(tmpdir(), 'btg-voice-'));
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  await page.route('http://btg.local/**', (route) => {
    const file = join(repo, 'src', decodeURIComponent(new URL(route.request().url()).pathname));
    if (!file.startsWith(join(repo, 'src')) || !existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream' });
  });
  await page.goto('http://btg.local/ui/credits.html'); // any page of the origin, for the module imports
  for (const set of SETS) {
    if (ONLY && !set.name.includes(ONLY)) continue;
    const samples = noise(set.rate), input = join(temp, 'noise.f32'), output = join(temp, 'out.f32');
    const webs = (await renderWeb(page, set, samples)).map((c) => f32(Buffer.from(c, 'base64')));
    let cores = webs.map((w) => new Float32Array(w.length));
    if (!NONE) {
      writeFileSync(input, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
      execFileSync(exe, [input, output, String(set.rate), ...coreArgs(set)], { encoding: 'utf8', stdio: 'pipe' });
      const raw = f32(readFileSync(output));
      cores = [0, 1].map((c) => Float32Array.from({ length: raw.length / 2 }, (_, i) => raw[2 * i + c]));
    }
    let error = 0, power = 0, largest = 0, at = 0, side = 0;
    webs.forEach((web, c) => {
      const core = cores[c];
      if (core.length !== web.length) { error = NaN; return; }
      for (let i = 0; i < web.length; i++) {
        const d = core[i] - web[i];
        error += d * d;
        power += web[i] * web[i];
        if (!(Math.abs(d) <= largest)) { largest = Math.abs(d); at = i; side = c; } // a NaN is the largest
      }
    });
    const diff = 10 * Math.log10(error / power), pass = diff <= BAR; // error 0: -Infinity; NaN fails
    failed ||= !pass;
    const web = webs[side][at], core = cores[side]?.[at];
    console.log(`${set.name}  diff ${diff.toFixed(1)} dB  max difference ${largest.toExponential(1)} at frame ${at} ${side ? 'right' : 'left'}`
      + ` (web ${web?.toExponential(3)} core ${core?.toExponential(3)})  ${pass ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
