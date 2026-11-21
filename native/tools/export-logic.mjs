// Writes the reference of the logic test (native/core/tests/test_logic.cpp) from the web app in the working tree (src/, read only):
//   node native/tools/export-logic.mjs <outDir>   -> <outDir>/logic-001.json, logic-002.json, ...: lists of { fn, in, out }, and
//                                                    <outDir>/logic.json: the manifest { total, chunks: [{ file, count }] } that names them in order
// One add() per function; later tasks append their functions here and in test_logic.cpp.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const { normalizeForm, checkForm, chordIndex } = await load('core/form.js');
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

// Task 26: harmony and the data of the displays (progressions.js, harmony.js, tags.js, timeline.js, fretboard.js). A function that throws in
// the web has the output { threw: true } (attempt); an argument that a case leaves out is undefined in the web, null in the core.
const { progressionFor } = await load('core/progressions.js');
const { colorChord, colorProgression, CHORD_COLORS } = await load('core/harmony.js');
const { STYLE_PRESETS, styleChordColor } = await load('core/tags.js');
const { chordTimeline } = await load('core/timeline.js');
const { fretboardNotes, nextDistinctChord, progressionRoles, romanDegree, beatsUntilChange, degreeLabel } = await load('core/fretboard.js');
const { SCALES } = await load('core/music.js');

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']; // naturals, flats and a sharp: every pitch class, both spellings
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const ALL_KEYS = ROOTS.flatMap((root) => MODE_IDS.map((mode) => ({ root, mode })));
const A_MINOR = { root: 'A', mode: 'minor' };
const bar = (root, quality, beats = 4) => ({ chord: { root, quality }, beats });
const BAD_KEYS = [null, 0, 'A', [], {}, { root: 'A' }, { mode: 'minor' }, { root: 'H', mode: 'minor' }, { root: 'A', mode: 'nope' }, { root: 'A', mode: 'toString' }, { root: 'a', mode: 'minor' }, { root: ['A'], mode: 'minor' }];

// progressionFor: 12 roots times 6 modes times seeds 1 to 50; the seed beyond what a 32-bit integer holds (>>> 0), a fraction, below zero, left out; keys it throws for
add('progressionFor', attempt(({ key, seed }) => progressionFor(key, seed)), [
  ...ALL_KEYS.flatMap((key) => SEEDS.map((seed) => ({ key, seed }))),
  ...[0, -1, 1.5, 2 ** 32 + 7, 2 ** 32 - 1, 2 ** 53].map((seed) => ({ key: A_MINOR, seed })), { key: A_MINOR },
  // a mode that is a list of one text is a mode for the key's lookups but not for `mode === 'minor'`: no dominant added, and a degree 7 is no chord ({...undefined})
  ...SEEDS.slice(0, 12).map((seed) => ({ key: { root: 'A', mode: ['minor'] }, seed })),
  ...BAD_KEYS.map((key) => ({ key, seed: 1 }))]);

// colorProgression: each of those results in each of the four colours, with beats and one more field that stay; then what its map and spread do with odd bars
const barsOf = (chords, seed) => chords.map((chord, i) => ({ chord, beats: [4, 2, 6, 3][(seed + i) % 4], ...(seed % 7 === 0 && { note: 'x' }) }));
const GOOD_BARS = [bar('A', 'min'), bar('E', 'maj7'), { chord: { root: 'D', quality: 'min', extra: 1 }, beats: 2, label: 'x' }];
add('colorProgression', attempt(({ bars, color, key }) => colorProgression(bars, color, key)), [
  ...ALL_KEYS.flatMap((key) => SEEDS.flatMap((seed) => { const bars = barsOf(progressionFor(key, seed), seed); return CHORD_COLORS.map((color) => ({ bars, color, key })); })),
  ...[null, 0, 'x', true, {}, { 0: bar('A', 'min'), length: 1 }].map((bars) => ({ bars, color: 'triads', key: A_MINOR })), { color: 'triads', key: A_MINOR },
  ...[[], [null], [0], [5], [true], ['ab'], [[1]], [[]], [{}], [{ chord: null }], [{ beats: 4 }], [{ chord: 5 }], [{ chord: 'Am' }], [{ chord: [] }], [bar('A', 'min'), null], [null, bar('A', 'min')],
    [{ chord: { root: 'A', quality: 'min' }, beats: 4, chord2: 1 }], GOOD_BARS].flatMap((bars) => ['sevenths', 'power'].map((color) => ({ bars, color, key: A_MINOR }))),
  ...['nope', '', 'toString', null, 5].map((color) => ({ bars: GOOD_BARS, color, key: A_MINOR })),
  ...BAD_KEYS.map((key) => ({ bars: GOOD_BARS, color: 'extended', key })), { bars: GOOD_BARS, color: 'extended' }]);

// colorChord alone: every quality of the register, in every colour, in a key of each mode (and spellings), on the roots of the key (the dominant too),
// on roots that are no step or are the same step spelled the other way (C# and Db), and on one that is no note; then the guards
const COLOR_KEYS = [A_MINOR, { root: 'C', mode: 'major' }, { root: 'D', mode: 'dorian' }, { root: 'E', mode: 'phrygian' }, { root: 'F', mode: 'lydian' }, { root: 'G', mode: 'mixolydian' },
  { root: 'Bb', mode: 'major' }, { root: 'F#', mode: 'minor' }, { root: 'Eb', mode: 'dorian' }];
const colorCases = COLOR_KEYS.flatMap((key) => [...new Set([...allowedChords(key).map((c) => c.root), 'C#', 'Gb', 'H'])]
  .flatMap((root) => Object.keys(CHORDS).flatMap((quality) => CHORD_COLORS.map((color) => ({ chord: { root, quality }, color, key })))));
const CHORD_GUARDS = [null, 0, 5, 'x', 'Am', [], [1], {}, { root: 'E' }, { quality: 'maj' }, { root: 'E', quality: 'nope' }, { root: 'E', quality: 'toString' }, { root: 'E', quality: '__proto__' },
  { root: 'E', quality: 'constructor' }, { root: 'E', quality: 5 }, { root: 'E', quality: null }, { root: 'E', quality: ['maj'] }, { root: 'E', quality: ['dom7'] }, { root: 'E', quality: {} }, { root: 'E', quality: true },
  { root: 'H', quality: 'maj' }, { root: 'e', quality: 'maj' }, { root: 5, quality: 'maj' }, { root: null, quality: 'maj' }, { root: ['E'], quality: 'maj' }, { root: '', quality: 'maj' }, { root: 'Ex', quality: 'maj' },
  { root: 'E', quality: 'maj', extra: 1, voicing: [1, 2] }, { root: 'E', quality: 'dom7', extra: 1 }, { root: 'F#', quality: 'power', extra: 1 }, { root: 'B', quality: 'dim', beats: 4 }];
add('colorChord', attempt(({ chord, color, key }) => colorChord(chord, color, key)), [
  ...colorCases,
  ...CHORD_GUARDS.flatMap((chord) => ['triads', 'sevenths', 'extended', 'power'].flatMap((color) => [A_MINOR, { root: 'C', mode: 'major' }].map((key) => ({ chord, color, key })))),
  ...['nope', '', 'toString', '__proto__', 'constructor', 'hasOwnProperty', 'TRIADS', 5, null, true, [], ['sevenths'], ['nope'], {}].map((color) => ({ chord: { root: 'E', quality: 'maj' }, color, key: A_MINOR })),
  { chord: { root: 'E', quality: 'maj' }, key: A_MINOR },
  ...BAD_KEYS.flatMap((key) => [{ chord: { root: 'E', quality: 'maj' }, color: 'sevenths', key }, { chord: { root: 'A', quality: 'min' }, color: 'power', key }]),
  { chord: { root: 'E', quality: 'maj' }, color: 'sevenths' }, { color: 'sevenths', key: A_MINOR },
  ...['minor', 'major', 'dorian'].flatMap((mode) => [{ chord: { root: 'E', quality: 'maj' }, color: 'extended', key: { root: 'A', mode: [mode] } }, { chord: { root: 'E', quality: 'maj' }, color: 'extended', key: { root: 'A', mode } }])]);

