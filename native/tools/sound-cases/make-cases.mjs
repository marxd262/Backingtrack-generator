// Writes the cases of the sound comparison (native/tools/sound-compare.mjs) from the web app in the working tree (src/, read only):
//   node native/tools/sound-cases/make-cases.mjs   -> samples.json (and the files later tasks add) next to this file
// Every case sets the sound it measures (the core reads it since Task 16): the neutral one (DEFAULT_TIMBRE) unless the case says otherwise.
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
const { DEFAULT_TIMBRE, resolveTrackTimbre } = await load('core/timbre.js');
const { tunedValue } = await load('audio/voices/tunables.js');
const { rollForm } = await load('core/form-roll.js');

const KEY = { root: 'A', mode: 'minor' };
const NONE = { drums: false, bass: false, chords: false, pad: false, lead: false, percussion: false };
// A verse, then a chorus: without drums the bass slides only into the downbeat of a chorus (articulation.js, band rule 6)
const FORM = { sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4 }] };
// width 0.5, the web app's default (mix.width 1): every layer where mix/pan puts it, the hits of a kit spread by mix/pan kit
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
  sound: neutral(0.5),
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
  return { name, track: track(style, { layers: { [layer]: true }, voices: { [layer]: { id: 'sample', variant } }, seed: SEEDS[name] ?? 1, extra: { form: KIT_FORM, ornaments: 1, ...(job && { jobs: { lead: 'melody', percussion: job } }) } }), sound: neutral(0.5), dry: true };
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

// Task 13: one track per style, all six layers with the style's voices, a rolled form, the layers where mix/pan puts them (width 0.5).
// The same set is the A/B set for listening (native/tools/ab-samples.cmd).
const bandOf = (id) => track(id, { layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
  extra: { form: rollForm({ template: 'auto', style: id, targetBars: 24, seed: 1, tags: STYLE_PRESETS.find((s) => s.id === id).tags }) } });
const bands = Object.fromEntries(STYLE_PRESETS.map((s) => [s.id, bandOf(s.id)]));
write('band.json', STYLE_PRESETS.map((style) => ({
  name: `band-${style.id}`,
  track: bands[style.id],
  sound: neutral(0.5),
  dry: true,
})));

