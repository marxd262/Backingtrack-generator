// Writes the cases of the sound comparison (native/tools/sound-compare.mjs) from the web app in the working tree (src/, read only):
//   node native/tools/sound-cases/make-cases.mjs   -> samples.json (and the files later tasks add) next to this file
// Every case is dry and plays with the neutral sound (DEFAULT_TIMBRE): the core has no timbre before Task 16.
// Prints how often each articulation occurs over the sample cases and exits 1 when one the sampler computes never does.
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const load = (file) => import(pathToFileURL(join(resolve(here, '../../..'), 'src', file)).href);
const { STYLE_PRESETS, buildEvents } = await load('index.js');
const { normalizeTrack } = await load('core/track.js');
const { resolveVoices } = await load('core/voices.js');
const { progressionFor } = await load('core/progressions.js');
const { DEFAULT_TIMBRE } = await load('core/timbre.js');
const { tunedValue } = await load('audio/voices/tunables.js');

const KEY = { root: 'A', mode: 'minor' };
const NONE = { drums: false, bass: false, chords: false, pad: false, lead: false, percussion: false };
// A verse, then a chorus: without drums the bass slides only into the downbeat of a chorus (articulation.js, band rule 6)
const FORM = { sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4 }] };
// width 0 puts every layer in the middle (the core's balance comes with Task 13)
const neutral = (width) => ({ ...structuredClone(DEFAULT_TIMBRE), master: { ...DEFAULT_TIMBRE.master, width } });
function track(styleId, { layers, voices = {}, seed = 2, lead = 'melody', extra = {} }) {
  const style = STYLE_PRESETS.find((s) => s.id === styleId);
  const t = normalizeTrack({
    key: KEY, bpm: style.bpm, seed, meter: [4, 4], bars: progressionFor(KEY, seed).map((chord) => ({ chord, beats: 4 })), tags: style.tags,
    voices: { ...style.voices, ...voices }, layers: { ...NONE, ...layers }, jobs: { lead, percussion: 'mixed' }, length: 8, variety: true, form: FORM, ...extra,
  });
  const given = { ...t, voices: resolveVoices(t) };
  buildEvents(given); // throws on a track the web app would refuse
  return given;
}
const write = (file, cases) => writeFileSync(join(here, file), `${JSON.stringify(cases, null, 1)}\n`);

// Task 11: every tonal sample voice alone, in the style that proposes it (styles propose only bass and chords; the others: a fitting style),
// with the default ornaments, and a twin with ornaments 1. The twin plays in the style named fourth (else the same); null: no twin, because
// ornaments change nothing there (the upright has no rules of its own, the pad rules and those of these chord styles do not scale).
// The leads play call and response: the melody's long notes all take the vibrato, so scoop, slideIn and pull would hardly occur.
const NOTES = [
  ['bass', 'finger', 'funk'], ['bass', 'pick', 'rock'], ['bass', 'upright', 'country', null],
  ['chords', 'guitar', 'rock'], ['chords', 'epiano', 'dreamy'], ['chords', 'muted', 'hardrock'], ['chords', 'jazz', 'blues', 'funk'], ['chords', 'funk', 'funk'],
  ['chords', 'steel', 'country', 'rock'], ['chords', 'nylon', 'reggae', 'funk'], ['chords', 'twelve', 'psych', 'rock'], ['chords', 'freepats', 'rock'],
  ['chords', 'freepatsjazz', 'blues', 'funk'],
  ['pad', 'strings', 'dreamy', null], ['pad', 'warm', 'psych', null],
  ['lead', 'flute', 'reggae'], ['lead', 'sax', 'blues'], ['lead', 'synth', 'psych'], ['lead', 'guitar', 'rock'],
];
const samples = NOTES.flatMap(([layer, variant, style, twin = style]) => [[style, 0], ...(twin ? [[twin, 1]] : [])].map(([at, ornate]) => ({
  name: `${layer}-${variant}${ornate ? '-ornaments' : ''}${at !== style ? `-${at}` : ''}`,
  track: track(at, { layers: { [layer]: true }, voices: { [layer]: { id: 'sample', variant } }, lead: layer === 'lead' ? 'callResponse' : 'melody', extra: ornate ? { ornaments: 1 } : {} }),
  sound: neutral(0),
  dry: true,
})));
write('samples.json', samples);