// styleChordColor: every style and one that is none, seeds 1 to 50, without and with variety; seeds the 32-bit conversion touches
const STYLE_IDS = [...STYLE_PRESETS.map((p) => p.id), 'nope', 'toString', null];
add('styleChordColor', attempt(({ style, seed, variety }) => styleChordColor(STYLE_PRESETS.find((p) => p.id === style), seed, variety)), [
  ...STYLE_IDS.flatMap((style) => SEEDS.flatMap((seed) => [false, true].map((variety) => ({ style, seed, variety })))),
  ...['blues', 'hardrock', 'funk'].flatMap((style) => [0, -1, 1.5, 2 ** 32 + 7, 2 ** 32 - 1].map((seed) => ({ style, seed, variety: true }))), { style: 'blues', variety: true }, { style: 'blues', seed: 3 }]);

// chordTimeline: a spread of the parity tracks (each of the ten combinations of meter and form: the first, the middle and the last; the shortest and the
// longest, the slowest and the fastest tempo, the bars of unequal length, every 40th), the guards of checkedTrack by hand and the mutation corpus on two of them
const pickIndex = new Set();
const combos = {};
parityTracks.forEach((t, i) => { (combos[`${t.meter}|${!!t.form}`] ??= []).push(i); });
for (const list of Object.values(combos)) [list[0], list[Math.floor(list.length / 2)], list.at(-1)].forEach((i) => pickIndex.add(i));
const argBy = (f, sign) => parityTracks.reduce((best, t, i) => (sign * f(t) > sign * f(parityTracks[best]) ? i : best), 0);
[...[1, -1].flatMap((s) => [argBy((t) => t.length, s), argBy((t) => t.bpm, s)]), ...parityTracks.map((t, i) => i).filter((i) => parityTracks[i].bars.some((b) => b.beats !== parityTracks[i].bars[0].beats)).slice(0, 4),
  ...parityTracks.map((t, i) => i).filter((i) => parityTracks[i].length === 512), ...parityTracks.map((t, i) => i).filter((i) => i % 40 === 0)].forEach((i) => pickIndex.add(i));
const TL = { key: A_MINOR, bpm: 100, length: 8, bars: [bar('A', 'min'), bar('D', 'min7'), bar('E', 'dom7')] };
const TL_FORM = { sections: [{ type: 'intro', bars: 2 }, { type: 'verse', bars: 6 }, { type: 'chorus', bars: 4 }] };
const tlWith = (fields) => ({ ...TL, ...fields });
const timelineHand = [
  null, 0, 'x', true, [], [1, 2, 3], {}, TL, { ...TL, extra: 1, seed: null, tags: null }, tlWith({ length: 1 }), tlWith({ length: 3 }), tlWith({ length: 512 }), tlWith({ length: 513 }), tlWith({ length: 0 }), tlWith({ length: 1.5 }), tlWith({ length: null }),
  tlWith({ length: undefined }), ...[19.99, 20, 20.5, 399.9, 400, 400.01, '100', null, 0].map((bpm) => tlWith({ bpm })),
  ...[[3, 4], [6, 8], [12, 8], [5, 4], [4, 4], [2, 4], [7, 8], null, 'x'].map((meter) => tlWith({ meter })),
  tlWith({ bars: [bar('A', 'min', 1), bar('D', 'min7', 16), bar('E', 'dom7', 3)] }), tlWith({ bars: [bar('A', 'min', 0)] }), tlWith({ bars: [bar('A', 'min', 17)] }), tlWith({ bars: [bar('A', 'min', 1.5)] }),
  tlWith({ bars: [] }), tlWith({ bars: [bar('A', 'nope')] }), tlWith({ bars: [bar('F#', 'maj')] }), tlWith({ bars: [bar('H', 'min')] }), tlWith({ bars: [null] }), tlWith({ bars: [bar('A', 'min')], length: 5 }),
  tlWith({ bars: [{ chord: { root: 'A', quality: 'min', extra: 1, voicing: [3, 4] }, beats: 4 }, bar('E', 'maj')] }), tlWith({ key: { root: 'H', mode: 'minor' } }), tlWith({ key: undefined }),
  tlWith({ form: TL_FORM }), tlWith({ form: TL_FORM, length: 99 }), tlWith({ form: { sections: [{ type: 'verse', bars: 8 }] } }), tlWith({ form: { sections: [{ type: 'verse', bars: 1 }, { type: 'chorus', bars: 1 }] }, bars: [bar('A', 'min'), bar('D', 'min7'), bar('E', 'dom7')] }),
  tlWith({ form: { sections: [{ type: 'verse', bars: 2 }, { type: 'chorus', bars: 7 }] }, bars: [bar('A', 'min', 2), bar('D', 'min7', 6), bar('E', 'dom7', 3)], meter: [6, 8], bpm: 63.7 }),
  tlWith({ form: null }), tlWith({ form: {} }), tlWith({ form: { sections: [] } }), tlWith({ form: { sections: [{ type: 'nope', bars: 4 }] } }), tlWith({ form: 'x' }), tlWith({ form: [] }),
  { ...TL, voices: { drums: 'sample' }, tags: { drums: ['driving'] }, jobs: { lead: 'riff' }, layers: [true, false], groove: 'nope' }, { ...TL, groove: 'waltz', meter: [4, 4] }, { ...TL, complexity: 2 },
  { ...TL, bars: [bar('A', 'min', 7), bar('E', 'dom7', 9), bar('D', 'min7', 11)], bpm: 133.3, length: 11 },
];
add('chordTimeline', attempt(chordTimeline), [...[...pickIndex].sort((a, b) => a - b).map((i) => parityTracks[i]), ...timelineHand, ...mutations(plain), ...mutations(formed)]);

// fretboardNotes: A minor, all 17 scales with every chord of the key as the current one (no next chord), as the next one (no current chord) and
// as the current one with the following chord next, in the standard tuning and in drop D, with the standard 22 frets and with 12; four more keys
// (the spellings, a mode each) with the following chord next; every quality of the register as the current chord; then the guards
const CHORDS_A = allowedChords(A_MINOR);
const DROP_D = [62, 59, 55, 50, 45, 38], BASS = [43, 38, 33, 28];
const SCALE_IDS = Object.keys(SCALES);
const noteCases = (key, setups, scales = SCALE_IDS) => scales.flatMap((scale) => allowedChords(key).flatMap((chord, i, list) => setups.flatMap((setup) => [
  { key, scale, current: chord, ...setup }, { key, scale, next: chord, ...setup }, { key, scale, current: chord, next: list[(i + 1) % list.length], ...setup }])));