// --- Phase 3 (Tasks 16, 14, 15, 17): the sound model, the sends and the sum ---
// The knobs of the layer effects (Phase 4) are 0 in the cases of the sound model and the sends, so that they measure only what they name;
// the cases of a style's own sound (claim 'style') carry that style's effects.
const PHASE4 = ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus'];
const FX = ['fuzz', 'overdrive', 'distortion'], FX_LAYERS = ['bass', 'chords', 'pad', 'lead'];
const claimOf = (layer, k) => `${FX.includes(k) ? 'fx' : 'mod'}:${layer}.${k}`;
const effectsOn = (sound) => FX_LAYERS.some((g) => PHASE4.some((k) => sound[g][k] !== 0));
const styleSound = (t) => resolveTrackTimbre(t); // what the page sends for this track
const set = (sound, fields) => { const s = structuredClone(sound); for (const [path, v] of Object.entries(fields)) { const [g, f] = path.split('.'); s[g][f] = v; } return s; };
// What a case claims to measure: make-cases exits 1 when a claim does not hold for the case as written. Sample-voice knobs act only in
// part of their range (the lowpass below 0.5, see brightnessHz; the time scale away from 0.5); their layer must play notes with a sample voice.
const CLAIMS = {};
// style: the case plays its style's own layer effects (resolveTrackTimbre); its limits are the effects' where one is on
CLAIMS.style = (c) => (FX_LAYERS.every((g) => PHASE4.every((k) => c.sound[g][k] === resolveTrackTimbre(c.track)[g][k])) ? '' : "not the style's own layer effects");
const knob = (path, layer, acts) => {
  CLAIMS[path] = (c, events) => {
    const [g, f] = path.split('.'), v = c.sound[g][f];
    if (!acts(v)) return `${path} = ${v} does nothing`;
    if (layer && !(c.track.voices[layer]?.id === 'sample' && events.some((e) => e.layer === layer && e.type === 'note'))) return `no ${layer} notes with a sample voice`;
    return '';
  };
};
knob('bass.cutoff', 'bass', (v) => v < 0.5); knob('chords.brightness', 'chords', (v) => v < 0.5); knob('pad.cutoff', 'pad', (v) => v < 0.5);
knob('chords.length', 'chords', (v) => v !== 0.5); knob('pad.attack', 'pad', (v) => v !== 0.5);
knob('master.brightness', null, (v) => v !== 0.5); knob('master.width', null, (v) => v !== 0.5);
// the width acts on a kit through mix/pan kit only where the voice places its hits (kitPan not 0: format 1) and plays hits that have a place
const KIT_PLACES = ['hat', 'openHat', 'crash', 'tomHigh', 'tomLow']; // KIT_PAN of synth.js
CLAIMS['kit.places'] = (c, events) => {
  const voice = c.track.voices.drums;
  if (voice?.id !== 'sample' || tunedValue(`drums/sample/${voice.variant}`, 'kitPan', {}) === 0) return 'the kit does not place its hits';
  return events.some((e) => e.layer === 'drums' && e.type === 'hit' && KIT_PLACES.includes(e.name)) ? '' : 'no hit with a place in the kit';
};
function claimed(c, claims) {
  const events = buildEvents(c.track);
  for (const g of FX_LAYERS) for (const k of PHASE4) if (c.sound[g][k] !== 0 && !claims.includes(claimOf(g, k)) && !claims.includes('style')) problems.push(`${c.name}: ${g}.${k} is on but not claimed`);
  if (claims.includes('style') && effectsOn(c.sound)) c.kind = 'synth';
  if ((c.kind === 'synth') !== effectsOn(c.sound)) problems.push(`${c.name}: kind must be 'synth' exactly where a layer effect is on`);
  for (const what of claims) { const why = CLAIMS[what](c, events); if (why) problems.push(`${c.name}: ${why}`); }
  return c;
}
const neutralSound = neutral(0.5), funk = bands.funk;
const SAMPLE_KNOBS = ['bass.cutoff', 'chords.brightness', 'chords.length', 'pad.cutoff', 'pad.attack'];
const soloOf = (name, layer, variant, style, fields, claims, extra = {}, tuning = undefined) => claimed({ name, dry: true, sound: set(neutralSound, fields), tuning,
  track: track(style, { layers: { [layer]: true }, voices: { [layer]: { id: 'sample', variant } }, extra }) }, claims);

