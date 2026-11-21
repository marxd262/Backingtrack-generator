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

// Task 25: the track check (track.js, voices.js, layers.js, form.js, music.js, chords.js).
// normalizeTrack and validateTrack take the track as TEXT (the core's functions do): the case's `in` is the text, the web gets JSON.parse of
// it (null when it is no JSON). The core's outputs are texts too; the test parses them. A helper that throws in the web has the output
// { threw: true } (the core throws std::invalid_argument); normalizeForm's `undefined` is { undefined: true }, else { value }.
const { parityTracks } = await import(new URL('./export-events.mjs', import.meta.url).href);
const { normalizeTrack, validateTrack } = await load('core/track.js');
const { completeVoices } = await load('core/voices.js');
const { completeJobs, LAYERS } = await load('core/layers.js');
const { normalizeForm, checkForm } = await load('core/form.js');
const { allowedChords, chordOptions } = await load('core/music.js');
const { chordName, CHORDS } = await load('core/chords.js');
const { GROOVES } = await load('core/grooves.js');

const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const texts = (values) => values.map((v) => JSON.stringify(v));
const seenTexts = new Set();
const trackCases = (list) => { // each text once; the same list goes to both functions
  const unique = [...new Set(list)].filter((text) => !seenTexts.has(text));
  unique.forEach((text) => seenTexts.add(text));
  add('validateTrack', (text) => validateTrack(parse(text)), unique);
  add('normalizeTrack', (text) => normalizeTrack(parse(text)), unique);
};
const attempt = (call) => (input) => { try { return call(input); } catch { return { threw: true }; } };

// The mutation corpus: every mutation of a JSON value. Each field (nested ones too) is replaced in turn by each of REPLACEMENTS; of an
// array, the array itself (as a field of its parent, or the value itself), its first and its last element are replaced and only these two
// are walked into. A later task reuses it on another kind of value.
const REPLACEMENTS = [null, 0, -1, 1e9, '', 'x', [], {}, true];
function mutations(value) {
  const out = REPLACEMENTS.map((r) => structuredClone(r));
  const replaceAt = (path, r) => {
    const copy = structuredClone(value);
    const parent = path.slice(0, -1).reduce((node, key) => node[key], copy);
    parent[path.at(-1)] = structuredClone(r);
    return copy;
  };
  const walk = (node, path) => {
    const keys = Array.isArray(node) ? [...new Set([0, node.length - 1])].filter((i) => i >= 0 && i < node.length) : Object.keys(node);
    for (const key of keys) {
      for (const r of REPLACEMENTS) out.push(replaceAt([...path, key], r));
      if (node[key] !== null && typeof node[key] === 'object') walk(node[key], [...path, key]);
    }
  };
  if (value !== null && typeof value === 'object') walk(value, []);
  return out;
}

// 1. every track of the parity set: valid, and normalised
const bySize = (list) => [...list].sort((a, b) => JSON.stringify(a).length - JSON.stringify(b).length);
const fieldCount = (v) => (v !== null && typeof v === 'object' ? Object.values(v).reduce((n, x) => n + fieldCount(x), 0) : 1);
if (parityTracks.some((t) => validateTrack(t).length)) throw new Error('a track of the parity set is not valid');
trackCases(parityTracks.map((t) => JSON.stringify(t)));

// 2. the mutation corpus on three small tracks of the parity set: plain bars; a form with sections; every optional field of the format
// (the parity set has no section with `locked` and none with all of level, density, crash, and no `template`: the third track, the one of the set with the most
// fields, is completed with them)
const plain = bySize(parityTracks.filter((t) => !t.form))[0];
const formed = bySize(parityTracks.filter((t) => t.form?.sections?.length))[0];
const widest = [...parityTracks].sort((a, b) => fieldCount(b) - fieldCount(a) || JSON.stringify(a).length - JSON.stringify(b).length)[0];
const full = structuredClone(widest);
Object.assign(full, { groove: Object.keys(GROOVES)[0], complexity: 0.7, loose: 0.3, ornaments: 0.25 });
Object.assign(full.form, { template: 'pop', auto: false });
Object.assign(full.form.sections[0], { level: -3, density: 0.2, crash: true, transition: 'roll', locked: false });
full.tags = { ...full.tags, rhythm: ['swing'], mood: ['dark'] };
if (validateTrack(full).length) throw new Error(`the full track is not valid: ${JSON.stringify(validateTrack(full))}`);
for (const base of [plain, formed, full]) trackCases(texts(mutations(base)));

