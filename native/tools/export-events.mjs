// Writes the reference for the C++ generator from the web app in the working tree (src/, read only).
//   node native/tools/export-events.mjs <outDir>           -> <outDir>/cases.json (tracks and their events)
//   node native/tools/export-events.mjs <outDir> --data    -> also rewrites native/core/data/grooves.json
// The first groups switch on drums and bass only; the groups of the other layers follow them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] ?? join(repo, 'native/build/parity'));

const load = (file) => import(pathToFileURL(join(repo, 'src', file)).href);
const { buildEvents, STYLE_PRESETS, GROOVES, METERS } = await load('index.js');
const { normalizeTrack } = await load('core/track.js');
const { resolveVoices } = await load('core/voices.js');
const { rollForm } = await load('core/form-roll.js');
const { progressionFor } = await load('core/progressions.js');
const { createRng } = await load('core/rng.js');
const { colorProgression, CHORD_COLORS } = await load('core/harmony.js');

if (process.argv.includes('--data')) {
  writeFileSync(join(repo, 'native/core/data/grooves.json'), `${JSON.stringify(GROOVES)}\n`);
}

const KEYS = [
  { root: 'A', mode: 'minor' }, { root: 'E', mode: 'minor' }, { root: 'F#', mode: 'minor' }, { root: 'C', mode: 'major' },
  { root: 'G', mode: 'major' }, { root: 'Bb', mode: 'major' }, { root: 'D', mode: 'dorian' },
];
const ONLY = { drums: true, bass: true, chords: false, pad: false, lead: false, percussion: false };
const cases = [];

// A track as the app's own UI would build it: style preset, progression from the key, optional rolled form.
function add(name, style, seed, extra = {}) {
  const pick = createRng(seed * 7919 + cases.length).fork('case');
  const meter = extra.meter ?? [4, 4];
  const beats = METERS[`${meter[0]}/${meter[1]}`].beats;
  const key = pick.pick(extra.keys ?? KEYS);
  const track = {
    key, bpm: style.bpm, seed, meter,
    bars: progressionFor(key, seed).map((chord, i) => ({ chord, beats: extra.oddBeats?.[i] ?? beats })),
    tags: style.tags, voices: style.voices, layers: extra.layers ?? ONLY, variety: true,
    ...extra.track,
  };
  if (extra.bars) track.bars = extra.bars(track);
  if (extra.form) track.form = typeof extra.form === 'function' ? extra.form(track, pick) : extra.form;
  const events = buildEvents(track);
  // the core gets the track with defaults and voices filled in; it must mean the same track
  const given = { ...normalizeTrack(track), voices: resolveVoices(track) };
  if (JSON.stringify(buildEvents(given)) !== JSON.stringify(events)) throw new Error(`normalized track differs: ${name}`);
  cases.push({ name: `${name}/${style.id}/seed${seed}`, track: given, events });
}
const rolled = (template, targets) => (track, pick) => rollForm({ template, style: undefined, targetBars: pick.pick(targets), seed: track.seed, tags: track.tags });