// What the sampler computes (sampler.js playNote; strum: sample.js), counted over the notes of all sample cases. A twin whose notes equal
// its plain case's measures nothing new.
const COMPUTED = ['staccato', 'dead', 'chuck', 'choke', 'palmMute', 'hammer', 'pull', 'slideIn', 'scoop', 'slideOff', 'fall', 'bend', 'vibrato', 'swell', 'ring', 'strum'];
const count = Object.fromEntries(COMPUTED.map((a) => [a, 0])), notesOf = new Map(), problems = [];
for (const c of samples) {
  const notes = buildEvents(c.track).filter((e) => e.type === 'note'), voice = c.track.voices[notes[0]?.layer];
  for (const e of notes) {
    if (e.art in count) count[e.art]++;
    if (e.ring) count.ring++;
    if (Array.isArray(e.strum) && e.strum[1] > 1 && tunedValue(`${e.layer}/${voice.id}/${voice.variant}`, 'strum', {}) > 0) count.strum++;
  }
  const plain = c.name.replace(/-ornaments.*$/, ''), text = JSON.stringify(notes);
  if (plain !== c.name && notesOf.get(plain) === text) problems.push(`${c.name} has the notes of ${plain}`);
  notesOf.set(c.name, text);
}
console.log(`samples.json: ${samples.length} cases. Articulations the sampler computes, notes over all cases:`);
for (const a of COMPUTED) console.log(`  ${a.padEnd(9)} ${count[a]}`);
const missing = COMPUTED.filter((a) => count[a] === 0);
if (missing.length) problems.push(`never occurs: ${missing.join(', ')}`);

// Task 12: every kit alone, and the percussion: a fill into a crashed chorus, then a stop (the crash before it chokes itself);
// ornaments 1 for flams. SEEDS: a case whose seed 1 lacks a fill, a crash, a flam or a choke (see the checks below).
const KITS = [
  ['drums', 'standard', 'funk'], ['drums', 'brushes', 'country'], ['drums', 'rimshot', 'reggae'], ['drums', 'jazz', 'blues'],
  ['drums', 'electronic', 'psych'], ['drums', '808', 'funk'], ['drums', 'muldjord', 'rock'], ['drums', 'legacy', 'rock'], ['percussion', 'studio', 'funk'],
  // the jobs that play only the instruments 'mixed' never picks: bongos, claves, cowbell (same layer set-up as the case above)
  ['percussion', 'studio', 'funk', 'bongos'], ['percussion', 'studio', 'funk', 'claves'], ['percussion', 'studio', 'funk', 'cowbell'],
];
const KIT_FORM = { sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4, transition: 'fill', crash: true }, { type: 'verse', bars: 2, transition: 'stop' }] };
const SEEDS = {};
const kits = KITS.map(([layer, variant, style, job]) => {
  const name = `${layer}-${variant}${job ? `-${job}` : ''}`;
  return { name, track: track(style, { layers: { [layer]: true }, voices: { [layer]: { id: 'sample', variant } }, seed: SEEDS[name] ?? 1, extra: { form: KIT_FORM, ornaments: 1, ...(job && { jobs: { lead: 'melody', percussion: job } }) } }), sound: neutral(0), dry: true };
});
const kitEvents = kits.map((c) => buildEvents(c.track));
kits.forEach((c, i) => {
  if (!kitEvents[i].some((e) => e.type === 'marker' && e.name === 'fill')) problems.push(`${c.name}: no fill`);
  if (c.name.startsWith('drums') && !kitEvents[i].some((e) => e.type === 'hit' && e.name === 'crash')) problems.push(`${c.name}: no crash`);
});
for (const art of ['flam', 'choke']) if (!kitEvents.some((list) => list.some((e) => e.layer === 'drums' && e.art === art))) problems.push(`no ${art} in any kit case`);
write('kits.json', kits);

// Hits per name over the kit cases (drums and percussion cases each count their own layer), and the arts the voice meets.
const hitCount = {};
let flams = 0, chokes = 0;
for (const list of kitEvents) for (const e of list) {
  if (e.type !== 'hit') continue;
  hitCount[e.name] = (hitCount[e.name] ?? 0) + 1;
  if (e.art === 'flam') flams++;
  if (e.art === 'choke') chokes++;
}
// rideBell and hatHalf: no rule of the generator writes them (articulation.js 176 renames the hats only to 'ride'; src/core has them only in DRUM_NAMES and DRUM_FALLBACK)
const DRUM_ONLY = ['kick', 'snare', 'hat', 'openHat', 'tomHigh', 'tomMid', 'tomLow', 'crash', 'sideStick', 'rimshot', 'ride', 'rideBell', 'hatHalf', 'hatPedal'];
const PERCUSSION = ['shaker', 'tambourine', 'congaHigh', 'congaLow', 'bongoHigh', 'bongoLow', 'claves', 'cowbell'];
console.log(`kits.json: ${kits.length} cases. Hits per name over all cases, flam ${flams}, choke ${chokes}:`);
for (const n of [...DRUM_ONLY, ...PERCUSSION]) console.log(`  ${n.padEnd(10)} ${hitCount[n] ?? 0}`);
for (const n of PERCUSSION) if (!hitCount[n]) problems.push(`no ${n} in any kit case`);
for (const p of problems) console.error(`ERROR ${p}`);
process.exit(problems.length ? 1 : 0);