// 3. by hand: values that are not tracks, every code at its edges, and what the web does with the odd (arrays count as objects in track.js)
const BARS = [{ chord: { root: 'A', quality: 'min' }, beats: 4 }, { chord: { root: 'D', quality: 'min7' }, beats: 4 }, { chord: { root: 'E', quality: 'dom7' }, beats: 4 }];
const TRACK = { key: { root: 'A', mode: 'minor' }, bpm: 100, length: 8, bars: BARS };
const SECTION = { type: 'verse', bars: 8 };
const GOOD_FORM = { sections: [{ type: 'intro', bars: 2 }, { type: 'chorus', bars: 4, level: -2, density: 0.5, transition: 'fill', crash: true, locked: false }], feel: { dynamics: 1.3 } };
const withField = (field, value) => ({ ...TRACK, [field]: value });
const WEIRD = [null, 0, 1, -1, 1e9, 0.5, '', 'x', true, false, [], {}, [0], ['x'], [[]], [{}], { a: 1 }];
const hand = [
  ...WEIRD, [1, 2, 3], [{ bpm: 100 }], Array.from({ length: 600 }, () => 0), [TRACK], {}, TRACK,
  // bpm, length: the edges, strings, other types
  ...[19.99, 20, 20.5, 399.99, 400, 400.01, '100', null, true, [], {}, 1e9, -1, 0].map((v) => withField('bpm', v)),
  ...[0, 1, 2.5, 8, 512, 513, -3, '8', null, true, [], {}, 1e9, 1e300].map((v) => withField('length', v)),
  // meter: supported, unsupported, and every shape that join() prints differently
  ...[[4, 4], [3, 4], [6, 8], [12, 8], [5, 4], [4.0, 4], [2, 4], [7, 8], [4, 4, 4], [4], [], '4/4', 4, true, {}, [null, 4], [4, null], [null, null], ['a', 'b'], [true, false], [{}, 4],
    [[1, 2], 3], [[], []], [[[1, 2], [3]], 'x'], [1.5, 4], [1e21, 4], [1e-7, 4], [0.1, 0.25], [-0, 4], [-1, 4], [123456789012, 4], ['', ''], [{ a: 1 }, [null, 1]]].map((v) => withField('meter', v)),
  // groove, complexity, loose, ornaments
  ...[...Object.keys(GROOVES), '', 'nope', 'Straight', 'toString', '__proto__', 'constructor', 5, true, [], {}, ['straight']].map((v) => withField('groove', v)),
  ...['complexity', 'loose', 'ornaments'].flatMap((f) => [0, 1, 0.5, -0.001, 1.001, '0.5', true, [], {}, 1e9, -1e9].map((v) => withField(f, v))),
  // voices: every shape of the entry and of the whole
  ...[{}, [], 'x', 5, true, { drums: 'sample' }, { drums: 'nope' }, { drums: null }, { drums: 5 }, { drums: [] }, { drums: ['sample'] }, { drums: {} }, { drums: { id: null } },
    { drums: { variant: 'classic' } }, { drums: { id: 'sample', variant: 'brushes' } }, { drums: { id: 'sample', variant: 'zzz' } }, { drums: { id: 'sample', variant: null } },
    { drums: { id: 'sample', variant: 5 } }, { drums: { id: 5, variant: 5 } }, { drums: { id: 'synth', variant: 'brushes' } }, { drums: { id: true } }, { drums: { id: [] } }, { drums: { id: {}, variant: [] } },
    { chords: { id: 'sample', variant: 'organ' } }, { chords: { id: 'organ', variant: 'organ' } }, { chords: 'sample/organ' }, { chords: { id: 'sample/organ' } },
    { nope: 1 }, { nope: null }, { nope: { id: 'x' } }, { nope: { id: 7 } }, { nope: [] }, { nope: true }, { nope: {} }, { bass: 'toString' }, { bass: { id: 'constructor' } }, { bass: { id: 'string', variant: 'finger' } },
    { bass: 'string', pad: 'x', lead: { id: 'sample', variant: 'sax' }, percussion: { id: 'synth' }, chords: 'epiano' }].map((v) => withField('voices', v)),
  // jobs
  ...[{}, [], 'x', 5, true, { lead: 'riff' }, { lead: 'nope' }, { lead: null }, { lead: 5 }, { lead: [] }, { lead: {} }, { lead: true }, { percussion: 'cowbell', lead: 'off' }, { drums: 'x' }, { drums: null },
    { nope: 'x' }, { nope: null }, { nope: 5 }, { nope: [] }, { nope: {} }, { bass: 1 }, { pad: false }, { toString: 'x' }].map((v) => withField('jobs', v)),
  // form
  ...[GOOD_FORM, {}, [], 'x', 5, true, { sections: [] }, { sections: 'x' }, { sections: {} }, { sections: [SECTION], feel: 'x' }, { sections: [SECTION], feel: [] }, { sections: [SECTION], feel: { dynamics: 1.31 } },
    { sections: [SECTION], feel: { structure: 'x', pauses: -1, randomness: 2, dynamics: null } }, { sections: [SECTION], template: 5, auto: 'yes' },
    { sections: [null] }, { sections: [5] }, { sections: [[]] }, { sections: ['x'] }, { sections: [{}] }, { sections: [{ type: 'verse' }] }, { sections: [{ type: 'nope', bars: 0 }, { type: 7, bars: 65 }, { type: 'verse', bars: 1.5 }, { type: 'verse', bars: '3' }] },
    { sections: [{ ...SECTION, level: -25 }, { ...SECTION, level: 1 }, { ...SECTION, density: -2 }, { ...SECTION, density: 2 }, { ...SECTION, transition: 'x' }, { ...SECTION, crash: 'yes' }, { ...SECTION, locked: 1 }] },
    { sections: [{ ...SECTION, level: null, density: null, transition: null, crash: null, locked: null }] }, { sections: [{ ...SECTION, level: '1', density: [], transition: 5, crash: [], locked: {} }] },
    { sections: Array.from({ length: 64 }, () => ({ type: 'verse', bars: 8 })) }, { sections: Array.from({ length: 65 }, () => ({ type: 'verse', bars: 1 })) },
    { sections: Array.from({ length: 9 }, () => ({ type: 'verse', bars: 64 })) }, { sections: Array.from({ length: 8 }, () => ({ type: 'verse', bars: 64 })) }, { sections: [{ type: 'verse', bars: 1e308 }, { type: 'verse', bars: 1e308 }] },
    { sections: [{ ...SECTION, extra: 1 }], extra: 2, template: 'pop', auto: true, feel: { dynamics: 0.2, extra: 3 } }].map((v) => withField('form', v)),
  // key
  ...[{}, [], null, 'A', 5, true, { root: 'A' }, { mode: 'minor' }, { root: 'H', mode: 'minor' }, { root: 'A', mode: 'nope' }, { root: 'A', mode: 'toString' }, { root: 'A', mode: '__proto__' }, { root: 'A', mode: 5 },
    { root: 'a', mode: 'minor' }, { root: 'A#', mode: 'minor' }, { root: 'Bb', mode: 'dorian' }, { root: 'E#', mode: 'major' }, { root: 'A\n', mode: 'minor' }, { root: 'Cb', mode: 'major' }, { root: 'F#', mode: 'lydian' }, { root: ['A'], mode: 'minor' }].map((v) => withField('key', v)),
  // tags
  ...[{}, [], 'x', 5, true, { drums: ['driving'] }, { drums: ['nope'] }, { drums: 'driving' }, { drums: null }, { drums: 5 }, { drums: {} }, { drums: [5, null, [], {}, true, '', 'x', 'dry'] }, { nope: [] }, { nope: ['x'] }, { nope: 5 },
    { mood: ['dark'], bass: ['x'], rhythm: 'swing', drums: ['dry', 'heavy'], zzz: [1] }, { toString: [] }].map((v) => withField('tags', v)),
  // bars
  ...[[], {}, 'x', 5, true, null, [null], [5], ['x'], [[]], [{}], [{ chord: null }], [{ chord: [] }], [{ chord: 'A' }], [{ chord: {} }], [{ chord: { root: 5 } }], [{ chord: { root: 'A' } }, 7],
    [{ chord: { root: 'A', quality: 'nope' }, beats: 4 }], [{ chord: { root: 'A', quality: 5 }, beats: 4 }], [{ chord: { root: 'A', quality: null }, beats: 4 }], [{ chord: { root: 'A', quality: [] }, beats: 4 }],
    [{ chord: { root: 'A', quality: {} }, beats: 4 }], [{ chord: { root: 'A', quality: true }, beats: 4 }], [{ chord: { root: 'A', quality: 1e21 }, beats: 4 }], [{ chord: { root: 'A', quality: 0.1 }, beats: 4 }],
    [{ chord: { root: 'A', quality: 'toString' }, beats: 4 }], [{ chord: { root: 'A', quality: '__proto__' }, beats: 4 }], [{ chord: { root: 'X', quality: 'min' }, beats: 4 }], [{ chord: { root: 'A', quality: 'min' } }],
    [{ chord: { root: 'A', quality: 'min' }, beats: 0 }], [{ chord: { root: 'A', quality: 'min' }, beats: 16 }], [{ chord: { root: 'A', quality: 'min' }, beats: 17 }], [{ chord: { root: 'A', quality: 'min' }, beats: 1.5 }],
    [{ chord: { root: 'A', quality: 'min' }, beats: '4' }], [{ chord: { root: 'A', quality: 'min' }, beats: null }], [{ chord: { root: 'A', quality: 'min' }, beats: -0.5 }], [{ chord: { root: 'A', quality: 'min' }, beats: [] }],
    [{ chord: { root: 'C', quality: 'maj' }, beats: 4 }, { chord: { root: 'F#', quality: 'dim' }, beats: 4 }, { chord: { root: 'E', quality: 'maj' }, beats: 4 }, { chord: { root: 'E', quality: 'min' }, beats: 4 },
      { chord: { root: 'A', quality: 'sus4' }, beats: 4 }, { chord: { root: 'B', quality: 'm7b5' }, beats: 4 }, { chord: { root: 'G', quality: 'power' }, beats: 4 }, { chord: { root: 'Db', quality: 'maj' }, beats: 4 }, { chord: { root: 'a', quality: 'min' }, beats: 4 }],
    ...Object.keys(CHORDS).map((quality) => ['A', 'E', 'B', 'C', 'F#'].map((root) => ({ chord: { root, quality }, beats: 4 })))].map((v) => withField('bars', v)),
  // the other fields of normalizeTrack: defaults, null counting as missing, strings and arrays that spread into layers
  { bars: BARS }, { ...TRACK, meter: null, layers: null, jobs: null, tags: null, seed: null, form: null }, { ...TRACK, seed: 0, tags: [], layers: 'ab' }, { ...TRACK, layers: [true, false] }, { ...TRACK, layers: 5 },
  { ...TRACK, layers: { drums: false, nope: 1, pad: null, lead: 'x' } }, { ...TRACK, jobs: { lead: null, percussion: 'cowbell', nope: 1, drums: null } }, { ...TRACK, jobs: 'x' }, { ...TRACK, jobs: [] },
  { ...TRACK, form: { sections: [{ type: 'intro', bars: 2.5 }, { type: 'verse', bars: 6 }] } }, { ...TRACK, length: 3, form: GOOD_FORM }, { ...TRACK, form: { sections: [{ type: 'nope', bars: 4 }] } },
  { ...TRACK, form: { sections: [{ type: 'verse', bars: 4, junk: 1, level: null }], template: 'pop', feel: null } }, { ...TRACK, form: 5 }, { ...TRACK, form: 0 }, { ...TRACK, form: '' }, { ...TRACK, form: false },
];
trackCases(texts(hand));

