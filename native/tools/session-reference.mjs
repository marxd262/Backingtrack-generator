// The reference of the core's session (native/core/src/session.cpp): the web app's state, src/ui/state.js itself, and the rules of the handlers that change
// it, with the actions of native/PROTOKOLL.md. Every rule that is a function of src/ (state.js, key-scale.js, tags-ui.js, progression-editor.js, variant.js,
// form-ui.js, the core) is called as it is; a rule that lives inside a DOM-bound handler (app.js, the panels) is transcribed below line for line, each with
// its file and lines, and kept as short as the handler allows. Imported by export-logic.mjs; src/ stays as it is.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'src');
const load = (file) => import(pathToFileURL(join(src, file)).href);

// The one global state.js touches at import that node does not give as a browser does: localStorage (node's own warns and needs a file). An empty
// store, as a browser that never saved: the mixer, the panorama and the layout start at their defaults. navigator and crypto are node's own.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => { store.set(key, String(value)); }, removeItem: (key) => { store.delete(key); } } });

const { state, ROOTS, ALL_LAYERS, preset, deriveBars, setChordColor, applyStyle, setMeter, formChoice, rollNewForm, setFormTemplate, setFormTarget, setFormFeel } = await load('ui/state.js');
const { chooseRoot, chooseScale } = await load('ui/key-scale.js');
const { toggleTag } = await load('ui/tags-ui.js');
const { addChord } = await load('ui/progression-editor.js');
const { stepVariant } = await load('ui/variant.js');
const { editPart, setLocked, addPart, copyPart, deletePart, movePart, stripBlocks } = await load('ui/form-ui.js');
const { organTuning, presetDrive, LESLIE_MODES } = await load('ui/organ-tuning.js');
const { STYLE_PRESETS, TAG_CATEGORIES, isSoundOnlyChange } = await load('core/tags.js');
const { SCALE_NAMES, chordOptions } = await load('core/music.js');
const { CHORD_COLORS } = await load('core/harmony.js');
const { METERS, meterKey, convertTempo, groovesFor } = await load('core/grooves.js');
const { TEMPLATE_IDS, TARGET_SIZES } = await load('core/form-roll.js');
const { PART_TYPES, TRANSITIONS, FORM_LIMITS, DYNAMICS_MAX } = await load('core/form-types.js');
const { formLength, isValidForm, chordIndex } = await load('core/form.js');
const { normalizeTrack } = await load('core/track.js');
const { VOICES, VOICE_LAYERS, completeVoices, setAllVoices, voiceKind, usesTimbreField } = await load('core/voices.js');
const { LAYER_IDS, jobsFor, completeJobs } = await load('core/layers.js');
const { DEFAULT_TIMBRE, resolveTrackTimbre } = await load('core/timbre.js');
const { MIX_NAMES } = await load('audio/mix.js');
const { validateTrack } = await load('index.js');

const initial = structuredClone(state); // the literal of state.js 58-90 as loaded (its seed is replaced by start's variant)
let touched; // app.js 205
let selected; // form-strip.js 35: the selected part of the strip
let change; // what the web app calls on a running player during the action (app.js applyLive, restartIfPlaying; the handlers; render)
let pushed; // organ-panel.js 46: the tuning last handed to the player
let player; // what the player plays (play.js 35-46): every action that changes its length or meter restarts it, so it is taken from the state before each action