// Task 16: the sound model on the whole band, dry (plan: neutral, psych, dreamy; neutral is band.json): the styles' own timbres,
// and the funk band at the ends of the knobs
const timbreCases = [
  // no knob of psych's own timbre is visible within the limits in the full band; the solo cases below prove the knobs, one each
  claimed({ name: 'timbre-psych', track: bands.psych, sound: styleSound(bands.psych), dry: true }, ['style']),
  claimed({ name: 'timbre-dreamy', track: bands.dreamy, sound: styleSound(bands.dreamy), dry: true }, ['style', 'master.brightness', 'bass.cutoff', 'chords.brightness', 'chords.length', 'pad.attack']),
  claimed({ name: 'timbre-bright', track: funk, sound: set(neutralSound, { 'master.brightness': 1, 'master.width': 1 }), dry: true }, ['master.brightness', 'master.width']),
  claimed({ name: 'timbre-dark', track: funk, sound: set(neutralSound, { 'master.brightness': 0, 'master.width': 0 }), dry: true }, ['master.brightness', 'master.width']),
  claimed({ name: 'timbre-short', track: funk, sound: set(neutralSound, { 'bass.cutoff': 0, 'chords.brightness': 0, 'chords.length': 0, 'pad.cutoff': 0, 'pad.attack': 0 }), dry: true }, SAMPLE_KNOBS),
  // One layer alone with a sample voice, one knob each (the sound the knob acts on is not lost in a full band); the funk band at the
  // ends of the knobs above is the group check. Each case must fail when the core ignores its knob (checked by a build of btg_render in
  // which makeVoice leaves filterHz, timeScale and the kit's width factor out, see task-16-report.md).
  // The length and attack knobs scale the zone's times, which only shows in notes that end inside them: bpm 240 (the chords' release,
  // 0.6 s; the warm pad's attack, 0.8 s).
  soloOf('timbre-bass-dark', 'bass', 'finger', 'funk', { 'bass.cutoff': 0 }, ['bass.cutoff']),
  soloOf('timbre-chords-dark', 'chords', 'nylon', 'reggae', { 'chords.brightness': 0 }, ['chords.brightness']),
  soloOf('timbre-chords-short', 'chords', 'steel', 'country', { 'chords.length': 0 }, ['chords.length'], { bpm: 240, ornaments: 0 }),
  soloOf('timbre-chords-long', 'chords', 'steel', 'country', { 'chords.length': 1 }, ['chords.length'], { bpm: 240, ornaments: 0 }),
  soloOf('timbre-pad-dark', 'pad', 'strings', 'dreamy', { 'pad.cutoff': 0 }, ['pad.cutoff']),
  soloOf('timbre-pad-quick', 'pad', 'warm', 'psych', { 'pad.attack': 0 }, ['pad.attack'], { bpm: 240 }),
  soloOf('timbre-pad-slow', 'pad', 'warm', 'psych', { 'pad.attack': 1 }, ['pad.attack'], { bpm: 240 }),
  // The kit (format 1, so it places its hits by KIT_PAN times width times mix/pan kit), the kit's place at its largest (1) so that the
  // balance sees it: hats on the right against crash and toms on the left cancel in the level, and the width moves the balance of a
  // whole kit by under 0.9 dB at most. Width 0 puts every hit in the middle. No case for width 1: from 0.5 to 1 the balance moves
  // by 0.05 dB at this kit place (the places clip at +-1), too little to see within +-0.5 dB; test_engine.cpp proves that width.
  soloOf('timbre-kit-mono', 'drums', 'jazz', 'blues', { 'master.width': 0 }, ['master.width', 'kit.places'], { form: KIT_FORM, ornaments: 1 }, { 'mix/pan': { kit: 1 } }),
];
write('timbre.json', timbreCases);
console.log(`timbre.json: ${timbreCases.length} cases`);