const fretCases = [
  // all scales on the standard board (every scale's pitch classes, every chord as current and next: the flags scale, current, next, root); the tuning and the fret count change
  // only the pitch offset and the loop bound, no branch, so the drop D tuning and 12 frets run on two scales (a pentatonic one and the widest, altered)
  ...noteCases(A_MINOR, [{}]),
  ...noteCases(A_MINOR, [{ frets: 12 }, { tuning: DROP_D }, { tuning: DROP_D, frets: 12 }], ['minorPentatonic', 'altered']),
  ...[{ root: 'C', mode: 'major' }, { root: 'Bb', mode: 'dorian' }, { root: 'F#', mode: 'lydian' }, { root: 'Eb', mode: 'mixolydian' }, { root: 'E', mode: 'phrygian' }]
    .flatMap((key) => SCALE_IDS.flatMap((scale) => allowedChords(key).map((chord, i, list) => ({ key, scale, current: chord, next: list[(i + 1) % list.length] })))),
  ...['A', 'C#', 'F'].flatMap((root) => Object.keys(CHORDS).flatMap((quality) => [{ key: A_MINOR, scale: 'minorPentatonic', current: { root, quality }, next: { root: 'E', quality } }])),
];
const NOTE_BASE = { key: A_MINOR, scale: 'minor', current: { root: 'A', quality: 'min' }, next: { root: 'D', quality: 'min' } };
const fretGuards = [
  null, 5, 'x', [], ...BAD_KEYS.map((key) => ({ ...NOTE_BASE, key })), { ...NOTE_BASE, key: undefined }, { scale: 'minor' }, {},
  ...['nope', '', 'toString', '__proto__', 'constructor', 5, null, true, ['major'], ['nope'], {}, 'Minor'].map((scale) => ({ ...NOTE_BASE, scale })), { ...NOTE_BASE, scale: undefined },
  ...[null, 0, 5, 'x', 'Am', [], {}, { root: 'A' }, { quality: 'min' }, { root: 'H', quality: 'min' }, { root: 'A', quality: 'nope' }, { root: 'A', quality: 'toString' }, { root: 5, quality: 'min' }, { root: ['A'], quality: 'min' }, { root: 'A', quality: ['min'] },
    { root: 'Gb', quality: 'min' }, { root: 'C#', quality: 'maj' }, { root: 'A', quality: 'min', extra: 1 }].flatMap((chord) => [{ ...NOTE_BASE, current: chord }, { ...NOTE_BASE, next: chord }]),
  { key: A_MINOR, scale: 'minor' }, { key: A_MINOR, scale: 'minor', current: null, next: null },
  ...[[], [40], [64, 59, 55, 50, 45, 40, 35], BASS, [100, -5, 12, 0], [64, 64], undefined, null, 'abc', 5, {}, true].flatMap((tuning) => [{ ...NOTE_BASE, tuning }, { ...NOTE_BASE, tuning, frets: 5 }]),
  ...[0, 1, 5, 11, 12, 13, 24, 36, -1, 2.5, 0.5, null, undefined].map((frets) => ({ ...NOTE_BASE, frets })),
];
add('fretboardNotes', attempt(fretboardNotes), [...fretCases, ...fretGuards]);

// nextDistinctChord and progressionRoles: bars that change at the start, in the middle, at the last bar, never (one chord, the same chord twice, the same
// chord under two spellings), by the quality only; with a bar that is no chord or has an unusable root; each with lengths below, at and above the bars,
// every barIndex, no form, a form (the parts start again), a form that is not valid and what is no form
const BARSETS = [
  [bar('A', 'min'), bar('D', 'min'), bar('E', 'maj'), bar('A', 'min')], [bar('A', 'min')], [bar('A', 'min'), bar('A', 'min')], [bar('A', 'min'), bar('A', 'min'), bar('A', 'min'), bar('E', 'maj')],
  [bar('E', 'maj'), bar('A', 'min'), bar('A', 'min'), bar('A', 'min')], [bar('C#', 'min'), bar('Db', 'min'), bar('F', 'maj')], [bar('A', 'min'), bar('A', 'min7'), bar('A', 'min')],
  [bar('A', 'min'), bar('H', 'min')], [bar('A', 'min'), { beats: 4 }], [{ beats: 4 }], [bar('A', 'nope'), bar('A', 'nope'), bar('A', 'toString')], [bar('A', 'min'), bar('F#', 'dim'), bar('B', 'maj'), bar('C', 'maj'), bar('G', 'maj')],
  [bar('A', 'min'), null, bar('E', 'maj')], [bar('A', 'min', 2), bar('D', 'min', 6), bar('E', 'maj', 3)],
  // a quality that is not there (the same, undefined === undefined) and one that is an object (two of them are two objects, a bar met again is the same one)
  [{ chord: { root: 'A' }, beats: 4 }, { chord: { root: 'A' }, beats: 4 }, bar('A', 'min')], [{ chord: { root: 'A', quality: {} }, beats: 4 }, { chord: { root: 'A', quality: {} }, beats: 4 }],
  [{ chord: { root: 'A', quality: null }, beats: 4 }, { chord: { root: 'A', quality: null }, beats: 4 }, { chord: { root: 'A', quality: 1 }, beats: 4 }, { chord: { root: 'A', quality: 1.0 }, beats: 4 }],
];
const FORMS = [undefined, null, { sections: [{ type: 'verse', bars: 3 }, { type: 'chorus', bars: 5 }] }, { sections: [{ type: 'verse', bars: 8 }] }, { sections: [{ type: 'verse', bars: 2 }, { type: 'bridge', bars: 2 }, { type: 'chorus', bars: 7 }] },
  { sections: [] }, { sections: [{ type: 'nope', bars: 3 }] }, 'x', []];
// (the full product of the usual lengths, indexes and the forms that are valid; then the odd lengths and indexes with every kind of form)
const LENGTHS = [1, 2, 3, 4, 5, 8, 9, 16], ODD_LENGTHS = [0, 1.5, -1, '4', null, undefined];
const INDEXES = [null, 0, 1, 2, 3, 4, 7, 8, 15, 100], ODD_INDEXES = [undefined, -1, 1.5, '1', 1e9];
const product = (...lists) => lists.reduce((rows, list) => rows.flatMap((row) => list.map((v) => [...row, v])), [[]]);
add('nextDistinctChord', attempt(({ bars, length, barIndex, form }) => nextDistinctChord(bars, length, barIndex, form)), [
  ...product(BARSETS, LENGTHS, INDEXES, [undefined, FORMS[2], FORMS[3]]).map(([bars, length, barIndex, form]) => ({ bars, length, barIndex, form })),
  ...product(BARSETS, ODD_LENGTHS, [1], FORMS).map(([bars, length, barIndex, form]) => ({ bars, length, barIndex, form })),
  ...product(BARSETS, [4], ODD_INDEXES, FORMS).map(([bars, length, barIndex, form]) => ({ bars, length, barIndex, form })),
  ...[null, undefined, {}, 'abc', 5, [], true].map((bars) => ({ bars, length: 4, barIndex: 1 })), { length: 4, barIndex: 1 }]);
const PLAYED = [undefined, null, 0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 100, -1, -3, 1.5];
add('progressionRoles', attempt(({ track, bar }) => progressionRoles(track, bar)), [
  ...product(BARSETS, [undefined, 1, 3, 4, 5, 8, 16], FORMS.slice(0, 5), PLAYED).map(([bars, length, form, at]) => ({ track: { bars, length, form }, bar: at })),
  ...product(BARSETS.slice(0, 6), [0, 2, 9, null], [undefined, FORMS[2], FORMS[6]], [null, 0, 3, 8]).map(([bars, length, form, at]) => ({ track: { bars, length, form }, bar: at })),
  ...[null, undefined, 0, 'x', {}, { length: 4 }, { bars: null }, { bars: {} }, { bars: 'abc', length: 4 }, { bars: [], length: 4 }, { bars: [], length: 1 }, { bars: [], length: 0 }].map((track) => ({ track, bar: 0 })), { bar: 1 }]);

// romanDegree and degreeLabel: every quality on every root in keys of every mode and spelling; the guards: chords outside the key (that is the same here), roots that are no note,
// the names every object has (CHORDS['toString'] is not undefined: the web throws), no chord, no key. degreeLabel: 12 keys, pitch classes from -13 to 25
const ROMAN_KEYS = [A_MINOR, { root: 'C', mode: 'major' }, { root: 'D', mode: 'dorian' }, { root: 'F#', mode: 'phrygian' }, { root: 'Bb', mode: 'lydian' }, { root: 'Eb', mode: 'mixolydian' }];
add('romanDegree', attempt(({ key, chord }) => romanDegree(key, chord)), [
  ...ROMAN_KEYS.flatMap((key) => ROOTS.concat(['C#', 'D#', 'G#', 'A#', 'Cb', 'E#']).flatMap((root) => Object.keys(CHORDS).map((quality) => ({ key, chord: { root, quality } })))),
  ...[...CHORD_GUARDS, { root: 'A', quality: 'hasOwnProperty' }, { root: 'A', quality: 'valueOf' }, { root: 'A', quality: 'isPrototypeOf' }, { root: 'A', quality: '__defineGetter__' }, { root: 'A', quality: 'propertyIsEnumerable' }, { root: 'A', quality: 'toLocaleString' },
    { root: 'A', quality: ['min7'] }, { root: 'A', quality: ['toString'] }, { root: 'A', quality: 'min7', extra: 1 }].map((chord) => ({ key: A_MINOR, chord })),
  ...BAD_KEYS.map((key) => ({ key, chord: { root: 'A', quality: 'min' } })), { chord: { root: 'A', quality: 'min' } }, { key: A_MINOR }, {}]);
