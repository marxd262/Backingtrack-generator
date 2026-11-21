// Task 30a: the cases of the profiles (native/core/src/profiles.cpp, profile_tree.cpp) for export-logic.mjs: the parts of a profile, the files, the tree and its store, the
// factory profiles, the session as parts, the last session and the order of names. The inputs are those of tests/core/profile.test.js, profile-parts.test.js,
// profile-tree.test.js and profile-store.test.js (taken over by hand, each test with at least one case), and beyond them: sanitizeParts over mutations of three full parts
// objects, parseFile over broken files and over mutations of a profile file and a folder file, the tree at its limits, the store with broken and old texts, compareNames over
// every pair of covered characters and over random strings. A case is { fn, in, out } as in export-logic.mjs; the cases' conventions (names of the arguments, `ids`, `stored`, `args`)
// are those of native/core/tests/test_logic.cpp.
import { cmp as icuCompare, buildCollation, COVERED } from './collation-data.mjs';

/** Adds the cases to `cases`; returns a line per test file for the log. */
export async function profileCases({ cases, load, mutations, ref }) {
  const parts = await load('core/profile-parts.js');
  const file = await load('core/profile.js');
  const tree = await load('core/profile-tree.js');
  const store = await load('ui/profile-store.js');
  const factory = await load('ui/profile-factory.js');
  const bridge = await load('ui/profile-session.js');
  const last = await load('ui/session-store.js');
  const { PART_IDS, PART_PRESETS } = parts;
  const { LIMITS } = file;
  const counts = {};
  const count = (key, n) => { counts[key] = (counts[key] ?? 0) + n; };

  // ---------- helpers ----------
  // A lone surrogate cannot be in the reference's JSON (the test's parser refuses it): both sides write it as the text \udXXX.
  const safe = (v) => {
    if (typeof v === 'string') return v.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
    if (Array.isArray(v)) return v.map(safe);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, safe(x)]));
    return v;
  };
  // The input goes through JSON as the case file does it (undefined and NaN are not in it), then the web function runs on what the core will get.
  const addP = (fn, call, inputs, tag) => {
    for (const input of inputs) {
      const i = input === undefined ? null : JSON.parse(JSON.stringify(input));
      cases.push({ fn, in: i, out: safe(call(i)) });
    }
    if (tag) count(tag, inputs.length);
  };
  const makeIds = (list) => { let n = 0; return () => { if (n >= list.length) throw new Error('a case has no more ids'); return list[n++]; }; };
  const idList = (n = 12) => Array.from({ length: n }, (_, i) => `id${i + 1}`);
  const counter = () => { let i = 0; return () => `id${++i}`; };
  const withCrypto = (list, fn) => { // loadTree and the take-over call defaultMakeId, which asks crypto.randomUUID: it gives the case's ids in order
    const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: makeIds(list) } });
    try { return fn(); } finally { Object.defineProperty(globalThis, 'crypto', real); }
  };
  const KEYS = { 'profiles.json': 'backingtrack.profiles', 'session.json': 'backingtrack.session' };
  const NAMES = Object.fromEntries(Object.entries(KEYS).map(([a, b]) => [b, a]));
  const memory = (stored = {}, fail = false) => {
    const data = new Map(Object.entries(stored).map(([name, text]) => [KEYS[name], text]));
    return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem(k, v) { if (fail) throw new Error('full'); data.set(k, String(v)); } };
  };
  const storedOf = (m) => Object.fromEntries([...m.data].map(([k, v]) => [NAMES[k], v]));
  const PROFILES = 'profiles.json', SESSION = 'session.json';

  // ---------- fixtures of the tests ----------
  const mkBars = (list = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['A', 'min']], beats = 4) => list.map(([root, quality]) => ({ chord: { root, quality }, beats }));
  const track = (extra = {}) => ({
    key: { root: 'A', mode: 'minor' }, bpm: 96, bars: mkBars(), tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
    length: 48, meter: [4, 4], layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true },
    voices: { chords: { id: 'sample', variant: 'jazz' } }, jobs: { lead: 'melody', percussion: 'congas' }, groove: 'straight', complexity: 0.7, ...extra,
  });
  const trackNoGroove = (extra = {}) => { const t = track(extra); if (!('groove' in extra)) delete t.groove; return t; }; // profile.test.js and profile-store.test.js: no groove unless given
  const session = (extra = {}) => ({ track: track(), scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 }, ...extra });
  const sessionNoGroove = (extra = {}) => ({ track: trackNoGroove(), scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 }, ...extra });
  const FORM = {
    template: 'pop', auto: true, feel: { structure: 0.6, dynamics: 0.9, pauses: 0.4, randomness: 0.5 },
    sections: [{ type: 'intro', bars: 8 }, { type: 'verse', bars: 16, level: -3, density: 0.25, transition: 'fill', crash: true, locked: true }, { type: 'chorus', bars: 16, transition: 'stop' }, { type: 'outro', bars: 8 }],
  };
  const FORM2 = { // profile.test.js
    template: 'rock', auto: false, feel: { structure: 0.6, dynamics: 0.9, pauses: 0.4, randomness: 0.5 },
    sections: [{ type: 'intro', bars: 8 }, { type: 'verse', bars: 16, level: -3, locked: true }, { type: 'chorus', bars: 24, crash: true, transition: 'stop' }],
  };
  const withForm = (form = structuredClone(FORM), extra = {}) => session({ track: track({ form, length: form.sections.reduce((n, x) => n + x.bars, 0), ...extra }) });
  const sumOf = (f) => f.sections.reduce((n, x) => n + x.bars, 0);
  const legacyProfile = (s) => structuredClone({ format: 'backingtrack-profile', version: 1, ...s });
  const OLD_FILE = {
    format: 'backingtrack-profile', version: 1,
    track: { key: { root: 'A', mode: 'minor' }, bpm: 96, bars: mkBars(), tags: { development: ['fullFromStart'] }, timbre: { master: { echo: 0.2 } }, seed: 42, variety: true,
      meter: [4, 4], length: 48, layers: { drums: true, bass: false, chords: true, pad: true, lead: true, percussion: true }, voices: { chords: { id: 'sample', variant: 'jazz' } },
      jobs: { lead: 'melody', percussion: 'congas' }, complexity: 0.7 },
    scale: 'blues', style: 'funk', chordColor: 'sevenths', chordColorFromStyle: false, mix: { drums: 0.5, master: 0.8 },
  };
  ref.reset();
  const startState = JSON.parse(JSON.stringify(ref.current().state)); // the start state of the web app: variant 1, the mixer's defaults
  const startSession = bridge.readSession(startState);

  // ======================================================================
  // profile-parts.test.js
  // ======================================================================
  addP('PART_IDS', () => PART_IDS, [null], 'parts');
  addP('PART_PRESETS', () => PART_PRESETS, [null], 'parts');

  // captureParts: 'alle 10 Teile', 'nicht gesetzte groove/complexity', 'Standardstimmen', ornaments, organ, pan, form, and the parts of every preset
  const t0 = track(); delete t0.groove; delete t0.complexity;
  const fresh = track(); delete fresh.voices; delete fresh.jobs;
  const withOrnaments = track(); withOrnaments.ornaments = 0.8;
  const full = withForm();
  const fullAll = { ...withForm(), organ: { leslie: 'fast', drive: 0.6 }, pan: { chords: 0.3, pad: -0.2 } };
  addP('captureParts', ({ session: s, ids }) => parts.captureParts(s, ids), [
    { session: full }, { session: full, ids: [] }, { session: session({ track: t0 }), ids: ['rhythm', 'tempo'] }, { session: session(), ids: [...PART_PRESETS.none] },
    { session: session({ track: fresh }), ids: ['voices'] }, { session: session({ track: withOrnaments }), ids: ['rhythm'] },
    { session: session({ organ: { leslie: 'fast', drive: 0.6 } }), ids: ['sound'] }, { session: session(), ids: ['sound'] },
    { session: session({ pan: { chords: 0.3, pad: -0.2 } }), ids: ['mixer'] }, { session: session(), ids: ['mixer'] },
    { session: session(), ids: ['form'] }, { session: session() }, { session: withForm({ ...FORM, sections: [{ type: 'nope', bars: 8 }] }), ids: ['form'] }, { session: withForm(), ids: ['form'] },
    { session: session({ track: track({ meter: [12, 8] }) }), ids: ['tempo'] }, { session: fullAll }, { session: startSession }, { session: startSession, ids: ['voices', 'sound', 'mixer'] },
    ...Object.values(PART_PRESETS).map((ids) => ({ session: fullAll, ids: [...ids] })), { session: full, ids: ['nope', 'tempo', 'harmony'] },
    { session: session({ track: track({ timbre: null, voices: null, jobs: null, tags: null }), organ: null, pan: null }) },
    { session: { track: {} } }, { session: { track: { key: null, bars: 5, groove: null, tags: 'x', voices: 'sample', jobs: [], form: 5 }, mix: null } },
  ], 'captureParts');

  // sanitizeParts: the tests' inputs
  const evil = JSON.parse('{"__proto__":{"x":1},"tempo":{"bpm":100,"__proto__":{"y":1}},"mixer":{"mix":{"__proto__":0.5,"constructor":1,"prototype":1,"drums":0.5}}}');
  const evilForm = JSON.parse('{"form":{"__proto__":{"x":1},"form":{"__proto__":{"y":1},"template":"pop","feel":{"__proto__":{"z":1},"structure":0.2,"constructor":1},"sections":[{"__proto__":{"w":1},"type":"verse","bars":8,"prototype":1},{"constructor":{"a":1},"type":"outro","bars":4}]}}}');
  const okHarmony = { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [4, 4] };
  const harmony = (n) => ({ key: { root: 'A', mode: 'minor' }, meter: [4, 4], bars: mkBars(Array.from({ length: n }, () => ['A', 'min'])) });
  const sec = [{ type: 'verse', bars: 8 }];
  const oneForm = (form) => ({ form: { form: { sections: sec, ...form } } });
  const capturedAll = JSON.parse(JSON.stringify(parts.captureParts(fullAll)));
  const sanitizeInputs = [
    capturedAll, JSON.parse(JSON.stringify(parts.captureParts(session()))), { nope: { a: 1 }, tempo: { bpm: 100, extra: 1 } },
    { tempo: { bpm: 5 }, rhythm: { groove: 'x', complexity: 2, length: 24 }, variant: { seed: -1, variety: 'ja' }, style: { style: 'nope', tags: { mood: ['dark'] } } },
    { rhythm: { groove: null, complexity: null }, variant: { seed: 4294967295, variety: false }, tempo: { bpm: 400 } }, { variant: { seed: 4294967296 } }, { variant: { seed: 1.5 } }, { tempo: { bpm: 401 } }, { rhythm: { length: 513 } },
    { harmony: okHarmony }, { harmony: { ...okHarmony, meter: undefined } }, { harmony: { ...okHarmony, bars: undefined } }, { harmony: { ...okHarmony, key: undefined } }, { harmony: { ...okHarmony, meter: [7, 8] } },
    { harmony: { ...okHarmony, bars: mkBars([['A', 'min'], ['C#', 'maj']]) } }, { harmony: { ...okHarmony, bars: mkBars(undefined, 3) } }, { harmony: { ...okHarmony, bars: [] } }, { harmony: { ...okHarmony, bars: [null] } },
    { harmony: { ...okHarmony, key: { root: 'H', mode: 'minor' } } }, { harmony: { ...okHarmony, scale: 'nope', chordColor: 'power', chordColorFromStyle: 1 } }, { harmony: { ...okHarmony, scale: 'dorian', chordColor: 'extended', chordColorFromStyle: true } },
    { harmony: harmony(512) }, { harmony: harmony(513) }, { harmony: { ...okHarmony, bars: [{ chord: 'A', beats: 4 }, { chord: { root: 'A', quality: 'min' }, beats: 4 }] } }, { harmony: { ...okHarmony, bars: [{ chord: { root: 'A' }, beats: 4 }] } },
    { harmony: { ...okHarmony, bars: [{ chord: [], beats: 4 }] } }, { harmony: { ...okHarmony, bars: [5, 'x'] } }, { harmony: { ...okHarmony, key: ['A'] } }, { harmony: { ...okHarmony, meter: [4.0, 4] } },
    { tempo: { bpm: 100, meter: [6, 8] } }, { tempo: { bpm: 100, meter: [7, 8] } }, { tempo: { bpm: 100, meter: '4/4' } }, { tempo: { bpm: 100, meter: [4] } }, { tempo: { bpm: 100, meter: null } }, { tempo: { meter: [6, 8] } },
    { tempo: { bpm: 19.99 } }, { tempo: { bpm: 20 } }, { tempo: { bpm: 400 } }, { tempo: { bpm: '100' } }, { tempo: { bpm: null } }, { tempo: { bpm: 1e308 } }, { tempo: { bpm: 100.5 } },
    { rhythm: { ornaments: 0 } }, { rhythm: { ornaments: null } }, ...[1.5, -0.1, 'x', null, true].map((ornaments) => ({ rhythm: { ornaments } })), { rhythm: { groove: 'toString' } }, { rhythm: { groove: 'straight', length: 0 } },
    { rhythm: { length: 512 } }, { rhythm: { length: 1.5 } }, { rhythm: { length: '24' } },
    { sound: { organ: { leslie: 'slow', drive: null } } }, { sound: { organ: { leslie: 'turbo', drive: 0.2, zither: 1 } } }, ...[{ leslie: 3 }, { drive: 1.5 }, { drive: 'x' }].map((organ) => ({ sound: { organ } })), { sound: { organ: [] } },
    { sound: { timbre: {} } }, { sound: { timbre: { master: { echo: 9 } } } }, { sound: { timbre: { master: { echo: 0.2, reverb: 3, nope: 1 }, nogroup: { a: 1 }, bass: { sub: null } } } }, { sound: { timbre: [] } }, { sound: { timbre: { master: [] } } },
    { sound: { timbre: { master: { echo: 0.2 }, bass: 'x', pad: { cutoff: 0.5 } } } },
    { mixer: { pan: { chords: -1, pad: 1.5, bass: 'x', lead: 0, zither: 0.2 } } }, { mixer: { pan: [] } }, { mixer: { mix: [] } },
    { voices: { voices: { chords: { id: 'sample', variant: 'jazz' }, bass: 'sample', lead: 'gibtsnicht', drums: { id: 'sample', variant: 'nope' }, banjo: 'x' }, jobs: { lead: 'melody', percussion: 'nope', drums: 'x' } },
      layers: { layers: { lead: false, bass: 'ja', zither: true } }, mixer: { mix: { drums: 0.5, bass: 2, master: -1, pad: 'x', zither: 1 } }, sound: { timbre: { master: { echo: 0.2, reverb: 3, nope: 1 }, nogroup: { a: 1 }, bass: { sub: null } } } },
    { voices: { voices: 'x', jobs: 5 } }, { voices: { voices: { chords: { id: 'sample', variant: null }, bass: { id: 'sample', variant: 'x', extra: 1 }, lead: { id: 'sample' }, pad: { variant: 'strings' }, percussion: { id: 5 }, drums: [] } } },
    { voices: { voices: { chords: { id: 'sample', variant: 'organ' }, bass: { id: 'sample', __proto__x: 1 } } } },
    { style: { tags: { mood: ['dark'], drums: ['driving'] } } }, { style: { tags: { mood: ['dark', 'nope'] } } }, { style: { tags: [] } }, { style: { tags: {} } }, { style: { style: 'funk', tags: { drums: 'driving' } } }, { style: { style: 'toString' } },
    { tempo: {}, rhythm: { nope: 1 }, layers: { layers: {} } }, 'str', [], null, 5, { tempo: 'x' }, { tempo: [] }, { tempo: { bpm: null } }, { tempo: { bpm: 1e30 } },
    { harmony: { key: null, bars: [null], meter: 'x' } }, { harmony: { key: { root: 'A', mode: 'minor' }, meter: [4, 4], bars: [{ chord: null, beats: 4 }] } }, { variant: { seed: 1e30 } }, { sound: { timbre: [] } },
    evil, { form: { form: FORM } }, { form: { zukunft: 1, form: { ...FORM, neu: 1, sections: FORM.sections.map((s) => ({ ...s, farbe: 'rot' })) } } },
    { form: { form: { template: 'jam', auto: false, feel: {}, sections: [
      { type: 'verse', bars: 8 }, { type: 'nope', bars: 8 }, { type: 'chorus', bars: 0 }, { type: 'chorus', bars: 1.5 }, { type: 'chorus', bars: 65 },
      { type: 'break', bars: 4, level: 5 }, { type: 'break', bars: 4, density: 2 }, { type: 'break', bars: 4, transition: 'x' }, { type: 'break', bars: 4, crash: 'ja' },
      { type: 'break', bars: 4, locked: 1 }, 'str', null, 5, [], { type: 'outro', bars: 4, level: -6, transition: 'stop' }] } } },
    ...[[], undefined, 'x', {}, [{ type: 'nope', bars: 8 }]].map((sections) => ({ form: { form: { template: 'pop', sections } } })), { form: { form: { template: 'pop', sections: [] } } }, { form: {} },
    ...['x', 5, [], null].map((form) => ({ form: { form } })),
    oneForm({ template: 'blues', auto: true }), oneForm({ template: 'blues' }), oneForm({ template: 'gibtsnicht', auto: 'ja' }), oneForm({ template: 'pop', feel: { structure: 2, dynamics: 1.3, pauses: null, randomness: -1, zusatz: 1 } }),
    oneForm({ template: 'pop', feel: 'x' }), oneForm({ template: 'pop', feel: { dynamics: 1.31 } }), oneForm({ template: 'rock', auto: false, feel: { structure: 1, dynamics: 0, pauses: 0.5, randomness: 1 } }),
    oneForm({ template: 'pop', feel: { toString: 5, valueOf: 'x', hasOwnProperty: 1, structure: 0.2 } }), oneForm({ template: 'buildDrop', feel: [] }),
    { form: { form: { template: 'pop', sections: Array.from({ length: 2000 }, () => ({ type: 'verse', bars: 1 })) } } }, // the test's 200,000 cost 6 MB: the count is O(1) all the same, 2,000 hold the 64-part cap
    { form: { form: { template: 'pop', sections: Array.from({ length: 70 }, () => ({ type: 'verse', bars: 1 })) } } },
    { form: { form: { template: 'pop', sections: Array.from({ length: 20 }, () => ({ type: 'verse', bars: 64 })) } } }, { form: { form: { template: 'pop', sections: Array.from({ length: 8 }, () => ({ type: 'verse', bars: 64 })) } } },
    { form: { form: { template: 'pop', sections: [{ type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 64 }, { type: 'verse', bars: 1 }] } } },
    evilForm, { form: { form: { sections: [{ type: 'verse', bars: 8, level: null, density: null, transition: null, crash: null, locked: null }] } } },
    { form: { form: { sections: [{ type: 'verse', bars: 8, level: '1', density: [], transition: 5, crash: [], locked: {} }] } } }, { form: { form: { sections: { length: 1e9 } } } },
    { harmony: okHarmony, tempo: { bpm: 100, meter: [4, 4] }, style: { style: 'rock', tags: { mood: ['dark'] } }, variant: { seed: 7, variety: false }, layers: { layers: { lead: false } } },
  ];
  addP('sanitizeParts', (x) => parts.sanitizeParts(x), sanitizeInputs, 'sanitizeParts');

  // sanitizeParts over the mutation corpus of three full parts objects: captured from a start state, with every part (organ and pan too), and from an old stored state
  const oldList = JSON.stringify([{ name: 'Funk', profile: legacyProfile(sessionNoGroove()) }]);
  const oldParts = withCrypto(idList(), () => store.loadTree(memory({ [PROFILES]: oldList }))).items[0].parts;
  const corpora = [JSON.parse(JSON.stringify(parts.captureParts(startSession))), capturedAll, JSON.parse(JSON.stringify(oldParts))];
  if (Object.keys(corpora[1]).length !== 10 || Object.keys(corpora[2]).length !== 9) throw new Error('the corpora are not what they should be');
  const mutated = corpora.map((base) => mutations(base));
  for (const list of mutated) addP('sanitizeParts', (x) => parts.sanitizeParts(x), list, 'sanitizeParts');
  count('sanitizeParts', 0);

  // applyParts: the tests' inputs, then every part alone on the start state and on a session, then the sanitized mutations of the full parts on the start state
  const t128 = track({ meter: [12, 8] }); delete t128.groove;
  const in128 = session({ track: t128 });
  const mkHarmony = { key: { root: 'C', mode: 'major' }, scale: 'majorPentatonic', bars: mkBars([['C', 'maj'], ['G', 'maj']], 2), chordColor: 'triads', chordColorFromStyle: true, meter: [6, 8] };
  const minor = { key: { root: 'A', mode: 'minor' }, bars: mkBars([['A', 'min']]), meter: [4, 4] };
  const dor = { key: { root: 'D', mode: 'dorian' }, bars: mkBars([['D', 'min']]), meter: [4, 4] };
  const other = { ...structuredClone(FORM), sections: [{ type: 'verse', bars: 10 }, { type: 'chorus', bars: 14 }] };
  const ornamentSession = session({ track: withOrnaments });
  const organSession = session({ organ: { leslie: 'fast', drive: 0.6 } });
  const panSession = session({ pan: { chords: 0.3, pad: -0.2 } });
  const rockForm = withForm({ ...structuredClone(FORM), auto: false, template: 'rock' });
  const applyInputs = [
    { session: session(), parts: { tempo: { bpm: 77 } } },
    { session: in128, parts: { tempo: { bpm: 100, meter: [4, 4] } } }, { session: in128, parts: { tempo: { bpm: 90, meter: [6, 8] } } }, { session: in128, parts: { tempo: { bpm: 100 } } },
    { session: session(), parts: { tempo: { bpm: 60, meter: [6, 8] } } }, { session: in128, parts: { tempo: { bpm: 45, meter: [3, 4] } } },
    { session: session(), parts: { harmony: { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [12, 8] }, tempo: { bpm: 100, meter: [4, 4] } } },
    { session: in128, parts: { harmony: { key: { root: 'A', mode: 'minor' }, bars: mkBars(), meter: [4, 4] }, tempo: { bpm: 100, meter: [4, 4] } } },
    { session: in128, parts: { tempo: { bpm: 250, meter: [4, 4] } } }, { session: in128, parts: { tempo: { bpm: 100, meter: [5, 4] } } }, { session: in128, parts: { tempo: { bpm: 100, meter: [7, 8] } } },
    { session: session(), parts: { rhythm: { groove: null } } }, { session: session(), parts: { rhythm: { complexity: null, length: 24 } } },
    { session: ornamentSession, parts: { rhythm: { ornaments: 0.2 } } }, { session: ornamentSession, parts: { rhythm: { ornaments: null } } }, { session: ornamentSession, parts: { rhythm: { complexity: 0.3 } } },
    { session: organSession, parts: { sound: { organ: { leslie: 'off' } } } }, { session: organSession, parts: { sound: { organ: { drive: null } } } }, { session: organSession, parts: { sound: { timbre: {} } } },
    { session: session(), parts: { sound: { organ: { leslie: 'slow', drive: 0.1 } } } },
    { session: panSession, parts: { mixer: { pan: { chords: -1, lead: 0 } } } }, { session: panSession, parts: { mixer: { mix: { drums: 0.3 } } } },
    { session: session(), parts: { layers: { layers: { lead: false } } } }, { session: session(), parts: { mixer: { mix: { drums: 0.3 } } } },
    { session: session(), parts: { voices: { voices: { bass: { id: 'sample', variant: 'pick' } } } } }, { session: session(), parts: { voices: { jobs: { lead: 'arpeggio' } } } },
    { session: session({ track: track({ timbre: { master: { echo: 0.2 }, bass: { sub: 0.9 } } }) }), parts: { sound: { timbre: {} } } },
    { session: session({ track: track({ timbre: { master: { echo: 0.2 }, bass: { sub: 0.9 } } }) }), parts: { sound: { timbre: { master: { echo: 0 } } } } },
    { session: session(), parts: { style: { style: 'rock', tags: { mood: ['dark'] } } } },
    { session: session(), parts: { harmony: mkHarmony } }, { session: session(), parts: { harmony: { ...mkHarmony, scale: undefined } } }, { session: session(), parts: { harmony: { ...mkHarmony, scale: 'blues' } } },
    { session: session({ scale: 'dorian' }), parts: { harmony: minor } }, { session: session(), parts: { harmony: { ...minor, scale: 'blues' } } }, { session: session(), parts: { harmony: dor } }, { session: session(), parts: { harmony: minor } },
    { session: session(), parts: { harmony: { bars: mkBars([['A', 'min']]), meter: [4, 4], scale: 'major', chordColor: 'power' } } }, { session: session(), parts: { harmony: { scale: 'major' } } },
    { session: session(), parts: { rhythm: { groove: 'gibtsnicht' } } }, { session: session(), parts: {} }, { session: session(), parts: null }, { session: session() }, { session: session(), parts: 'x' }, { session: session(), parts: [] },
    { session: session(), parts: { variant: { seed: 9, variety: false } } },
    // the form: sets it, the sum is the length; profiles without a form leave it; a length alone rolls it again (or not); with no form only the length
    { session: session(), parts: { form: { form: other }, rhythm: { length: 96 } } },
    ...[{}, { tempo: { bpm: 77 } }, { rhythm: { groove: 'straight' } }, { harmony: parts.captureParts(session()).harmony }, { style: { style: 'rock' } }].map((p) => ({ session: withForm(), parts: p })),
    { session: rockForm, parts: { rhythm: { length: 96 } } }, { session: rockForm, parts: { rhythm: { length: 50 } } }, { session: withForm({ ...structuredClone(FORM), auto: true }), parts: { rhythm: { length: 96 } } },
    { session: rockForm, parts: { rhythm: { groove: null } } }, { session: session(), parts: { rhythm: { length: 96 } } },
    ...[48, 50, 44, 96].map((length) => ({ session: withForm(), parts: { rhythm: { length } } })),
    { session: withForm(), parts: { rhythm: { length: 24 } } }, { session: withForm({ ...structuredClone(FORM), template: 'blues', auto: false }), parts: { rhythm: { length: 192 } } },
    { session: withForm(), parts: { rhythm: { length: 128 } } },
    // every part alone: captureParts -> applyParts gives the same session
    ...PART_IDS.map((id) => ({ session: session(), parts: { [id]: parts.captureParts(withForm())[id] } })),
    { session: startSession, parts: parts.captureParts(full) }, { session: startSession, parts: parts.captureParts(fullAll) }, { session: full, parts: parts.captureParts(startSession) },
    { session: startSession, parts: parts.captureParts(startSession) }, { session: fullAll, parts: parts.captureParts(fullAll) },
    { session: session(), parts: { harmony: { key: 5, bars: [], meter: 'x' } } },
    // 'Profil mit Standardstimmen setzt eine gewählte Stimme zurück (auch über die Datei)'
    { session: session(), parts: parts.captureParts(session({ track: fresh }), ['voices']) },
    { session: session(), parts: parts.sanitizeParts(JSON.parse(JSON.stringify(parts.captureParts(session({ track: fresh }), ['voices'])))).parts },
  ];
  addP('applyParts', ({ session: s, parts: p }) => parts.applyParts(s, p), applyInputs, 'applyParts');
  // the sanitized mutations of the full parts, on the start state (a part may be invalid for the session: errors)
  addP('applyParts', ({ session: s, parts: p }) => parts.applyParts(s, p), mutated[1].map((m) => ({ session: startSession, parts: parts.sanitizeParts(JSON.parse(JSON.stringify(m))).parts })), 'applyParts');

  addP('partIdsOf', (p) => parts.partIdsOf(p), [{ variant: {}, tempo: {}, harmony: {} }, {}, null, 'x', [], capturedAll, { nope: 1, form: {} }], 'partIdsOf');
  addP('mergeParts', ({ base, over }) => parts.mergeParts(base, over), [
    { base: { tempo: { bpm: 90 }, style: { style: 'funk', tags: {} } }, over: { tempo: { bpm: 120 }, variant: { seed: 3 } } }, { base: capturedAll, over: { form: { form: FORM } } }, { over: { tempo: { bpm: 1 } } },
    { base: { tempo: { bpm: 1 } } }, { base: {}, over: {} }, { base: null, over: null }, { base: capturedAll, over: capturedAll }, { base: 'x', over: [] },
  ], 'mergeParts');

  // ======================================================================
  // profile.test.js
  // ======================================================================
  addP('FORMATS', () => ({ FORMAT_PROFILE: file.FORMAT_PROFILE, FORMAT_FOLDER: file.FORMAT_FOLDER, PROFILE_VERSION: file.PROFILE_VERSION, FOLDER_VERSION: file.FOLDER_VERSION }), [null], 'profile');
  addP('LIMITS', () => LIMITS, [null], 'profile');
  const fullSession = () => ({ ...sessionNoGroove(), track: trackNoGroove({ groove: 'straight' }) });
  const profileNode = (name = 'Funk', extra = {}) => ({ type: 'profile', name, parts: parts.captureParts(fullSession()), ...extra });
  const folderNode = (name, items) => ({ type: 'folder', name, items });
  const fileTree = { ...folderNode('Meine Profile', [profileNode('A', { id: 'ID-p1' }), { ...folderNode('Unter', [profileNode('B'), folderNode('Leer', [])]), id: 'ID-f1' }]), id: 'ID-root' };
  const treeBackupItems = [profileNode('A'), folderNode('U', [profileNode('B')])];
  const withMore = profileNode(); withMore.parts.tempo.future = 1; withMore.parts.futurePart = { a: 1 };
  const moreFolder = { ...file.makeFolderFile(folderNode('F', [profileNode()])), extra: 1 }; moreFolder.items[0].more = { x: 1 }; moreFolder.items.push({ type: 'future', name: 'Z', stuff: 1 });
  const badParts = profileNode(); badParts.parts.tempo.bpm = 5; badParts.parts.mixer.mix.drums = 7; badParts.parts.variant = 'x';
  const deepChain = (levels, leaf = profileNode()) => { let n = leaf; for (let i = levels; i >= 1; i--) n = folderNode('F', [n]); return n; };
  let tiefNode = profileNode('tief'); for (let i = 100; i >= 1; i--) tiefNode = folderNode(`F${i}`, [tiefNode]);
  const manyProfiles = (n) => Array.from({ length: n }, (_, i) => ({ type: 'profile', name: `P${i}`, parts: { tempo: { bpm: 100 } } }));
  const noMeter = structuredClone(OLD_FILE); delete noMeter.track.meter;
  addP('makeProfileFile', (n) => file.makeProfileFile(n), [
    { ...profileNode(), id: 'abc', extra: 1 }, { ...profileNode(), id: 'x', selected: true }, { ...profileNode(), name: '  A  ' }, profileNode('x'.repeat(80)), { type: 'profile', name: 5, parts: {} }, { type: 'profile' }, null, 'x', { name: 'N', parts: capturedAll },
    { type: 'folder', name: 'F', items: [] }, { type: 'profile', name: '   ', parts: { tempo: { bpm: 5 } } }, { name: '  mit Leerzeichen  ', parts: { tempo: { bpm: 100 } } },
  ], 'makeProfileFile');
  addP('makeFolderFile', (n) => file.makeFolderFile(n), [
    fileTree, { ...folderNode('F', [{ ...profileNode(), id: 'y' }]), id: 'z', open: true }, { name: 'Meine Profile', items: treeBackupItems, backup: true }, folderNode('F', treeBackupItems), { ...folderNode('F', treeBackupItems), backup: 'ja' },
    { items: [null, 5, 'x', { type: 'future' }, folderNode(undefined, [{ type: 'profile', name: '', parts: { tempo: { bpm: 100 } } }])] }, null, 'x', { name: 7, items: 'x' }, { type: 'profile', name: 'P', parts: {} },
    tiefNode,
  ], 'makeFolderFile');

  const profileText = JSON.stringify(file.makeProfileFile(profileNode()));
  const base0 = JSON.stringify({ ...file.makeProfileFile(profileNode()), pad: '' });
  const FILE = LIMITS.file;
  const fillText = (pad) => JSON.stringify({ ...file.makeProfileFile(profileNode()), pad });
  const astral = '\u{1F600}';
  const parseInputs = [
    // round trips
    profileText, JSON.stringify(file.makeFolderFile(fileTree)), JSON.stringify(OLD_FILE), structuredClone(OLD_FILE), JSON.stringify(file.makeFolderFile({ name: 'Meine Profile', items: treeBackupItems, backup: true })),
    JSON.stringify(file.makeProfileFile({ type: 'profile', name: 'Mit Form', parts: parts.captureParts(session({ track: track({ form: FORM2, length: 48 }) })) })),
    { ...file.makeProfileFile(withMore), extra: [1], parts: withMore.parts }, moreFolder, structuredClone(noMeter),
    { ...OLD_FILE, version: 7, track: { ...OLD_FILE.track, bpm: 5 }, style: 'nope' }, { ...OLD_FILE, track: null }, { ...OLD_FILE, track: [] }, { format: 'backingtrack-profile', track: {} },
    { ...OLD_FILE, track: { ...OLD_FILE.track, meter: [5, 4] } }, { ...noMeter, track: { ...noMeter.track, bars: noMeter.track.bars.map((b) => ({ ...b, beats: 3 })) } }, { ...noMeter, track: { ...noMeter.track, bars: [] } },
    { ...OLD_FILE, track: { ...OLD_FILE.track, meter: null } }, { ...OLD_FILE, track: { ...OLD_FILE.track, voices: 'x', jobs: 5, layers: [], tags: 'x', timbre: 7 }, mix: 'x', scale: 5 },
    // version is only information
    ...[99, undefined, '2', -1, null].flatMap((version) => [{ ...file.makeProfileFile(profileNode()), version }, { ...file.makeFolderFile(folderNode('F', [profileNode()])), version }]),
    // what is refused
    '', 'kein json', '[]', '5', 'null', '"x"', {}, [], null, undefined, 7, { format: 'x' }, { format: 'backingtrack-profile', parts: {} }, { format: 'backingtrack-profile', parts: { tempo: { bpm: 5 } } }, { format: 'backingtrack-profile', parts: 'x' },
    { format: 'backingtrack-profile' }, { format: 'backingtrack-profile', parts: null }, { format: 'backingtrack-folder' }, { format: 'backingtrack-folder', items: [] }, { format: 'backingtrack-folder', items: 'x' },
    { format: 'backingtrack-folder', name: 'F', items: [{ type: 'profile', name: 'a', parts: {} }, { type: 'folder' }, 5, null, { type: 'x' }] },
    // broken files of the brief: no JSON, another format, version 99 (read), 6 MB, depth 9, 1,001 nodes
    '{"format":"backingtrack-profile"', '{"format":"backingtrack-profile",}', '﻿' + profileText, ` \n\t${profileText}\r\n `, '{"format":"other","version":2,"parts":{"tempo":{"bpm":100}}}', '{"format":"backingtrack-profile","version":99,"name":"V","parts":{"tempo":{"bpm":100}}}',
    '{"format":"backingtrack-profile","version":2,"name":"A","name":"B","parts":{"tempo":{"bpm":100},"tempo":{"bpm":90}}}', '{"__proto__":{"polluted":1}}',
    '{"format":"backingtrack-folder","name":"F","__proto__":{"polluted":1},"items":[{"type":"profile","name":"A","__proto__":{"polluted":2},"parts":{"__proto__":{"polluted":3},"tempo":{"bpm":100,"__proto__":{"polluted":4}}}}]}',
    JSON.stringify(file.makeFolderFile(deepChain(9))), JSON.stringify(file.makeFolderFile(deepChain(8))), JSON.stringify(file.makeFolderFile(deepChain(7))), JSON.stringify(file.makeFolderFile(deepChain(25))),
    file.makeFolderFile(tiefNode), // 100 nested folders as a value; as a text the core refuses it (more than 64 levels of text, test_logic.cpp checks it) file.makeFolderFile(deepChain(7)), file.makeFolderFile(deepChain(8)),
    { format: 'backingtrack-folder', name: 'F', items: manyProfiles(10000) }, { format: 'backingtrack-folder', name: 'F', items: manyProfiles(999) }, { format: 'backingtrack-folder', name: 'F', items: manyProfiles(1000) },
    { format: 'backingtrack-folder', name: 'F', items: manyProfiles(1001) },
    JSON.stringify({ format: 'backingtrack-folder', name: 'M', backup: true, items: manyProfiles(1000) }), JSON.stringify({ format: 'backingtrack-folder', name: 'M', backup: true, items: manyProfiles(1001) }),
    JSON.stringify({ format: 'backingtrack-folder', name: 'M', items: manyProfiles(1001) }), JSON.stringify({ format: 'backingtrack-folder', name: 'M', items: manyProfiles(1000) }),
    file.makeFolderFile({ name: 'Meine Profile', items: [deepChain(7)], backup: true }), file.makeFolderFile({ name: 'Meine Profile', items: [deepChain(8)], backup: true }),
    { ...file.makeFolderFile({ name: 'M', items: treeBackupItems, backup: true }), backup: false }, { ...file.makeFolderFile({ name: 'M', items: treeBackupItems, backup: true }), backup: 'ja' },
    { ...file.makeFolderFile({ name: 'M', items: treeBackupItems, backup: true }), backup: null }, { ...file.makeFolderFile({ name: 'M', items: treeBackupItems, backup: true }), backup: 1 },
    { format: 'backingtrack-folder', name: 'F', items: [{ type: 'folder', name: ' U ', items: [{ type: 'profile', name: '', parts: profileNode().parts }] }, { type: 'profile', name: 5, parts: { tempo: { bpm: 100 } } }] },
    { format: 'backingtrack-folder', name: 7, items: [{ type: 'folder', name: ' U ', items: [{ type: 'profile', name: '', parts: profileNode().parts }] }] },
    { format: 'backingtrack-folder', name: 'F', items: [{ type: 'profile', name: 'A', parts: badParts.parts }, { type: 'profile', name: 'B', parts: badParts.parts }] },
    { format: 'backingtrack-profile', version: 2, name: 'X', parts: badParts.parts }, { format: 'backingtrack-profile', version: 2, name: 'Alt', parts: { ...parts.captureParts(fullSession()), zukunft: { a: 1 } } },
    { format: 'backingtrack-profile', version: 2, name: 'Halb', parts: { ...parts.captureParts(fullSession()), form: { form: { ...FORM2, sections: [{ type: 'verse', bars: 8 }, { type: 'nope', bars: 4 }] } } } },
    { format: 'backingtrack-profile', version: 2, name: 'Nur', parts: { form: { form: { ...FORM2, sections: [] } } } },
    { format: 'backingtrack-folder', type: 'profile', name: 'F', items: [{ type: 'profile', name: 'p', parts: { tempo: { bpm: 100 } } }] }, { format: 'backingtrack-folder', name: 'F', type: 'x', items: [{ type: 'profile', parts: { tempo: { bpm: 100 } } }] },
    ...[5, null, {}, [], '', '   ', undefined, '  Funk mit Echo  ', 'x'.repeat(80), `${'x'.repeat(58)}  y`, `${'x'.repeat(59)} y`, ' ﻿NBSP　', 'a'.repeat(59) + astral, 'b'.repeat(60) + astral, astral.repeat(30), astral.repeat(31), `a${astral.repeat(30)}`,
      '  Line\u000b', '᠎Mongolian', '​Zero'].map((name) => ({ ...file.makeProfileFile(profileNode()), name })),
    ...[5, null, {}, [], '', '   ', 'x'.repeat(70), `a${astral.repeat(30)}`].map((name) => ({ format: 'backingtrack-folder', name, items: [{ type: 'folder', name, items: [{ type: 'profile', name, parts: { tempo: { bpm: 100 } } }] }] })),
    // The size of the text in UTF-16 code units, two texts of about 5 MB (each costs 5 MB of the reference): one of exactly the limit (read) and one of one unit more (refused).
    // Both end in ten emoji, which count two units each: the first has more bytes than the limit (a count of bytes refuses it), the second fewer code points than the limit (a count
    // of code points reads it). Together with the `>` of the check and the branch for a four-byte sequence they fix the count; texts of ASCII at the limit and a byte above, and a
    // text of 6 MB, reach no branch of their own and are not cases.
    fillText('x'.repeat(FILE - base0.length - 20) + astral.repeat(10)), fillText('x'.repeat(FILE - base0.length - 20 + 1) + astral.repeat(10)),
    // nesting: 63 levels in an unknown field are read in both (64 do not, test_logic.cpp says so)
    `{"format":"backingtrack-profile","version":2,"name":"x","parts":{"tempo":{"bpm":100}},"extra":${'['.repeat(62)}${']'.repeat(62)}}`,
    `{"format":"backingtrack-profile","version":2,"name":"x","parts":{"tempo":{"bpm":100}},"extra":${'{"a":'.repeat(62)}1${'}'.repeat(62)}}`,
  ];
  if (fillText('x'.repeat(FILE - base0.length - 20) + astral.repeat(10)).length !== FILE) throw new Error('the astral file is not 5,000,000 UTF-16 units');
  if (fillText('x'.repeat(FILE - base0.length - 20 + 1) + astral.repeat(10)).length !== FILE + 1) throw new Error('the astral file is not 5,000,001 UTF-16 units');
  addP('parseFile', (x) => file.parseFile(x), parseInputs, 'parseFile');
  // parseFile over mutations of one profile file and one folder file (as values; a text of each too, in the size of a few mutations)
  const profileFile = file.makeProfileFile(profileNode());
  const folderFile = file.makeFolderFile({ name: 'Meine Profile', items: [profileNode('A'), folderNode('U', [profileNode('B')])], backup: true });
  addP('parseFile', (x) => file.parseFile(x), mutations(profileFile), 'parseFile');
  addP('parseFile', (x) => file.parseFile(x), mutations(folderFile), 'parseFile');
  addP('parseFile', (x) => file.parseFile(x), mutations(OLD_FILE), 'parseFile');
  addP('parseFile', (x) => file.parseFile(x), mutations(profileFile).slice(0, 200).map((m) => JSON.stringify(m)), 'parseFile');

  // ======================================================================
  // ui/profile-factory.js, ui/profile-session.js, ui/session-store.js
  // ======================================================================
  addP('factoryProfiles', () => factory.factoryProfiles(), [null], 'factory');
  addP('factoryParts', (id) => { try { return factory.factoryParts(id); } catch (error) { return { threw: error instanceof TypeError }; } }, [...factory.factoryProfiles().map((p) => p.styleId), 'nope', 'toString', '__proto__', ''], 'factory');
  addP('readSession', (s) => bridge.readSession(s), [startState, { track: {}, scale: 'x', extra: 1 }, { ...startState, organ: undefined, pan: undefined }, {}, { track: null, mix: null }], 'session');

  // writeSession: a state and what applyParts made of a profile; the state after (the arguments come as a text: the key order is part of what is compared)
  const writeCases = [];
  const applyTo = (s, p) => { const r = parts.applyParts(s, p); if (!r.ok) throw new Error(`applyParts failed for a writeSession case: ${JSON.stringify(r.errors)}`); return r.session; };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fullProfile = parts.captureParts(withForm());
  const formState = clone(startState); // a state with a form (the start state has one, rolled)
  for (const p of [fullProfile, { tempo: { bpm: 100, meter: [6, 8] } }, { tempo: { bpm: 77 } }, { rhythm: { length: 96 } }, { rhythm: { length: 48 } }, { form: { form: other } }, { harmony: parts.captureParts(session()).harmony },
    { style: { style: 'rock', tags: {} } }, parts.captureParts(startSession), parts.captureParts(fullAll), { mixer: { mix: { drums: 0.1 }, pan: { chords: 0.5 } } }, { sound: { organ: { leslie: 'off', drive: 0.1 } } }]) {
    for (const state of [formState, { ...clone(startState), tempoRef: { key: '4/4', quarter: 100, shown: 100 } }, { ...clone(startState), track: { ...clone(startState).track, form: undefined, length: 24 } }]) {
      writeCases.push({ state: clone(state), session: applyTo(bridge.readSession(clone(state)), p) });
    }
  }
  writeCases.push({ state: clone(startState), session: bridge.readSession(clone(startState)) }, { state: { ...clone(startState), formTarget: 192 }, session: bridge.readSession(clone(startState)) });
  for (const c of writeCases) {
    const args = JSON.stringify(c);
    const state = JSON.parse(args).state;
    bridge.writeSession(state, JSON.parse(args).session);
    cases.push({ fn: 'writeSession', in: { args }, out: safe(JSON.parse(JSON.stringify(state))) });
  }
  count('session', writeCases.length);

  // saveLast and loadLast (Date.now is the case's `at`)
  const realNow = Date.now;
  const lastCases = [
    { session: full, bar: 0, at: 1700000000000 }, { session: fullAll, bar: 7, at: 1700000000123 }, { session: startSession, bar: 31, at: 5 }, { session: session({ track: t0 }), bar: 2, at: 0 }, { session: full, bar: 3, at: 1.5 },
  ];
  for (const c of lastCases) for (const fail of [false, true]) {
    const stored = fail ? { [SESSION]: '{"old":true}' } : {};
    const m = memory(stored, fail);
    Date.now = () => c.at;
    const entry = last.saveLast(m, c.session, c.bar);
    Date.now = realNow;
    cases.push({ fn: 'saveLast', in: { args: JSON.stringify(c), stored, fail }, out: safe(JSON.parse(JSON.stringify({ entry, stored: storedOf(m) }))) });
  }
  count('last', lastCases.length * 2);
  const entryText = (extra = {}) => JSON.stringify({ parts: parts.captureParts(full), bar: 4, at: 1700000000000, ...extra });
  const lastStored = [
    entryText(), entryText({ bar: 0 }), entryText({ bar: -1 }), entryText({ bar: 1.5 }), entryText({ bar: '3' }), entryText({ bar: null }), entryText({ bar: 1e300 }), entryText({ at: null }), entryText({ at: 'x' }), entryText({ at: -5 }),
    entryText({ at: 1.5 }), JSON.stringify({ parts: parts.captureParts(full) }), JSON.stringify({ bar: 3 }), JSON.stringify({ parts: { harmony: capturedAll.harmony, tempo: capturedAll.tempo, style: capturedAll.style } }),
    JSON.stringify({ parts: { ...capturedAll, harmony: { ...capturedAll.harmony, scale: undefined } }, bar: 2 }), JSON.stringify({ parts: { ...capturedAll, style: { tags: capturedAll.style.tags } }, bar: 2 }),
    JSON.stringify({ parts: { ...capturedAll, variant: { seed: 'x' } }, bar: 2 }), JSON.stringify({ parts: { ...capturedAll, tempo: { bpm: 5 } }, bar: 2 }), '', 'x', '{', 'null', '[]', '5', '"x"', '{}', '[{"parts":1}]',
    '{"parts":{"harmony":{"key":1}},"bar":1}', `{"parts":${'['.repeat(3)}${']'.repeat(3)}}`, JSON.stringify({ parts: parts.captureParts(startSession), bar: 9, at: 12 }),
    JSON.stringify({ parts: parts.captureParts(fullAll), bar: 2, at: 3, extra: [1, { a: 2 }] }), '{"bar":1,"bar":2,"parts":' + JSON.stringify(parts.captureParts(full)) + '}',
  ];
  const lastBase = JSON.parse(entryText());
  const lastMutations = mutations(lastBase).map((v) => JSON.stringify(v));
  for (const text of [...lastStored, ...lastMutations]) {
    const m = memory({ [SESSION]: text });
    cases.push({ fn: 'loadLast', in: { stored: { [SESSION]: text } }, out: safe(JSON.parse(JSON.stringify({ entry: last.loadLast(m), stored: storedOf(m) }))) });
  }
  cases.push({ fn: 'loadLast', in: { stored: {} }, out: { entry: null, stored: {} } });
  count('last', lastStored.length + lastMutations.length + 1);

  // ======================================================================
  // profile-tree.test.js
  // ======================================================================
  const P = (extra = {}) => ({ tempo: { bpm: 100 }, ...extra });
  const NAME = 'x'.repeat(60);
  function build(spec) { // as the test's build: names with "/" as a path, an ending "!" a profile
    const makeId = counter();
    let t = tree.newTree();
    for (const path of spec) {
      const names = path.split('/');
      let parentId = null;
      names.forEach((n, i) => {
        const lastName = i === names.length - 1;
        const isProfile = lastName && n.endsWith('!');
        const name = isProfile ? n.slice(0, -1) : n;
        const siblings = parentId === null ? t.items : tree.find(t, parentId).node.items;
        const hit = siblings.find((x) => x.name === name);
        if (hit) { parentId = hit.id; return; }
        const r = isProfile ? tree.addProfile(t, parentId, name, P(), makeId) : tree.addFolder(t, parentId, name, makeId);
        if (!r.ok) throw new Error(`${path}: ${r.code}`);
        t = r.tree;
        parentId = r.id;
      });
    }
    return t;
  }
  function chain(depth) {
    const makeId = counter();
    let t = tree.newTree();
    let parentId = null;
    const ids = [];
    for (let i = 1; i <= depth; i++) { const r = tree.addFolder(t, parentId, `F${i}`, makeId); t = r.tree; parentId = r.id; ids.push(r.id); }
    return { tree: t, ids };
  }
  const bigItems = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `n${from + i}`, type: 'profile', name: `P${from + i}`, parts: {} }));
  // 'anlegen: sortiert': the test's five steps and some more, each on the tree the step before made
  let steps = tree.newTree();
  const stepIds = counter();
  const orderCases = [];
  for (const [kind, name] of [['p', 'Funk 10'], ['p', 'Funk 2'], ['f', 'Zeta'], ['p', 'alpha'], ['f', 'Beta'], ['p', 'funk 02'], ['p', 'Funk 2a'], ['p', 'FUNK 3'], ['f', 'beta 1'], ['p', 'Ärger'], ['p', 'zebra'], ['p', 'résumé'], ['p', 'Æsop'], ['p', 'ßtraße']]) {
    orderCases.push({ kind, tree: steps, name, ids: ['next1'] });
    const r = kind === 'f' ? tree.addFolder(steps, null, name, stepIds) : tree.addProfile(steps, null, name, P(), stepIds);
    steps = r.ok ? r.tree : steps;
  }
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), orderCases.filter((c) => c.kind === 'f').map((c) => ({ tree: c.tree, parentId: null, name: c.name, ids: ['f1'] })), 'tree');
  addP('addProfile', (a) => tree.addProfile(a.tree, a.parentId, a.name, a.parts, makeIds(a.ids)), orderCases.filter((c) => c.kind === 'p').map((c) => ({ tree: c.tree, parentId: null, name: c.name, parts: P(), ids: ['p1'] })), 'tree');
  addP('sortItems', (items) => tree.sortItems(items), [steps.items, [...steps.items].reverse(), [], [steps.items[0]], bigItems(30).reverse(), bigItems(1001, 0).reverse().slice(0, 40)], 'tree');
  addP('countNodes', (t) => tree.countNodes(t), [steps, tree.newTree(), { items: bigItems(1000) }, build(['A/B/c!', 'A/d!', 'e!'])], 'tree');

  addP('newTree', () => tree.newTree(), [null], 'tree');
  // 'feindliche Namen sind gewöhnliche Namen': five folders in a row, each with a profile of the same name in capitals (taken)
  let hostile = tree.newTree();
  const hostileCases = [];
  for (const name of ['__proto__', 'constructor', '<b>x</b>', 'toString', 'hasOwnProperty']) {
    hostileCases.push({ tree: hostile, parentId: null, name, ids: ['h1'] }, { tree: hostile, parentId: null, name: name.toUpperCase(), ids: ['h2'] });
    hostile = tree.addFolder(hostile, null, name, () => `h-${name}`).tree;
  }
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), hostileCases, 'tree');
  addP('addProfile', (a) => tree.addProfile(a.tree, a.parentId, a.name, a.parts, makeIds(a.ids)), hostileCases.map((c) => ({ ...c, parts: P() })), 'tree');
  addP('listFolders', (t) => tree.listFolders(t), [hostile], 'tree');

  // 'Namen'
  const tNames = build(['Funk!', 'Ordner']);
  const folderOrdner = tNames.items.find((n) => n.name === 'Ordner');
  const nameArgs = (t, parentId, name, extra = {}) => ({ tree: t, parentId, name, ids: idList(4), ...extra });
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), [
    nameArgs(tNames, null, '  '), nameArgs(tNames, null, ' FUNK '), nameArgs(tNames, null, `  ${'x'.repeat(80)}  `), nameArgs(tNames, null, 'x'.repeat(60)), nameArgs(tNames, null, 'x'.repeat(61)), nameArgs(tNames, null, 'x'.repeat(59)),
    nameArgs(tNames, null, 'fünk'), nameArgs(tNames, null, 'Ünk'), nameArgs(tNames, null, 'ÜNK'), nameArgs(tNames, null, 'ordner'), nameArgs(tNames, null, 'ORDNER (2)'), nameArgs(tNames, null, null), nameArgs(tNames, 'nope', 'x'),
    nameArgs(tNames, tNames.items.find((n) => n.name === 'Funk').id, 'x'), nameArgs(tree.newTree(), null, `a${astral.repeat(30)}`), nameArgs(tree.newTree(), null, astral.repeat(30)), nameArgs(tree.newTree(), null, astral.repeat(31)),
    nameArgs(tree.newTree(), null, `${astral}${'b'.repeat(58)}${astral}`), nameArgs(tree.newTree(), null, `b${astral}`.repeat(31)), nameArgs(tree.newTree(), null, '  ﻿ Neu　  '), nameArgs(tree.newTree(), null, '᠎'),
    nameArgs(tree.newTree(), null, '\t\n\u000b\f\r     '), nameArgs(tree.newTree(), null, `${'x'.repeat(58)}  y`), nameArgs(tree.newTree(), null, `${'x'.repeat(59)}  `),
    nameArgs(tree.newTree(), null, '__proto__'), nameArgs(tree.newTree(), null, 'Ordnerİ'), nameArgs(tNames, null, 'ORDNER'), nameArgs(tNames, null, 'Ordner '), nameArgs(tNames, null, ' ordner '),
  ], 'tree');
  addP('addProfile', (a) => tree.addProfile(a.tree, a.parentId, a.name, a.parts, makeIds(a.ids)), [
    { ...nameArgs(tNames, null, ''), parts: P() }, { ...nameArgs(tNames, null, 'funk'), parts: P() }, { ...nameArgs(tNames, null, 'ordner'), parts: P() }, { ...nameArgs(tNames, folderOrdner.id, 'Funk'), parts: P() },
    { ...nameArgs(tNames, null, 'Neu'), parts: capturedAll }, { ...nameArgs(tNames, null, 'Neu'), parts: {} }, { ...nameArgs(tNames, null, 'Neu'), parts: null }, { ...nameArgs(tNames, null, 'Neu'), parts: { a: [1, { b: 2 }] } },
  ], 'tree');
  addP('validName', (a) => tree.validName(a.tree, a.parentId, a.name, a.exceptId), [
    { tree: tNames, parentId: null, name: ' Neu ' }, { tree: tNames, parentId: null, name: 'funk' }, { tree: tNames, parentId: null, name: 'funk', exceptId: tNames.items[1].id }, { tree: tNames, parentId: null, name: 'funk', exceptId: 'nope' },
    { tree: tNames, parentId: null, name: '' }, { tree: tNames, parentId: null, name: undefined }, { tree: tNames, parentId: null, name: null }, { tree: tNames, parentId: 'nope', name: 'x' },
    { tree: tNames, parentId: tNames.items.find((n) => n.name === 'Funk').id, name: 'x' }, { tree: tNames, parentId: folderOrdner.id, name: 'Funk' }, { tree: tNames, parentId: null, name: 'x'.repeat(100) },
    { tree: tNames, parentId: null, name: `${'x'.repeat(59)} y` }, { tree: tNames, parentId: null, name: `${'x'.repeat(59)}  y` }, { tree: tNames, parentId: null, name: `a${astral}`.repeat(31) },
  ], 'tree');
  addP('freeName', (a) => tree.freeName(a.names, a.name), [
    { names: [], name: 'Funk' }, { names: ['Funk'], name: 'Funk' }, { names: ['Funk', 'Funk (2)'], name: 'Funk' }, { names: ['funk', 'FUNK (2)', 'Funk (3)'], name: 'Funk' }, { names: [NAME], name: NAME }, { names: [NAME, `${'x'.repeat(56)} (2)`], name: NAME },
    { names: [`${'x'.repeat(59)}  `], name: `${'x'.repeat(59)}  ` }, { names: ['A (2)'], name: 'A' }, { names: ['a'], name: 'A' }, { names: ['Ünk'], name: 'ÜNK' }, { names: Array.from({ length: 12 }, (_, i) => (i ? `Funk (${i + 1})` : 'Funk')), name: 'Funk' },
    { names: [`${'a'.repeat(58)} b`], name: `${'a'.repeat(58)} b` }, { names: ['x (2)'], name: 'x (2)' }, { names: ['İ'], name: 'i̇' }, { names: [astral.repeat(30)], name: astral.repeat(30) },
  ], 'tree');

  // 'Elternordner'
  const tA = build(['A!']);
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), [nameArgs(tA, 'nope', 'x'), nameArgs(tA, tA.items[0].id, 'x')], 'tree');

  // 'umbenennen'
  const tAB = build(['A!', 'B!']);
  const renameArgs = (t, id, name) => ({ tree: t, id, name });
  addP('renameNode', (a) => tree.renameNode(a.tree, a.id, a.name), [
    renameArgs(tAB, tAB.items[0].id, 'A'), renameArgs(tAB, tAB.items[0].id, 'a'), renameArgs(tAB, tAB.items[0].id, 'b'), renameArgs(tAB, tAB.items[0].id, ' '), renameArgs(tAB, 'nope', 'x'), renameArgs(tAB, tAB.items[0].id, 'Z'),
    renameArgs(tAB, tAB.items[1].id, 'A (2)'), renameArgs(tAB, tAB.items[1].id, `${'x'.repeat(70)}`), renameArgs(tAB, tAB.items[0].id, `a${astral.repeat(30)}`), renameArgs(build(['A/B/c!', 'A/d!', 'e!']), tAB.items[0].id, 'q'),
    renameArgs(build(['A/B/c!', 'A/d!', 'e!', 'A/Z']), build(['A/B/c!', 'A/d!', 'e!', 'A/Z']).items.find((n) => n.name === 'A').items[0].id, 'zz'), renameArgs(tNames, folderOrdner.id, 'funk'), renameArgs(tNames, folderOrdner.id, 'ORDNER'),
  ], 'tree');

  // 'Tiefe'
  const c8 = chain(8), c7 = chain(7), c9 = chain(8);
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), [nameArgs(c8.tree, c8.ids[7], 'x'), nameArgs(c8.tree, c8.ids[6], 'x'), nameArgs(c9.tree, null, 'F9'), nameArgs(c7.tree, c7.ids[6], 'x')], 'tree');
  addP('addProfile', (a) => tree.addProfile(a.tree, a.parentId, a.name, a.parts, makeIds(a.ids)), [{ ...nameArgs(c8.tree, c8.ids[7], 'x'), parts: P() }, { ...nameArgs(c8.tree, c8.ids[6], 'x'), parts: P() }], 'tree');
  addP('find', (a) => tree.find(a.tree, a.id), [{ tree: c8.tree, id: c8.ids[7] }, { tree: c8.tree, id: c8.ids[0] }, { tree: c8.tree, id: 'nope' }, { tree: c8.tree, id: null }], 'tree');

  // 'Knotenlimit'
  const full1000 = { items: bigItems(1000) };
  addP('addProfile', (a) => tree.addProfile(a.tree, a.parentId, a.name, a.parts, makeIds(a.ids)), [{ ...nameArgs(full1000, null, 'mehr'), parts: P() }, { ...nameArgs({ items: bigItems(999, 1) }, null, 'ok'), parts: P() }], 'tree');
  addP('addFolder', (a) => tree.addFolder(a.tree, a.parentId, a.name, makeIds(a.ids)), [nameArgs(full1000, null, 'mehr'), nameArgs({ items: bigItems(999, 1) }, null, 'ok'), nameArgs({ items: bigItems(1001) }, null, 'zu viel')], 'tree');

  // 'find, pathNames, countProfiles, countNodes'
  const tABC = build(['A/B/c!', 'A/d!', 'e!']);
  const nodeA = tABC.items.find((n) => n.name === 'A');
  const nodeC = tree.find(tABC, nodeA.items.find((n) => n.name === 'B').items[0].id);
  addP('find', (a) => tree.find(a.tree, a.id), [{ tree: tABC, id: nodeC.node.id }, { tree: tABC, id: nodeA.id }, { tree: tABC, id: 'nope' }, { tree: tNames, id: folderOrdner.id }], 'tree');
  addP('pathNames', (a) => tree.pathNames(a.tree, a.id), [{ tree: tABC, id: nodeC.node.id }, { tree: tABC, id: 'nope' }, { tree: tABC, id: nodeA.id }], 'tree');
  addP('countProfiles', (n) => tree.countProfiles(n), [nodeA, tABC, nodeC.node, tree.newTree(), { type: 'folder', items: [] }, { items: [{ type: 'profile' }, { type: 'folder', items: [{ type: 'profile' }] }] }], 'tree');

  // 'removeNode'
  const nodeB = nodeA.items.find((n) => n.name === 'B');
  addP('removeNode', (a) => tree.removeNode(a.tree, a.id), [{ tree: tABC, id: nodeB.id }, { tree: tABC, id: nodeA.id }, { tree: tABC, id: 'nope' }, { tree: tABC, id: nodeC.node.id }, { tree: tABC, id: tABC.items.find((n) => n.name === 'e').id }], 'tree');

  // 'overwriteParts'
  const tProf = tree.addProfile(tree.newTree(), null, 'P', { tempo: { bpm: 90 }, style: { style: 'funk' } }, counter());
  const tFolder = tree.addFolder(tProf.tree, null, 'F', counter());
  addP('overwriteParts', (a) => tree.overwriteParts(a.tree, a.id, a.parts), [
    { tree: tProf.tree, id: tProf.tree.items[0].id, parts: { tempo: { bpm: 120 }, mixer: { mix: {} } } }, { tree: tFolder.tree, id: tFolder.id, parts: {} }, { tree: tProf.tree, id: 'nope', parts: {} },
    { tree: tProf.tree, id: tProf.tree.items[0].id, parts: {} }, { tree: tProf.tree, id: tProf.tree.items[0].id, parts: capturedAll }, { tree: tProf.tree, id: tProf.tree.items[0].id }, { tree: tProf.tree, id: tProf.tree.items[0].id, parts: null },
    { tree: build(['A/p!', 'B/p!']), id: build(['A/p!', 'B/p!']).items[0].items[0].id, parts: { variant: { seed: 3 } } },
  ], 'tree');

  // 'listFolders'
  const tList = build(['B/z/y', 'A/m', 'A/a', 'p!']);
  addP('listFolders', (t) => tree.listFolders(t), [tList, tree.newTree(), tABC, c8.tree, build(['b', 'a', 'B (2)', 'A1', 'a10', 'a2', 'Ä']), { items: bigItems(30).map((n, i) => (i % 3 ? n : { id: n.id, type: 'folder', name: n.name, items: [] })) }], 'tree');

  // 'moveNode', 'canMove', 'moveTargets'
  const tMove = build(['A/B/C', 'D', 'A/p!']);
  const mA = tMove.items.find((n) => n.name === 'A'), mB = mA.items.find((n) => n.name === 'B'), mC = mB.items.find((n) => n.name === 'C'), mD = tMove.items.find((n) => n.name === 'D'), mP = mA.items.find((n) => n.name === 'p');
  const moveArgs = (t, id, targetId) => ({ tree: t, id, targetId });
  const afterMove = tree.moveNode(tMove, mB.id, mD.id).tree;
  const moveList = [
    ...[mA.id, mB.id, mC.id].map((target) => moveArgs(tMove, mA.id, target)), moveArgs(tMove, mB.id, mA.id), moveArgs(tMove, mA.id, mP.id), moveArgs(tMove, 'nope', null), moveArgs(tMove, mA.id, 'nope'), moveArgs(tMove, mB.id, mD.id),
    moveArgs(afterMove, mC.id, null), moveArgs(tMove, mB.id, null), moveArgs(tMove, mA.id, null), moveArgs(tMove, mP.id, mD.id), moveArgs(tMove, mP.id, mB.id), moveArgs(tMove, mD.id, mC.id), moveArgs(tMove, mD.id, mD.id),
    moveArgs(build(['A!', 'B!']), build(['A!', 'B!']).items[0].id, null), moveArgs(tMove, mA.id, mA.id),
  ];
  const mid = tree.addFolder(c7.tree, null, 'Mitte', () => 'mid1');
  const midKid = tree.addFolder(mid.tree, mid.id, 'Kind', () => 'mid2');
  const blatt = tree.addProfile(midKid.tree, null, 'Blatt', P(), () => 'mid3');
  moveList.push(moveArgs(midKid.tree, mid.id, c7.ids[6]), moveArgs(midKid.tree, mid.id, c7.ids[5]), moveArgs(blatt.tree, blatt.id, c7.ids[6]), moveArgs(blatt.tree, blatt.id, c7.ids[5]), moveArgs(blatt.tree, mid.id, c7.ids[4]));
  const tDup = build(['A/Funk!', 'Funk!', 'A/Funk (2)!', 'B']);
  const tDup2 = build(['X/funk', 'Funk!']);
  const tLong = build([`D/${'y'.repeat(60)}!`, `${'y'.repeat(60)}!`]);
  moveList.push(moveArgs(tDup, tDup.items.find((n) => n.name === 'Funk').id, tDup.items.find((n) => n.name === 'A').id), moveArgs(tDup2, tDup2.items.find((n) => n.name === 'Funk').id, tDup2.items.find((n) => n.name === 'X').id),
    moveArgs(tLong, tLong.items.find((n) => n.type === 'profile').id, tLong.items.find((n) => n.name === 'D').id), moveArgs(tDup, tDup.items.find((n) => n.name === 'B').id, tDup.items.find((n) => n.name === 'A').id),
    moveArgs(tDup, tDup.items.find((n) => n.name === 'A').id, tDup.items.find((n) => n.name === 'B').id));
  const tMt = build(['A/B/C', 'D/E', 'p!']);
  const tk = tree.addFolder(c7.tree, null, 'K', () => 'k1'), tk2 = tree.addFolder(tk.tree, tk.id, 'K2', () => 'k2');
  const targetsList = [moveArgs(tMt, tMt.items.find((n) => n.name === 'A').id), moveArgs(tMt, tMt.items.find((n) => n.name === 'A').items[0].id), moveArgs(tMt, tMt.items.find((n) => n.type === 'profile').id), moveArgs(tMt, 'nope'),
    moveArgs(tk2.tree, tk.id), moveArgs(tList, tList.items[0].id), moveArgs(tree.newTree(), 'x')];
  addP('moveNode', (a) => tree.moveNode(a.tree, a.id, a.targetId), moveList, 'tree');
  addP('canMove', (a) => tree.canMove(a.tree, a.id, a.targetId), moveList, 'tree');
  addP('moveTargets', (a) => tree.moveTargets(a.tree, a.id), [...targetsList, ...moveList.slice(0, 8).map((a) => ({ tree: a.tree, id: a.id }))], 'tree');

  // 'importNode'
  const nodeImp = (n, items) => ({ type: 'folder', name: n, items });
  const impNode = { type: 'folder', name: 'Ordner', items: [{ type: 'profile', name: 'a', parts: P() }, { type: 'profile', name: 'A', parts: P() }, { type: 'folder', name: 'Sub', items: [{ type: 'profile', name: 'x', parts: P() }] }] };
  const mkDeep = (levels) => { let n = { type: 'profile', name: 'blatt', parts: P() }; for (let i = levels; i >= 1; i--) n = { type: 'folder', name: `O${i}`, items: [n] }; return n; };
  const importArgs = (t, parentId, node, n = 12) => ({ tree: t, parentId, node, ids: idList(n) });
  const c5 = chain(5), c6 = chain(6);
  let n5 = { type: 'profile', name: 'blatt', parts: P() }; for (let i = 5; i >= 1; i--) n5 = { type: 'folder', name: `O${i}`, items: [n5] };
  const four = { type: 'folder', name: 'V1', items: [{ type: 'folder', name: 'V2', items: [{ type: 'folder', name: 'V3', items: [{ type: 'profile', name: 'V4', parts: P() }] }] }] };
  const items997 = bigItems(LIMITS.nodes - 3), items900 = bigItems(900);
  const bigNode = { type: 'folder', name: 'Gross', items: Array.from({ length: 10 }, (_, i) => ({ type: 'profile', name: `q${i}`, parts: P() })) };
  const bigNode2 = { type: 'folder', name: 'G', items: Array.from({ length: 299 }, (_, i) => ({ type: 'profile', name: `q${i}`, parts: P() })) };
  const backupNode = { type: 'folder', name: 'Meine Profile', backup: true, items: [{ type: 'profile', name: 'Funk', parts: P() }, { type: 'folder', name: 'Neu', items: [{ type: 'profile', name: 'y', parts: P() }] }] };
  const deepBackup = { type: 'folder', name: 'M', backup: true, items: [{ type: 'folder', name: 'O1', items: [{ type: 'folder', name: 'O2', items: [{ type: 'profile', name: 'p', parts: P() }] }] }] };
  const imports = [
    importArgs(tNames, null, impNode), importArgs(tNames, folderOrdner.id, { type: 'profile', name: 'Funk', parts: P() }), importArgs(tNames, 'nope', impNode), importArgs(tNames, tNames.items.find((n) => n.type === 'profile').id, impNode),
    importArgs(tree.newTree(), null, mkDeep(10)), importArgs(c8.tree, c8.ids[7], mkDeep(1)), importArgs(c8.tree, c8.ids[6], { type: 'profile', name: 'p', parts: P() }), importArgs(c5.tree, c5.ids[4], n5), importArgs(c6.tree, c6.ids[5], four),
    importArgs(tree.newTree(), null, four), importArgs({ items: items997 }, null, bigNode), importArgs({ items: [...items997, ...bigItems(3, 2000)] }, null, bigNode), importArgs({ items: items900 }, null, bigNode2, 120),
    importArgs(tNames, null, backupNode), importArgs(c6.tree, c6.ids[5], deepBackup), importArgs(chain(8).tree, 'id8', deepBackup), importArgs(tree.newTree(), null, deepBackup),
    importArgs(tree.newTree(), null, { type: 'profile', name: 'leer' }), importArgs(tree.newTree(), null, { type: 'profile', name: 'leer', parts: null }),
    importArgs(tree.newTree(), null, { type: 'folder', name: 'F', items: [{ type: 'profile', name: 'ohne' }, { type: 'profile', name: 'mit', parts: P() }] }),
    importArgs(tree.newTree(), null, { type: 'folder', name: '__proto__', items: [{ type: 'profile', name: '__proto__', parts: P() }] }), importArgs(build(['__proto__']), build(['__proto__']).items[0].id, { type: 'folder', name: '__proto__', items: [{ type: 'profile', name: '__proto__', parts: P() }] }),
    importArgs(tNames, null, null), importArgs(tNames, null, 5), importArgs(tNames, null, 'x'), importArgs(tNames, null, []), importArgs(tNames, null, { type: 'folder', name: 'F' }), importArgs(tNames, null, { type: 'folder', name: 'F', items: 'x' }),
    importArgs(tNames, null, { type: 'folder', name: 'F', items: [null, 5, 'x', [], {}, { type: 'profile', name: 'ok', parts: [] }, { type: 'profile', name: 'ok2', parts: 'x' }, { type: 'profile', name: 'ok3', parts: 5 }] }),
    importArgs(tNames, null, { type: 'profile', name: '  ', parts: P() }), importArgs(tNames, null, { type: 'profile', parts: P() }), importArgs(tNames, null, { type: 'profile', name: null, parts: P() }), importArgs(tNames, null, { type: 'profile', name: 'x'.repeat(70), parts: P() }),
    importArgs(tNames, null, { type: 'profile', name: 'Funk', parts: P() }), importArgs(tNames, null, { ...impNode, name: 'funk' }), importArgs(tNames, null, { type: 'folder', name: 'F', items: Array.from({ length: 5 }, () => ({ type: 'profile', name: 'same', parts: P() })) }),
    importArgs(tNames, null, { ...backupNode, backup: false }), importArgs(tNames, null, { type: 'profile', name: 'P', backup: true, items: [{ type: 'profile', name: 'x', parts: P() }], parts: P() }), importArgs(tNames, null, { ...backupNode, items: [] }),
    importArgs(tree.newTree(), null, { type: 'folder', name: 'F', items: [{ type: 'folder', name: 'G', items: [null] }] }, 12),
    importArgs(c7.tree, c7.ids[6], { type: 'folder', name: 'X', items: [{ type: 'folder', name: 'Y', items: [{ type: 'folder', name: 'Z', items: [{ type: 'profile', name: 'w', parts: P() }, { type: 'profile', name: 'v', parts: P() }] }] }] }),
    importArgs(tree.newTree(), null, nodeImp(`${'n'.repeat(59)}  x`, [{ type: 'profile', name: `${'n'.repeat(59)}  x`, parts: P() }])),
  ];
  addP('importNode', (a) => tree.importNode(a.tree, a.parentId, a.node, makeIds(a.ids)), imports, 'tree');
  count('tree', 0);

  // ======================================================================
  // profile-store.test.js
  // ======================================================================
  const store2 = (items) => JSON.stringify({ version: 2, items });
  const parts0 = () => parts.captureParts({ ...sessionNoGroove(), track: trackNoGroove({ groove: 'straight' }) });
  const prof = (name, extra = {}) => ({ id: `p-${name}`, type: 'profile', name, parts: parts0(), ...extra });
  const fold = (name, items, extra = {}) => ({ id: `f-${name}`, type: 'folder', name, items, ...extra });
  const loadCase = (stored, ids = idList(40)) => ({ stored, ids });
  const loadTreeCall = ({ stored, ids }) => { const m = memory(stored); const t = withCrypto(ids, () => store.loadTree(m)); return { tree: t, stored: storedOf(m) }; };
  const wholeTree = { items: [fold('Ordner', [fold('Leer', []), prof('B')]), prof('Funk')] };
  const noParts = { id: 'x1', type: 'profile', name: 'ohne Teile' };
  const badParts2 = { id: 'x2', type: 'profile', name: 'schlecht', parts: { tempo: { bpm: 5 } } };
  const noItems = { id: 'x3', type: 'folder', name: 'ohne Inhalt' };
  let nest = prof('tief'); for (let i = 10; i >= 1; i--) nest = fold(`F${i}`, [nest]);
  const oldGood = legacyProfile(sessionNoGroove());
  const oldOther = legacyProfile(sessionNoGroove({ track: trackNoGroove({ bpm: 120 }), style: 'rock' }));
  const oldNoMeter = legacyProfile(sessionNoGroove()); delete oldNoMeter.track.meter;
  const reserved = ['session', 'mine', 'factory', 'factory:reggae', 'factory:'];
  const loads = [
    // empty or missing, broken
    loadCase({}), loadCase({ [PROFILES]: store2([]) }), ...['kaputt', '{}', 'null', '"x"', '5', '{"items":5}', '{"version":2}', '{"version":2,"items":{}}', '', '[', '[]', '[null]', '[1,2]', '{"items":[]}', '﻿{"items":[]}'].map((t) => loadCase({ [PROFILES]: t })),
    // saved and loaded again
    loadCase({ [PROFILES]: JSON.stringify({ version: 2, items: wholeTree.items }) }), loadCase({ [PROFILES]: store2([prof('Gut'), null, 5, 'x', [], noParts, badParts2, noItems, { id: 'x4', type: 'zukunft', name: 'Z' }, fold('Ordner', [prof('Innen'), null, noParts])]) }),
    // ids and names repaired
    loadCase({ [PROFILES]: store2([prof('Funk', { id: 'dup' }), prof('funk', { id: 'dup' }), prof('  Rock  ', { id: undefined }), prof('x'.repeat(80), { id: 7 }), prof('   ', { id: 'e' }), fold('Ordner', [prof('Funk', { id: 'dup' }), prof('Funk', { id: 'dup' })])]) }),
    loadCase({ [PROFILES]: store2([prof('A', { id: 'session' }), prof('B', { id: 'factory:reggae' }), prof('C', { id: 'keep-me' }), fold('F', [prof('Innen', { id: 'session' }), fold('Unter', [], { id: 'factory' }), prof('X', { id: 'factory:' })], { id: 'mine' })]) }),
    loadCase({ [PROFILES]: store2([prof('A', { id: '' }), prof('B', { id: null }), prof('C', { id: ['x'] }), prof('D', { id: 'Factory:a' }), prof('E', { id: 'sessions' }), prof('F', { id: 'factoryx' })]) }),
    loadCase({ [PROFILES]: store2([prof('A', { name: 5 }), prof('B', { name: null }), prof('C', { name: undefined }), prof('D', { name: ['x'] }), prof('E', { name: '   ' }), prof(`${'z'.repeat(59)}  y`), prof(`a${astral.repeat(30)}`)]) }),
    loadCase({ [PROFILES]: store2([prof('Funk'), prof('FUNK'), prof('funk'), prof('Funk (2)'), fold('Funk', []), prof('Ärger'), prof('Aerger'), prof('Ünk'), prof('ÜNK')]) }),
    // unknown fields, limits, hostile
    loadCase({ [PROFILES]: JSON.stringify({ version: 2, extra: [1], items: [{ ...prof('A', { extra: 1, selected: true }), parts: { ...prof('A').parts, futurePart: { a: 1 } } }, fold('F', [], { open: true })] }) }),
    loadCase({ [PROFILES]: store2([nest]) }), loadCase({ [PROFILES]: store2(Array.from({ length: 1500 }, (_, i) => prof(`P${i}`, { id: `i${i}` }))) }),
    loadCase({ [PROFILES]: store2(Array.from({ length: 1000 }, (_, i) => fold(`F${i}`, [], { id: `i${i}` }))) }),
    loadCase({ [PROFILES]: store2(Array.from({ length: 40 }, (_, i) => fold(`F${i}`, Array.from({ length: 40 }, (_, k) => prof(`P${k}`, { id: `x${i}-${k}` })), { id: `f${i}` }))) }),
    loadCase({ [PROFILES]: '{"version":2,"__proto__":{"polluted":1},"items":[{"id":"a","type":"profile","name":"__proto__","__proto__":{"polluted":2},"parts":{"__proto__":{"polluted":3},"tempo":{"bpm":100}}}]}' }),
    loadCase({ [PROFILES]: `{"items":[{"id":"a","id":"b","type":"profile","type":"folder","name":"x","name":"y","items":[],"parts":{"tempo":{"bpm":100}}}]}` }),
    // the old flat list
    loadCase({ [PROFILES]: JSON.stringify([{ name: 'Funk', profile: oldGood }, { name: 'Rock', profile: oldOther }]) }),
    loadCase({ [PROFILES]: JSON.stringify([{ name: 'ok', profile: oldGood }, { name: '', profile: oldGood }, { name: 'Ok', profile: oldGood }, { name: 'bad', profile: { format: 'x' } }, { name: 'ohne', profile: null }, null, 5,
      { name: 'kaputt', profile: { ...oldGood, track: { ...oldGood.track, bars: [] } } }]) }),
    loadCase({ [PROFILES]: '[]' }), loadCase({ [PROFILES]: JSON.stringify([{ name: 'alt', profile: oldNoMeter }]) }),
    loadCase({ [PROFILES]: JSON.stringify([{ name: '  spaced  ', profile: oldGood }, { name: 5, profile: oldGood }, { name: `${'n'.repeat(70)}`, profile: oldGood }, { name: 'N', profile: JSON.stringify(oldGood) }, { name: 'M', profile: 'kein json' },
      { name: 'Neu', profile: file.makeProfileFile(profileNode('X')) }, { name: 'Ord', profile: file.makeFolderFile(folderNode('F', [profileNode()])) }, 'x', [], { profile: oldGood }, { name: 'nameonly' }]) }),
    loadCase({ [PROFILES]: JSON.stringify(Array.from({ length: 1005 }, (_, i) => ({ name: `Alt ${i}`, profile: oldGood }))) }, idList(1100)),
  ];
  addP('loadTree', loadTreeCall, loads, 'store');
  // the store over the mutation corpus of one stored tree (hostile values everywhere), with and without ids to spare
  const storedBase = { version: 2, items: [{ id: 'a', type: 'profile', name: 'A', parts: { tempo: { bpm: 100, meter: [4, 4] }, style: { style: 'funk', tags: { drums: ['dry'] } }, mixer: { mix: { drums: 0.5 } } } },
    { id: 'f', type: 'folder', name: 'F', items: [{ id: 'b', type: 'profile', name: 'B', parts: { variant: { seed: 3, variety: true } } }] }] };
  addP('loadTree', loadTreeCall, mutations(storedBase).map((v) => loadCase({ [PROFILES]: JSON.stringify(v) })), 'store');
  const storedBaseList = [{ name: 'Funk', profile: { format: 'backingtrack-profile', version: 1, track: oldGood.track, scale: 'blues', style: 'funk', mix: { drums: 0.5 } } }, { name: 'B', profile: oldGood }];
  addP('loadTree', loadTreeCall, mutations(storedBaseList).slice(0, 400).map((v) => loadCase({ [PROFILES]: JSON.stringify(v) })), 'store');

  // saveTree: the stored text is the web's JSON.stringify; a failing write leaves the stored text as it was
  const saveCase = (t, stored = {}, fail = false) => ({ args: JSON.stringify({ tree: t }), stored, fail });
  const saveCall = ({ args, stored, fail }) => { const m = memory(stored, fail); const saved = store.saveTree(m, JSON.parse(args).tree); return { saved, stored: storedOf(m) }; };
  const saves = [
    saveCase(wholeTree), saveCase(wholeTree, { [PROFILES]: store2([prof('Alt')]) }), saveCase(wholeTree, { [PROFILES]: store2([prof('Alt')]) }, true), saveCase(wholeTree, {}, true), saveCase(tree.newTree()), saveCase({ items: [] }, { [PROFILES]: 'x' }),
    saveCase(tABC), saveCase(c8.tree), saveCase({ items: bigItems(1000) }), saveCase({ items: [{ id: 'a', type: 'profile', name: `a${astral.repeat(29)}`, parts: { tempo: { bpm: 1e21, loose: 1e-7, x: -0, y: 0.1, z: 123456789.125, w: 5e-324 } } }] }),
    saveCase({ items: [{ id: 'q', type: 'profile', name: '"quote" \\ / \b\f\n\r\t \u0001 \u001f \u007f   😀 ä', parts: { s: 'é', n: null, b: true, a: [1, [2, { c: 3 }]] } }] }),
    saveCase({}), saveCase({ version: 9, other: 1, items: [{ id: 'k' }] }), saveCase({ items: 'x' }), saveCase({ items: null }), saveCase({ items: [wholeTree.items[0], null, 5, 'x'] }), saveCase(null), saveCase(5), saveCase('x'), saveCase([]),
  ];
  // the web's `{ items: undefined }` writes {"version":2}: JSON drops undefined, so the case has no `items` at all (saveCase({}) above)
  for (const c of saves) cases.push({ fn: 'saveTree', in: c, out: safe(JSON.parse(JSON.stringify(saveCall(c)))) });
  count('store', saves.length);

  // ======================================================================
  // the order and the case of names
  // ======================================================================
  const table = buildCollation();
  const covered = COVERED.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)));
  const sign = (a, b) => Math.sign(icuCompare(a, b));
  const cmpCase = (a, b) => ({ a, b });
  const compareCall = ({ a, b }) => sign(a, b);
  // 1. every pair of single covered characters
  const singles = [];
  for (const a of covered) for (const b of covered) singles.push(cmpCase(a, b));
  addP('compareNames', compareCall, singles, 'compare');
  // 2. strings of two characters over one representative of each primary class, every expansion and every ignored character: each against two others of its kind and two single characters
  const reps = []; const seenWeights = new Set();
  for (const c of covered) { const k = JSON.stringify(table.chars[c.codePointAt(0)]); if (!seenWeights.has(k)) { seenWeights.add(k); reps.push(c); } }
  for (const c of covered) if (table.chars[c.codePointAt(0)].length !== 1 && !reps.includes(c)) reps.push(c); // every expansion and ignored one, also the ones of equal weights
  let seed = 20260721;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const twos = []; for (const x of reps) for (const y of reps) twos.push(x + y);
  const pairs2 = [];
  for (const s of twos) pairs2.push(cmpCase(s, pick(twos)), cmpCase(pick(twos), s), cmpCase(s, pick(reps)), cmpCase(pick(reps), s));
  addP('compareNames', compareCall, pairs2, 'compare');
  // 3. random strings of 1 to 12 characters over the covered set, digits, spaces and punctuation well represented; and near-equal pairs (one character apart)
  const digits = [...'0123456789'], puncts = [...' -_.,()[]/&'], letters = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'], special = [...'lL·­ßæĲ'];
  const pool = [...digits, ...digits, ...digits, ...puncts, ...puncts, ...letters, ...special, ...covered];
  const randomString = () => { let s = ''; const n = 1 + Math.floor(rnd() * 12); for (let i = 0; i < n; i++) s += pick(pool); return s; };
  const randoms = [];
  for (let i = 0; i < 100000; i++) randoms.push(cmpCase(randomString(), randomString()));
  for (let i = 0; i < 20000; i++) { const s = randomString(); const at = Math.floor(rnd() * s.length); randoms.push(cmpCase(s, s.slice(0, at) + pick(pool) + s.slice(at + 1))); }
  const coveredSet = new Set(covered);
  const isCovered = (s) => [...s].every((ch) => coveredSet.has(ch));
  for (let i = 0; i < 5000; i++) { // the upper case of a covered character can lie outside (the micro sign, the n with apostrophe): those pairs are the ruling's, not a case
    const s = randomString(), upper = s.toUpperCase();
    randoms.push(cmpCase(s, s.replace(/[aeiou]/g, 'ä')));
    if (isCovered(upper)) randoms.push(cmpCase(s, upper));
  }
  addP('compareNames', compareCall, randoms, 'compare');
  // 3b. combining marks (U+0300 to U+036F are covered; the collation ignores most of them at primary strength): decomposed letters against their precomposed forms and against
  // other letters, inside names of several characters, next to digits and next to the contraction `l·`; marks after `l` before the dot; marks beside every sort of character
  const composites = covered.filter((c) => c.normalize('NFD') !== c && [...c.normalize('NFD')].every((ch) => coveredSet.has(ch)));
  const contexts = ['', 'a', 'Z', '1', '12', '007', ' ', 'l', 'L', 'l·', '·', 'Funk 2 ', '·l', '9', '-', 'ß', '́', 'Ĳ'];
  const marks = covered.filter((c) => c >= '̀' && c <= 'ͯ');
  const decomposed = [];
  for (const c of composites) {
    const nfd = c.normalize('NFD');
    for (let i = 0; i < 40; i++) {
      const left = pick(contexts), right = pick(contexts);
      decomposed.push(cmpCase(left + nfd + right, left + c + right), cmpCase(left + nfd + right, left + pick(composites) + right), cmpCase(left + c + right, left + pick(composites).normalize('NFD') + right));
    }
  }
  for (let i = 0; i < 3000; i++) {
    const m = Array.from({ length: Math.floor(rnd() * 3) }, () => pick(marks)).join('');
    const l = pick(['l', 'L']), tail = pick(['', 'a', '1', ' ', '·']);
    decomposed.push(cmpCase(`${l}${m}·${tail}`, `${l}·${tail}`), cmpCase(`${l}${m}·${tail}`, `${l}${tail}`), cmpCase(`${l}${m}·${tail}`, `${l}${pick(marks)}·${tail}`));
  }
  for (let i = 0; i < 10000; i++) {
    let s = ''; const n = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < n; k++) s += rnd() < 0.35 ? pick(marks) : pick(pool);
    let t = ''; for (const ch of s) t += rnd() < 0.2 ? '' : ch;
    decomposed.push(cmpCase(s, t), cmpCase(s, s.normalize('NFC')), cmpCase(s.normalize('NFD'), randomString()));
  }
  addP('compareNames', compareCall, decomposed.filter((c) => isCovered(c.a) && isCovered(c.b)), 'compare');
  // 4. numbers: leading zeros, runs of every length up to 254 digits, a number beside letters and other numbers
  const numbers = [];
  for (const [a, b] of [['a1', 'a01'], ['a1', 'a10'], ['a2', 'a10'], ['a9', 'a10'], ['a007', 'a7'], ['0', '00'], ['0', ''], ['00', '000'], ['1', '01'], ['1 2', '12'], ['1,2', '12'], ['1-2', '1 2'], ['x1y', 'x01y'], ['x1y2', 'x1y10'], ['Funk 2', 'Funk 10'],
    ['Funk 2', 'Funk 02'], ['1', '¹'], ['9', '¹'], ['²', '2'], ['¼', '¹z'], ['½', '1/2'], ['5½', '51'], ['1­2', '12'], ['l·', 'l'], ['L·l', 'Ll'], ['l··', 'l'], ['Ŀ', 'L'], ['Ŀ·', 'l'],
    ['9'.repeat(100), '1' + '0'.repeat(100)], ['9'.repeat(254), '1' + '0'.repeat(253)], ['1' + '0'.repeat(253), '9'.repeat(254)], ['0'.repeat(100) + '5', '5'], ['a' + '1'.repeat(200), 'a' + '1'.repeat(199) + '2'], ['ß', 'ss'], ['ß', 'sz'], ['æ', 'ae'], ['œ', 'oe'],
    ['Ĳ', 'ij'], ['ŉ', "'n"], ['‥', '..'], ['…', '...'], ['…', '..'], [' ', ' '], ['­', ''], ['a­', 'a'], ['­1', '1'], ['‐', '-'], ['–', '-'], ['€', '$'], ['€', 'e']]) {
    numbers.push(cmpCase(a, b), cmpCase(b, a));
  }
  addP('compareNames', compareCall, numbers, 'compare');
  // 5. the names of the four test files, every pair
  const testNames = ['Funk 10', 'Funk 2', 'Zeta', 'alpha', 'Beta', 'Funk', 'Ordner', 'funk', 'FUNK', 'ordner', 'A', 'B', 'Z', 'a', 'b', 'Sub', 'A (2)', 'Neu', 'Funk (2)', 'funk (2)', 'Funk (3)', 'X', 'x', 'D', 'E', 'F', 'm', 'z', 'y', 'e',
    'O1', 'O2', 'O10', 'F1', 'F2', 'F10', 'V1', 'V4', 'P0', 'P1', 'P2', 'P10', 'P100', 'P999', 'q0', 'q1', 'q298', 'x'.repeat(60), 'y'.repeat(60), `${'y'.repeat(56)} (2)`, '__proto__', 'constructor', '<b>x</b>', 'toString', 'hasOwnProperty', 'Importiert',
    'Rock', 'Gut', 'Innen', 'ok', 'Ok (2)', 'Meine Profile', 'Mitte', 'Kind', 'Blatt', 'K', 'K2', 'Gross', 'G', 'mit', 'leer', 'tief', 'Alt', 'Halb', 'Nur', 'Mit Form', 'Funk mit Echo', 'U', 'Leer', 'Unter', 'Ordner (2)', 'Neu', 'ohne', 'Z', 'N', 'M'];
  const namePairs = []; for (const a of testNames) for (const b of testNames) namePairs.push(cmpCase(a, b));
  addP('compareNames', compareCall, namePairs, 'compare');
  // lowerCase: every covered character, the names, random strings
  const lowers =[...covered, ...testNames, ...randoms.slice(0, 5000).map((c) => c.a), 'İstanbul', 'ÀÉÎÕÜ', 'ẞ'].filter((s) => [...s].every((ch) => coveredSet.has(ch)));
  addP('lowerCase', (s) => s.toLowerCase(), lowers, 'compare');
  addP('isReservedId', (id) => store.isReservedId(id), [...reserved, 'p-1', 'sessions', 'my', 'factoryx', 'Factory:a', '', 'factory:x', 'mine ', ' session', 'factor', 'Session', 'factory:', 'factory:'], 'store');

  return counts;
}