// Task 14: the long reverb and the shared room, wet: no echo (Task 15), no limiter (Task 17), ringing 2.5 s past the song on both sides.
// At the neutral sound the reverb lies about 25 dB under the dry sum and would not be seen (design section 6): each case turns its send up.
const { masterParams, drumParams } = await load('audio/voice-params.js');
const sendsOf = (c) => {
  const mix = masterParams(c.sound.master);
  return { reverb: mix.reverbWet, roomSend: drumParams(c.sound.drums).roomSend, room: mix.roomWet * tunedValue('mix/room', 'wet', c.tuning ?? {}), echo: mix.echoWet };
};
const plays = (events, layer) => events.some((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit'));
CLAIMS.reverb = (c) => (sendsOf(c).reverb > 0 ? '' : 'the reverb is off');
CLAIMS.roomSend = (c, events) => (sendsOf(c).roomSend > 0 && sendsOf(c).reverb > 0 && (plays(events, 'drums') || plays(events, 'percussion')) ? '' : 'no drums into the reverb');
CLAIMS.room = (c) => (sendsOf(c).room > 0 ? '' : 'the room is off');
CLAIMS.noEcho = (c) => (sendsOf(c).echo === 0 ? '' : 'the echo is on');
// only the room sends of bass, chords, pad and lead: drums and percussion send nothing, and one of the four plays with a send
const MELODIC = ['bass', 'chords', 'pad', 'lead'], roomOf = (c, layer) => tunedValue('mix/room', layer, c.tuning ?? {});
CLAIMS.melodicRoom = (c, events) => (sendsOf(c).room > 0 && roomOf(c, 'drums') === 0 && roomOf(c, 'percussion') === 0
  && MELODIC.some((l) => roomOf(c, l) > 0 && plays(events, l)) ? '' : 'not only the melodic layers into the room');
const WET = { limiter: false, tail: 2.5 };
const drumsSolo = kits.find((c) => c.name === 'drums-standard').track;
const sendCases = [
  claimed({ name: 'reverb-drums', track: drumsSolo, sound: set(neutralSound, { 'master.reverb': 1, 'master.echo': 0, 'master.roomWet': 0, 'drums.room': 1 }), ...WET }, ['reverb', 'roomSend', 'noEcho']),
  claimed({ name: 'room-drums', track: drumsSolo, sound: set(neutralSound, { 'master.reverb': 0, 'master.echo': 0, 'master.roomSize': 1 }), tuning: { 'mix/room': { wet: 4 } }, ...WET }, ['room', 'noEcho']),
  // the room at its loudest (roomWet 1 and wet 4: 8 times the neutral), so that its sends, tone and highpass show in a whole band;
  // room-melodic: the same without drums and percussion, the only case for the sends of bass, chords, pad and lead
  claimed({ name: 'room-band', track: funk, sound: set(neutralSound, { 'master.reverb': 0, 'master.echo': 0, 'master.roomSize': 0, 'master.roomWet': 1 }), tuning: { 'mix/room': { wet: 4, tone: 3000 } }, ...WET }, ['room', 'noEcho']),
  claimed({ name: 'room-melodic', track: funk, sound: set(neutralSound, { 'master.reverb': 0, 'master.echo': 0, 'master.roomSize': 0, 'master.roomWet': 1 }), tuning: { 'mix/room': { wet: 4, tone: 3000, drums: 0, percussion: 0 } }, ...WET }, ['room', 'melodicRoom', 'noEcho']),
  claimed({ name: 'sends-dreamy', track: bands.dreamy, sound: set(styleSound(bands.dreamy), { 'master.reverb': 1, 'master.echo': 0, 'master.roomWet': 0.75 }), ...WET }, ['style', 'reverb', 'roomSend', 'room', 'noEcho']),
];
write('sends.json', sendCases);
console.log(`sends.json: ${sendCases.length} cases`);

// Task 15: the echo (dotted eighths on chords, pad and lead, taken behind the trim), wet: no reverb, no room, no limiter, 2.5 s past the
// song. At the neutral sound (wet 0.3, feedback 0.38) it lies about 10 dB under its layer and could hardly be seen: the solo cases turn it up.
CLAIMS.echo = (c, events) => (sendsOf(c).echo > 0 && ['chords', 'pad', 'lead'].some((l) => plays(events, l)) ? '' : 'no echo on chords, pad or lead');
CLAIMS.noReverb = (c) => (sendsOf(c).reverb === 0 && sendsOf(c).room === 0 ? '' : 'the reverb or the room is on');
const ECHO_ONLY = { 'master.reverb': 0, 'master.roomWet': 0 };
const echoCases = [
  claimed({ name: 'echo-chords', track: samples.find((c) => c.name === 'chords-guitar').track, sound: set(neutralSound, { ...ECHO_ONLY, 'master.echo': 1 }), ...WET }, ['echo', 'noReverb']),
  claimed({ name: 'echo-pad-slow', track: track('dreamy', { layers: { pad: true }, voices: { pad: { id: 'sample', variant: 'strings' } }, extra: { bpm: 45 } }),
    sound: set(neutralSound, { ...ECHO_ONLY, 'master.echo': 1 }), ...WET }, ['echo', 'noReverb']),
  claimed({ name: 'echo-lead', track: samples.find((c) => c.name === 'lead-flute').track, sound: set(neutralSound, { ...ECHO_ONLY, 'master.echo': 0.75 }), ...WET }, ['echo', 'noReverb']),
];
write('echo.json', echoCases);
// Task 15, and Task 16's three timbres with their sends: the whole band, every send on, at the neutral sound and in the styles psych and dreamy.
// Their claims only say that a send is on; the solo cases (sends.json, echo.json) prove the sends.
const wetCases = [
  claimed({ name: 'wet-neutral', track: funk, sound: neutralSound, ...WET }, ['reverb', 'room', 'echo']),
  claimed({ name: 'wet-psych', track: bands.psych, sound: styleSound(bands.psych), ...WET }, ['style', 'reverb', 'room', 'echo']),
  claimed({ name: 'wet-dreamy', track: bands.dreamy, sound: styleSound(bands.dreamy), ...WET }, ['style', 'reverb', 'roomSend', 'room', 'echo']),
];
write('wet.json', wetCases);
console.log(`echo.json: ${echoCases.length} cases, wet.json: ${wetCases.length} cases`);

// Task 17: the nine bands with everything: their styles' timbres (Phase 4 knobs 0), reverb, room, echo and the sum with the limiter,
// ringing 2.5 s past the song. The A/B set for listening (native/tools/ab-mix.cmd). Then the funk band at the tempo extremes (the plan:
// all six layers, everything on, at 20 and 400 bpm, below full scale), with the real packs: a form of 4 bars at 20 bpm (48 s), the rolled
// form of 24 bars at 400 bpm.
const mixCases = STYLE_PRESETS.map((s) => claimed({ name: `mix-${s.id}`, track: bands[s.id], sound: styleSound(bands[s.id]), tail: 2.5 }, ['style', 'reverb', 'room', 'echo']));
const SIX = { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true };
const funkAt = (bpm, form) => track('funk', { layers: SIX, extra: { bpm, form } });
const slow = funkAt(20, { sections: [{ type: 'verse', bars: 2 }, { type: 'chorus', bars: 2 }] }), fast = funkAt(400, bands.funk.form);
for (const [name, t] of [['mix-funk-20bpm', slow], ['mix-funk-400bpm', fast]]) mixCases.push(claimed({ name, track: t, sound: styleSound(t), tail: 2.5, peakBelow: 0 }, ['style', 'reverb', 'room', 'echo'])); // peakBelow 0: the plan's "below full scale", asserted on the native peak
// The fine value mix/bus on is 0 by default (tunables.js): the nine cases above run the old limiter alone, shelf -> limiter at -10 dB.
// The glue compressor (on 1: glue, its gain, limiter at -2 dBFS) is the user's to switch on; three styles measure it, the loudest ones and one
// with a dense envelope.
CLAIMS.glue = (c) => (tunedValue('mix/bus', 'on', c.tuning ?? {}) >= 0.5 ? '' : 'the glue is off');
for (const id of ['funk', 'rock', 'poppunk']) mixCases.push(claimed({ name: `mix-${id}-glue`, track: bands[id], sound: styleSound(bands[id]), tuning: { 'mix/bus': { on: 1 } }, tail: 2.5 }, ['style', 'reverb', 'room', 'echo', 'glue']));
// The same tempo extremes with a style whose own sound has layer effects on (Task 19, the plan's "everything on" with the effects the styles
// really carry; psych: fuzz on the bass, chorus on the chords).
const psychAt = (bpm, form) => track('psych', { layers: SIX, extra: { bpm, form } });
for (const [name, t] of [['mix-psych-20bpm', psychAt(20, { sections: [{ type: 'verse', bars: 2 }, { type: 'chorus', bars: 2 }] })], ['mix-psych-400bpm', psychAt(400, bands.psych.form)]])
  mixCases.push(claimed({ name, track: t, sound: styleSound(t), tail: 2.5, peakBelow: 0 }, ['style', 'reverb', 'room', 'echo']));
write('mix.json', mixCases);
console.log(`mix.json: ${mixCases.length} cases (nine styles, funk at 20 and 400 bpm, three styles with the glue, psych at 20 and 400 bpm)`);

// --- Phase 4 (Tasks 18, 19): the layer effects. One layer alone with its sample voice, one knob (or the named ones), dry: the chain is all
// that differs from samples.json. The limits of effects (kind 'synth', Global Constraints). fx:<layer>.<knob>: the knob above 0 on a layer
// that plays notes with a sample voice; every other layer effect 0 (claimed). blend: a stage between bypass and full (mix = min(1, 8 v),
// fx-params.js 18), where the bypass and the 128-frame-late wet path add up to a comb.
for (const layer of FX_LAYERS) for (const k of PHASE4) CLAIMS[claimOf(layer, k)] = (c, events) => {
  const v = c.sound[layer][k];
  if (!(v > 0 && v <= 1)) return `${layer}.${k} = ${v} does nothing`;
  return c.track.voices[layer]?.id === 'sample' && events.some((e) => e.layer === layer && e.type === 'note') ? '' : `no ${layer} notes with a sample voice`;
};
CLAIMS.blend = (c) => (FX_LAYERS.some((g) => FX.some((k) => c.sound[g][k] > 0 && 8 * c.sound[g][k] < 1)) ? '' : 'no stage between bypass and full');
const effectSolo = (name, layer, variant, style, fields, claims) => claimed({ name, dry: true, kind: 'synth', sound: set(neutralSound, fields),
  track: track(style, { layers: { [layer]: true }, voices: { [layer]: { id: 'sample', variant } } }) }, claims);
const fxCases = [];
for (const [layer, variant, style] of [['bass', 'finger', 'funk'], ['chords', 'guitar', 'rock']])
  for (const k of FX) for (const v of [0.3, 1]) fxCases.push(effectSolo(`fx-${layer}-${k}-${v}`, layer, variant, style, { [`${layer}.${k}`]: v }, [claimOf(layer, k)]));
for (const [layer, variant, style] of [['pad', 'strings', 'dreamy'], ['lead', 'guitar', 'rock']])
  for (const k of FX) fxCases.push(effectSolo(`fx-${layer}-${k}-0.3`, layer, variant, style, { [`${layer}.${k}`]: 0.3 }, [claimOf(layer, k)]));
fxCases.push(effectSolo('fx-chords-overdrive-blend', 'chords', 'guitar', 'rock', { 'chords.overdrive': 0.06 }, [claimOf('chords', 'overdrive'), 'blend']));
fxCases.push(effectSolo('fx-bass-all', 'bass', 'finger', 'funk', { 'bass.fuzz': 0.5, 'bass.overdrive': 0.5, 'bass.distortion': 0.5 }, FX.map((k) => claimOf('bass', k))));
write('fx.json', fxCases);
console.log(`fx.json: ${fxCases.length} cases`);

// Task 19: vibrato and chorus, one layer alone, one knob, dry. The plan's three measures hardly see them (phase-4-design.md 6.2): a
// vibrato of ±40 cents moves no octave band and no 50 ms window, the chorus keeps the power; these cases guard level and bands, their
// printed stereo figure shows a chorus (and their diff, where the dry voice's own disagreement is low, a missing effect), fx-compare.mjs
// proves the chain.
const modCases = [];
for (const [layer, variant, style] of [['bass', 'finger', 'funk'], ['chords', 'guitar', 'rock']])
  for (const k of ['vibrato', 'chorus']) for (const v of [0.3, 1]) modCases.push(effectSolo(`mod-${layer}-${k}-${v}`, layer, variant, style, { [`${layer}.${k}`]: v }, [claimOf(layer, k)]));
for (const [layer, variant, style] of [['pad', 'strings', 'dreamy'], ['lead', 'guitar', 'rock']])
  for (const k of ['vibrato', 'chorus']) modCases.push(effectSolo(`mod-${layer}-${k}-1`, layer, variant, style, { [`${layer}.${k}`]: 1 }, [claimOf(layer, k)]));
// the vibrato's rate follows the tempo (modParams: 4 Hz at 60 bpm, 5.5 Hz from 120 bpm on)
for (const bpm of [60, 160]) modCases.push(claimed({ name: `mod-chords-both-${bpm}bpm`, dry: true, kind: 'synth', sound: set(neutralSound, { 'chords.vibrato': 0.5, 'chords.chorus': 0.5 }),
  track: track('rock', { layers: { chords: true }, voices: { chords: { id: 'sample', variant: 'guitar' } }, extra: { bpm } }) }, [claimOf('chords', 'vibrato'), claimOf('chords', 'chorus')]));
// the plan's style: psych (fuzz on the bass, chorus on the sample twelve-string from its tags), dry, its own timbre as the page sends it
modCases.push(claimed({ name: 'mod-psych', track: bands.psych, sound: resolveTrackTimbre(bands.psych), dry: true, kind: 'synth' }, [claimOf('bass', 'fuzz'), claimOf('chords', 'chorus')]));
write('mod.json', modCases);
console.log(`mod.json: ${modCases.length} cases`);
for (const p of problems) console.error(`ERROR ${p}`);
process.exit(problems.length ? 1 : 0);
