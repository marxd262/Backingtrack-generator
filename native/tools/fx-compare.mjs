// The core's layer effects (native/core/src/guitar_fx.cpp; Task 19: mod_fx.cpp) against the web app's chains in Chromium, sample by sample:
//   node native/tools/fx-compare.mjs [--none]   -> one line per set; exit code 1 when one differs by more than its limit
// --none: btg_fx copies its input (no effect): the red run, how far each set's effect lies from its limit.
// A test signal made here (mono; two channels in the stereo sets) goes through the browser (OfflineAudioContext(2, frames, rate) on a page served from src/: buffer source ->
// node or chain -> destination; a chain is built at frame 0 with { immediate: true } as createInstruments does) and through btg_fx.
// The limits of the guitar sets are measured (below); a difference above one is traced to its cause, never met by widening. How those of the
// mod and series sets were set is under "mod, series".
//
// The sets:
//   curves, shaper: the four curves of the live nodes against btg_fx curves; one WaveShaperNode against Shaper (identity curve, each curve).
//   guitar: createGuitarFx against GuitarFx, each layer and stage and all three, at 44.1 and 96 kHz.
//   "(2x exact)": the same sets with the two 4x shapers (distortion, fuzz) pinned to 2x on both sides (the page keeps the node's oversample at
//     '2x', btg_fx --two both). Everything but the 4x stages is then bit-identical to Chromium (measured: at most 2e-36, denormal tails), so
//     these sets hold it at 1e-6 per sample and 0.001 dB per 10 ms window: 100 times tighter than the guitar limit, leaving room for another
//     platform's libm (a coefficient one ulp away moves float roundings by 6e-8). The 4x stages differ because Chromium convolves their second
//     stage by FFT (SimpleFFTConvolver, up_sampler.cc 96) where the core convolves directly. What that costs, measured (Task 18, fix round 1):
//       - the stream into the fuzz shaper is bit-identical in the browser's chain and the core's; the shaper output differs by 8e-7 (bass
//         fuzz 0.3) and 1.3e-5 (chords fuzz 1), the core being the nearer to an exact double-precision convolution (7e-7 against 3.7e-6);
//       - the next node, the 35 Hz highpass in float state, integrates them: rounding differences of about 1e-6 between the two shaper
//         outputs, decorrelated, come out of a filter with poles at 0.9979 as about 2e-4 (a JavaScript copy of the filter reproduces the
//         browser's output from the browser's input bit for bit, and fed with the core's shaper output and the browser's gives 1.66e-4
//         apart); that is the residual at the chain's output, 1e-4 to 2e-4, in the sets with fuzz;
//       - the browser against itself, the same input moved by 1, 17, 40, 64, 77, 101 and 127 frames (the FFT's block phase), with the
//         deterministic part (the browser's and the core's time variance, equal) taken out: residual(k) - residual(0) is at most 2.7e-4 in a
//         sample and its 10 ms window levels move by up to, per kind of set (the largest of the sets measured):
//           fuzz (bass fuzz 1, bass and chords fuzz 0.3, pad fuzz 0.3):                 3.0e-4 and 0.0046 dB
//           distortion (bass 0.3 and 1, chords 0.3 and 1, lead 1, chords 0.3 at 96 kHz): 1.05e-4 (bass 0.3; chords 1.3e-5) and 0.0137 dB
//           all three (bass and chords 0.5 and 1, chords 0.5 at 96 kHz):                2.7e-4 and 0.0230 dB
//         the core against itself does not move that way. That is the size of the residual itself.
//     So the sets through a 4x stage (any fuzz or distortion knob above 0, at the start or in a change) take the browser's own spread of
//     their kind with a margin of 1.5: fuzz 4.5e-4 per sample and 0.007 dB per window, distortion 1.6e-4 and 0.021 dB, all three 4.2e-4 and
//     0.035 dB. Without fuzz and distortion (overdrive only, 2x) nothing is left to explain and the tight limit holds.
//   in time: the creation fade and the bias ramp on signal from frame 0 ("now"); the first loud chord 0.15 s after the build, as in the app
//     since the transport has a lead ("lead"; the browser's source starts at 0.15 s, so the chain's input is silent, nothing feeding it, until
//     then, the core is given the zeros); a chain built by set(..., false) while sound runs (the lazy fade); knobs changed in the middle of
//     a ramp; all knobs back to 0 (from then on the output is the dry signal, bit for bit, on both sides: "dry again"). The browser changes
//     the knobs between render quanta through ctx.suspend(t), set, resume; btg_fx does the same at that frame (--change <frame> f o d).
//   mod, series (Task 19): createModFx against ModFx, alone and behind a distortion chain (createGuitarFx into createModFx, set in that order);
//     both channels are compared. The chain is bit-identical to Chromium's; the browser's oscillator is not the core's sine. Evidence, the
//     "(ideal LFO)" twins: the page replaces every OscillatorNode of the chain by a buffer that holds what the core computes (float sine of the
//     phase that Chromium's float increment, float(f) * float(4096 / rate), accumulates in double), started when the node is. Every set with
//     constant LFO frequencies is then bit-identical to the core: max difference 0 (the series with 2x shapers: 1e-38, denormals) at 44.1,
//     48 and 96 kHz, for vibrato, chorus and both, built at frame 0, built while playing (lazy), in the lead (there the browser plays the
//     lead's zeros as samples: a source that is merely not started yet has another effect, below), in a ramp, and back to 0.
//     What the sets with the browser's own oscillators show is the browser's oscillator. A bare OscillatorNode (sine) against the core's LFO,
//     measured over 2 to 5 s (Chromium 158, fix round 1): below an increment of 0.3 table entries per frame (48 kHz: 3.4 Hz 3.0e-7, 3.5 Hz
//     3.0e-7) the difference is 3.0e-7 (the table's and its linear interpolation's own size, (2 pi / 4096)^2 / 8 = 2.9e-7); from 0.3 on
//     (3.52 Hz: 3.9e-6, 3.6 Hz: 2.2e-6) it is up to 6e-6 (less at some frequencies, measured by the review of the phase: 7e-7 at 44.1 kHz
//     and 4 Hz, 5e-7 at 10 Hz and 48 kHz), and the jump lies where oscillator_handler.cc 504 goes from the scalar loop to
//     ProcessKRateVector. The worst over 4 to 5.5 Hz in steps of 0.1 Hz (the vibrato): 5.98e-6 (44.1 kHz, at 4.3 Hz), 5.96e-6 (48 kHz, at
//     5.0 Hz), 5.62e-6 (96 kHz, at 4.7 Hz; there the increment in 4096 entries is below 0.3, and the browser's table is larger at that rate:
//     16384 entries above 88.2 kHz, periodic_wave_handler.cc 46 to 54, read in Task 20a); the chorus's 0.6 and 0.8 Hz: 3.0e-7 at every rate.
//     The error is the same every second and does not depend on the frame within a quantum. The vector kernel's x86 body,
//     cpu/x86/oscillator_kernel_sse2.cc (read in Task 20a), carries the read index in float within a render quantum: the first four frames'
//     indices as floats (118 to 125), then 4 * increment added and wrapped in float (186 to 188), the double index recomputed only at the
//     quantum's end (193 to 195). The wave table is worth the 3e-7 only; the 6e-6 are not the table's. Since Task 20a
//     Oscillator::constant (native/core/src/osc.cpp) has that kernel; ModFx's LFO does not, and its 6e-6 could be removed with it.
//     A delay time moves by depth * that (vibrato 36 to 45 frames * 6e-6 = 2.7e-4 frames; chorus 144 frames * 3e-7 = 4e-5). The delay reads in
//     float (delay_sse2.cc), and a move this small can flip the rounding of the read position by one step now and then; the step is 2^-12 =
//     2.4e-4 frames for the vibrato's position at 44.1 and 48 kHz (about 2336, between 2048 and 4096), 1.2e-4 for the chorus's (about 1664),
//     4.9e-4 at 96 kHz (about 4544). That is consistent with the measured sample differences, not measured on its own: a sample then differs
//     by up to (move + one step) times the signal's change per frame (0.52 at the sweep's top, 8 kHz at -6 dBFS: up to about 2.6e-4 for the
//     vibrato), and the largest differences lie on the sweep.
//     Measured differences of the sets with the browser's oscillators (48 kHz unless said):
//         vibrato (60, 100, 160 bpm): 1.8e-4, 1.9e-4, 1.9e-4, windows 0.0003 dB      chorus 0.3 and 1: 3.5e-5, 8.8e-5, windows 0.0001 dB
//         both 0.5: 1.8e-4 (44.1 kHz 2.4e-4, 96 kHz 2.1e-4); in time: from frame 0 1.2e-4, lead 2.0e-4, lazy 1.3e-4, ramps and tempo 1.1e-4,
//         vibrato then chorus 5.5e-5, then all 0 3.1e-6; windows 0.0003 dB at most
//     How the limits were set (not by the shifted-input procedure of Task 18): each is 1.5 times the largest measured difference of the sets
//     of its kind, rounded up: vibrato 3e-4 and 0.0005 dB, chorus 1.4e-4 and 0.0002 dB, both 3.6e-4 and 0.0005 dB. They are fitted to
//     those measurements. They stand for the browser's side of ruling H in substance because of the "(ideal LFO)" twins: the core equals the
//     browser's chain with an ideal LFO bit for bit, so a difference of a plain set is the browser's chain with its own oscillators against
//     its chain with an ideal LFO. A kind's limit is a ceiling for sets far below it: chorus 0.3 (3.5e-5 against 1.4e-4), "vibrato then
//     chorus" (5.5e-5) and "then all 0" (3.1e-6) against 3.6e-4. The two series sets are each 1.5 times their own measurement, chords all three
//     0.5 with both 0.5 (9.1e-5, 0.0013 dB, also the 4x stages' residual of the distortion chain) 1.4e-4 and 0.002 dB, bass overdrive 0.3
//     with vibrato 1 (3.6e-4, 0.0001 dB) 5.5e-4 and 0.0005 dB; that is not ruling H (no spread over shifted inputs was run, and the reason
//     for the bass's larger value, a larger change per frame behind the clipping overdrive, was not measured). The proof there is the
//     "(2x exact) (ideal LFO)" twins at 1e-6. What the twins cannot prove: that the page's LFO model equals Chromium's oscillator (the plain
//     sets bound it to the limits above), the vibrato's frequency ramp of a tempo change (the substitute ignores setTargetAtTime: that set has
//     no twin and is held only by its plain limit), and tempos and rates other than the sets' (60, 100, 160 bpm; 44.1, 48, 96 kHz).
//     The lead: in the app the song starts 0.15 s after the build and nothing feeds the chain until then. A browser source that has not
//     started propagates silence, and a delay node whose input is silent for longer than its tail (0.05 s) does not process: its write index
//     lags the frame count, the position's float rounding differs, and with the ideal LFO the set differs by 1.0e-4 (limit 1.5e-4 on that
//     twin); with real zeros played (the plain twin of "(ideal LFO)") it is 0, and with a constant source of 1e-10 feeding the chain from
//     frame 0 (its delays then process) 3e-8, the offset's own rounding. The core plays on, as the real app's voices do (zeros are not
//     silence to its engine).
//   stereo (Task 20b): the guitar, mod and series sets with an input of two channels that differ (the right one is the signal of the same
//     segments with its frequencies times 0.79 and another noise seed): Chromium then runs every node of a chain in two channels, and so
//     does the core (btg_fx --stereo 0); both channels are compared. Each set takes the limits of its mono kind above (guitar: the kind of its
//     knobs; mod: its kind; the series: those of its mono twin); none is set from these sets' own figures. Two things follow from what a
//     kind's limit is, and were ruled after a first run with a right channel at 1.26 times the frequencies had three sets above their kind's
//     limit (bass all 0.3: windows 0.0400 dB against 0.035; chorus 1: 1.8e-4 against 1.4e-4; the join: 3.7e-4 against 3.6e-4; each one's
//     twin exact):
//       - the other channels stay inside the band of the standard signal (the right channel's frequencies times 0.79, the join's second
//         source times 0.79 and 0.63). A kind's limits were measured over that band (the 4x kinds' as the browser's spread, the mod kinds'
//         fitted to their sets): above it the bass's cabinet leaves a window at -67 dBFS, where the 4x stages' residual of 1e-4 is no
//         longer small against the signal and the window measure reads the residual, not a level; and a mod set's difference grows with
//         the signal's change per frame at the sweep's top. The join is not covered by that argument: from its frame on each channel is
//         the standard signal plus a second one, up to twice the level and change per frame that any mono limit was measured on; it is
//         judged at the "both" limit times STEREO_COPY all the same (measured 3.0e-4 against 7.0e-4), its twin exact.
//       - a stereo set through the chorus takes its mono kind's limit per sample times STEREO_COPY = 1.945: a copy at pan -0.7 of a stereo
//         input keeps its left and adds its right at cos(0.3 pi / 2) = 0.891 (stereo_panner.cc 126 to 152), so what the browser's oscillator
//         moves in a copy reaches a side at up to 1.891 (with the other copy's share 2.345) where a mono input's copy has cos(0.15 pi / 2) =
//         0.972 (1.205). The factor is the formula's, not a measurement. Their window figure is printed and not judged: the first run with
//         this ruling kept the mono kind's window limit and had chorus 1 at 0.000248 dB against 0.0002 (mono chorus 1: 0.000066 dB). A
//         window's level does not follow the formula (the side's own level changes with the other side's share), so a limit could only
//         be fitted to that figure, and none is set; the twins hold the windows at 0.001 dB.
//     Their "(2x exact)" and "(ideal LFO)" twins hold both channels at 1e-6. "a second, stereo source joins": a mod set running in mono
//     gets a second source of two channels at a quantum boundary (ctx.suspend, connect, start); from that quantum on Chromium's DelayNodes
//     have up-mixed their rings (delay_handler.cc 145 to 196) and its panners take the formula of a stereo input, and the core turns at
//     that frame (btg_fx --stereo <frame>; its input from there is the two sources' sum per channel, in float, as the node's input sums them).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NONE = process.argv.includes('--none');
const SIGNALS = {
  standard: [[0.25, 'silence'], [0.6, 'chord', -7], [0.6, 'chord', -1], [0.4, 'chord', -40], [0.4, 'noise', -20], [0.3, 'silence'], [0.8, 'sweep', -6]],
  now: [[0.9, 'chord', -1], [0.4, 'noise', -20], [0.3, 'silence'], [0.5, 'sweep', -6]],
  lead: [[0.15, 'silence'], [0.9, 'chord', -1], [0.4, 'noise', -20], [0.3, 'silence'], [0.5, 'sweep', -6]],
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

const knobs = (fuzz = 0, overdrive = 0, distortion = 0) => ({ fuzz, overdrive, distortion });
// a set goes through a 4x stage when one of its knobs, at the start or in a change, has fuzz or distortion above 0; its kind is fuzz,
// distortion, or all three (both, wherever they are) and brings its limits (see the head of this file)
const FOUR_X = { fuzz: [4.5e-4, 0.007], distortion: [1.6e-4, 0.021], all: [4.2e-4, 0.035] };
const guitar = (name, layer, knob, extra = {}) => {
  const all = [knob, ...(extra.changes ?? []).map((c) => c.knob)], fuzz = all.some((k) => k.fuzz > 0), distortion = all.some((k) => k.distortion > 0);
  const [limit, windows] = fuzz || distortion ? FOUR_X[fuzz && distortion ? 'all' : fuzz ? 'fuzz' : 'distortion'] : [1e-6, 0.001];
  return { name: `guitar ${name}`, rate: 48000, kind: 'guitar', layer, knob, limit, windows, signal: 'standard', ...extra };
};
const MID = 43136; // frame 337 * 128 (0.899 s): the first loud chord is sounding
const BASE = [
  ...['bass', 'chords', 'pad', 'lead'].map((layer) => guitar(`${layer} fuzz 0.3`, layer, knobs(0.3))),
  ...[0.06, 0.3, 1].map((v) => guitar(`chords overdrive ${v}`, 'chords', knobs(0, v))),
  ...[0.3, 1].map((v) => guitar(`chords distortion ${v}`, 'chords', knobs(0, 0, v))),
  guitar('chords fuzz 1', 'chords', knobs(1)),
  guitar('chords all 0.5', 'chords', knobs(0.5, 0.5, 0.5)),
  guitar('bass overdrive 0.3', 'bass', knobs(0, 0.3)),
  guitar('bass distortion 0.3', 'bass', knobs(0, 0, 0.3)),
  guitar('bass all 0.5', 'bass', knobs(0.5, 0.5, 0.5)),
  guitar('chords all 0.5 44.1 kHz', 'chords', knobs(0.5, 0.5, 0.5), { rate: 44100 }),
  guitar('chords all 0.5 96 kHz', 'chords', knobs(0.5, 0.5, 0.5), { rate: 96000 }),
];
const all = knobs(0.5, 0.5, 0.5), off = knobs();
const TIME = [
  guitar('chords all 0.5, signal from frame 0', 'chords', all, { signal: 'now' }),
  guitar('chords all 0.5, chord 0.15 s after the build', 'chords', all, { signal: 'lead', start: 0.15 }),
  guitar('chords all 0.5, built while playing (lazy)', 'chords', off, { changes: [{ frame: MID, knob: all }] }),
  guitar('chords knobs changed in the middle of a ramp', 'chords', all, { changes: [{ frame: MID, knob: knobs(1, 0.2, 0.7) }, { frame: MID + 2560, knob: knobs(0.3, 0.9, 0.1) }] }),
  guitar('chords all 0.5, then all 0', 'chords', all, { changes: [{ frame: MID, knob: off }], dryFrom: MID + 12000 }),
  guitar('bass fuzz 1, lazy, then 0.4, then all 0', 'bass', off, { changes: [{ frame: MID, knob: knobs(1) }, { frame: MID + 12800, knob: knobs(0.4) }, { frame: MID + 25600, knob: off }], dryFrom: MID + 25600 + 12000 }),
];
const exact = (set) => ({ ...set, name: `${set.name} (2x exact)`, two: 'both', limit: 1e-6, windows: 0.001 });
// Task 19: the modulation chain (createModFx against ModFx), alone ("mod") and behind a distortion chain ("series": createGuitarFx into
// createModFx, set in that order as synth.js applyFx does). A set's knob is { vibrato, chorus, bpm } (series: with fuzz, overdrive,
// distortion); both channels of the output are compared. The limits are set in the head of this file.
const vc = (vibrato = 0, chorus = 0, bpm = 100) => ({ vibrato, chorus, bpm });
// The browser's oscillator is not a sine: the limits of a set through its LFOs are the browser's own spread (see the head), per kind of set
const MOD_LIMITS = { vibrato: [3e-4, 5e-4], chorus: [1.4e-4, 2e-4], both: [3.6e-4, 5e-4] };
const mod = (name, knob, extra = {}) => {
  const knobs = [knob, ...(extra.changes ?? []).map((c) => c.knob)], v = knobs.some((k) => k.vibrato > 0), c = knobs.some((k) => k.chorus > 0);
  const [limit, windows] = MOD_LIMITS[v && c ? 'both' : v ? 'vibrato' : 'chorus'];
  return { name: `mod ${name}`, rate: 48000, kind: 'mod', knob, limit, windows, signal: 'standard', ...extra };
};
// the same set with the browser's oscillators replaced by what the core computes ("ideal LFO"), the source from frame 0 (real zeros in the lead)
const ideal = (set) => ({ ...set, name: `${set.name} (ideal LFO)`, ideal: true, start: 0, limit: 1e-6, windows: 0.001 });
const MODS = [
  ...[60, 100, 160].map((bpm) => mod(`vibrato 1 at ${bpm} bpm`, vc(1, 0, bpm))),
  mod('chorus 0.3', vc(0, 0.3)), mod('chorus 1', vc(0, 1)), mod('both 0.5', vc(0.5, 0.5)),
  mod('both 0.5 44.1 kHz', vc(0.5, 0.5), { rate: 44100 }), mod('both 0.5 96 kHz', vc(0.5, 0.5), { rate: 96000 }),
];
const MOD_TIME = [
  mod('both 0.5, signal from frame 0', vc(0.5, 0.5), { signal: 'now' }),
  mod('both 0.5, chord 0.15 s after the build', vc(0.5, 0.5), { signal: 'lead', start: 0.15 }),
  mod('both 0.5, built while playing (lazy)', vc(), { changes: [{ frame: MID, knob: vc(0.5, 0.5) }] }),
  mod('knobs and tempo changed in the middle of a ramp', vc(0.5, 0.5), { tempo: true, changes: [{ frame: MID, knob: vc(1, 0.2, 160) }, { frame: MID + 2560, knob: vc(0.3, 0.9, 60) }] }),
  mod('vibrato 1, then chorus 0.5 only', vc(1, 0), { changes: [{ frame: MID, knob: vc(0, 0.5) }] }),
  mod('both 0.5, then all 0', vc(0.5, 0.5), { changes: [{ frame: MID, knob: vc() }], dryFrom: MID + 12000 }),
];
// a distortion chain into a modulation chain: the limits of a set are 1.5 times its own measured spread (head of this file)
const series = (name, layer, knob, limit, windows) => ({ name: `series ${name}`, rate: 48000, kind: 'series', layer, knob, limit, windows, signal: 'standard' });
const SERIES = [series('chords all 0.5 and both 0.5', 'chords', { fuzz: 0.5, overdrive: 0.5, distortion: 0.5, ...vc(0.5, 0.5) }, 1.4e-4, 0.002),
  series('bass overdrive 0.3 and vibrato 1', 'bass', { fuzz: 0, overdrive: 0.3, distortion: 0, ...vc(1, 0) }, 5.5e-4, 5e-4)];
// Task 20b: the chains in two channels (the head of this file); the limits are those of each set's mono kind, through the chorus times
// what the panner's formula for a stereo input adds to a copy's kept side
const STEREO_COPY = (1 + Math.cos(0.3 * Math.PI / 2)) / Math.cos(0.15 * Math.PI / 2);
const wide = (set) => (set.knob.chorus > 0 ? { ...set, limit: set.limit * STEREO_COPY, windows: Infinity } : set); // Infinity: printed, not judged
const stereo = (name) => wide({ ...[...BASE, ...MODS, ...SERIES].find((s) => s.name === name), name: `${name} stereo`, stereo: true });
const STEREO = [
  ...['bass', 'chords', 'pad', 'lead'].flatMap((layer) => [0.3, 1].map((v) => ({ ...guitar(`${layer} all ${v} stereo`, layer, knobs(v, v, v)), stereo: true }))),
  stereo('guitar chords all 0.5 44.1 kHz'), stereo('guitar chords all 0.5 96 kHz'),
];
const STEREO_MODS = ['mod vibrato 1 at 100 bpm', 'mod chorus 1', 'mod both 0.5 44.1 kHz', 'mod both 0.5 96 kHz', 'series chords all 0.5 and both 0.5'].map(stereo);
const JOIN = wide(mod('both 0.5, a second, stereo source joins at 0.899 s', vc(0.5, 0.5), { join: MID }));
// kinds: curves (the four curves of the live nodes against btg_fx curves), shaper (a WaveShaperNode: curve, oversample, gain of the signal),
// guitar (createGuitarFx)
const shaper = (name, curve, oversample, gain, extra = {}) => ({ name: `shaper ${name}`, rate: 48000, kind: 'shaper', curve, oversample, gain, limit: 1e-5, windows: 0.01, signal: 'standard', ...extra });
const SETS = [
  { name: 'curves', rate: 48000, kind: 'curves', limit: 0 },
  shaper('line 2', 'line', 2, 1, { limit: 1e-6 }), shaper('line 4', 'line', 4, 1, { limit: 1e-6 }),
  shaper('soft 2 (x4)', 'soft', 2, 4), shaper('hard 4 (x4)', 'hard', 4, 4), shaper('fuzz 4 (x4)', 'fuzz', 4, 4), shaper('muff 2 (x4)', 'muff', 2, 4),
  shaper('hard 4 (x4) 44.1 kHz', 'hard', 4, 4, { rate: 44100 }), shaper('hard 4 (x4) 96 kHz', 'hard', 4, 4, { rate: 96000 }),
  ...BASE, ...TIME, ...BASE.map(exact), ...TIME.map(exact),
  ...MODS, ...MOD_TIME, ...SERIES, ...MODS.map(ideal), ...MOD_TIME.filter((s) => !s.tempo).map(ideal), ...SERIES.map((s) => ideal(exact(s))),
  { ...ideal(MOD_TIME[1]), name: `${MOD_TIME[1].name} (ideal LFO, source silent until then)`, start: 0.15, limit: 1.5e-4, windows: 0.0002 },
  // the same, a constant source of 1e-10 into the chain from frame 0 keeps its delays processing: the difference is gone (it is the core's
  // 0 plus the offset's 1e-10 times the gains: 1e-6 holds with a margin of 1000)
  { ...ideal(MOD_TIME[1]), name: `${MOD_TIME[1].name} (ideal LFO, source silent until then, chain kept awake)`, start: 0.15, awake: true },
  ...STEREO, ...STEREO_MODS, JOIN, ...STEREO.map(exact), ...STEREO_MODS.map((s) => (s.kind === 'series' ? ideal(exact(s)) : ideal(s))), ideal(JOIN),
];

// one channel: the segments one after the other; t counts from the segment's start. f scales every frequency and seed starts the noise: the
// stereo sets' other channels (the head of this file)
function signal(rate, segments, { f = 1, seed = 1 } = {}) {
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
  const out = [], starts = [];
  for (const [seconds, kind, db] of segments) {
    const a = 10 ** ((db ?? 0) / 20), n = Math.round(seconds * rate);
    starts.push(out.length);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      out.push(kind === 'chord' ? a * Math.exp(-3 * (t % 0.3)) * (Math.sin(2 * Math.PI * 110 * f * t) + Math.sin(2 * Math.PI * 138.59 * f * t) + Math.sin(2 * Math.PI * 164.81 * f * t)) / 3
        : kind === 'noise' ? a * noise()
        : kind === 'sweep' ? a * Math.sin(2 * Math.PI * 50 * f * seconds / Math.log(160) * (160 ** (t / seconds) - 1)) : 0);
    }
  }
  return { samples: Float32Array.from(out), starts };
}