// play.js 35-46 for { ...state.track, layers: ALL_LAYERS } (app.js 128)
function playerOf(trackInput) {
  const track = normalizeTrack(trackInput);
  const bpm = track.bpm;
  let loopSec = 0;
  for (let i = 0; i < track.length; i++) loopSec += (track.bars[chordIndex(track, i)].beats * 60) / bpm;
  return { bpm, loopBars: track.length, loopSec, startMeter: meterKey(track.meter) };
}
// play.js 172-178: setTrack refuses (false) a track of another length, duration or meter (its buildEvents, 174, throws only for a track validateTrack refuses: errors stay empty)
function setTrackTakes(newTrack) {
  const t2 = normalizeTrack({ ...newTrack, bpm: player.bpm });
  let sec = 0;
  for (let i = 0; i < t2.length; i++) sec += (t2.bars[chordIndex(t2, i)].beats * 60) / player.bpm;
  return !(t2.length !== player.loopBars || Math.abs(sec - player.loopSec) > 1e-9 || meterKey(t2.meter) !== player.startMeter);
}
// app.js 173-181 while playing: stop and start again, at the bar that plays (inPlace) or from bar 1
const restartIfPlaying = ({ inPlace = false } = {}) => { change.restart = true; change.inPlace = inPlace; };
// app.js 186-195 while a player runs: setTimbre always, setTempo with tempo, setTrack with patterns, and a restart in place when setTrack refuses the track
const applyLive = ({ patterns = false, tempo = false } = {}) => {
  change.sound = true;
  if (tempo) change.tempo = true;
  if (patterns) {
    if (setTrackTakes({ ...state.track, layers: ALL_LAYERS })) change.events = true;
    else restartIfPlaying({ inPlace: true });
  }
};
// organ-panel.js 62-64: every render hands a changed tuning to the player
const renderOrgan = () => { const key = JSON.stringify(organTuning(state.organ)); if (key !== pushed) { pushed = key; change.sound = true; } };
// voices-panel.js 89-93: every render hands the voices to the player when one of them (id or variant) changed
const voiceKeys = () => { const v = completeVoices(state.track.voices); return VOICE_LAYERS.map((layer) => `${v[layer].id}/${v[layer].variant}`).join(','); };

// app.js 340-346
function setVariant(seed) {
  state.track.seed = seed;
  deriveBars();
  rollNewForm();
  restartIfPlaying({ inPlace: true });
}
// form-panel.js 19
const commitFeel = (before) => (state.track.length === before ? applyLive({ patterns: true }) : restartIfPlaying({ inPlace: true }));
// form-strip.js 39, 49-62 (liveSoon is applyLive({ patterns: true }) one frame later)
const formNow = () => (isValidForm(state.track.form) ? state.track.form : null);
function commitPart(result) {
  if (result) {
    const before = state.track.length;
    state.track.form = result.form;
    state.track.length = formLength(result.form);
    selected = result.index;
    if (state.track.length === before) applyLive({ patterns: true });
    else restartIfPlaying({ inPlace: true });
  }
}
// form-strip.js 229-241 at every render: with blocks (a valid form) `selected` is clamped to them, without it stays. The web renders the strip only on the play
// page (228); the session clamps after every action, as if it were shown (the selection is read only there).
function renderStrip() {
  const blocks = formNow() ? stripBlocks(formNow()) : [];
  if (blocks.length > 0) selected = Math.min(Math.max(selected, 0), blocks.length - 1);
}
const showsPercent = (x, value) => String(Math.round(x * 100)) === String(value); // a knob or fader shows String(Math.round(x * 100)) (mixer.js 101, 111; form-panel.js 81)

// what the controls can send
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const oneOf = (v, list) => typeof v === 'string' && list.includes(v);
const isDraw = (v) => typeof v === 'number' && v >= 0 && v < 1; // Math.random()
const isFrom = (v) => v === 'start' || v === 'play';
const isVariant = (v) => int(v, 1, 9999);
const partIndex = (v) => formNow() !== null && int(v, 0, state.track.form.sections.length - 1); // the strip shows only a valid form; `selected` is clamped to its parts
const organShown = () => completeVoices(state.track.voices).chords.id === 'organ'; // organ-panel.js 48-50
const STYLE_IDS = STYLE_PRESETS.map((p) => p.id);
const FEEL_MAX = { structure: 1, dynamics: DYNAMICS_MAX, pauses: 1, randomness: 1 }; // form-panel.js 12, 43
const pick = (list, r) => list[Math.floor(r * list.length)]; // app.js 209 with the draw from the action

