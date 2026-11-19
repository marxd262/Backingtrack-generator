// Writes the reference of the logic test (native/core/tests/test_logic.cpp) from the web app in the working tree (src/, read only):
//   node native/tools/export-logic.mjs <outDir>   -> <outDir>/logic.json, a list of { fn, in, out }
// One add() per function; later tasks append their functions here and in test_logic.cpp.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const outDir = process.argv[2];
if (!outDir) { console.log('usage: export-logic.mjs <outDir>'); process.exit(2); }
const src = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'src');
const load = (file) => import(pathToFileURL(join(src, file)).href);
const { DEFAULT_TIMBRE, completeTimbre } = await load('core/timbre.js');
const { masterParams, drumParams, bassParams, chordParams, padParams } = await load('audio/voice-params.js');
const { fxChainParams } = await load('audio/fx-params.js');
const { modParams } = await load('audio/mod-fx.js');
const { brightnessHz } = await load('audio/voices/sample-zones.js');

const cases = [];
const add = (fn, call, inputs) => { for (const input of inputs) cases.push({ fn, in: input, out: call(input) }); };
const STEPS = [0, 0.25, 0.5, 0.75, 1];
// every field of the group at every step, the others at DEFAULT_TIMBRE
const sweep = (group) => Object.keys(DEFAULT_TIMBRE[group]).flatMap((field) => STEPS.map((v) => ({ ...DEFAULT_TIMBRE[group], [field]: v })));

// Task 16: the sound model
add('completeTimbre', completeTimbre, [{}, null, [], 'text',
  { master: { brightness: 0.2, width: 1.5, echo: -1, reverb: '0.3', roomSize: null, extra: 1 }, chords: [0.1], pad: null, nope: { a: 1 } },
  { drums: { room: 0.75 }, bass: { cutoff: 0 }, lead: { fuzz: 1 } }]);
add('masterParams', masterParams, sweep('master'));
add('drumParams', drumParams, sweep('drums'));
add('bassParams', bassParams, sweep('bass'));
add('chordParams', chordParams, sweep('chords'));
add('padParams', padParams, sweep('pad'));
add('fxChainParams', ({ timbre, layer }) => fxChainParams(timbre, layer), ['bass', 'chords', 'pad', 'lead'].flatMap((layer) =>
  ['fuzz', 'overdrive', 'distortion'].flatMap((field) => STEPS.map((v) => ({ timbre: { fuzz: 0, overdrive: 0, distortion: 0, [field]: v }, layer })))));
add('modParams', ({ timbre, bpm }) => modParams(timbre, bpm), [20, 60, 100, 120, 400].flatMap((bpm) =>
  ['vibrato', 'chorus'].flatMap((field) => STEPS.map((v) => ({ timbre: { vibrato: 0, chorus: 0, [field]: v }, bpm })))));
add('brightnessHz', brightnessHz, [...Array.from({ length: 11 }, (_, i) => i / 10), null]);

// Fix round 1 (appended, the cases above keep their places): inputs that act together or lie outside what the knobs give.
// fxChainParams: cab = mix(max), not a sum, so two and three knobs up at different values; -1, 2, null and a missing knob count as
// clamped, 1, 0 and 0. modParams: both knobs up; the bpm null, missing (the default 100) and not a number. brightnessHz: the clamp, and non-numbers.
const FX_MIXES = [{ fuzz: 0.3, overdrive: 0.7, distortion: 0 }, { fuzz: 0.02, overdrive: 0.01, distortion: 0.03 }, { fuzz: 0.9, overdrive: 0.4, distortion: 0.6 },
  { fuzz: 0.05, overdrive: 0.5, distortion: 0.2 }, { fuzz: -1, overdrive: 2, distortion: null }, { fuzz: null, overdrive: -0.5, distortion: 1.5 }, {}];
add('fxChainParams', ({ timbre, layer }) => fxChainParams(timbre, layer), ['bass', 'chords', 'pad', 'lead'].flatMap((layer) => FX_MIXES.map((timbre) => ({ timbre, layer }))));
add('modParams', ({ timbre, bpm }) => modParams(timbre, bpm), [
  ...[20, 60, 100, 120, 400].map((bpm) => ({ timbre: { vibrato: 0.3, chorus: 0.6 }, bpm })),
  ...[null, undefined, 'fast'].flatMap((bpm) => [{ timbre: { vibrato: 0.5, chorus: 0.5 }, bpm }, { timbre: { vibrato: 0, chorus: 0 }, bpm }]),
  { timbre: { vibrato: -1, chorus: 2 }, bpm: 80 }, { timbre: { vibrato: 2, chorus: null }, bpm: 80 }, { timbre: {}, bpm: 80 }]);
add('brightnessHz', brightnessHz, [-1, 2, 1e300, 0.05, 0.45, 0.49, 0.5, 0.51, 'text', NaN, Infinity]);

// Task 14: the noise of the reverb and of the room (nodes.js noiseBuffer), summarised: length, sum of squares per channel, five samples
const { noiseBuffer } = await load('audio/nodes.js');
const { createRng } = await load('core/rng.js');
const context = (sampleRate) => ({ sampleRate, createBuffer: (channels, length) => {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { length, numberOfChannels: channels, getChannelData: (c) => data[c] };
} });
const summary = (buffer, channels) => {
  const square = (d) => { let s = 0; for (const x of d) s += x * x; return s; };
  const at = [0, 1, 2, 1000, buffer.length - 1];
  return { length: buffer.length, sumSquares: Array.from({ length: channels }, (_, c) => square(buffer.getChannelData(c))),
    at: Object.fromEntries(at.map((i) => [i, Array.from({ length: channels }, (_, c) => buffer.getChannelData(c)[i])])) };
};
add('noiseBuffer', ({ label, seconds, channels, decay, sampleRate }) => summary(noiseBuffer(context(sampleRate), createRng(1).fork(label), seconds, channels, decay), channels),
  [44100, 48000, 96000].flatMap((sampleRate) => [{ label: 'reverb', seconds: 2, channels: 2, decay: 3, sampleRate },
    ...[0.15, 0.4, 1].map((seconds) => ({ label: 'room', seconds, channels: 2, decay: 6.9 / seconds, sampleRate }))]));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'logic.json'), JSON.stringify(cases));
console.log(`logic.json: ${cases.length} cases of ${new Set(cases.map((c) => c.fn)).size} functions`);