add('degreeLabel', attempt(({ key, pc }) => degreeLabel(key, pc)), [
  ...ROOTS.concat(['C#', 'F#', 'A#', 'E#', 'Cb']).flatMap((root) => Array.from({ length: 39 }, (_, i) => ({ key: { root, mode: 'major' }, pc: i - 13 }))),
  ...[0, 5, 11, 12, -12, 24, 1e9, -1e9].map((pc) => ({ key: { root: 'A', mode: 'nope' }, pc })),
  ...BAD_KEYS.map((key) => ({ key, pc: 3 })), { pc: 3 }, { key: { root: 'A' }, pc: 3 }]);

// beatsUntilChange: the tracks of the display (bars of unequal length, a form, a change at the first and at the last bar, one chord throughout, a length that is no
// multiple of the bars), at tempos from 20 to 400; times before 0, at 0, around every bar's start (a hair before and after: the rounding up has a slack of 1e-9),
// inside the bars, after the end, over several loops; then what throws (no bars, no length)
const BT = (bars, length, bpm, form) => ({ bars, length, bpm, ...(form && { form }) });
const FORM_3_5 = { sections: [{ type: 'verse', bars: 3 }, { type: 'chorus', bars: 5 }] };
const BTRACKS = [
  BT(BARSETS[0], 4, 100), BT(BARSETS[0], 8, 120.5), BT(BARSETS[0], 6, 20), BT(BARSETS[0], 7, 400), BT(BARSETS[1], 4, 100), BT(BARSETS[1], 1, 100), BT(BARSETS[2], 5, 77), BT(BARSETS[3], 4, 90), BT(BARSETS[3], 9, 90.25),
  BT(BARSETS[4], 4, 140), BT(BARSETS[4], 3, 140), BT(BARSETS[5], 3, 100), BT(BARSETS[6], 6, 64), BT(BARSETS[11], 5, 133.3), BT(BARSETS[11], 12, 61), BT(BARSETS[13], 4, 100), BT(BARSETS[13], 10, 150), BT(BARSETS[13], 3, 99),
  BT(BARSETS[0], 8, 100, FORM_3_5), BT(BARSETS[13], 8, 110, FORM_3_5), BT(BARSETS[3], 8, 100, FORM_3_5), BT(BARSETS[1], 8, 100, FORM_3_5), BT(BARSETS[0], 14, 123, FORMS[4]), BT(BARSETS[11], 10, 77, FORMS[3]),
  BT(BARSETS[0], 8, 100, FORMS[5]), BT(BARSETS[0], 8, 100, FORMS[8]),
];
const OFFSETS = [-1e-10, 0, 1e-10, 0.3, 1, 1.5, 2.0000000004, 2.9999999994]; // in beats from a bar's start
const timesOf = (t) => { // the starts of the bars as the function sums them
  const dur = (i) => (t.bars[chordIndex(t, i)].beats * 60) / t.bpm;
  let start = 0;
  const starts = Array.from({ length: t.length + 1 }, (_, i) => { const s = start; start += i < t.length ? dur(i) : 0; return s; });
  return { starts, loop: starts.at(-1) };
};
const untilCases = BTRACKS.flatMap((track) => {
  const { starts, loop } = timesOf(track);
  const secs = [-loop * 0.5, -0.001, -loop, 0, 1e-12, loop, loop * 2.5, 1e6, ...starts.flatMap((s) => OFFSETS.map((o) => s + (o * 60) / track.bpm))];
  return [...new Set([...secs, ...[-1, 2, 7].flatMap((k) => starts.slice(1, 4).map((s) => s + k * loop))])].map((songSec) => ({ track, songSec }));
});
add('beatsUntilChange', attempt(({ track, songSec }) => beatsUntilChange(track, songSec)), [...untilCases,
  ...[null, undefined, {}, { length: 4, bpm: 100 }, { bars: [], length: 4, bpm: 100 }, { bars: BARSETS[0], length: 0, bpm: 100 }, { bars: BARSETS[0], length: -1, bpm: 100 }, { bars: BARSETS[7], length: 4, bpm: 100 },
    { bars: BARSETS[8], length: 4, bpm: 100 }, { bars: BARSETS[9], length: 2, bpm: 100 }, { bars: BARSETS[0], bpm: 100 }, { bars: BARSETS[0], length: null, bpm: 100 },
    ...[0.5, 1, 1.5, 2.5, 4.5, 5].map((length) => ({ bars: BARSETS[0], length, bpm: 100 })), { bars: [], length: 0, bpm: 100 }].flatMap((track) => [0, 3.3, 5].map((songSec) => ({ track, songSec })))]);

// Task 27: rolling and editing a song form (form-roll.js, form-ui.js). What a case holds is JSON: the web is given the value of the text (roundtrip), so a field that is
// `undefined` is missing. Where `undefined` is the point (editPart's reset of a field, setLocked's value) the case says { $undefined: true } and the web gets the real thing.
// A function that throws in the web has the output { threw: true }.
const { rollForm, resolveTemplate, TEMPLATE_IDS, STYLE_TEMPLATE, TARGET_SIZES } = await load('core/form-roll.js');
const { limits, editPart, setLocked, addPart, copyPart, deletePart, movePart } = await load('ui/form-ui.js');
const { PART_TYPES, TRANSITIONS } = await load('core/form-types.js');
const roundtrip = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// rollForm. 1. The product: the five templates and auto, the nine styles and an unknown one, the seven target sizes, the structure at 0, 0.6 and 1, seeds 1 to 20; each a second
// time with the first roll as `previous`, every third part (the offset follows the seed) locked.
const roll = (args) => { const input = roundtrip(args); const out = rollForm(input); cases.push({ fn: 'rollForm', in: input, out }); return out; };
const lockEvery = (form, step, offset) => ({ ...form, sections: form.sections.map((s, i) => ((i + offset) % step === 0 ? { ...s, locked: true } : s)) });
const rollTwice = (args, seed) => { const first = roll(args); roll({ ...args, previous: lockEvery(first, 3, seed % 3) }); };
const ROLL_TEMPLATES = ['auto', ...TEMPLATE_IDS];
for (const template of ROLL_TEMPLATES) for (const style of [...Object.keys(STYLE_TEMPLATE), 'nope']) for (const targetBars of TARGET_SIZES) for (const structure of [0, 0.6, 1])
  for (let seed = 1; seed <= 20; seed++) rollTwice({ template, style, targetBars, feel: { structure }, seed }, seed);
// 2. The development tags, each alone and together (and one twice), on a thinner product: both styles that decide nothing (an unknown one, where the tag picks the template, and psych)
const DEV_SETS = [['buildsSlowly'], ['fullFromStart'], ['withBreakouts'], ['buildsSlowly', 'fullFromStart'], ['buildsSlowly', 'withBreakouts'], ['fullFromStart', 'withBreakouts'],
  ['buildsSlowly', 'fullFromStart', 'withBreakouts'], ['withBreakouts', 'withBreakouts', 'buildsSlowly']];
for (const template of ROLL_TEMPLATES) for (const style of ['nope', 'psych']) for (const development of DEV_SETS) for (const targetBars of [24, 48, 96, 192]) for (const structure of [0.6, 1])
  for (let seed = 1; seed <= 5; seed++) rollTwice({ template, style, targetBars, feel: { structure }, seed, tags: { development } }, seed);
