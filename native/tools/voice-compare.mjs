// The building blocks of the core's synth voices (native/core/src/osc.cpp, param.cpp, patch.cpp; Task 20a) against Chromium, sample by sample:
//   node native/tools/voice-compare.mjs [--none] [--only=<part of a name>]   -> one line per set; exit code 1 when a set fails
// Each set is rendered by an OfflineAudioContext on a page served from src/ (the same graph written in the page's JavaScript) and by btg_fx
// (osc, param, graph: the graph built with SynthTone's calls; voice: the core's voice), both channels compared. A set passes when the power
// of the difference is at most -60 dB of the power of the web's render (ruling 6; the bar was set before measuring). Printed per set: that
// figure, the largest sample difference, its frame and channel. --none: the core side is zeros (every set must fail, at 0 dB).
//
// What each kind proves:
//   osc: a SynthTone with one oscillator node against an OscillatorNode. Each of these makes a set fail when it is taken out (the mutation
//     runs of Task 20a): the culling of the band-limited tables per range (the 3 520 Hz sets: an unculled table aliases above Nyquist), the
//     detune, the k-rate kernel's float read index (with the index in double the FM sets at a gain of 5000 and of 2640 fail, at -55.2 and
//     -57.2 dB; the other sets show it only in their figure, about -140 dB against -93 to -122 dB), the 5-point interpolation (the sine at
//     1 Hz), a custom wave's real coefficients and its normalisation, with and without disableNormalization (the two custom sets). The sets
//     also play the four types, the a-rate path (the kick's exponential 150 -> 46 Hz in 0.12 s), negative increments (FM through zero), the
//     3-point interpolation (2.5 Hz), the table size by rate (44.1 kHz: 4096, 96 kHz: 16384) and the start and stop frames. Four sets start
//     inside a render quantum (Task 21): the kick's ramp, the same built as drums.js builds it (no .value: 440 Hz before its first event),
//     an FM set and a constant sawtooth; with Chromium's first quantum of an a-rate oscillator taken out of the core (patch.cpp,
//     CHROMIUM_FIRST_QUANTUM false) the kick and the FM set fail (figures below); the k-rate blocks on the grid they show only in their
//     figures, test_synth.cpp proves those bit for bit.
//   param: Param::values against a ConstantSourceNode whose offset carries the automation: adsr (src/audio/nodes.js, called by the page), the
//     epiano's amp envelope (src/audio/voices/epiano.js 24 to 28, fixed numbers), each event kind alone (a first ramp starts from the intrinsic
//     value), a setTarget after a linear ramp, an a-rate input (the noise buffer) added to the intrinsic value.
//   graph: fixed small graphs fed with the noise buffer this tool makes (the same floats on both sides), each node kind in the core first here
//     and not through a voice: 1 noise -> lowpass whose frequency runs an exponential ramp -> a gain with adsr's envelope (coefficients per
//     frame while a param moves); 2 a looped buffer started at a fractional offset and ended by a duration (at rate 1 Chromium rounds the
//     offset to a frame and copies the frames); 3 noise -> bandpass -> gain and noise -> highpass -> gain, static; 4 two oscillators through
//     stereo panners at -0.6 and +0.6, summed (two channels); 5 a sine LFO through a gain into a lowpass's frequency, the lowpass on a sawtooth.
//   voice (Task 21 on): a voice of the web app (createVoice with the deps synth.js gives it: params of the layer from the timbre, getTimbre,
//     the voice's rng, the noise buffer, no tuning) plays notes at given frames into one gain, against btg_fx voice: makeVoice for the key
//     with no pack, as setVoices builds a synth voice, the notes handed to it chunk by chunk through Tones as the engine does (no layer chain,
//     no mixer). The e-piano (src/audio/voices/epiano.js): velocity 0.3 and 1, brightness 0 and 1, length 0 and 1, tremolo 1, A1 and C7 (the
//     bell at 0.45 of the rate), a chord of four, a note of 0.02 s (the web's minimum 0.05 plays). Each of these makes a set fail when it is
//     taken out (Task 21's mutation runs): the bell (every set, -41.0 to -25.3 dB), the decay of the modulation's depth (-14.6 to +1.2 dB),
//     the velocity's part of the index (-16.3 to -0.0 dB), the tremolo (tremolo 1, -0.9 dB), the amplitude's last exponential (the release,
//     -7.2 to +5.1 dB), the brightness knob (brightness 0 and 1, +3.4 and +4.9 dB), the length knob (length 0 and 1, -12.8 and -22.7 dB).
//     Two sets start inside a render quantum: a tone, and the same pitch struck twice (Chromium's first quantum, below).
//     The organ (src/audio/voices/organ.js, organ-leslie.js; Task 20), through its chain slot, with a tuning as the page's setTuning sends
//     it and the events' leslie and swell fields: the four presets (a chord struck over 5 ms, then a single note after a gap), jazz with the
//     Leslie off, always slow, always fast and following the events (slow to fast), rock with drive 0 and 1, ballad's swell from -3 dB
//     with an art swell, micAngle 30, gospel's low and high key (the fold-back), a set inside a quantum (the LFOs' first quantum), 44.1 and
//     96 kHz. Each of these makes a set fail when it is taken out (Task 20's mutation runs): the click at the note's end (every set, -45.7 to
//     -30.6 dB), the percussion's single trigger (the eight jazz sets with a chord struck over 5 ms, -45.2 to -18.5 dB), the fold-back (the
//     low and high key, -5.4 and -2.2 dB), the wheels' cents (16 sets; the 17th plays only A, whose wheels are exact: -27.9 to -5.8 dB),
//     the Doppler, the amplitude modulation and the drum turning the way of the horn (every set with the Leslie on: -18.4 to +2.8, -16.1 to
//     -10.2, -18.1 to -7.5 dB), the preamp's 20 Hz highpass (every set with the drive on, -24.3 to -10.1 dB), the swell's glide (the swell
//     set, -24.8 dB), the Leslie's speed change (the slow-to-fast set, -9.9 dB), the Leslie knob (leslie 0, 2 and 3: +3.6, -8.3, -7.9 dB;
//     each against the events under which the preset's mode 1 plays otherwise), the drive knob (drive 0 and 1, +4.0 and -12.7 dB).
//     The classic synth (src/audio/voices/classic.js; Task 22) on bass, chords, pad and lead: each layer neutral and each knob of its uses at
//     0 and 1, a bass note shorter than holdMin + holdCut, the chords' chorus in two channels (alone, with the tremolo, at 44.1 and 96 kHz),
//     their tremolo, a chord of four, a pad note too short for its attack, the lead's 20 ms note and a low and a high note, the pad at 44.1 and
//     96 kHz, two sets 92 frames into a quantum, and the pad's whole graph (shimmer 1 with thickness 1: 16 nodes, SynthTone's NODES; with
//     NODES 15 btg_fx refuses it, "the voice's graph does not fit a SynthTone", and every other set passes). Each of these makes a set fail when it is taken out (Task 22's mutation runs): the bass's
//     sine (every bass set, -13.1 to -1.1 dB), its decay gain (pluck 1, -1.2 dB), its two saws' opposite detune (every bass set, -19.0 to
//     -4.1 dB), the square's 7 cents (every chords set, -6.4 to +3.2 dB), the chorus saws' late start (the five chorus sets, +0.3 dB), their
//     phase at a start between frames (chorus 1 at 44.1 kHz, -28.1 dB: at 48 and 96 kHz 11 and 17 ms are whole frames), the panners (the
//     five chorus sets, -10.9 to -9.9 dB), the tremolo (the three tremolo sets, -2.8 to -2.2 dB), the pad's LFO (every pad set, -26.6 to
//     -4.9 dB), its extra saws (thickness 1, -4.2 dB), its octave sines (shimmer 1, -1.0 dB), its attack rule (the short note, -0.2 dB), the
//     lead's filter ramp (every lead set, -19.8 to -2.0 dB), its triangle's 9 cents (every lead set, -11.6 to +1.5 dB).
//     Events and their ends lie exactly on frames (renderWeb): with frame / rate the param events of a tone at 1632 / 48000 come a frame
//     after its sources' start in Chromium (ceil(t * rate) against TimeToSampleFrame) and its first frame plays the gains' default 1 (the
//     chord sets measured -48.4 to -45.2 dB, the 44.1 kHz set -39.8 dB, before the placement; the e-piano's frames were exact already).
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
//     Started inside a render quantum (Task 21): the kick 92 frames in -118.3 dB (3.8e-6), the kick as drums.js builds it -118.3 dB
//     (3.8e-6), the FM set by 5000 19 frames in -118.2 dB (3.5e-6), the sawtooth 65 frames in -140.6 dB (1.8e-7). Chromium's first render
//     quantum of an oscillator with an a-rate frequency (patch.cpp, CHROMIUM_FIRST_QUANTUM): it runs on the values of the quantum's first
//     frames, so up to 127 frames behind its params; taken out of the core, the kick measures -51.9 dB and the FM set -12.1 dB (an FM
//     carrier keeps the lost phase), the sawtooth (k-rate) stays. The drums.js kick with the core given 150 Hz as the node's value (its first
//     event's, not the default 440 Hz the first quantum runs on before the start): +2.0 dB. The k-rate blocks on the grid (osc.cpp: the
//     rest of the quantum first): counted from the oscillator's own start instead, the FM set -93.9, the sawtooth -102.3 dB, below the bar
//     (the float lanes re-synced on other frames): these sets show the grid only in their figures; test_synth.cpp is what proves it.
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
//   voice (Task 21): the e-piano's eleven sets on a quantum's first frame -134.0 (velocity 1) to -113.9 dB (C7), at most 7.4e-7 (the chord
//     of four, -127.0 dB, puts its largest difference of 3.9e-7 or 4.0e-7 on other frames from run to run of the whole tool: the web side).
//     Inside a quantum: the tone 92 frames in -125.2 dB (1.1e-7), the same pitch twice (92 and 58 frames in) -127.5 dB (1.1e-7). With
//     Chromium's first quantum taken out: +3.5 and +2.7 dB (the carrier runs behind its modulation in its first quantum and keeps the phase
//     it loses there for the whole tone); with the k-rate blocks counted from each oscillator's start: -106.0 and -104.7 dB.
//   voice (Task 20): the organ's seventeen sets -75.5 (96 kHz) to -115.6 dB (rock drive 0), at most 1.1e-4; from run to run of the whole
//     tool they move by about 1 dB (the browser sums `pre`'s connections in the order of a hash set). Every set with the preamp on lies at
//     -76.8 to -84.3 dB: its 20 Hz highpass keeps its state in float with poles near 1 (as Chromium's), so a last-bit difference at its input
//     (the wave tables, the core's transform in double against Chromium's in float; that order of the sum) makes the two rounding
//     sequences drift apart: the core against itself with its preamp's input scaled by 1 + 1e-7 measured -84.4 dB (largest 3.2e-5). After
//     the notes Chromium stops a node whose inputs are silent once its tail has passed (a biquad's impulse response below 1/32768,
//     biquad.cc TailFrame; audio_handler.cc PropagatesSilence) and plays exact zeros, the core rings on: -88 to -98 dB in those windows,
//     not rebuilt. A setTarget is tested for convergence where Chromium tests it, at its first frame and each quantum's (param.h; at every
//     frame before: the click's gain, rock drive 0 -102.3 dB then). Not rebuilt either, rounding only (the float lanes against a double
//     index): the LFOs' path before a speed change the browser already knows of (this page schedules every event before the render, so
//     from the chain's first setValue on its LFOs run a-rate while a later change is listed; the core sees an event in its own chunk), and
//     the rest of a quantum begun on the k-rate path when an event of the next chunk switches it (never here: chunks end on quanta).
//   voice (Task 22): the classic synth's 46 sets -138.8 (chords brightness 1) to -94.7 dB (chorus 1 at 96 kHz), at most 5.2e-5. The bass
//     -133.6 to -106.5 dB; its lowest figures (cutoff 0 -109.3, resonance 1 -106.5 dB) are its tone's end: the core ends a synth tone one chunk
//     (256 frames) after its last source's stop, where the browser's lowpass at 56 Hz or with Q 14 dB rings on (1.3e-5 and 4.3e-5, the
//     amp at its 1e-4 floor). The chords in one channel -138.8 to -123.7 dB; in two channels -121.1 (44.1 kHz) to -94.7 dB, the largest
//     difference a few frames after the sources' stop, where the browser's render is exactly 0 and the core's lowpass rings on at the amp's
//     floor (5.1e-5): not traced into Chromium's source, not rebuilt. Without the phase of a start between frames (osc.h `lead`, Chromium's
//     start_frame_offset) chorus 1 at 44.1 kHz measured -28.1 dB. The pad -137.6 to -123.9 dB (its figures move by about 0.1 dB from run to
//     run: the browser's side), the lead -135.1 to -132.1 dB.
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
// a frame (ruling 9: Chromium starts one between frames with a phase offset, the core does not). The render's frame 0 is the first frame of
// the core's grid of render quanta, as of the OfflineAudioContext's; most sets start at 1536 = 12 * 128, on a quantum's first frame.
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
  // started inside a render quantum: the a-rate first quantum (the kick, the FM carrier; they fail without it) and the k-rate blocks on the
  // grid (the modulator, the sawtooth: 63 frames left in its quantum, not a multiple of four), which these sets show only in their figures
  // (test_synth.cpp proves the grid bit for bit)
  osc('sine 150 -> 46 Hz exponential (the kick), started 92 frames into a quantum', 'sine', 150, 0, { start: 1500 / 48000, exp: [46, (1500 + 5760) / 48000] }),
  // as drums.js and percussion.js build theirs: no .value, so 440 Hz (the default) before the first event, which is what its first quantum
  // runs on before the start; from: the first event's value
  osc('sine, 440 Hz until it is set to 150 at its start, then 150 -> 46 Hz (drums.js), started 92 frames into a quantum', 'sine', 440, 0,
    { start: 1500 / 48000, from: 150, exp: [46, (1500 + 5760) / 48000] }),
  osc('sine 440 Hz, FM by a 440 Hz sine through 5000, started 19 frames into a quantum', 'sine', 440, 0, { start: 1555 / 48000, fm: [440, 5000] }),
  osc('sawtooth 440 Hz, started 65 frames into a quantum', 'sawtooth', 440, 0, { start: 1601 / 48000 }),
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
// A synth voice (Task 21 on): events [frame, midi, vel, seconds], the timbre's knobs over DEFAULT_TIMBRE; most at 1536, two inside a quantum.
const voice = (name, key, events, extra = {}) => ({ name: `voice ${name}`, kind: 'voice', rate: 48000, seconds: 1, key, events, sound: {}, ...extra });
const RHODES = 'chords/epiano/rhodes', note = (midi = 57, vel = 0.8, seconds = 0.5) => [1536, midi, vel, seconds];
const VOICE = [
  ...[0.3, 1].map((vel) => voice(`epiano velocity ${vel}`, RHODES, [note(57, vel)])),
  ...['brightness', 'length'].flatMap((k) => [0, 1].map((v) => voice(`epiano ${k} ${v}`, RHODES, [note()], { sound: { chords: { [k]: v } } }))),
  voice('epiano tremolo 1', RHODES, [note()], { sound: { chords: { tremolo: 1 } } }),
  voice('epiano low note (A1)', RHODES, [note(33)]),
  voice('epiano high note (C7: the bell at its limit, 0.45 of the rate)', RHODES, [note(96)]),
  voice('epiano chord of four (A3 C4 E4 G4)', RHODES, [57, 60, 64, 67].map((m) => note(m))),
  voice('epiano note cut short (0.02 s: the web plays 0.05)', RHODES, [note(57, 0.8, 0.02)]),
  voice('epiano started 92 frames into a quantum (frame 1500)', RHODES, [[1500, 57, 0.8, 0.5]]),
  voice('epiano the same pitch twice, 92 and 58 frames into a quantum (frames 1500, 10554)', RHODES, [[1500, 57, 0.6, 1.5], [10554, 57, 0.6, 1.3]], { seconds: 2 }),
];
// Task 20, the organ: events [frame, midi, vel, seconds, fields of the event]; tuning: the organ's fine values as the page's setTuning sends
// them. A chord (A3 C4 E4, its keys struck 2 and 5 ms apart as a played chord's are), held 0.5 s, then after a gap of 0.25 s a single note
// (A4): the percussion's single trigger fires at the chord's first key and again at the single note, not at the chord's other keys.
const organ = (variant, name, events, extra = {}) => voice(`organ ${variant} ${name}`, `chords/organ/${variant}`, events, { seconds: 1.5, ...extra });
const chordThenNote = (from = 1536) => [[from, 57, 0.8, 0.5], [from + 96, 60, 0.8, 0.5], [from + 240, 64, 0.8, 0.5], [from + 36000, 69, 0.8, 0.4]];
const tuned = (variant, values) => ({ tuning: { [`chords/organ/${variant}`]: values } });
VOICE.push(
  ...['jazz', 'rock', 'gospel', 'ballad'].map((v) => organ(v, 'a chord, then a single note after a gap', chordThenNote())),
  // each against the events under which mode 1 (the preset's) would play otherwise: 2 (always slow) against events that ask for fast
  // (leslie 1, a chorus), 3 (always fast) and 0 against events that do not
  ...[0, 2, 3].map((mode) => organ('jazz', `leslie ${mode}`, chordThenNote().map((e) => (mode === 2 ? [...e, { leslie: 1 }] : e)), tuned('jazz', { leslie: mode }))),
  // leslie 1: the second chord's notes carry leslie 1, the rotors speed up over the inertia (hornUp 1 s, drumUp 3.5 s: setTargetAtTime)
  organ('jazz', 'leslie 1, the events go from slow to fast', [[1536, 57, 0.8, 0.4], [1536, 64, 0.8, 0.4], [24000, 57, 0.8, 1.4, { leslie: 1 }], [24000, 64, 0.8, 1.4, { leslie: 1 }]], { seconds: 2 }),
  ...[0, 1].map((drive) => organ('rock', `drive ${drive}`, chordThenNote(), tuned('rock', { drive }))),
  // the pedal at -3 dB (a verse), then an art swell that opens it over 0.4 s (a note into the chorus: no swell field, 0 dB)
  organ('ballad', 'swell: -3 dB, then an art swell to 0 dB', [[1536, 57, 0.8, 0.5, { swell: -3 }], [28800, 57, 0.8, 0.8, { art: 'swell', artTime: 0.4 }]]),
  organ('jazz', 'micAngle 30', chordThenNote(), tuned('jazz', { micAngle: 30 })),
  // the fold-back: below C2 the 16' plays an octave up, high up the 1' and 1 1/3' fold down (every drawbar out)
  organ('gospel', 'low key (E2, 40)', [[1536, 40, 0.8, 0.5]], { seconds: 1 }),
  organ('gospel', 'high key (E6, 88)', [[1536, 88, 0.8, 0.5]], { seconds: 1 }),
  // started 92 frames into a render quantum: the LFOs' first quantum (Chromium runs it on the default 440 Hz before the start)
  organ('jazz', 'a chord, then a single note after a gap, 92 frames into a quantum', chordThenNote(1500)),
  organ('jazz', 'a chord, then a single note after a gap at 44.1 kHz', chordThenNote(), { rate: 44100 }),
  organ('jazz', 'a chord, then a single note after a gap at 96 kHz (tables of 16384)', chordThenNote(), { rate: 96000 }),
);
// Task 22, the classic synth on bass, chords, pad and lead (src/audio/voices/classic.js): each layer neutral and each knob of its uses at 0
// and 1; the chords' chorus in two channels (both judged), its saws started 11 and 17 ms after the tone; two rates; two sets 92 frames into a
// quantum.
const classic = (layer, name, events, extra = {}) => voice(`classic ${layer} ${name}`, `${layer}/synth/classic`, events, extra);
const knobs = (layer, names, events, extra = {}) => names.flatMap((k) => [0, 1].map((v) => classic(layer, `${k} ${v}`, events, { sound: { [layer]: { [k]: v } }, ...extra })));
const BASS = [[1536, 45, 0.8, 0.5]], CHORD = [[1536, 57, 0.8, 0.5]], PAD = [[1536, 57, 0.8, 2]], LEAD = [[1536, 69, 0.8, 0.5]];
const CHORUS = { chords: { chorus: 1 } }, PAD_SET = { seconds: 3.5 }, CHORD_SET = { seconds: 2 };
VOICE.push(
  classic('bass', 'neutral', BASS),
  ...knobs('bass', ['sub', 'pluck', 'cutoff', 'resonance', 'roundness'], BASS),
  classic('bass', 'a note of 0.05 s (shorter than holdMin + holdCut)', [[1536, 45, 0.8, 0.05]]),
  classic('chords', 'neutral', CHORD, CHORD_SET),
  ...knobs('chords', ['brightness', 'length'], CHORD, CHORD_SET),
  classic('chords', 'chorus 1 (two channels)', CHORD, { sound: CHORUS, ...CHORD_SET }),
  classic('chords', 'tremolo 1', CHORD, { sound: { chords: { tremolo: 1 } }, ...CHORD_SET }),
  classic('chords', 'chorus 1 with tremolo 1', CHORD, { sound: { chords: { chorus: 1, tremolo: 1 } }, ...CHORD_SET }),
  classic('chords', 'chord of four (A3 C4 E4 G4)', [57, 60, 64, 67].map((m) => [1536, m, 0.8, 0.5]), CHORD_SET),
  classic('pad', 'neutral', PAD, PAD_SET),
  ...knobs('pad', ['attack', 'cutoff', 'lfoSpeed', 'lfoDepth', 'shimmer', 'thickness'], PAD, PAD_SET),
  classic('pad', 'attack 1, a note of 1 s (too short for its attack: line 57 shortens it)', [[1536, 57, 0.8, 1]], { sound: { pad: { attack: 1 } }, ...PAD_SET }),
  classic('lead', 'neutral', LEAD),
  classic('lead', 'a note of 0.02 s (the hold floor)', [[1536, 69, 0.8, 0.02]]),
  classic('lead', 'low note (C3)', [[1536, 48, 0.8, 0.5]]),
  classic('lead', 'high note (C7)', [[1536, 96, 0.8, 0.5]]),
  ...[44100, 96000].flatMap((rate) => [classic('chords', `chorus 1 at ${rate / 1000} kHz`, CHORD, { sound: CHORUS, ...CHORD_SET, rate }),
    classic('pad', `neutral at ${rate / 1000} kHz`, PAD, { ...PAD_SET, rate })]),
  classic('chords', 'chorus 1 with tremolo 1, started 92 frames into a quantum (frame 1500)', [[1500, 57, 0.8, 0.5]], { sound: { chords: { chorus: 1, tremolo: 1 } }, ...CHORD_SET }),
  classic('pad', 'neutral, started 92 frames into a quantum (frame 1500)', [[1500, 57, 0.8, 2]], PAD_SET),
  // the pad's whole graph: the extra saws and the octave sines, 16 nodes, SynthTone's limit (a larger one is not built: btg_fx exits with an error)
  classic('pad', 'shimmer 1 with thickness 1 (all 16 nodes)', PAD, { sound: { pad: { shimmer: 1, thickness: 1 } }, ...PAD_SET }),
);
const SETS = [...OSC, ...PARAM, ...GRAPH, ...VOICE];

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
      if (hz !== undefined) o.frequency.value = hz; // undefined: as drums.js, its value stays the default 440 Hz
      o.start(start);
      o.stop(stop);
      return o;
    };
    const gain = (value) => { const g = ctx.createGain(); g.gain.value = value; return g; };
    const filter = (type, hz, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
    const panner = (pan) => { const p = ctx.createStereoPanner(); p.pan.value = pan; return p; };
    if (set.kind === 'osc') {
      const o = oscillator(set.wave, set.from === undefined ? set.hz : undefined, set.start, set.stop);
      o.detune.value = set.cents;
      if (set.exp) { o.frequency.setValueAtTime(set.from ?? set.hz, set.start); o.frequency.exponentialRampToValueAtTime(set.exp[0], set.exp[1]); }
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
    } else if (set.kind === 'voice') { // createVoice with the deps synth.js gives it (124 to 132), the events at their frames into one gain
      const { createVoice } = await import('/audio/voices/index.js');
      const { completeTimbre } = await import('/core/timbre.js');
      const { createRng } = await import('/core/rng.js');
      const { noiseBuffer } = await import('/audio/nodes.js');
      const p = await import('/audio/voice-params.js');
      const [layer, id, variant] = set.key.split('/'), sound = completeTimbre(set.sound), rng = createRng(1);
      const params = { drums: p.drumParams(sound.drums), bass: p.bassParams(sound.bass), chords: p.chordParams(sound.chords), pad: p.padParams(sound.pad), lead: {} }[layer];
      const play = createVoice(layer, { id, variant }, ctx, { params, getTimbre: () => sound[layer], rng: rng.fork(`voice-${layer}`),
        noise: noiseBuffer(ctx, rng.fork('noise'), 1), getTuning: () => set.tuning ?? {}, setStatus: () => {}, track: () => {} });
      const sum = gain(1);
      sum.connect(out);
      // An event and its end exactly on their frames (Task 20): frame / r times r can come out a hair above the frame (1632 / 48000 *
      // 48000 = 1632.0000000000002), and so can t + dur (1536 / 44100 + 0.5 at 44.1 kHz). Chromium then starts a source on the frame
      // (TimeToSampleFrame rounds through 1/1024 frame) but an AudioParam event one frame later (ceil(t * rate)): the source's first frame
      // plays the param's default (the organ's key gain and click gain: 1). The core places events on frames (ruling 9), its ends a whole
      // number of frames later: the time, then the duration, steps down by a double's last bit until it is not above its frame.
      const below = (x) => { const f = new Float64Array([x]); new BigInt64Array(f.buffer)[0] -= 1n; return f[0]; };
      for (const [frame, midi, vel, dur, fields] of set.events) {
        let t = frame / r, d = dur;
        while (t * r > frame) t = below(t);
        while ((t + d) * r > frame + Math.round(dur * r)) d = below(d);
        play(sum, t, { type: 'note', layer, midi, vel, dur: d, ...fields });
      }
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
      ...(set.exp ? ['--exp', String(set.from ?? set.hz), String(set.exp[0]), String(set.exp[1] * r)] : []), ...(set.fm ? ['--fm', ...set.fm.map(String)] : []),
      ...(set.custom ? ['--custom', set.custom.real.join(','), set.custom.imag.join(','), set.custom.raw ? 'raw' : 'normalized'] : [])];
  }
  if (set.kind === 'param') {
    const events = set.adsr ? adsrEvents(set.adsr) : set.events;
    return ['param', frames, String(set.value), ...events.flatMap(([kind, v, t, tc]) => [kind, String(v), String(t * r), ...(kind === 'target' ? [String(tc * r)] : [])]),
      ...(set.input ? ['--input'] : [])];
  }
  if (set.kind === 'voice') { // an event's fields as name=value (art 'swell' goes with its artTime)
    const fields = (f = {}) => Object.entries(f).filter(([k]) => k !== 'art').map(([k, v]) => `${k}=${v}`);
    return ['voice', frames, set.key, JSON.stringify(set.sound), ...(set.tuning ? ['--tuning', JSON.stringify(set.tuning)] : []),
      ...set.events.flatMap(([frame, midi, vel, dur, f]) => [...[frame, midi, vel, dur].map(String), ...fields(f)])];
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