// 4. texts that are no track as JSON, and what JSON.parse does with the text: the order of keys, a key twice, numbers beyond a double, white space
const good = JSON.stringify({ ...TRACK, tags: { drums: ['dry'] }, voices: { drums: 'sample' }, jobs: { lead: 'riff' } });
trackCases(['', ' ', '{', '}', 'nope', 'null', 'undefined', 'NaN', "{'a':1}", '{"a":1,}', '[1,]', '01', '{"bpm":01}', '1.', '.5', '-', '{"a" 1}', '"x', '﻿{}', '﻿' + good,
  good.slice(0, good.length - 1), good.slice(0, 40), good.slice(0, good.indexOf('"bars"') + 12), `${good} x`, `${good}{}`, `\n\t ${good}\r\n `, '{\n"bpm" : 100 ,\t"length":8}', '[]', '[1,2,3]', '5', '"x"', 'true', 'false', '{}', '[[],[]]',
  // the order of keys (integer-like keys first, ascending; the others as written) reaches the list of validate
  '{"tags":{"zz":[],"b":5,"10":[],"2":[1],"1":{},"a":["x"],"4294967294":5,"4294967295":5,"01":5,"-1":5},"voices":{"x":1,"10":2,"9":{"id":3},"bass":"nope","1":null,"drums":5,"pad":[]},"jobs":{"b":1,"2":2,"1":3,"lead":"x","percussion":"y"}}',
  '{"voices":{"lead":"nope","nope":1,"drums":"x"},"jobs":{"percussion":"x","lead":"y","nope":"z"},"tags":{"mood":["x"],"drums":["y"],"nope":[]}}',
  // a key twice: the last value, at the first one's place
  '{"bpm":"a","bpm":100,"tags":{"x":1,"drums":["dry"],"x":["y"]},"voices":{"drums":"x","bass":"y","drums":"sample"}}', '{"bars":[],"bars":' + JSON.stringify(BARS) + ',"key":{"root":"A","mode":"minor"},"bpm":100,"length":8}',
  // numbers: beyond a double, exponents, integers written as decimals, minus zero, beyond 2^53
  '{"bpm":1e999}', '{"bpm":-1e999,"length":1E3}', '{"bpm":1e-999}', '{"bpm":1.0E+2,"length":8.0}', '{"bpm":-0,"length":-0.0}', '{"bpm":12345678901234567890,"length":9007199254740993}', '{"bpm":123456789012345678901234567890}',
  '{"bpm":0.1,"length":1e2,"bars":[{"chord":{"root":"A","quality":"min"},"beats":4.0}]}', '{"complexity":1e-7,"loose":1e21,"ornaments":0.30000000000000004}', '{"meter":[4.0,4e0]}', '{"meter":[1e21,4]}',
  '{"bars":[{"chord":{"root":"A","quality":1e21},"beats":4},{"chord":{"root":"A","quality":1e-7},"beats":4},{"chord":{"root":"A","quality":123456789012345680000},"beats":4},{"chord":{"root":"A","quality":-0},"beats":4},{"chord":{"root":"A","quality":1.5e300},"beats":4}]}',
  // strings: escapes, other scripts, a key that is __proto__, an empty key
  '{"groove":"\\u0073traight","bpm":"\\ud83d\\ude00 \\u00e4\\n\\"x\\\\"}', '{"__proto__":{"bpm":100},"bpm":"x"}', '{"":1,"tags":{"":[],"a":5}}', '{"layers":"\\u00e4b\\u20ac","bpm":1}', '{"layers":"x","jobs":{"lead":"\\u00e4"}}',
  '{"__proto__":5,"layers":{"__proto__":false}}', '{"tags":{"__proto__":[1]},"voices":{"__proto__":1},"jobs":{"__proto__":1}}',
].concat([
  // an array as the track: its length is the array's length
  '[1,2,3]', '[{"bpm":100}]', JSON.stringify(Array.from({ length: 513 }, () => 1)), '[[],[]]', '[null]',
]));