// 3. What a branch needs that the product does not reach: arguments of every kind (each field alone, the others as BASE), and a previous form of every kind
const ROLL_BASE = { template: 'pop', style: 'funk', targetBars: 48, seed: 3 };
[null, 0, 'x', true, [], {}, [ROLL_BASE], { template: 'pop', targetBars: 96 }].forEach(roll);
const rollWith = (fields, seeds = [3]) => seeds.forEach((seed) => roll({ ...ROLL_BASE, seed, ...fields }));
[undefined, null, 'auto', 'nope', '', 5, true, [], {}, ['pop'], 'Pop', 'toString', 'jam', 'blues'].forEach((template) => rollWith({ template }, [1, 2, 3]));
[undefined, null, 5, '', 'nope', 'toString', '__proto__', 'constructor', 'hasOwnProperty', ['funk'], {}, true, ...Object.keys(STYLE_TEMPLATE)].forEach((style) => rollWith({ template: 'auto', style }, [1, 2]));
[undefined, null, 'x', '48', true, [], {}, 0, -5, 10, 24, 28, 30, 40, 48.5, 80, 112, 144, 160, 1000, 1e308, -1e308, 5e-324, 24.0000001].forEach((targetBars) =>
  ['auto', 'pop', 'blues'].forEach((template) => rollWith({ template, targetBars }, [1, 2])));
[undefined, null, 0, 'x', true, [], [0.5], {}, { structure: -1 }, { structure: 2 }, { structure: 0.3 }, { structure: 1e308 }, { structure: '0.8' }, { structure: null }, { structure: true }, { dynamics: 1.3 },
  { dynamics: 5 }, { dynamics: -3 }, { pauses: 0.1, randomness: 0.9 }, { structure: 0.45, dynamics: 0.2, pauses: 1, randomness: 0 }, { structure: 0.3, extra: 1 }, { structure: [0.5] }].forEach((feel) =>
  ['pop', 'rock', 'blues'].forEach((template) => rollWith({ template, feel }, [1, 2, 3, 4])));
[undefined, null, 0, 1, -1, 1.5, 0.5, -0.5, 2 ** 31, 2 ** 32, 2 ** 32 + 7, 2 ** 32 - 1, 4294967296.5, 2 ** 53, -(2 ** 53), 1e300, -1e300, 1e308, '5', true, [], [5], {}, '', 'x'].forEach((seed) =>
  ['auto', 'rock'].forEach((template) => roll({ ...ROLL_BASE, template, targetBars: 96, seed })));
[undefined, null, 5, 'x', [], {}, { development: null }, { development: 'buildsSlowly' }, { development: {} }, { development: [] }, { development: [5, null, 'x', ['buildsSlowly'], {}, true] }, { development: ['buildsSlowly', 5] },
  { development: ['toString', 'constructor', '__proto__', 'hasOwnProperty'] }, { development: ['buildsSlowly', 'buildsSlowly'] }, { development: ['fullFromStart', 'buildsSlowly'] }, { development: ['buildsSlowly'], mood: ['x'] }].forEach((tags) =>
  ['auto', 'pop'].forEach((template) => ['nope', 'funk'].forEach((style) => rollWith({ template, style, tags }, [1, 2]))));
// every single part locked, the last, the first and the last, two next to each other, every second, all, none: of forms of every template, with the same template and another one
for (const [t, template] of ['jam', 'pop', 'buildDrop', 'blues', 'rock'].entries()) for (const targetBars of [32, 96]) for (let seed = 1; seed <= 6; seed++) {
  const args = { template, targetBars, seed, feel: { structure: 0.6 } };
  const first = roll(args);
  const n = first.sections.length, all = Array.from({ length: n }, (_, i) => i);
  const patterns = [...all.slice(0, 12).map((i) => [i]), [n - 1], [0, n - 1], [1, 2], all, all.filter((i) => i % 2), [], [n - 2, n - 1]];
  for (const locks of patterns) {
    const previous = { ...first, sections: first.sections.map((s, i) => (locks.includes(i) ? { ...s, locked: true } : s)) };
    for (const other of [template, ROLL_TEMPLATES[(t + 2) % 6]]) roll({ ...args, template: other, previous });
  }
}
const locked = (type, bars, extra) => ({ type, bars, locked: true, ...extra });
const PREVIOUS = [
  { sections: Array.from({ length: 64 }, () => locked('verse', 8)) }, // 64 locked parts, 512 bars
  { sections: Array.from({ length: 64 }, () => locked('verse', 64)) }, // each valid, together 4096 bars
  { sections: Array.from({ length: 70 }, () => locked('verse', 4)) }, // beyond the parts: the web reads 64 of them
  { sections: Array.from({ length: 9 }, () => locked('chorus', 64)) },
  { sections: [locked('outro', 8), locked('intro', 4), locked('bridge', 4), locked('chorus', 8)] },
  { sections: [locked('intro', 4)] }, { sections: [locked('outro', 4)] }, { sections: [locked('bridge', 8)] }, { sections: [locked('break', 8), locked('build', 4)] },
  { sections: [locked('verse', 8, { level: -3, density: 0.5, transition: 'roll', crash: true, junk: 1 }), locked('chorus', 8, { level: null, density: null, transition: null })], feel: { structure: 0.1 }, template: 'blues', auto: true },
  { sections: [locked('nope', 8), locked('verse', 0), locked('verse', 65), locked('verse', 2.5), locked('verse', 8, { level: 5 }), locked('verse', 8, { transition: 'x' }), locked('verse', 8, { crash: 1 }),
    locked('verse', 8, { density: -2 }), locked('verse', 8, { locked: 'yes' }), { type: 'verse', bars: 8, locked: 'true' }, { type: 'verse', bars: 8, locked: 1 }, { type: 'verse', bars: 8 }, locked('chorus', 8)] },
  { sections: [null, 5, 'x', [], { locked: true }, locked('verse', 8)] }, { sections: 'x' }, { sections: {} }, { sections: null }, [], 'x', 5, true, {}, null,
  // one part longer than a small target allows (nothing is left to take away), two bridges (a guard rail the roll cannot mend), parts so short that the draw falls far under the target
  { sections: [locked('verse', 64)] }, { sections: [locked('chorus', 64)] }, { sections: [locked('verse', 32)] },
  { sections: [locked('verse', 8), locked('chorus', 8), locked('bridge', 4), locked('chorus', 8), locked('bridge', 4), locked('chorus', 8)] },
  { sections: [locked('verse', 1)] }, { sections: [locked('verse', 4)] }, { sections: [locked('verse', 2), locked('chorus', 2)] }, { sections: [locked('intro', 2), locked('verse', 4), locked('chorus', 4)] },
];
for (const previous of PREVIOUS) for (const template of [...TEMPLATE_IDS]) for (const targetBars of [24, 96, 192]) for (const feel of [undefined, { structure: 0 }]) rollWith({ template, targetBars, previous, feel }, [1, 2]);
// previous forms of random parts, locked or not (a small generator of its own: the cases must not change from run to run): the draw falls under the target or far above it, and the fit has to grow parts
let lcg = 12345;
const random = () => { lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0; return lcg / 4294967296; };
const choose = (list) => list[Math.floor(random() * list.length)];
for (let i = 0; i < 2000; i++) {
  const sections = Array.from({ length: 1 + Math.floor(random() * 10) }, () => ({ type: choose(PART_TYPES), bars: choose([1, 2, 3, 4, 8, 12, 16, 32, 64]), locked: random() < 0.75 }));
  roll({ template: choose(TEMPLATE_IDS), targetBars: choose(TARGET_SIZES), seed: 1 + Math.floor(random() * 50), feel: { structure: choose([0, 0.3, 0.6, 1]) }, previous: { sections } });
}