const f32 = (buffer) => new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const b64 = (floats) => Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');

// in the page: one set through Chromium; returns both channels (or the four curves and their oversample values) as base64. inputs: the
// source's channels, then those of the second source of a set that has one (join)
async function renderWeb(page, set, inputs, liveCurves) {
  return page.evaluate(async ([input, set, curveBytes]) => {
    const toF32 = (text) => new Float32Array(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer);
    const toB64 = (floats) => {
      const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(text);
    };
    const { createGuitarFx } = await import('/audio/guitar-fx.js');
    const { fxChainParams } = await import('/audio/fx-params.js');
    const { createModFx, modParams } = await import('/audio/mod-fx.js');
    const made = []; // the shapers of a chain, in the order of their creation: od, dist, fuzz, muff
    const wrapped = (ctx, pinned) => {
      const make = ctx.createWaveShaper.bind(ctx), pin = Object.getOwnPropertyDescriptor(WaveShaperNode.prototype, 'oversample');
      ctx.createWaveShaper = () => {
        const s = make(), i = made.length;
        made.push(s);
        if (pinned(i)) { pin.set.call(s, '2x'); Object.defineProperty(s, 'oversample', { get: () => '2x', set: () => {} }); } // the chain's own '4x' goes nowhere
        return s;
      };
      return ctx;
    };
    const r = set.rate;
    if (set.kind === 'curves') {
      const ctx = wrapped(new OfflineAudioContext(2, 128, r), () => false);
      createGuitarFx(ctx, 'chords', ctx.destination).set(fxChainParams({ fuzz: 1 }, 'chords'), { immediate: true });
      return { oversample: made.map((s) => s.oversample), curves: made.map((s) => toB64(s.curve)) };
    }
    const xs = input.map(toF32), x = xs[0];
    const ctx = new OfflineAudioContext(2, x.length, r);
    // set.start: seconds before the source starts; then the buffer holds only what follows (the 0.15 s of the lead are real silence on the
    // chain's input: nothing feeds it, as in the app before the first note), and the core is given the zeros
    const start = Math.round((set.start ?? 0) * r);
    const buffer = ctx.createBuffer(set.stereo ? 2 : 1, x.length - start, r);
    for (let c = 0; c < buffer.numberOfChannels; c++) buffer.copyToChannel(xs[c].subarray(start), c);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (set.ideal) {
      // "(ideal LFO)": every OscillatorNode of the chain is replaced by a buffer that holds what the core's LFO computes (a float sine of the
      // phase that Chromium's increment, float(f) * float(4096 / rate), accumulates in double), started at the context time of o.start():
      // the chain around it is the browser's own, the wave table is not (constant frequencies only)
      ctx.createOscillator = () => {
        const out = ctx.createBufferSource();
        let at = 0, hz = 440, filled = false;
        return {
          connect: (to) => out.connect(to), start() { at = ctx.currentTime; }, stop() {},
          frequency: {
            cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {},
            get value() { return hz; },
            set value(v) {
              hz = v;
              if (filled) return;
              filled = true;
              const first = Math.round(at * r), lfo = new Float32Array(x.length - first), increment = Math.fround(Math.fround(v) * Math.fround(4096 / Math.fround(r)));
              for (let i = 0, index = 0; i < lfo.length; i++) { lfo[i] = Math.sin((2 * Math.PI * index) / 4096); index += increment; index -= Math.floor(index / 4096) * 4096; }
              const b = ctx.createBuffer(1, lfo.length, r);
              b.copyToChannel(lfo, 0);
              out.buffer = b;
              out.start(at);
            },
          },
        };
      };
    }
    if (set.kind === 'shaper') {
      const shaper = ctx.createWaveShaper();
      shaper.curve = set.curve === 'line' ? Float32Array.of(-1, 1) : toF32(curveBytes);
      shaper.oversample = `${set.oversample}x`;
      const g = ctx.createGain();
      g.gain.value = set.gain;
      source.connect(g).connect(shaper).connect(ctx.destination);
    } else if (set.kind === 'mod') {
      const fx = createModFx(ctx, ctx.destination);
      fx.set(modParams(set.knob, set.knob.bpm), { immediate: true });
      for (const c of set.changes ?? []) ctx.suspend(c.frame / r).then(() => { fx.set(modParams(c.knob, c.knob.bpm), { immediate: false }); ctx.resume(); });
      source.connect(fx.input);
      if (set.awake) { const keep = ctx.createConstantSource(); keep.offset.value = 1e-10; keep.connect(fx.input); keep.start(0); } // not silent: the delays keep processing
      if (set.join !== undefined) { // a second source of two channels joins the chain's input between two render quanta
        const joined = ctx.createBuffer(2, x.length - set.join, r), second = ctx.createBufferSource();
        for (let c = 0; c < 2; c++) joined.copyToChannel(xs[1 + c].subarray(set.join), c);
        second.buffer = joined;
        ctx.suspend(set.join / r).then(() => { second.connect(fx.input); second.start(set.join / r); ctx.resume(); });
      }
    } else {
      const two = set.two, series = set.kind === 'series';
      wrapped(ctx, (i) => (i === 1 && (two === 'hard' || two === 'both')) || (i === 2 && (two === 'fuzz' || two === 'both')));
      const mod = series ? createModFx(ctx, ctx.destination) : null;
      const fx = createGuitarFx(ctx, set.layer, mod ? mod.input : ctx.destination);
      const apply = (knob, options) => { fx.set(fxChainParams(knob, set.layer), options); mod?.set(modParams(knob, knob.bpm), options); };
      apply(set.knob, { immediate: true });
      for (const c of set.changes ?? []) ctx.suspend(c.frame / r).then(() => { apply(c.knob, { immediate: false }); ctx.resume(); });
      source.connect(fx.input);
    }
    source.start(start / r);
    const rendered = await ctx.startRendering();
    return { left: toB64(rendered.getChannelData(0)), right: toB64(rendered.getChannelData(1)) };
  }, [inputs.map(b64), set, liveCurves]);
}