// 4b. the reader's numbers, in a valid track. `bpm` (out of range for all of them: validateTrack shows it in `params`) and the unknown field `extra`
// (normalizeTrack copies it to its output unchanged) hold the parsed double, which the test compares bit for bit (a difference, however small, is not identical).
const NUMBERS = ['0.1', '0.30000000000000004', '1e21', '1e-7', '5e-324', '4.9e-324', '2.2250738585072011e-308', '1.7976931348623157e308', '1.7976931348623159e308', '9007199254740993',
  '123456789012345678901234567890', '123456789'.repeat(45).slice(0, 400), '1'.padEnd(400, '0'), `0.${'1'.repeat(398)}`, `1.${'0'.repeat(398)}1`, '1e400', '-1e400', '1e999', '1e-400', '-1e-400', '-0', '-0.0', '0e0', '-0e0', '1E5', '1e+5',
  '1.5E-3', '100', '100.0', '1e2', '4.35', '0.000001', '1e-6', '123456.789e3', '-5e-324', '2e-324', '3e-324', '2.4703282292062328e-324', '9007199254740992', '9007199254740991', '18014398509481985', '-9007199254740993'];
const numberTrack = (n) => `{"key":{"root":"A","mode":"minor"},"bpm":${n},"length":8,"extra":${n},"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]}`;
trackCases(NUMBERS.map(numberTrack));
// where the sign of an overflow, and of a zero, can be read: String(-Infinity) in a meter's message and in a chord's name (the sign of -0 never shows: String(-0) is "0")
trackCases(['1e999', '-1e999', '1e400', '-1e400', '-0', '-0.0', '-1e-400'].flatMap((n) => [
  `{"meter":[${n},4]}`, `{"bars":[{"chord":{"root":"A","quality":${n}},"beats":${n}}],"length":${n}}`]));