// Inputs that make a branch of form-roll.js matter, which random forms reach rarely or not at all. They are found by probes: copies of form-roll.js outside src/ (written to a temporary
// directory), one that counts how often the type search of assignTypes runs into its budget, and for each other branch one without it. The first inputs of a fixed stream (or list)
// of candidates on which the copy without the branch answers otherwise than the real function are kept: a core without the branch fails on them. The export fails if a family finds too few.
// The branches: the cut of a previous form to 64 parts, the bridge, the fit and the unit growth at 64 parts, the `ok` of the score, the filler of 8 bars, the growth of a main part.
const probeDirectory = mkdtempSync(join(tmpdir(), 'btg-probe-'));
const probeSource = readFileSync(join(src, 'core/form-roll.js'), 'utf8').replace(/from '(\.\/[^']+)'/g, (match, path) => `from '${pathToFileURL(join(src, 'core', path)).href}'`);
const probeVariant = async (name, swaps) => {
  let text = probeSource;
  for (const [from, to] of swaps) {
    if (!text.includes(from)) throw new Error(`form-roll.js no longer has "${from}": the probe "${name}" cannot be made`);
    text = text.replace(from, to);
  }
  writeFileSync(join(probeDirectory, `${name}.mjs`), text);
  return import(pathToFileURL(join(probeDirectory, `${name}.mjs`)).href);
};
globalThis.btgBudgetOverruns = 0;
const counting = await probeVariant('counting', [['if (++nodes > SEARCH_BUDGET) return false;', 'if (++nodes > SEARCH_BUDGET) { globalThis.btgBudgetOverruns++; return false; }']]);
const WITHOUT = {
  cut: [['.slice(0, FORM_LIMITS.parts)', '']],
  bridgeParts: [['sections.length >= FORM_LIMITS.parts ||', '']],
  rangeParts: [['diff > 0 && items.length < FORM_LIMITS.parts', 'diff > 0']],
  unitParts: [['if (!unit || items.length >= FORM_LIMITS.parts) return;', 'if (!unit) return;']],
  scoreOk: [[' + (ok ? 0 : 1) }', ' }']],
  fillerOptions: [['lengthOptions([PHRASE, 2 * FILLER_BARS])', 'lengthOptions([PHRASE, FILLER_BARS])']],
  mainFirst: [['const c = room.some(isMain) ? room.filter(isMain) : room;', 'const c = room;']],
};
const variants = {};
for (const [name, swaps] of Object.entries(WITHOUT)) variants[name] = await probeVariant(name, swaps);
rmSync(probeDirectory, { recursive: true, force: true });
const stream = (seed) => { // a stream of its own for each family: the cases do not change from run to run
  let state = seed;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return { next, choose: (list) => list[Math.floor(next() * list.length)] };
};
const TEMPLATE_NAMES = [...TEMPLATE_IDS];
const find = (what, wanted, make, tries, hit) => {
  const found = [];
  let tried = 0;
  for (; tried < tries && found.length < wanted; tried++) {
    const args = make();
    if (hit(roundtrip(args))) found.push(args);
  }
  console.log(`  ${found.length} inputs ${what}: ${tried} candidates tried`);
  if (found.length < wanted) throw new Error(`only ${found.length} of ${wanted} inputs ${what} in ${tries} tries: form-roll.js has changed?`);
  return found;
};
const findOverruns = (wanted, make, tries) => find('run the type search into its budget', wanted, make, tries, (args) => { const before = globalThis.btgBudgetOverruns; counting.rollForm(args); return globalThis.btgBudgetOverruns > before; });
const findKills = (branch, wanted, make, tries) => find(`tell the roll without "${branch}" from the roll`, wanted, make, tries, (args) => JSON.stringify(variants[branch].rollForm(roundtrip(args))) !== JSON.stringify(rollForm(roundtrip(args))));
{
  // 1. up to 24 parts, about one in five locked: the type search of assignTypes ends at its budget of 3000 nodes (one roll of such an input ends it up to 60 times)
  const { next, choose } = stream(424242);
  const overruns = findOverruns(24, () => ({ template: choose(TEMPLATE_NAMES), targetBars: choose(TARGET_SIZES), seed: 1 + Math.floor(next() * 50), feel: { structure: choose([0, 0.3, 0.6, 1]) },
    previous: { sections: Array.from({ length: 1 + Math.floor(next() * 24) }, () => ({ type: choose(PART_TYPES), bars: choose([1, 2, 3, 4, 8, 12, 16, 32, 64]), locked: next() < 0.2 })) } }), 40000);
  if (new Set(overruns.map((a) => a.template)).size < 3 || new Set(overruns.map((a) => a.targetBars)).size < 3) throw new Error('the inputs of the search budget are of too few templates or targets');
  overruns.forEach(roll);
}
{
  // 2. the limits of 64 parts, in a previous form of 20 to 70 places, most of them locked, 1 to 4 bars: the fit meets exactly 64 parts with bars still to add (fitInRange, and
  // fitAnyLength for a unit: blues), a bridge would be the 65th part, and a locked part stands beyond the 64th place (the cut of lockedParts)
  const { next, choose } = stream(31337);
  const make = (lengths, shares) => () => {
    const mixed = next() < 0.5, lockedShare = choose(shares);
    const sections = Array.from({ length: choose(lengths) }, (_, i) => ({ type: mixed ? choose(['intro', 'verse', 'build', 'chorus', 'break', 'outro']) : i % 2 ? 'chorus' : 'verse', bars: choose([1, 1, 2, 3, 4]), locked: next() < lockedShare }));
    return { template: choose(TEMPLATE_NAMES), targetBars: choose([64, 96, 128, 192]), seed: 1 + Math.floor(next() * 50), feel: { structure: choose([0, 0.3, 0.6, 1]) }, previous: { sections } };
  };
  const nearly64 = make([20, 30, 40, 50, 55, 58, 60, 62, 63, 64], [0.5, 0.8, 0.95, 1]);
  findKills('rangeParts', 3, nearly64, 40000).forEach(roll);
  findKills('unitParts', 4, nearly64, 40000).forEach(roll);
  // (verses and choruses of 1 or 2 bars, template pop or rock: the only ones with a bridge)
  const bridgeForms = ['pop', 'rock'].flatMap((template) => [50, 52, 54, 56, 57, 58, 59, 60, 61, 62, 63, 64].flatMap((places) => [128, 192].flatMap((targetBars) =>
    Array.from({ length: 6 }, (_, i) => i + 1).flatMap((seed) => [1, 2].map((bars) => ({ template, targetBars, seed, previous: { sections: Array.from({ length: places }, (_, i) => locked(i % 2 ? 'chorus' : 'verse', bars)) } }))))));
  let candidate = 0;
  findKills('bridgeParts', 3, () => bridgeForms[candidate++], bridgeForms.length).forEach(roll);
  const cutForm = () => ({ template: choose(['pop', 'rock']), targetBars: choose([96, 128]), seed: 1 + Math.floor(next() * 50), feel: { structure: choose([0.6, 1]) },
    previous: { sections: Array.from({ length: choose([65, 66, 70]) }, (_, i) => ({ type: i % 2 ? 'chorus' : 'verse', bars: choose([1, 1, 2]), locked: next() < choose([0.8, 0.9, 0.95]) })) } });
  findKills('cut', 6, cutForm, 40000).forEach(roll);
}
{
  // 3. one to three locked parts of a kind that does not fit where it stands (a bridge, an intro or an outro in the middle, a break), among free ones: the type search fails
  // while the guard rails count no fault and the length is right
  // (the shapes: places, and the locked parts of them as [place, type, bars]; every shape with the three templates, four targets, structure 0.6 and 1, seeds 1 to 50)
  const SHAPES = [[4, [[1, 'chorus', 48], [3, 'bridge', 12]]], [6, [[2, 'intro', 24], [3, 'intro', 8], [5, 'bridge', 24]]], [10, [[1, 'intro', 48], [4, 'break', 8]]],
    [13, [[0, 'chorus', 16], [1, 'verse', 4], [2, 'outro', 3], [5, 'break', 2]]], [6, [[5, 'outro', 1]]]];
  const candidates = SHAPES.flatMap(([places, locks]) => ['buildDrop', 'rock', 'pop'].flatMap((template) => [32, 48, 64, 96].flatMap((targetBars) => [0.6, 1].flatMap((structure) =>
    Array.from({ length: 50 }, (_, i) => ({ template, targetBars, seed: i + 1, feel: { structure },
      previous: { sections: Array.from({ length: places }, (_, place) => { const lock = locks.find(([at]) => at === place); return lock ? { type: lock[1], bars: lock[2], locked: true } : { type: 'verse', bars: 8, locked: false }; }) } }))))));
  let candidate = 0;
  findKills('scoreOk', 5, () => candidates[candidate++], candidates.length).forEach(roll);
}
{
  // 4. one locked outro of 1 bar behind four to nine places: the draw has fewer parts than there are places before it, so the places are filled with fillers of 8 bars, and the fit has bars to add
  const candidates = [4, 5, 6, 7, 8, 9].flatMap((places) => ['buildDrop', 'rock', 'pop'].flatMap((template) => [32, 48, 64, 96, 128].flatMap((targetBars) => [0.6, 1].flatMap((structure) =>
    Array.from({ length: 50 }, (_, i) => ({ template, targetBars, seed: i + 1, feel: { structure },
      previous: { sections: Array.from({ length: places }, (_, place) => (place === places - 1 ? { type: 'outro', bars: 1, locked: true } : { type: 'verse', bars: 8, locked: false })) } }))))));
  let candidate = 0;
  findKills('fillerOptions', 3, () => candidates[candidate++], candidates.length).forEach(roll);
}
{
  // 5. the fit has to grow parts, and has a main part (verse, chorus) and another one to choose from: one to four locked parts, any type, any length
  const { next, choose } = stream(2468);
  // (build & drop has the parts of every kind: the build and the break are no main parts)
  findKills('mainFirst', 6, () => ({ template: 'buildDrop', targetBars: choose([64, 96, 128, 192]), seed: 1 + Math.floor(next() * 50), feel: { structure: choose([0, 0.3, 0.6]) },
    previous: { sections: Array.from({ length: 1 + Math.floor(next() * 3) }, () => ({ type: choose(PART_TYPES), bars: choose([2, 3, 4, 6, 8, 12, 16, 24, 32]), locked: true })) } }), 20000).forEach(roll);
}
// The budget again, by hand: the input of the review (ten free parts before a locked part of 64 bars; the roll ends the search 63 times) and its family: n free parts, then a locked break or
// build of 64 bars, rock and pop, targets 48, 96 and 192, seeds 1 to 5
const FREE_TYPES = ['break', 'build', 'outro', 'outro', 'outro', 'build', 'intro', 'outro', 'bridge', 'break'];
roll({ template: 'rock', targetBars: 96, seed: 18, feel: { structure: 1 }, previous: { sections: [...[4, 4, 32, 32, 32, 12, 16, 12, 16, 4].map((bars, i) => ({ type: FREE_TYPES[i], bars })), locked('break', 64)] } });
for (const n of [6, 8, 10, 12]) for (const last of ['break', 'build']) for (const template of ['rock', 'pop']) for (const targetBars of [48, 96, 192]) for (let seed = 1; seed <= 5; seed++)
  roll({ template, targetBars, seed, feel: { structure: 1 }, previous: { sections: [...Array.from({ length: n }, (_, i) => ({ type: FREE_TYPES[i % 10], bars: 4 })), locked(last, 64)] } });