const exe = ['native/build/core/Release/btg_fx.exe', 'native/build/core/btg_fx'].map((p) => join(repo, p)).find(existsSync);
if (!exe) { console.log('btg_fx not built (native/build.ps1)'); process.exit(1); }
const temp = mkdtempSync(join(tmpdir(), 'btg-fx-'));
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
  let live = null; // the curves of the live nodes, for the shaper sets
  const POINTS = 16385, NAMES = ['soft', 'hard', 'fuzz', 'muff'];
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7); // a substring of the set names, for working on one set
  for (const set of SETS) {
    const { name, rate, kind, limit } = set;
    if (only && !name.includes(only) && kind !== 'curves') continue;
    if (kind === 'curves') {
      const web = await renderWeb(page, set, [new Float32Array(1)], null);
      const out = join(temp, 'curves.f32');
      execFileSync(exe, ['curves', out], { encoding: 'utf8', stdio: 'pipe' });
      const core = f32(readFileSync(out)), curves = web.curves.map((c) => f32(Buffer.from(c, 'base64')));
      live = Object.fromEntries(NAMES.map((n, i) => [n, web.curves[i]]));
      let largest = 0, at = 0;
      curves.forEach((c, k) => c.forEach((v, i) => { const d = Math.abs(v - core[k * POINTS + i]); if (!(d <= largest)) { largest = d; at = k * POINTS + i; } }));
      const sizes = curves.every((c) => c.length === POINTS) && core.length === 4 * POINTS, order = web.oversample.join(', ');
      const pass = sizes && largest <= limit && order === '2x, 4x, 4x, 2x';
      failed ||= !pass;
      console.log(`${name}  max difference ${largest.toExponential(1)}  oversample ${order}  at curve ${NAMES[Math.floor(at / POINTS)]} point ${at % POINTS}  ${pass ? 'PASS' : 'FAIL'}`);
      continue;
    }
    const segments = SIGNALS[set.signal], { samples, starts } = signal(rate, segments);
    // the right channel of a stereo set, the two of a join's second source (the head of this file)
    const others = (set.stereo ? [{ f: 0.79, seed: 7 }] : set.join !== undefined ? [{ f: 0.79, seed: 7 }, { f: 0.63, seed: 11 }] : []).map((o) => signal(rate, segments, o).samples);
    const rendered = await renderWeb(page, set, [samples, ...others], kind === 'shaper' ? live?.[set.curve] ?? null : null);
    // one or two channels are compared: the modulation chains and every chain with a stereo input write left and right, the others the same on both
    const twoSides = set.stereo || kind === 'mod' || kind === 'series';
    const webs = (twoSides ? [rendered.left, rendered.right] : [rendered.left]).map((c) => f32(Buffer.from(c, 'base64')));
    const input = join(temp, 'in.f32'), output = join(temp, 'out.f32');
    // the core gets the scaled signal itself (the page scales in a gain node: a float multiplication, the same one); two channels interleaved
    // where the chain's input has two (from a join's frame on, each the sum of the two sources in float, as the node's input sums them)
    const given = kind === 'shaper' ? samples.map((v) => Math.fround(v * set.gain)) : samples;
    const fed = !others.length ? given : Float32Array.from({ length: 2 * samples.length }, (_, j) => {
      const i = j >> 1, c = j & 1;
      return set.stereo ? (c ? others[0][i] : samples[i]) : samples[i] + (i >= set.join ? others[c][i] : 0);
    });
    writeFileSync(input, Buffer.from(fed.buffer, fed.byteOffset, fed.byteLength));
    const stereoArgs = others.length ? ['--stereo', String(set.join ?? 0)] : [];
    const knobArgs = (k) => [k.fuzz, k.overdrive, k.distortion].map(String);
    const modArgs = (k) => [k.vibrato, k.chorus, k.bpm].map(String);
    const both = (k) => (kind === 'series' ? [...knobArgs(k), ...modArgs(k)] : modArgs(k));
    const changes = (args) => (set.changes ?? []).flatMap((c) => ['--change', String(c.frame), ...args(c.knob)]);
    const mode = NONE ? ['none', ...stereoArgs] : kind === 'shaper' ? ['shaper', set.curve, String(set.oversample)]
      : kind !== 'guitar' ? [kind, ...(kind === 'series' ? [set.layer] : []), ...both(set.knob), ...(set.two ? ['--two', set.two] : []), ...changes(both), ...stereoArgs]
      : ['guitar', set.layer, ...knobArgs(set.knob), ...(set.two ? ['--two', set.two] : []), ...changes(knobArgs), ...stereoArgs];
    execFileSync(exe, [input, output, String(rate), ...mode], { encoding: 'utf8', stdio: 'pipe' });
    const raw = f32(readFileSync(output));
    const cores = webs.map((_, c) => Float32Array.from({ length: raw.length / 2 }, (_, i) => raw[2 * i + c]));
    let largest = 0, at = 0, side = 0, windows = 0; // the level of 10 ms windows above -80 dBFS
    const size = Math.round(0.01 * rate);
    webs.forEach((web, c) => {
      const core = cores[c];
      if (core.length !== web.length) { largest = Infinity; return; }
      for (let i = 0; i < web.length; i++) { const d = Math.abs(web[i] - core[i]); if (!(d <= largest)) { largest = d; at = i; side = c; } } // a NaN is the largest
      for (let from = 0; from + size <= web.length; from += size) {
        let a = 0, b = 0;
        for (let i = from; i < from + size; i++) { a += web[i] * web[i]; b += core[i] * core[i]; }
        const la = 10 * Math.log10(a / size), lb = 10 * Math.log10(b / size);
        if (la > -80) windows = Math.max(windows, Math.abs(la - lb));
      }
    });
    const web = webs[side], core = cores[side];
    // after all knobs are back to 0 and the ramp is over, the output is the dry signal: the largest difference to the input, web and core
    let dry = '', dryOk = true;
    if (set.dryFrom !== undefined) {
      const away = (outs) => { let m = 0; for (const out of outs) for (let i = set.dryFrom; i < given.length; i++) m = Math.max(m, Math.abs(out[i] - given[i])); return m; };
      const [w, c] = [away(webs), away(cores)];
      dryOk = !NONE ? w === 0 && c === 0 : true;
      dry = `  dry again from ${(set.dryFrom / rate).toFixed(3)} s: web ${w.toExponential(1)} core ${c.toExponential(1)}`;
    }
    const segment = starts.findLastIndex((s) => s <= at), [, what, db] = segments[segment];
    const pass = largest <= limit && windows <= set.windows && dryOk;
    failed ||= !pass;
    console.log(`${name}  max difference ${largest.toExponential(1)}  windows ${windows.toFixed(4)} dB${set.windows === Infinity ? ' (not judged)' : ''}  at ${(at / rate).toFixed(3)} s${twoSides ? ` ${side ? 'right' : 'left'}` : ''} (${what}${db === undefined ? '' : ` ${db} dBFS`}, web ${web[at].toExponential(3)} core ${core[at].toExponential(3)})${dry}  ${pass ? 'PASS' : 'FAIL'}`);
  }
} finally {
  await browser.close();
  rmSync(temp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