// texts that JSON.parse refuses, in a track and alone; and what it accepts that a stricter reader might not
const goodTrack = numberTrack('100');
trackCases(['{"bpm":+1}', '{"bpm":01}', '{"bpm":.5}', '{"bpm":1.}', '{"bpm":1e}', '{"bpm":-}', '{"bpm":1e+}', '{"bpm":-01}', '{"bpm":1.e5}', '{"bpm":--1}', '{"bpm":0x10}', '{"bpm":Infinity}', '{"bpm":NaN}', '{"bpm":1 2}',
  '+1', '01', '.5', '1.', '1e', '-', '-1', '0', '1e5', '"\\x41"', '{"bpm":"\\x41"}', '{"bpm":"a\tb"}', '{"bpm":"a\nb"}', 'tru', 'nul', 'fals', 'truee', '{"bpm":tru}', '{"bpm":"\\u12"}', '{"bpm":"\\u12G4"}', '{"bpm":"\\u00e4\\u00C4"}',
  `${goodTrack}\u0000`, `${goodTrack}\u0000${goodTrack}`, `${goodTrack},`, `${goodTrack} ${goodTrack}`, '{"bpm":1,}', '{"bpm":1,"length":8,}', '{"bars":[1,]}', '{"bars":[,1]}', '{,}', '{"bpm":1,,"length":2}', '{"bpm"}', '{"bpm":}', '{:1}', '{1:1}', '{bpm:1}',
  "{'bpm':1}", "{\"bpm\":'a'}", '{"bpm":"a}', '{"bpm":"a\\"}', '{"bpm":1}}', '[}', '{]', '{"a":[{"b":[]}]}', '[]]', '{"bpm":"\\/\\b\\f\\n\\r\\t\\\\"}',
  // a key twice (the last value, at the first one's place), a valid surrogate pair, and the pair with a lone half before it
  '{"bpm":1,"extra":2,"bpm":3}', '{"extra":1,"extra":{"a":1},"extra":[2]}', '{"bpm":"\\ud83d\\ude00","extra":"\\uD83D\\uDE00x\\ud83d\\ude00"}', '{"bars":[{"chord":{"root":"A\\ud83d\\ude00","quality":"min"},"beats":4}]}',
  '{"layers":"\\u00e4\\u20ac"}']);