// The limits of 64 parts in rolling: a previous of 66 locked parts of 1 to 3 bars, the last two free (the web reads 64 of the parts; the roll appends behind the 64th); each template at 192 bars
// with 64 locked parts of 1 bar (the draw is appended behind the last lock and only the final cut to 64 parts removes it), the parts all verses and alternating verse and chorus
roll({ template: 'rock', targetBars: 128, seed: 18, feel: { structure: 0.6 }, previous: { sections: Array.from({ length: 66 }, (_, i) => ({ type: i % 2 ? 'chorus' : 'verse', bars: 1 + (i % 3), locked: i < 64 })) } });
for (const template of TEMPLATE_IDS) for (let seed = 1; seed <= 3; seed++) for (const alternating of [false, true])
  roll({ template, targetBars: 192, seed, previous: { sections: Array.from({ length: 64 }, (_, i) => locked(alternating && i % 2 ? 'chorus' : 'verse', 1)) } });
// blues: locked parts that leave the total 1 to 11 bars from a multiple of its unit of 12 (the total is the target within 5 or 6 bars)
for (const targetBars of TARGET_SIZES) for (const at of [0, 1, 2]) for (let bars = 1; bars <= 11; bars++) for (let seed = 1; seed <= 3; seed++)
  roll({ template: 'blues', targetBars, seed, previous: { sections: Array.from({ length: at + 1 }, (_, i) => (i === at ? locked('verse', bars) : { type: 'verse', bars: 12 })) } });

// resolveTemplate: the template (or auto), the style and the tags, each of every kind
const RT_STYLES = [undefined, null, ...Object.keys(STYLE_TEMPLATE), 'nope', '', 5, 'toString', '__proto__', 'constructor', 'hasOwnProperty', ['funk'], {}, true];
const RT_TAGS = [undefined, null, 5, 'x', [], {}, { development: ['buildsSlowly'] }, { development: ['fullFromStart'] }, { development: ['buildsSlowly', 'fullFromStart'] }, { development: ['withBreakouts'] },
  { development: ['withBreakouts', 'buildsSlowly'] }, { development: 'buildsSlowly' }, { development: [5, 'buildsSlowly'] }, { development: null }, { development: {} }];
for (const template of [undefined, null, 'auto', ...TEMPLATE_IDS, 'nope', '', 5, true, [], {}, ['pop'], 'Pop', 'AUTO', 'toString', '__proto__']) for (const style of RT_STYLES) for (const tags of RT_TAGS) {
  const input = roundtrip({ template, style, tags });
  cases.push({ fn: 'resolveTemplate', in: input, out: resolveTemplate(input.template, input.style, input.tags) });
}

// The editing. A case is { form, index, patch | locked | dir }; the web gets the form as JSON and the patch and `locked` as they are (with their `undefined`s)
const CALLS = { limits: ({ form, index }) => limits(form, index), editPart: ({ form, index, patch }) => editPart(form, index, patch), setLocked: ({ form, index, locked }) => setLocked(form, index, locked),
  addPart: ({ form }) => addPart(form), copyPart: ({ form, index }) => copyPart(form, index), deletePart: ({ form, index }) => deletePart(form, index), movePart: ({ form, index, dir }) => movePart(form, index, dir) };
