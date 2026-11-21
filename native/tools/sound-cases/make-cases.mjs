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
const { resolveVoices, usesTimbreField, VOICES } = await load('core/voices.js');
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
const bandOf = (id, voices) => track(id, { layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true }, voices,
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
// style: the case plays its style's own layer effects (resolveTrackTimbre). A case of the whole band keeps the sample limits, effects on or
// not (phase-4 ruling R); a case of fewer layers, sample voices alone, with an effect on has the effects' (kind 'synth').
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
// Phase 5: the layers that are on, play notes or hits and have a voice whose registry kind is not 'sample' (src/core/voices.js).
// voice:<layer>: the layer is one of them; synth:<layer>.<knob>: also the knob is away from its neutral value (DEFAULT_TIMBRE) and the
// layer's voice uses it (usesTimbreField).
const synthLayers = (c, events) => Object.keys(c.track.layers).filter((l) => c.track.layers[l] && VOICES[l][c.track.voices[l].id].kind !== 'sample'
  && events.some((e) => e.layer === l && (e.type === 'note' || e.type === 'hit')));
for (const layer of Object.keys(VOICES)) {
  CLAIMS[`voice:${layer}`] = (c, events) => (synthLayers(c, events).includes(layer) ? '' : `no ${layer} notes or hits with a voice that is not a sample voice`);
  for (const k of Object.keys(DEFAULT_TIMBRE[layer] ?? {})) CLAIMS[`synth:${layer}.${k}`] = (c, events) => {
    if (c.sound[layer][k] === DEFAULT_TIMBRE[layer][k]) return `${layer}.${k} = ${c.sound[layer][k]} is its neutral value`;
    if (!usesTimbreField(c.track.voices, `${layer}.${k}`)) return `the voice of ${layer} does not use ${layer}.${k}`;
    return CLAIMS[`voice:${layer}`](c, events);
  };
}
function claimed(c, claims) {
  const events = buildEvents(c.track);
  // a voice that makes the knob's effect itself (its registry uses name it: the classic chords' chorus, ownChorus in synth.js) claims it as synth:
  const owns = (g, k) => claims.includes(`synth:${g}.${k}`) && VOICES[g][c.track.voices[g].id].uses.includes(`${g}.${k}`);
  for (const g of FX_LAYERS) for (const k of PHASE4) if (c.sound[g][k] !== 0 && !claims.includes(claimOf(g, k)) && !owns(g, k) && !claims.includes('style')) problems.push(`${c.name}: ${g}.${k} is on but not claimed`);
  // ruling 10 as tightened in Phase 5's fix wave: a case in which a layer plays a voice that is not a sample voice has the sample limits,
  // effects on or not (every case of the six synth files lay inside them, p5-review/evidence.md); the effects' limits stay for a case of
  // sample voices alone with a layer effect on and fewer layers than the whole band
  const synth = effectsOn(c.sound) && !Object.values(c.track.layers).every(Boolean) && synthLayers(c, events).length === 0;
  if (claims.includes('style') && synth) c.kind = 'synth';
  if ((c.kind === 'synth') !== synth) problems.push(`${c.name}: kind must be 'synth' exactly where a layer effect is on in a case of sample voices alone and fewer layers than the whole band`);
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
  return events.some((e) => e.layer === layer && e.type === 'note') ? '' : `no ${layer} notes`; // with a sample voice or (Task 20 on) a synth voice
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
// the plan's style: psych (fuzz on the bass, chorus on the sample twelve-string from its tags), dry, its own timbre as the page sends it;
// the whole band, so the sample limits (ruling R)
modCases.push(claimed({ name: 'mod-psych', track: bands.psych, sound: resolveTrackTimbre(bands.psych), dry: true }, [claimOf('bass', 'fuzz'), claimOf('chords', 'chorus')]));
write('mod.json', modCases);
console.log(`mod.json: ${modCases.length} cases`);

// --- Phase 5: the synth voices. One layer alone with a synth voice, dry, the sample limits (ruling 10 as tightened, see claimed). ---
// The e-piano's, the classic synth's and the string voices' cases also judge the diff at voice-compare's bar (Phase 5 ruling 6): they run
// Engine::render against the page, which follows it sample by sample there.
const DIFF_BELOW = -60, judgeDiff = (cases) => cases.map((c) => ({ ...c, diffBelow: DIFF_BELOW }));
const synthSolo = (name, layer, voice, style, fields, claims, extra = {}, tuning = undefined) => claimed({ name, dry: true, sound: set(neutralSound, fields), tuning,
  track: track(style, { layers: { [layer]: true }, voices: { [layer]: voice }, extra }) }, claims);
// Task 21: the FM e-piano on the chords, neutral and each of its knobs at its ends (dreamy: long chords, so that length shows)
const EPIANO = { id: 'epiano', variant: 'rhodes' };
const epianoCases = [synthSolo('epiano-neutral', 'chords', EPIANO, 'dreamy', {}, ['voice:chords'])];
for (const [k, values] of [['brightness', [0, 1]], ['length', [0, 1]], ['tremolo', [0.5, 1]]])
  for (const v of values) epianoCases.push(synthSolo(`epiano-${k}-${v}`, 'chords', EPIANO, 'dreamy', { [`chords.${k}`]: v }, ['voice:chords', `synth:chords.${k}`]));
write('epiano.json', judgeDiff(epianoCases));
console.log(`epiano.json: ${epianoCases.length} cases`);

// Task 20: the tonewheel organ on the chords, in the default form (a verse, then a chorus: src/core/organ.js turns the Leslie fast and opens
// the swell pedal into the chorus). leslie:<mode>: the organ's fine value leslie is that mode (the tuning's, else the preset's 1); for mode 1
// the chord notes carry leslie 1 and also none, so the Leslie changes its speed. swell: the swell knob is on, the chord notes carry two pedal
// values (swell in dB, none for 0 dB) and an art 'swell'. perc: the preset's perc is on and a note other than the first starts when every
// earlier note has ended (organ.js percussionGate, HELD_EPS 0.005 s): the single trigger fires again.
const organKey = (c) => `chords/organ/${c.track.voices.chords?.variant}`;
const chordNotes = (events) => events.filter((e) => e.layer === 'chords' && e.type === 'note');
for (const mode of [0, 1, 2, 3]) CLAIMS[`leslie:${mode}`] = (c, events) => {
  if (c.track.voices.chords?.id !== 'organ') return 'the chords do not play the organ';
  if (tunedValue(organKey(c), 'leslie', c.tuning ?? {}) !== mode) return `leslie is not ${mode}`;
  const notes = chordNotes(events);
  return mode !== 1 || (notes.some((e) => e.leslie === 1) && notes.some((e) => e.leslie === undefined)) ? '' : 'the chord notes do not switch the Leslie';
};
CLAIMS.swell = (c, events) => {
  if (!(tunedValue(organKey(c), 'swell', c.tuning ?? {}) > 0)) return 'the swell is off';
  const notes = chordNotes(events);
  return new Set(notes.map((e) => e.swell ?? 0)).size >= 2 && notes.some((e) => e.art === 'swell') ? '' : 'the chord notes do not move the pedal with an art swell';
};
CLAIMS.perc = (c, events) => {
  if (!(tunedValue(organKey(c), 'perc', c.tuning ?? {}) > 0)) return 'the percussion is off';
  let held = -Infinity, again = false;
  for (const e of chordNotes(events).sort((a, b) => a.t - b.t)) {
    again ||= held > -Infinity && e.t >= held - 0.005;
    held = Math.max(held, e.t + Math.max(0.03, e.dur));
  }
  return again ? '' : 'no note starts after every earlier one has ended';
};
// The four presets in the styles scripts/render-organ.mjs and tunables.js measured them in (gospel in the rock case); jazz with the Leslie
// off, always slow, always fast; rock with drive 0 and 1; ballad with the swell off; rock with no click; jazz with no percussion; and jazz
// behind the layer chains, which the organ's two channels run in two (chorus, distortion, vibrato at 1). Each fails when the core ignores its
// knob (Task 20's mutation runs, again at the sample limits in Phase 5's fix wave), except two that cannot fail red: Leslie mode 2 (with
// the preset's mode 1 instead it stays within the limits, envelope 0.980, bands -0.60 dB; voice-compare's set "organ jazz leslie 2" fails
// then, -8.3 dB) and the vibrato (bands +0.86 dB at 8 kHz, envelope 0.997 without it; as every vibrato case, mod.json; fx-compare's
// stereo vibrato set proves the chain).
const ORGAN_STYLE = { jazz: 'blues', rock: 'rock', gospel: 'rock', ballad: 'dreamy' };
const organSolo = (name, variant, tuning, claims, fields = {}) => synthSolo(name, 'chords', { id: 'organ', variant }, ORGAN_STYLE[variant], fields,
  ['voice:chords', ...claims], {}, tuning && { [`chords/organ/${variant}`]: tuning });
const organCases = [
  organSolo('organ-jazz', 'jazz', undefined, ['leslie:1', 'swell', 'perc']),
  ...['rock', 'gospel', 'ballad'].map((v) => organSolo(`organ-${v}`, v, undefined, ['leslie:1', 'swell'])),
  ...[0, 2, 3].map((mode) => organSolo(`organ-jazz-leslie-${mode}`, 'jazz', { leslie: mode }, [`leslie:${mode}`, 'swell', 'perc'])),
  ...[0, 1].map((drive) => organSolo(`organ-rock-drive-${drive}`, 'rock', { drive }, ['leslie:1', 'swell'])),
  organSolo('organ-ballad-swell-0', 'ballad', { swell: 0 }, ['leslie:1']),
  organSolo('organ-rock-click-0', 'rock', { click: 0 }, ['leslie:1', 'swell']),
  organSolo('organ-jazz-perc-0', 'jazz', { perc: 0 }, ['leslie:1', 'swell']),
  ...['chorus', 'distortion', 'vibrato'].map((k) => organSolo(`organ-jazz-${k}-1`, 'jazz', undefined, ['leslie:1', 'swell', 'perc', claimOf('chords', k)], { [`chords.${k}`]: 1 })),
];
// The diff stays printed, not judged (-25 to -44 dB; -73 dB with the Leslie off or at one speed): Task 23a found organ-jazz's held by the
// Leslie following the song form (its speed changes: the page's LFOs run a-rate while a later change is listed, the core's k-rate, a path
// not rebuilt); the other cases' not traced.
write('organ.json', organCases);
console.log(`organ.json: ${organCases.length} cases`);

// Task 22: the classic synth on each of its four layers alone, neutral and each knob of its voice's uses at its ends (a knob whose neutral
// value is 0 at 0.5 and 1, as the e-piano's tremolo: at 0 its case would be the neutral one); the lead's uses are empty. Each case fails
// when the core ignores its knob (Task 22's mutation runs, again at the sample limits in Phase 5's fix wave). Pad lfoSpeed 0 stays within
// the level, band and envelope limits then (bands +1.07 dB at 4 kHz, envelope 1.000); its diff measured -13.7 dB in that run, made before
// the case carried diffBelow -60, so that it fails red on the diff is computed, not run; voice-compare's set "classic pad lfoSpeed 0" fails
// then (-18.8 dB).
const CLASSIC = { id: 'synth', variant: 'classic' }, CLASSIC_STYLE = { bass: 'funk', chords: 'dreamy', pad: 'dreamy', lead: 'psych' };
const classicCases = [];
for (const layer of ['bass', 'chords', 'pad', 'lead']) {
  classicCases.push(synthSolo(`classic-${layer}-neutral`, layer, CLASSIC, CLASSIC_STYLE[layer], {}, [`voice:${layer}`]));
  for (const path of VOICES[layer].synth.uses) {
    const k = path.split('.')[1];
    for (const v of DEFAULT_TIMBRE[layer][k] === 0 ? [0.5, 1] : [0, 1])
      classicCases.push(synthSolo(`classic-${layer}-${k}-${v}`, layer, CLASSIC, CLASSIC_STYLE[layer], { [path]: v }, [`voice:${layer}`, `synth:${path}`]));
  }
}
write('classic.json', judgeDiff(classicCases));
console.log(`classic.json: ${classicCases.length} cases`);

// Task 23: the synth kit and the synth percussion alone, dry, as kits.json plays their sample voices (the funk style, seed 1, KIT_FORM, ornaments
// 1): the drums at the neutral sound and each of the six knobs of their sound at its ends (every one's neutral value is 0.5), the percussion's
// jobs. Then the nine bands of band.json with every layer on its synth voice. Each knob case fails when the core ignores its knob (Task 23's
// mutation runs, again at the sample limits in Phase 5's fix wave), except two that cannot fail red: hatLength 0 and 1 stay within the
// limits then (bands -1.11 and +0.31 dB at 8 kHz, envelope 1.000); voice-compare's sets "drums openHat, hatLength 0, 1" fail then (-10.0,
// -9.4 dB).
const SYNTH_VOICE = { id: 'synth', variant: 'classic' }, KIT_KNOBS = ['kickPunch', 'kickLength', 'snareTone', 'snareSnap', 'hatBright', 'hatLength'];
const kitSynth = (name, layer, fields, claims, job) => claimed({ name, dry: true, sound: set(neutralSound, fields),
  track: track('funk', { layers: { [layer]: true }, voices: { [layer]: SYNTH_VOICE }, seed: 1, extra: { form: KIT_FORM, ornaments: 1, ...(job && { jobs: { lead: 'melody', percussion: job } }) } }) }, claims);
const kitsSynthCases = [kitSynth('drums-synth', 'drums', {}, ['voice:drums'])];
for (const k of KIT_KNOBS) for (const v of DEFAULT_TIMBRE.drums[k] === 0 ? [0.5, 1] : [0, 1]) kitsSynthCases.push(kitSynth(`drums-synth-${k}-${v}`, 'drums', { [`drums.${k}`]: v }, ['voice:drums', `synth:drums.${k}`]));
for (const job of [undefined, 'bongos', 'claves', 'cowbell']) kitsSynthCases.push(kitSynth(`percussion-synth${job ? `-${job}` : ''}`, 'percussion', {}, ['voice:percussion'], job));
for (const c of kitsSynthCases.filter((k) => k.name.startsWith('drums'))) {
  const events = buildEvents(c.track);
  if (!events.some((e) => e.type === 'marker' && e.name === 'fill') || !events.some((e) => e.type === 'hit' && e.name === 'crash')) problems.push(`${c.name}: no fill or no crash`);
}
// The diff stays printed, not judged (-45 to -134 dB): Task 23a found drums-synth's held by one kick and hat on the grid at 21.6 s, where the
// page's own time is one ulp after its frame (Chromium's window click there, which the core leaves out by ruling: 99.8 % of the difference);
// the other cases' not traced.
write('kits-synth.json', kitsSynthCases);
const ALL_SYNTH = Object.fromEntries(Object.keys(VOICES).map((l) => [l, SYNTH_VOICE]));
const bandSynthCases = STYLE_PRESETS.map((s) => claimed({ name: `band-synth-${s.id}`, track: bandOf(s.id, ALL_SYNTH), sound: neutral(0.5), dry: true },
  Object.keys(VOICES).map((l) => `voice:${l}`)));
write('band-synth.json', bandSynthCases); // the diff stays printed, not judged (-48 to -125 dB): not traced
console.log(`kits-synth.json: ${kitsSynthCases.length} cases, band-synth.json: ${bandSynthCases.length} cases`);

// Task 24: the string model on the bass and on the chords alone (both voices are hidden in the page, a track names them), neutral and each
// knob of its voice's uses at its ends (a knob whose neutral value is 0 at 0.5 and 1, as Task 22's), in the styles of the classic synth's
// cases (dreamy: the chords' longest notes). Each case fails when the core holds its knob at the neutral value (Task 24's mutation runs;
// sub 0.5 and roundness 0.5 since the sample limits of Phase 5's fix wave).
const STRING_VOICE = { bass: { id: 'string', variant: 'finger' }, chords: { id: 'string', variant: 'electric' } }, STRING_STYLE = { bass: 'funk', chords: 'dreamy' };
const stringCases = [];
for (const layer of ['bass', 'chords']) {
  stringCases.push(synthSolo(`string-${layer}-neutral`, layer, STRING_VOICE[layer], STRING_STYLE[layer], {}, [`voice:${layer}`]));
  for (const path of VOICES[layer].string.uses) {
    const k = path.split('.')[1];
    for (const v of DEFAULT_TIMBRE[layer][k] === 0 ? [0.5, 1] : [0, 1])
      stringCases.push(synthSolo(`string-${layer}-${k}-${v}`, layer, STRING_VOICE[layer], STRING_STYLE[layer], { [path]: v }, [`voice:${layer}`, `synth:${path}`]));
  }
}
write('string.json', judgeDiff(stringCases));
console.log(`string.json: ${stringCases.length} cases`);
for (const p of problems) console.error(`ERROR ${p}`);
process.exit(problems.length ? 1 : 0);