// nesting: an unknown field nested exactly 64 levels deep in a valid track (the track's own object is level 1, so 63 more) equals the web; 65 does not (test_logic.cpp checks it)
const nested = (levels, inner) => `${'['.repeat(levels)}${inner}${']'.repeat(levels)}`;
trackCases([`{"key":{"root":"A","mode":"minor"},"bpm":100,"length":8,"extra":${nested(63, '1')},"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]}`,
  `{"key":{"root":"A","mode":"minor"},"bpm":100,"length":8,"extra":${'{"a":'.repeat(63)}1${'}'.repeat(63)},"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]}`,
  `{"key":{"root":"A","mode":"minor"},"bpm":${nested(63, '1')},"length":8,"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]}`,
  `{"key":{"root":"A","mode":"minor"},"bpm":100,"length":8,"meter":${nested(63, '4')},"bars":[{"chord":{"root":"A","quality":"min"},"beats":4}]}`]);

// 5. the helpers, each with inputs of its own
const REGISTER = Object.fromEntries(Object.entries(VOICES).map(([layer, ids]) => [layer, Object.fromEntries(Object.entries(ids).map(([id, v]) => [id, v.variants]))]));
const voiceInputs = [null, 0, 'x', true, [], [{ drums: 'sample' }], {}, { nope: 1 }, { drums: null }, { drums: 5 }, { drums: [] }, { drums: ['sample'] }, { drums: {} }, { drums: { id: null } }, { drums: { variant: 'brushes' } },
  { drums: { id: 'sample', variant: 'zzz' } }, { drums: { id: 'sample', variant: null } }, { drums: { id: 'sample', variant: 5 } }, { drums: { id: 'sample', variant: [] } }, { drums: { id: 'synth', variant: 'brushes' } },
  { drums: { id: 'nope', variant: 'classic' } }, { drums: { id: 5 } }, { drums: { id: ['sample'] } }, { drums: 'toString' }, { drums: { id: '__proto__' } }, { drums: { id: 'sample', variant: 'constructor' } },
  // the removed voice chords sample/organ (a sample over the whole range, since 2026-11-15 the tonewheel organ) gets its successor organ/jazz; no other pair does
  { chords: { id: 'sample', variant: 'organ' } }, { chords: { id: 'sample', variant: 'organ', extra: 1 } }, { chords: { id: 'organ', variant: 'organ' } }, { chords: { id: 'organ' } }, { chords: 'organ' },
  { chords: 'sample/organ' }, { chords: { id: 'sample/organ', variant: 'jazz' } }, { bass: { id: 'sample', variant: 'organ' } }, { drums: { id: 'sample', variant: 'organ' } }, { chords: { id: 'epiano', variant: 'organ' } },
  Object.fromEntries(Object.keys(REGISTER).map((layer) => [layer, { id: 'sample', variant: REGISTER[layer].sample[0] }])), Object.fromEntries(Object.keys(REGISTER).map((layer) => [layer, 'synth'])),
  // the whole register: every layer, every voice, as text, as a record without a variant and with each variant
  ...Object.entries(REGISTER).flatMap(([layer, ids]) => Object.entries(ids).flatMap(([id, variants]) => [{ [layer]: id }, { [layer]: { id } }, ...variants.map((variant) => ({ [layer]: { id, variant } }))]))];