const edit = (fn, input) => {
  const encoded = { ...input };
  if (input.patch) encoded.patch = Object.fromEntries(Object.entries(input.patch).map(([k, v]) => [k, v === undefined ? { $undefined: true } : v]));
  if ('locked' in input && input.locked === undefined) encoded.locked = { $undefined: true };
  let out;
  try { out = CALLS[fn]({ ...input, form: roundtrip(input.form) }); } catch { out = { threw: true }; }
  cases.push({ fn, in: encoded, out });
};
// 30 rolled forms, a fixed choice over the templates, styles, sizes and seeds; the odd ones with every third part locked
const EDIT_FORMS = Array.from({ length: 30 }, (_, i) => {
  const form = rollForm({ template: ROLL_TEMPLATES[i % 6], style: Object.keys(STYLE_TEMPLATE)[i % 9], targetBars: TARGET_SIZES[(i * 3) % 7], seed: 1 + i * 7, feel: { structure: [0.6, 1, 0.3][i % 3] } });
  return i % 2 ? lockEvery(form, 3, i % 3) : form;
});
const patchesFor = (part) => [
  ...[...PART_TYPES, 'x', null, undefined, 5].map((type) => ({ type })),
  ...[1, 2, part.bars - 1, part.bars + 1, 64, 65, 0, -1, 2.5, 0.4, 1e9, null, undefined].map((bars) => ({ bars })),
  ...[-24, -25, -3.3, 0, 1, null, 'x', undefined].map((level) => ({ level })), ...[-1, -2, 0.5, 1, 2, null, '0.5', undefined].map((density) => ({ density })),
  ...[...TRANSITIONS, 'x', null, undefined].map((transition) => ({ transition })), ...[true, false, 'x', null, undefined].map((crash) => ({ crash })),
  {}, { locked: true }, { foo: 1 }, { type: 'chorus', bars: 12, level: -2, density: 0.3, transition: 'roll', crash: true }, { level: undefined, density: undefined }, { type: 'bridge', transition: undefined },
  { bars: 7, extra: 1 }, { type: 'verse', bars: null }, { bars: 4, level: 'x' },
];
const OUTSIDE = (n) => [-1, n, n + 1, 1.5, 1e9, -0.5]; // an index that is no part
for (const form of EDIT_FORMS) {
  const n = form.sections.length;
  form.sections.forEach((part, index) => {
    for (const patch of patchesFor(part)) edit('editPart', { form, index, patch });
    for (const locked of [true, false, undefined, null, 1, 'x']) edit('setLocked', { form, index, locked });
    for (const dir of [-1, 1, 0, 2, -2, 1.5, 1e9]) edit('movePart', { form, index, dir });
    for (const fn of ['copyPart', 'deletePart', 'limits']) edit(fn, { form, index });
  });
  edit('addPart', { form });
  for (const index of OUTSIDE(n)) {
    for (const fn of ['copyPart', 'deletePart', 'limits']) edit(fn, { form, index });
    edit('setLocked', { form, index, locked: true }); edit('editPart', { form, index, patch: { type: 'chorus' } });
    for (const dir of [1, -1]) edit('movePart', { form, index, dir });
  }
}
// the limits: 64 parts, a part of 64 bars, 512 bars, the room for one more part of 8 bars to the bar, the first and the last part, the only part
const sec = (type, bars, extra) => ({ type, bars, ...extra });
const formOf = (sections) => ({ template: 'pop', auto: false, feel: { structure: 0.6, dynamics: 0.6, pauses: 0.4, randomness: 0.5 }, sections });
const times = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const LIMIT_FORMS = [
  formOf(times(64, (i) => sec(i % 2 ? 'chorus' : 'verse', 8, i % 3 === 0 ? { locked: true } : {}))), // 64 parts, 512 bars
  formOf(times(64, () => sec('verse', 1))), // 64 parts, 64 bars
  formOf([...times(63, () => sec('verse', 1)), sec('chorus', 64)]), // 64 parts, 127 bars, one of 64
  formOf([...times(62, () => sec('verse', 8)), sec('chorus', 7)]), // 63 parts, 503 bars: room for 8 (511)
  formOf([...times(62, () => sec('verse', 8)), sec('chorus', 8)]), // 504 bars: room for exactly 8
  formOf([...times(62, () => sec('verse', 8)), sec('chorus', 9)]), // 505 bars: none
  formOf(times(8, () => sec('verse', 64))), // 512 bars in 8 parts of 64
  formOf([...times(7, () => sec('verse', 64)), sec('outro', 63)]), // 511 bars
  formOf([...times(7, () => sec('verse', 64)), sec('outro', 62)]), // 510 bars
  formOf([sec('verse', 64)]), formOf([sec('verse', 1)]), formOf([sec('verse', 8, { locked: true })]), formOf([sec('intro', 2), sec('outro', 2)]),
  formOf(times(65, () => sec('verse', 1))), // beyond the parts of a valid form
];
const LIMIT_PATCHES = (part) => [{ bars: part.bars + 1 }, { bars: part.bars - 1 }, { bars: 64 }, { bars: 1 }, { type: 'chorus' }, { level: -5 }, { level: undefined }, {}];
for (const form of LIMIT_FORMS) {
  const n = form.sections.length;
  form.sections.forEach((part, index) => {
    for (const patch of LIMIT_PATCHES(part)) edit('editPart', { form, index, patch });
    for (const locked of [true, false]) edit('setLocked', { form, index, locked });
    for (const dir of [-1, 1]) edit('movePart', { form, index, dir });
    for (const fn of ['copyPart', 'deletePart', 'limits']) edit(fn, { form, index });
  });
  edit('addPart', { form });
  for (const index of OUTSIDE(n)) for (const fn of ['copyPart', 'deletePart', 'limits']) edit(fn, { form, index });
}
// parts that are no parts, forms that are none: what the web does with them (a form without a list of parts throws)
const ODD_FORMS = [
  { sections: [{ type: 'verse' }] }, { sections: [{ type: 'verse', bars: 8 }, null, { type: 'chorus', bars: 8 }] }, { sections: [5, 'x', [], {}, 0, '', false] }, { sections: [{ type: 'verse', bars: 8 }], feel: { dynamics: 9 } },
  { sections: [{ type: 'verse', bars: 8, level: 5 }] }, { sections: [{ type: 'nope', bars: 8 }] }, { sections: [{ type: 'verse', bars: 1.5 }] }, { sections: [{ type: 'verse', bars: null }] },
  { sections: [{ type: 'verse', bars: 8 }], extra: 1, template: 'pop', auto: true, feel: null }, { sections: [{ type: 'verse', bars: 8 }] }, { sections: [] }, { sections: [{ type: 'verse', bars: 600 }] },
  { sections: [{ type: 'verse', bars: 8, locked: 'yes' }, { type: 'chorus', bars: 8, locked: null }] }, { sections: [{ type: 'verse', bars: 8, level: -3, density: 0.2, transition: 'roll', crash: true, extra: 1 }] },
  null, undefined, 0, 'x', true, [], {}, { sections: null }, { sections: undefined }, [{ type: 'verse', bars: 8 }],
];
for (const form of ODD_FORMS) for (const index of [0, 1, 2, 5, -1])
  for (const input of [{ patch: { type: 'chorus' } }, { patch: { bars: 4 } }, { patch: { level: -3 } }, { patch: { transition: 'roll' } }, { patch: {} }, { patch: { level: undefined } }]) edit('editPart', { form, index, ...input });
for (const form of ODD_FORMS) for (const index of [0, 1, 2, -1]) {
  for (const fn of ['copyPart', 'deletePart', 'limits']) edit(fn, { form, index });
  for (const locked of [true, undefined, null]) edit('setLocked', { form, index, locked });
  for (const dir of [-1, 1, 0]) edit('movePart', { form, index, dir });
}
for (const form of ODD_FORMS) edit('addPart', { form });

// The cases go to chunk files (logic-001.json, ...: each a JSON list of cases, a new one begun once the current passes CHUNK_BYTES), so that the
// test never holds the whole reference; logic.json is the manifest: { total, chunks: [{ file, count }] } in the order of the cases.
const CHUNK_BYTES = 16e6;
mkdirSync(outDir, { recursive: true });
for (const name of readdirSync(outDir)) if (/^logic(-\d+)?\.json$/.test(name)) rmSync(join(outDir, name)); // chunks of an earlier run
const chunks = [];
let pending = [], pendingBytes = 0;
const flush = () => {
  if (!pending.length) return;
  const file = `logic-${String(chunks.length + 1).padStart(3, '0')}.json`;
  writeFileSync(join(outDir, file), `[${pending.join(',')}]`);
  chunks.push({ file, count: pending.length });
  pending = [];
  pendingBytes = 0;
};
for (const c of cases) {
  const text = JSON.stringify(c);
  pending.push(text);
  pendingBytes += text.length + 1;
  if (pendingBytes >= CHUNK_BYTES) flush();
}
flush();
writeFileSync(join(outDir, 'logic.json'), JSON.stringify({ total: cases.length, chunks }));
console.log(`logic.json: ${cases.length} cases of ${new Set(cases.map((c) => c.fn)).size} functions in ${chunks.length} chunks`);