for (const style of STYLE_PRESETS) {
  // rolled song forms, as at the start of the app
  for (let seed = 1; seed <= 20; seed++) {
    add('form', style, seed, { form: (track, pick) => rollForm({ template: 'auto', style: style.id, targetBars: pick.pick([24, 32, 48]), seed: track.seed, tags: track.tags }) });
  }
  // no form, the knobs of the rhythm module at their ends and in the middle
  for (let seed = 101; seed <= 108; seed++) {
    const k = seed - 101;
    add('plain', style, seed, { track: { length: 24, variety: k % 2 === 0, complexity: [0.1, 0.5, 0.9][k % 3], loose: [0, 0.5, 1][(k >> 1) % 3], ornaments: [0, 0.5, 1, 0.75][k % 4] } });
  }
  // hand-made forms: every transition, set levels and densities, the feel knobs at their ends
  for (let seed = 201; seed <= 203; seed++) {
    const k = seed - 201;
    add('custom', style, seed, {
      form: {
        feel: { dynamics: [0, 0.6, 1.3][k], pauses: [0.9, 0.4, 0.6][k], randomness: [1, 0.5, 0][k] },
        sections: [
          { type: 'intro', bars: 2 }, { type: 'verse', bars: 8 }, { type: 'build', bars: 4 }, { type: 'chorus', bars: 8 },
          { type: 'break', bars: 3, level: -9 }, { type: 'verse', bars: 5, transition: 'stop', density: 0.3 }, { type: 'bridge', bars: 4, transition: 'roll' },
          { type: 'chorus', bars: 9, crash: false, transition: 'stop' }, { type: 'outro', bars: 4, transition: 'fill', crash: true },
        ],
      },
    });
  }
  // other voices (the rules ask for them), single layers
  add('voices', style, 301, { form: rolled('pop', [32]), track: { voices: { bass: { id: 'sample', variant: 'pick' }, drums: { id: 'synth', variant: 'classic' } } } });
  add('voices', style, 302, { form: rolled('rock', [32]), track: { voices: { bass: { id: 'sample', variant: 'upright' }, drums: { id: 'sample', variant: 'muldjord' } } } });
  add('voices', style, 303, { form: rolled('jam', [24]), track: { voices: { bass: { id: 'sample', variant: 'finger' } } } });
  add('drumsOnly', style, 401, { form: rolled('pop', [32]), track: { layers: { ...ONLY, bass: false } } });
  add('bassOnly', style, 402, { form: rolled('pop', [32]), track: { layers: { ...ONLY, drums: false } } });
}
// every groove and meter, with and without form; bars of other lengths than the meter
const styles = STYLE_PRESETS;
for (const [g, id] of Object.keys(GROOVES).entries()) {
  const meter = GROOVES[id].meter.split('/').map(Number);
  for (let seed = 501; seed <= 506; seed++) {
    const style = styles[(g + seed) % styles.length];
    add(`groove-${id}`, style, seed, { meter, track: { groove: id, ...(seed % 2 ? { length: 16 } : {}) }, ...(seed % 2 ? {} : { form: rolled(['pop', 'blues', 'buildDrop'][seed % 3], [24, 32]) }) });
  }
  add(`odd-${id}`, styles[g % styles.length], 601, { meter, oddBeats: [2, 6, 3, 5], track: { groove: id, length: 12 } });
}

// ---- The layers after drums and bass. Their groups come last and draw from their own list of keys, so the
// cases above stay exactly as they were.
const KEYS_ALL = [...KEYS, { root: 'E', mode: 'phrygian' }, { root: 'F', mode: 'lydian' }, { root: 'G', mode: 'mixolydian' }];
const autoForm = (style) => (track, pick) => rollForm({ template: 'auto', style: style.id, targetBars: pick.pick([24, 32, 48]), seed: track.seed, tags: track.tags });

// pad: every pad voice, with and without a form; two styles get a wide pad (`dreamy` lifts padWidth over 0.6)
const PAD_VOICES = [{ id: 'sample', variant: 'strings' }, { id: 'sample', variant: 'warm' }, { id: 'synth', variant: 'classic' }];
for (const [s, style] of STYLE_PRESETS.entries()) {
  for (let seed = 701; seed <= 708; seed++) {
    const track = { voices: { ...style.voices, pad: PAD_VOICES[(s + seed) % PAD_VOICES.length] } };
    if (s % 4 === 1) track.tags = { ...style.tags, mood: ['dreamy'] };
    if (seed > 706) track.length = 24;
    add('pad', style, seed, { layers: { ...ONLY, pad: true }, keys: KEYS_ALL, track, ...(seed > 706 ? {} : { form: autoForm(style) }) });
  }
}

// chords with the guitar rules: every voice that is not a keyboard (those have rules of their own), every chord
// colour, every amount of ornaments; per groove one track of arpeggios
const WITH_CHORDS = { ...ONLY, chords: true, pad: true };
const GUITAR_VOICES = [
  ...['guitar', 'muted', 'jazz', 'funk', 'steel', 'nylon', 'twelve', 'freepats', 'freepatsjazz'].map((variant) => ({ id: 'sample', variant })),
  { id: 'synth', variant: 'classic' }, { id: 'string', variant: 'electric' },
];
// the progression in a chord colour, as the UI does it
const colored = (color) => (track) => colorProgression(track.bars, color, track.key);
for (const [s, style] of STYLE_PRESETS.entries()) {
  for (const [v, voice] of GUITAR_VOICES.entries()) {
    const k = s + v;
    const track = { voices: { ...style.voices, chords: voice }, ornaments: [0.5, 1, 0, 0.75][k % 4] };
    if (k % 5 === 4) track.length = 24;
    add('chords', style, 800 + v, { layers: WITH_CHORDS, keys: KEYS_ALL, bars: colored(CHORD_COLORS[k % 4]), track, ...(k % 5 === 4 ? {} : { form: autoForm(style) }) });
  }
}
for (const [g, id] of Object.keys(GROOVES).entries()) {
  const style = styles[g % styles.length];
  const track = { groove: id, voices: { ...style.voices, chords: GUITAR_VOICES[g % GUITAR_VOICES.length] }, tags: { ...style.tags, synths: ['arpeggio'] } };
  add(`arp-${id}`, style, 850 + g, { meter: GROOVES[id].meter.split('/').map(Number), layers: WITH_CHORDS, keys: KEYS_ALL, bars: colored(CHORD_COLORS[g % 4]), track, form: autoForm(style) });
}