add('completeVoices', completeVoices, voiceInputs);

const JOBS = Object.fromEntries(Object.entries(LAYERS).filter(([, l]) => l.jobs).map(([id, l]) => [id, l.jobs]));
add('completeJobs', completeJobs, [null, 0, 'x', true, [], ['riff'], {}, { nope: 1 }, { lead: null }, { lead: 5 }, { lead: [] }, { lead: {} }, { lead: 'nope' }, { lead: 'riff' }, { percussion: 'riff' }, { lead: 'cowbell', percussion: 'riff' },
  { lead: 'melody', percussion: 'congas', drums: 'x', bass: 'y' }, { toString: 'x' },
  ...Object.entries(JOBS).flatMap(([layer, jobs]) => jobs.map((job) => ({ [layer]: job })))]);

const SEC = { type: 'verse', bars: 8 };
const formInputs = [null, 0, 5, 'x', '', true, false, [], [SEC], {}, { sections: [] }, { sections: null }, { sections: 'x' }, { sections: {} }, { sections: [SEC] }, { sections: [SEC], feel: null },
  { sections: [SEC], feel: 'x' }, { sections: [SEC], feel: 5 }, { sections: [SEC], feel: [] }, { sections: [SEC], feel: {} }, { sections: [SEC], feel: { structure: 0.1, dynamics: 1.3, pauses: 0, randomness: 1 } },
  { sections: [SEC], feel: { structure: 1.01 } }, { sections: [SEC], feel: { dynamics: 1.31 } }, { sections: [SEC], feel: { dynamics: -0.01 } }, { sections: [SEC], feel: { pauses: 'x' } }, { sections: [SEC], feel: { randomness: null } },
  { sections: [SEC], feel: { structure: null, dynamics: 0.2, extra: 9 } }, { sections: [SEC], feel: { structure: [], pauses: {}, randomness: true } },
  { sections: [null] }, { sections: [5] }, { sections: [[]] }, { sections: ['x'] }, { sections: [{}] }, { sections: [{ type: 'verse' }] }, { sections: [{ bars: 4 }] }, { sections: [{ type: 'nope', bars: 4 }] }, { sections: [{ type: 7, bars: 4 }] },
  ...[0, 1, 64, 65, 1.5, -1, '3', null, 1e9, true].map((bars) => ({ sections: [{ type: 'verse', bars }] })),
  ...[-24, -25, 0, 1, null, '1', -0.5, true].map((level) => ({ sections: [{ ...SEC, level }] })), ...[-1, 1, -1.01, 1.01, null, '0', 0].map((density) => ({ sections: [{ ...SEC, density }] })),
  ...['none', 'fill', 'roll', 'stop', 'x', null, 5].map((transition) => ({ sections: [{ ...SEC, transition }] })), ...[true, false, null, 'yes', 1, []].flatMap((v) => [{ sections: [{ ...SEC, crash: v }] }, { sections: [{ ...SEC, locked: v }] }]),
  { sections: [{ type: 'x', bars: 0, level: 5, density: 5, transition: 'x', crash: 'x', locked: 'x' }, { type: 'y', bars: 0, level: 5 }] },
  { sections: [{ type: 'x', bars: 0 }], feel: 'x' }, { sections: [{ ...SEC, junk: 1, level: null }], template: 'pop', auto: true, extra: 1 }, { sections: [SEC], template: 5, auto: 'yes' }, { sections: [SEC], template: null, auto: null },
  { sections: Array.from({ length: 64 }, () => SEC) }, { sections: Array.from({ length: 65 }, () => ({ ...SEC, bars: 1 })) }, { sections: Array.from({ length: 9 }, () => ({ type: 'verse', bars: 64 })) },
  { sections: Array.from({ length: 8 }, () => ({ type: 'verse', bars: 64 })) }, { sections: [{ type: 'verse', bars: 64 }, ...Array.from({ length: 8 }, () => ({ type: 'verse', bars: 64 })), { type: 'x', bars: 0 }] },
  { sections: [{ type: 'verse', bars: 1e308 }, { type: 'verse', bars: 1e308 }] }, { sections: [{ type: 'verse', bars: 64 }, null, 'x', { type: 'verse', bars: 64 }] },
  { sections: Array.from({ length: 70 }, () => ({ type: 'x', bars: 0 })), feel: { dynamics: 9 } },
  ...['intro', 'verse', 'build', 'chorus', 'bridge', 'break', 'outro'].map((type) => ({ sections: [{ type, bars: 4 }] }))];