const ACTIONS = {
  start: {
    valid: (a) => isVariant(a.variant),
    run: (a) => {
      const { mix, pan } = state; // stored preferences (state.js 84-85: loadMix, loadPan): a fresh load keeps them
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, structuredClone(initial), { mix, pan });
      state.track.seed = a.variant; // state.js 68: seed: rollVariant()
      touched = { key: false, style: false, tempo: false, variant: false }; // app.js 205
      selected = 0; // form-strip.js 35
      deriveBars(); // app.js 484
      setFormTemplate('auto'); // app.js 485
      Object.assign(change, { events: true, sound: true, voices: true, tempo: true, mix: true });
    },
  },
  newVariant: { valid: (a) => isVariant(a.variant), run: (a) => setVariant(a.variant) }, // app.js 347-348
  stepVariant: { valid: (a) => a.dir === -1 || a.dir === 1, run: (a) => setVariant(stepVariant(state.track.seed, a.dir)) }, // app.js 349-350
  enterVariant: { valid: (a) => isVariant(a.variant), run: (a) => { touched.variant = true; setVariant(a.variant); } }, // app.js 353-356
  // key-scale.js 25, 29-30, 52-53; app.js 206 (a button in the popover of the start page). `same`: the selects of the play page show the value (key-scale.js 56-57) and
  // send no change for it; the chips fire again
  setRoot: {
    valid: (a) => oneOf(a.root, ROOTS) && isFrom(a.from), same: (a) => a.from === 'play' && a.root === state.track.key.root,
    run: (a) => { chooseRoot(a.root); restartIfPlaying(); if (a.from === 'start') touched.key = true; },
  },
  setScale: {
    valid: (a) => oneOf(a.scale, SCALE_NAMES) && isFrom(a.from), same: (a) => a.from === 'play' && a.scale === state.scale,
    run: (a) => { chooseScale(a.scale); restartIfPlaying(); if (a.from === 'start') touched.key = true; },
  },
  // app.js 256-260 (the start page's cards, which fire again) and 275-278 (the select of the play page, showing the style: 418)
  setStyle: {
    valid: (a) => oneOf(a.style, STYLE_IDS) && isFrom(a.from), same: (a) => a.from === 'play' && a.style === state.style,
    run: (a) => { applyStyle(a.style); if (a.from === 'start') touched.style = true; applyLive({ patterns: true, tempo: true }); },
  },
  // app.js 282-288; both ranges show track.bpm (app.js 415, tuning.js 141-142)
  setTempo: {
    valid: (a) => int(a.bpm, 40, 200) && isFrom(a.from), same: (a) => String(a.bpm) === String(state.track.bpm),
    run: (a) => { if (a.from === 'start') touched.tempo = true; state.track.bpm = a.bpm; change.tempo = true; },
  },
  // app.js 210-221
  surprise: {
    valid: (a) => isVariant(a.variant) && isDraw(a.style) && isDraw(a.tempo) && isDraw(a.scale) && isDraw(a.root),
    run: (a) => {
      const bpm = state.track.bpm;
      if (!touched.style) applyStyle(pick(STYLE_PRESETS, a.style).id);
      const styleBpm = convertTempo(preset(state.style).bpm, '4/4', meterKey(state.track.meter));
      state.track.bpm = touched.tempo ? bpm : Math.min(200, Math.max(40, Math.round(styleBpm * (0.9 + a.tempo * 0.2))));
      if (!touched.variant) state.track.seed = a.variant;
      if (!touched.key) {
        state.scale = pick(SCALE_NAMES, a.scale);
        chooseRoot(pick(ROOTS, a.root));
      } else deriveBars();
      rollNewForm();
      restartIfPlaying({ inPlace: true });
    },
  },
  // tuning.js 29-34
  toggleTag: {
    valid: (a) => typeof a.category === 'string' && oneOf(a.tag, TAG_CATEGORIES.find((c) => c.id === a.category)?.tags ?? []),
    run: (a) => {
      const before = state.track.tags;
      state.track.tags = toggleTag(before, a.category, a.tag);
      applyLive({ patterns: !isSoundOnlyChange(before, state.track.tags) });
    },
  },
  // progression-editor.js 55 (the chips: a root of chordOptions, then one of its qualities) and tuning.js 85 (the wheel: allowedChords); changed() is tuning.js 19
  addChord: {
    valid: (a) => typeof a.root === 'string' && typeof a.quality === 'string' && chordOptions(state.track.key).some((o) => o.root === a.root && o.qualities.includes(a.quality)),
    run: (a) => { if (addChord({ root: a.root, quality: a.quality })) restartIfPlaying(); },
  },
  // progression-editor.js 24-28 (removeChord, not exported), 83-85; the button is disabled at one chord (102)
  removeChord: {
    valid: (a) => state.track.bars.length > 1 && int(a.index, 0, state.track.bars.length - 1),
    run: (a) => { state.track.bars.splice(a.index, 1); state.notice = null; restartIfPlaying(); },
  },
  // chord-color.js 13-17
  setChordColor: { valid: (a) => oneOf(a.color, CHORD_COLORS), run: (a) => { state.chordColorFromStyle = false; setChordColor(a.color); restartIfPlaying(); } },
  // rhythm.js 15-17
  setMeter: { valid: (a) => typeof a.meter === 'string' && Object.hasOwn(METERS, a.meter), run: (a) => { if (setMeter(a.meter)) restartIfPlaying({ inPlace: true }); } },
  // rhythm.js 28-31 (the options: groovesFor of the meter, 57)
  setGroove: { valid: (a) => oneOf(a.groove, groovesFor(meterKey(state.track.meter))), run: (a) => { state.track.groove = a.groove; applyLive({ patterns: true }); } },
  // rhythm.js 36-46
  setRhythmKnob: {
    valid: (a) => oneOf(a.knob, ['complexity', 'loose', 'ornaments']) && int(a.value, 0, 100),
    run: (a) => { state.track[a.knob] = a.value / 100; applyLive({ patterns: true }); },
  },
  // form-panel.js 22-29; the select shows formChoice() (73)
  setFormTemplate: {
    valid: (a) => oneOf(a.template, ['auto', ...TEMPLATE_IDS, 'off']), same: (a) => a.template === formChoice(),
    run: (a) => { const before = state.track.length; setFormTemplate(a.template); commitFeel(before); },
  },
  // form-panel.js 32-39; the select shows the target, without a form the length (76-77)
  setFormTarget: {
    valid: (a) => TARGET_SIZES.includes(a.bars), same: (a) => String(a.bars) === String(formChoice() !== 'off' ? state.formTarget : state.track.length),
    run: (a) => { const before = state.track.length; setFormTarget(Number(a.bars)); commitFeel(before); },
  },
  // form-panel.js 41-54; the knobs are disabled without a form (83) and show the form's feel (79-82)
  setFormFeel: {
    valid: (a) => Boolean(state.track.form) && oneOf(a.knob, Object.keys(FEEL_MAX)) && int(a.value, 0, Math.round(FEEL_MAX[a.knob] * 100)),
    same: (a) => showsPercent((state.track.form?.feel ?? state.formFeel)[a.knob], a.value),
    run: (a) => { setFormFeel(a.knob, a.value / 100); if (a.knob !== 'structure') applyLive({ patterns: true }); },
  },
  // form-panel.js 55-61
  releaseStructure: { valid: () => Boolean(state.track.form), run: () => { const before = state.track.length; rollNewForm(); commitFeel(before); } },
  // form-strip.js 66-77, 104-112: a click on a part, or a key that moves the selection (to a part of the strip, 108)
  selectPart: { valid: (a) => partIndex(a.index), run: (a) => { selected = a.index; } },
  // form-strip.js 63, 114-123: one field per control, on the selected part; the resets are disabled while the part has no value of its own (208); level and density
  // are the knobs' ranges. `same`: the type select shows the part's type (195), the grip sends a length only when it differs (94)
  editPart: {
    same: (a) => (a.field === 'type' || a.field === 'bars') && a.value === formNow().sections[selected][a.field],
    valid: (a) => {
      if (!formNow()) return false;
      const s = formNow().sections[selected];
      switch (a.field) {
        case 'type': return oneOf(a.value, PART_TYPES);
        case 'transition': return oneOf(a.value, TRANSITIONS);
        case 'crash': return typeof a.value === 'boolean';
        case 'level': return a.value === null ? s.level != null : int(a.value, FORM_LIMITS.levelMin, FORM_LIMITS.levelMax);
        case 'density': return a.value === null ? s.density != null : int(a.value, FORM_LIMITS.densityMin * 100, FORM_LIMITS.densityMax * 100);
        case 'bars': return int(a.value, 1, FORM_LIMITS.bars);
        default: return false;
      }
    },
    run: (a) => {
      const value = a.value === null ? undefined : a.field === 'density' ? a.value / 100 : a.value;
      commitPart(editPart(formNow(), selected, { [a.field]: value }));
    },
  },
  toggleLock: { valid: () => formNow() !== null, run: () => { const f = formNow(); commitPart(setLocked(f, selected, !f.sections[selected].locked)); } }, // form-strip.js 124
  deletePart: { valid: () => formNow() !== null, run: () => commitPart(deletePart(formNow(), selected)) }, // form-strip.js 125
  movePart: { valid: (a) => formNow() !== null && (a.dir === -1 || a.dir === 1), run: (a) => commitPart(movePart(formNow(), selected, a.dir)) }, // form-strip.js 126-127
  copyPart: { valid: () => formNow() !== null, run: () => commitPart(copyPart(formNow(), selected)) }, // form-strip.js 128
  addPart: { valid: () => formNow() !== null, run: () => commitPart(addPart(formNow())) }, // form-strip.js 129
  // form-strip.js 130-146; the button stands in #form-bar, shown only with a form (235); a form that is not valid (its else branch) no action can make
  rerollForm: {
    valid: () => formNow() !== null,
    run: () => {
      if (formNow().sections.every((s) => s.locked)) return;
      const before = state.track.length;
      rollNewForm({ reroll: true });
      if (state.track.length === before) applyLive({ patterns: true });
      else restartIfPlaying({ inPlace: true });
    },
  },
  // mixer.js 34-40, 54-59, 64 with app.js 198-200
  setLevel: {
    valid: (a) => oneOf(a.channel, MIX_NAMES) && int(a.value, 0, 100), same: (a) => showsPercent(state.mix[a.channel], a.value),
    run: (a) => { state.mix = { ...state.mix, [a.channel]: a.value / 100 }; change.mix = true; },
  },
  setPan: {
    valid: (a) => oneOf(a.layer, LAYER_IDS) && int(a.value, -100, 100), same: (a) => showsPercent(state.pan[a.layer], a.value),
    run: (a) => { state.pan = { ...state.pan, [a.layer]: a.value / 100 }; change.mix = true; },
  },
  toggleMute: { valid: (a) => oneOf(a.layer, LAYER_IDS), run: (a) => { state.track.layers = { ...state.track.layers, [a.layer]: !state.track.layers[a.layer] }; change.mix = true; } },
  // mixer.js 79, voices-panel.js 48-52
  toggleAllVoices: {
    valid: () => true,
    run: () => { state.track.voices = setAllVoices(state.track.voices, voiceKind(state.track.voices) === 'sample' ? 'synth' : 'sample'); change.voices = true; },
  },
  // voices-panel.js 40-44, 74-84: the options are the voices that are not hidden, each variant; the select shows `${id}/${variant}` (100)
  setVoice: {
    valid: (a) => oneOf(a.layer, VOICE_LAYERS) && typeof a.id === 'string' && Object.hasOwn(VOICES[a.layer], a.id) && !VOICES[a.layer][a.id].hidden && oneOf(a.variant, VOICES[a.layer][a.id].variants),
    same: (a) => { const { id, variant } = completeVoices(state.track.voices)[a.layer]; return `${id}/${variant}` === `${a.id}/${a.variant}`; },
    run: (a) => { state.track.voices = completeVoices({ ...state.track.voices, [a.layer]: { id: a.id, variant: a.variant } }); change.voices = true; },
  },
  // jobs-panel.js 12, 17-20 with app.js 387; the select shows completeJobs(jobs)[layer] (29-33)
  setJob: {
    valid: (a) => oneOf(a.layer, LAYER_IDS.filter((id) => jobsFor(id).length)) && oneOf(a.job, jobsFor(a.layer)), same: (a) => completeJobs(state.track.jobs)[a.layer] === a.job,
    run: (a) => { state.track.jobs = { ...state.track.jobs, [a.layer]: a.job }; applyLive({ patterns: true }); },
  },
  // timbre-panel.js 39-43; a knob the voice does not use is disabled (108-109)
  setTimbre: {
    valid: (a) => typeof a.group === 'string' && Object.hasOwn(DEFAULT_TIMBRE, a.group) && typeof a.field === 'string' && Object.hasOwn(DEFAULT_TIMBRE[a.group], a.field)
      && int(a.value, 0, 100) && usesTimbreField(state.track.voices, `${a.group}.${a.field}`),
    run: (a) => {
      const timbre = state.track.timbre;
      state.track.timbre = { ...timbre, [a.group]: { ...timbre[a.group], [a.field]: a.value / 100 } };
      change.sound = true;
    },
  },
  // timbre-panel.js 55-58; disabled while the group has no knob set (115-116)
  resetTimbre: {
    valid: (a) => typeof a.group === 'string' && Object.hasOwn(DEFAULT_TIMBRE, a.group) && Object.keys(state.track.timbre[a.group] ?? {}).length > 0,
    run: (a) => { const { [a.group]: removed, ...rest } = state.track.timbre; state.track.timbre = rest; change.sound = true; },
  },
  // organ-panel.js 32-35; the knob shows the mode's place (51-52)
  setLeslie: {
    valid: (a) => organShown() && oneOf(a.mode, LESLIE_MODES), same: (a) => String(Math.max(0, LESLIE_MODES.indexOf(state.organ.leslie))) === String(LESLIE_MODES.indexOf(a.mode)),
    run: (a) => { state.organ = { ...state.organ, leslie: a.mode }; },
  },
  // organ-panel.js 36-44; a double click (value null) is first the knob's own (knob.js 103-107: set(min), which reports only a change), then the panel's
  setOrganDrive: {
    valid: (a) => organShown() && (a.value === null || int(a.value, 0, 100)),
    run: (a) => {
      if (a.value !== null) { state.organ = { ...state.organ, drive: a.value / 100 }; return; }
      const { variant } = completeVoices(state.track.voices).chords;
      if (String(Math.round((state.organ.drive ?? presetDrive(variant)) * 100)) !== '0') { state.organ = { ...state.organ, drive: 0 }; renderOrgan(); }
      state.organ = { ...state.organ, drive: null };
    },
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

/**
 * Applies the action text as the session does. Returns 'refused' (not valid), 'repeat' (the value its control shows: the web sends no event) or 'applied';
 * the first two change nothing and leave every flag false.
 */
export function apply(text) {
  change = { events: false, sound: false, voices: false, tempo: false, mix: false, restart: false, inPlace: false };
  let action;
  try { action = JSON.parse(text); } catch { return 'refused'; }
  if (action === null || typeof action !== 'object' || Array.isArray(action) || typeof action.action !== 'string' || !Object.hasOwn(ACTIONS, action.action)) return 'refused';
  const def = ACTIONS[action.action];
  if (!def.valid(action)) return 'refused';
  if (def.same?.(action)) return 'repeat';
  const watched = voiceKeys();
  pushed = JSON.stringify(organTuning(state.organ));
  player = state.track.bars.length ? playerOf({ ...state.track, layers: ALL_LAYERS }) : null; // no bars: the state as imported, before the first start (which calls no applyLive)
  def.run(action);
  // render(): voices-panel.js 89-93, organ-panel.js 62-64, form-strip.js 241
  if (voiceKeys() !== watched) change.voices = true;
  renderOrgan();
  renderStrip();
  return 'applied';
}

/**
 * What the core's session must give after the action: the flags, state() (with errors as app.js reports them, validateTrack of index.js), track() (what app.js 128 and
 * 191 hand the player: every layer on), sound(), tuning().
 */
export function record() {
  return JSON.parse(JSON.stringify({
    change,
    state: {
      track: state.track, formTarget: state.formTarget, formSalt: state.formSalt, formFeel: state.formFeel, scale: state.scale, chordColor: state.chordColor,
      chordColorFromStyle: state.chordColorFromStyle, style: state.style, mix: state.mix, pan: state.pan, organ: state.organ, tempoRef: state.tempoRef ?? null, touched,
      selectedPart: selected, errors: validateTrack(state.track),
    },
    track: { ...state.track, layers: ALL_LAYERS },
    sound: resolveTrackTimbre(state.track),
    tuning: organTuning(state.organ),
  }));
}

/** The reference's state, read only, for the export's draws. */
export const current = () => ({ state, touched, selected });
/** Back to what the core's constructor gives (the start state of variant 1, the mixer's defaults), before each sequence. */
export const reset = () => {
  Object.assign(state, { mix: structuredClone(initial.mix), pan: structuredClone(initial.pan) });
  apply(JSON.stringify({ action: 'start', variant: 1 }));
};