// keys: the electric pianos with their rules and the organ with leslie and swell; every groove too, so that every
// style profile of the key rules occurs
const KEY_VOICES = [{ id: 'epiano', variant: 'rhodes' }, { id: 'sample', variant: 'epiano' }, ...['jazz', 'rock', 'gospel', 'ballad'].map((variant) => ({ id: 'organ', variant }))];
for (const [s, style] of STYLE_PRESETS.entries()) {
  for (const [v, voice] of KEY_VOICES.entries()) {
    const k = s + v;
    add('keys', style, 900 + v, { layers: WITH_CHORDS, keys: KEYS_ALL, bars: colored(CHORD_COLORS[k % 4]), form: autoForm(style), track: { voices: { ...style.voices, chords: voice }, ornaments: [0.5, 1, 0.75][k % 3] } });
  }
  add('keys-plain', style, 910, { layers: WITH_CHORDS, keys: KEYS_ALL, track: { voices: { ...style.voices, chords: KEY_VOICES[s % KEY_VOICES.length] }, length: 24 } });
}
for (const [g, id] of Object.keys(GROOVES).entries()) {
  const style = styles[g % styles.length];
  for (const [v, voice] of [KEY_VOICES[g % 2], KEY_VOICES[2 + (g % 4)]].entries()) {
    add(`keys-${id}`, style, 920 + v, { meter: GROOVES[id].meter.split('/').map(Number), layers: WITH_CHORDS, keys: KEYS_ALL, form: autoForm(style), track: { groove: id, voices: { ...style.voices, chords: voice } } });
  }
}

// lead: every job in every mode, every lead voice (the rules differ for saxophone and guitar); every groove with the
// riff (the shuffle has a rule of its own) and with one other job
const WITH_LEAD = { ...WITH_CHORDS, lead: true };
const LEAD_VOICES = [{ id: 'synth', variant: 'classic' }, ...['flute', 'sax', 'synth', 'guitar'].map((variant) => ({ id: 'sample', variant }))];
const LEAD_JOBS = ['fills', 'arpeggio', 'melody', 'callResponse', 'riff'];
const MODE_KEYS = [{ root: 'A', mode: 'minor' }, { root: 'C', mode: 'major' }, { root: 'D', mode: 'dorian' }, { root: 'E', mode: 'phrygian' }, { root: 'F', mode: 'lydian' }, { root: 'G', mode: 'mixolydian' }];
let leadCase = 0;
for (const job of LEAD_JOBS) {
  for (const key of MODE_KEYS) {
    for (let k = 0; k < 3; k++, leadCase++) {
      const n = leadCase, style = STYLE_PRESETS[n % STYLE_PRESETS.length], plain = n % 6 === 5;
      const track = { jobs: { lead: job }, voices: { ...style.voices, lead: LEAD_VOICES[n % LEAD_VOICES.length] }, ornaments: [0.5, 1, 0.75][n % 3] };
      if (plain) track.length = 24;
      add(`lead-${job}`, style, 1000 + n, { layers: WITH_LEAD, keys: [key], bars: colored(CHORD_COLORS[n % 4]), track, ...(plain ? {} : { form: autoForm(style) }) });
    }
  }
}
for (const [g, id] of Object.keys(GROOVES).entries()) {
  const style = styles[g % styles.length], meter = GROOVES[id].meter.split('/').map(Number);
  add(`riff-${id}`, style, 1100 + g, { meter, layers: WITH_LEAD, keys: KEYS_ALL, form: autoForm(style), track: { groove: id, jobs: { lead: 'riff' }, voices: { ...style.voices, lead: LEAD_VOICES[4] } } });
  add(`lead-${id}`, style, 1150 + g, { meter, layers: WITH_LEAD, keys: KEYS_ALL, form: autoForm(style), track: { groove: id, jobs: { lead: LEAD_JOBS[g % 4] }, voices: { ...style.voices, lead: LEAD_VOICES[g % LEAD_VOICES.length] } } });
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'cases.json'), JSON.stringify(cases));
const total = cases.reduce((n, c) => n + c.events.length, 0);
console.log(`${cases.length} tracks, ${total} events -> ${join(out, 'cases.json')}`);