add('checkForm', (form) => { const found = []; checkForm(form, (code, params) => found.push({ code, params })); return found; }, formInputs);
add('normalizeForm', (form) => { const r = normalizeForm(form); return r === undefined ? { undefined: true } : { value: r }; }, formInputs);

const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'].flatMap((n) => [n, `${n}#`, `${n}b`]);
const MODE_IDS = ['minor', 'major', 'dorian', 'phrygian', 'lydian', 'mixolydian'];
const keyInputs = [...NOTES.flatMap((root) => MODE_IDS.map((mode) => ({ root, mode }))), { root: 'A', mode: 'minor', extra: 1 },
  null, 0, 'A', [], ['A', 'minor'], true, {}, { root: 'A' }, { mode: 'minor' }, { root: 'H', mode: 'minor' }, { root: 'a', mode: 'minor' }, { root: 'A', mode: 'nope' }, { root: 'A', mode: 'toString' }, { root: 'A', mode: '__proto__' },
  { root: 'A', mode: 'constructor' }, { root: 'A', mode: 5 }, { root: 5, mode: 'minor' }, { root: 'A#b', mode: 'minor' }, { root: 'A\n', mode: 'minor' }, { root: ['A'], mode: 'minor' }, { root: null, mode: 'minor' }];
add('allowedChords', attempt(allowedChords), keyInputs);
add('chordOptions', attempt(chordOptions), keyInputs);

const chordInputs = [...Object.keys(CHORDS).flatMap((quality) => ['A', 'C#', 'Bb', 'E'].map((root) => ({ root, quality }))), { root: 'A', quality: 'nope' }, { root: 'A' }, { quality: 'maj' }, { root: 5, quality: 'min' }, { root: null, quality: 'maj' },
  { root: ['x'], quality: 'dim' }, { root: 'A', quality: null }, { root: 'A', quality: 5 }, { root: 'A', quality: ['min'] }, { root: 'A', quality: [['dom7']] }, { root: 'A', quality: {} }, { root: 'A', quality: true },
  ...['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__lookupSetter__'].map((quality) => ({ root: 'A', quality })),
  null, 0, 'x', [], {}, [1, 2], { root: 'A', quality: 'maj', extra: 1 }, { root: 1e21, quality: 'min7' }, { root: 0.1, quality: 'maj' }, { root: '', quality: 'min' }, { root: 'Cb', quality: 'maj7' }];
add('chordName', attempt(chordName), chordInputs);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'logic.json'), JSON.stringify(cases));
console.log(`logic.json: ${cases.length} cases of ${new Set(cases.map((c) => c.fn)).size} functions`);
