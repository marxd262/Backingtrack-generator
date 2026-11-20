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

// Task 18: the layer profiles of the distortion chain, whole (the chain reads ref, distHp, toneHz and the cabinet; fxChainParams the trims)
const { LAYER_FX } = await load('audio/fx-params.js');
add('LAYER_FX', (layer) => LAYER_FX[layer], Object.keys(LAYER_FX));
// Task 18 (the two minors of Task 16): a layer without a chain throws in the web (LAYER_FX[layer] is undefined); the case's output is
// { threw: true }, which the core's function writes when it throws std::invalid_argument. And the order of the timbre's fields.
add('fxChainThrows', (layer) => { try { fxChainParams({ fuzz: 0.5 }, layer); return { threw: false }; } catch (error) { return { threw: error instanceof TypeError }; } },
  ['drums', 'percussion', 'bass', 'lead']);
add('timbreFields', (timbre) => ({ names: Object.entries(timbre).flatMap(([group, fields]) => Object.keys(fields).map((field) => `${group}.${field}`)),
  defaults: Object.values(timbre).flatMap((fields) => Object.values(fields)) }), [DEFAULT_TIMBRE]);

// Task 19: the constants of the modulation chain, whole (modParams reads vibCents and chorusLevel, the chain the rest)
const { MOD } = await load('audio/mod-fx.js');
add('MOD', () => MOD, [null]);

// Task 20: the noise of the synth voices, synth.js 60 (noiseBuffer(ctx, createRng(1).fork('noise'), 1): one second, mono, no decay), the
// buffer Engine::prepare makes for its rate as Tones::noise
add('noiseBuffer', ({ label, seconds, channels, decay, sampleRate }) => summary(noiseBuffer(context(sampleRate), createRng(1).fork(label), seconds, channels, decay), channels),
  [44100, 48000, 96000].map((sampleRate) => ({ label: 'noise', seconds: 1, channels: 1, decay: 0, sampleRate })));

// Task 22: synth.js 231 (ownChorus, not exported), whether a layer's chosen voice makes the chorus itself, for every layer and every voice
// id of the registry (the key with the id's first variant)
const { VOICES } = await load('core/voices.js');
add('ownsChorus', ({ layer, id }) => VOICES[layer][id].uses.includes(`${layer}.chorus`),
  Object.keys(VOICES).flatMap((layer) => Object.keys(VOICES[layer]).map((id) => ({ layer, id, variant: VOICES[layer][id].variants[0] }))));

// Task 24: the string model (string-model.js renderString), summarised as noiseBuffer: length, sum of squares, samples at places that hold
// the start, the attack noise, the body of the note, the samples around noteEnd, the release, the last sample before stop, stop and the last.
// Both voices' fine values (their params at the neutral timbre) at midi 28 to 88, the velocity steps 0, 3/8 and 1, the durs 0.05, 0.5 and 3.5,
// 44.1, 48 and 96 kHz, rotated so that every midi comes 6 times (once per voice and rate) and every other value 12 times, every velocity
// with every dur (36 cases, seeds 1 to 36); then on the bass's values every param at both ends of
// RANGES (string-model.js 25 to 27, not exported: written out here; pluckPos 0, pickupPos 0 and body 0 are the branches), every param
// beyond both ends (the clamp: so the core's ranges are proven, not this copy), STRING_DEFAULTS with dur and vel left out, three seeds of
// the range the voice draws from (Math.floor(rng.next() * 2 ** 31)), and a dur longer than `seconds`.
const { renderString, STRING_DEFAULTS } = await load('audio/string-model.js');
const { tunedValue } = await load('audio/voices/tunables.js');
const STRING_PARAMS = ['pluckPos', 'brightness', 'decay', 'excite', 'stiffness', 'pickupPos', 'pickupLp', 'body'];
const RANGES = { pluckPos: [0, 0.5], brightness: [0, 1], decay: [0.05, 10], excite: [0, 1], stiffness: [0, 1], pickupPos: [0, 0.5], pickupLp: [200, 20000], body: [0, 1] };
const fineOf = (key) => Object.fromEntries(STRING_PARAMS.map((n) => [n, tunedValue(key, n, {})]));
const placesOf = ({ seconds, dur, sampleRate }) => { // as renderString computes length, noteEnd and stop
  const length = Math.ceil(seconds * sampleRate), noteEnd = Math.round((Number.isFinite(dur) ? dur : seconds) * sampleRate);
  const stop = Math.min(length, noteEnd + Math.ceil(11.6 * 0.02 * sampleRate));
  const at = [0, 1, 2, Math.round(0.002 * sampleRate), Math.round(0.03 * sampleRate), Math.floor(noteEnd / 2), noteEnd - 1, noteEnd, noteEnd + 1,
    noteEnd + Math.round(0.05 * sampleRate), stop - 1, stop, length - 1];
  return [...new Set(at.filter((i) => i >= 0 && i < length))].sort((a, b) => a - b);
};
const stringCase = (input) => ({ ...input, at: placesOf(input) });
const MIDIS = [28, 40, 52, 64, 76, 88], VELS = [0, 0.375, 1], DURS = [0.05, 0.5, 3.5], RATES = [44100, 48000, 96000];
const KEYS = ['bass/string/finger', 'chords/string/electric'], BASE = { midi: 40, seconds: 0.8, dur: 0.5, vel: 1, sampleRate: 48000, seed: 1 };
const stringCases = Array.from({ length: 36 }, (_, i) => {
  const dur = DURS[Math.floor(i / 3) % 3];
  return stringCase({ midi: MIDIS[Math.floor(i / 2) % 6], seconds: dur + 0.3, dur, vel: VELS[i % 3], sampleRate: RATES[Math.floor(i / 12)], seed: 1 + i, params: fineOf(KEYS[i % 2]) });
});
for (const [name, [lo, hi]] of Object.entries(RANGES)) for (const v of [lo, hi]) stringCases.push(stringCase({ ...BASE, params: { ...fineOf(KEYS[0]), [name]: v } }));
stringCases.push(stringCase({ ...BASE, params: Object.fromEntries(Object.entries(RANGES).map(([n, [lo]]) => [n, lo - 1])) }));
stringCases.push(stringCase({ ...BASE, params: Object.fromEntries(Object.entries(RANGES).map(([n, [, hi]]) => [n, hi * 2])) }));
stringCases.push(stringCase({ midi: 52, seconds: 0.6, sampleRate: 48000, seed: 1, params: { ...STRING_DEFAULTS } }));
for (const seed of [7, 1234567890, 2147483647]) stringCases.push(stringCase({ ...BASE, seed, params: fineOf(KEYS[1]) }));
stringCases.push(stringCase({ ...BASE, seconds: 0.4, dur: 0.9, params: fineOf(KEYS[0]) }));
add('renderString', ({ at, ...input }) => {
  const out = renderString(input);
  let sumSquares = 0;
  for (const x of out) sumSquares += x * x;
  return { length: out.length, sumSquares, at: Object.fromEntries(at.map((i) => [i, out[i]])) };
}, stringCases);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'logic.json'), JSON.stringify(cases));
console.log(`logic.json: ${cases.length} cases of ${new Set(cases.map((c) => c.fn)).size} functions`);
