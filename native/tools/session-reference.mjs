// The reference of the core's session (native/core/src/session.cpp): the web app's state, src/ui/state.js itself, and the rules of the handlers that change
// it, with the actions of native/PROTOKOLL.md. Every rule that is a function of src/ (state.js, key-scale.js, tags-ui.js, progression-editor.js, variant.js,
// form-ui.js, the core) is called as it is; a rule that lives inside a DOM-bound handler (app.js, the panels) is transcribed below line for line, each with
// its file and lines, and kept as short as the handler allows. Imported by export-logic.mjs; src/ stays as it is.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = join(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'src');
const load = (file) => import(pathToFileURL(join(src, file)).href);

// The one global state.js touches at import that node does not give as a browser does: localStorage (node's own warns and needs a file). It starts empty,
// as a browser that never saved. It is state.js's `layoutStorage`, through which the web writes the profiles, the last session and the mixer: at a step whose
// storage fails it throws as a full or locked browser storage does, and every setItem is logged as the core's btg::Storage write is (the name the core uses for
// the key, the text, whether it took). navigator and crypto are node's own.
// 'backingtrack.profiles.damaged' and 'backingtrack.profiles.newer' are no keys of the web: the session keeps a damaged profiles.json and one of a newer version under
// them (PROTOKOLL.md section 3a, below at `commit`).
const NAMES = { 'backingtrack.profiles': 'profiles.json', 'backingtrack.session': 'session.json', 'backingtrack.mix': 'mix.json', 'backingtrack.profiles.damaged': 'profiles.damaged.json',
  'backingtrack.profiles.newer': 'profiles.newer.json' };
const KEYS = Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [name, key]));
const store = new Map();
let writesFail = false, readsFail = false; // readsFail: false, 'none' (nothing is stored: getItem gives null) or 'throw' (the storage cannot be read)
let writes = [];
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => { if (readsFail === 'throw') throw new Error('locked'); if (readsFail) return null; return store.has(key) ? store.get(key) : null; },
  setItem: (key, value) => { const text = String(value); writes.push([NAMES[key] ?? key, text, !writesFail]); if (writesFail) throw new Error('full'); store.set(key, text); },
  removeItem: (key) => { store.delete(key); } } });

const { state, layoutStorage, ROOTS, ALL_LAYERS, MAX_CHORDS, preset, deriveBars, setChordColor, applyStyle, setMeter, formChoice, rollNewForm, setFormTemplate, setFormTarget, setFormFeel } = await load('ui/state.js');
const { loadMix, loadPan, saveMix } = await load('ui/mix-state.js');
const { loadTree, saveTree, isReservedId } = await load('ui/profile-store.js');
const { saveLast, loadLast } = await load('ui/session-store.js');
const { readSession, writeSession } = await load('ui/profile-session.js');
const { factoryProfiles, factoryParts } = await load('ui/profile-factory.js');
const { loopBars } = await load('ui/position.js');
const { PART_IDS, PART_PRESETS, captureParts, applyParts, partIdsOf } = await load('core/profile-parts.js');
const { parseFile, makeProfileFile, makeFolderFile, FORMAT_FOLDER, PROFILE_VERSION, FOLDER_VERSION, LIMITS } = await load('core/profile.js');
const { newTree, find, sortItems, addProfile, addFolder, renameNode, removeNode, overwriteParts, importNode, freeName, canMove, moveNode, moveTargets, listFolders, countNodes, countProfiles } = await load('core/profile-tree.js');
const { chooseRoot, chooseScale } = await load('ui/key-scale.js');
const { toggleTag } = await load('ui/tags-ui.js');
const { addChord } = await load('ui/progression-editor.js');
const { stepVariant } = await load('ui/variant.js');
const { editPart, setLocked, addPart, copyPart, deletePart, movePart, stripBlocks, levelValue, densityValue, levelLabel, densityLabel, limits } = await load('ui/form-ui.js');
const { organTuning, presetDrive, LESLIE_MODES, DEFAULT_ORGAN } = await load('ui/organ-tuning.js');
const { DEFAULT_PAN } = await load('ui/mix-state.js');
const { tagEffect } = await load('ui/tag-effects.js');
const { layoutWheel, nodeMatches } = await load('ui/wheel-geometry.js');
const { STYLE_PRESETS, TAG_CATEGORIES, isSoundOnlyChange } = await load('core/tags.js');
const { SCALE_NAMES, SCALES, isValidKey, chordOptions, allowedChords, diatonicChords, noteToPc, chordMidi, noteName } = await load('core/music.js');
const { CHORD_COLORS } = await load('core/harmony.js');
const { METERS, meterKey, convertTempo, groovesFor, grooveIdFor } = await load('core/grooves.js');
const { TEMPLATE_IDS, TARGET_SIZES } = await load('core/form-roll.js');
const { PART_TYPES, TRANSITIONS, FORM_LIMITS, FEEL_DEFAULTS, DYNAMICS_MAX, resolveSection } = await load('core/form-types.js');
const { formLength, isValidForm, chordIndex, sectionAt } = await load('core/form.js');
const { nextDistinctChord, progressionRoles, romanDegree, fretboardNotes, beatsUntilChange, STANDARD_TUNING, FRETS } = await load('core/fretboard.js');
const { CHORDS, CHORD_GROUPS, chordName, chordShort } = await load('core/chords.js');
const { t, setLanguage, getLanguage } = await load('i18n/index.js');
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
// the profile window (profiles.js 41-47) and the last session (app.js 153, the offer of "Weitermachen"); `resumed`: the bar the playback starts at after a resume that
// restored (app.js 233), null after every other action (PROTOKOLL.md section 4); `legacy`: what importLegacy did with each text, null after every other action
let tree, selection, open, message, undo, last, resumed, legacy;
let drag; // the own row being dragged (profile-drag.js), or null: profileDrag (PROTOKOLL.md section 3)
let refusals; // progression-editor.js 11: how often addChord found the progression full (not exported: counted here where the real addChord refuses)
let rollNote; // form-strip.js 37: "Neu würfeln" found every part locked
// PROTOKOLL.md section 3a (ruled, the web has none of it): what is wrong with the storage per name, state().storage, and the damaged or newer text of profiles.json until
// it is kept
let problems, keepText;

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
  rollNote = false; // 50
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

// ---------- the profile window (profiles.js) and the last session (app.js) ----------
// The messages are the web's translation keys with their parameters, { key, params }: `t(key, params)` of profiles.js before it is translated.
const msg = (key, params = {}) => ({ key, params });
const count = (key, n, params = {}) => msg(n === 1 ? `${key}.one` : key, { ...params, n }); // profile-parts-picker.js 17
const errorsOf = (errors) => errors.map((e) => msg(`err.${e.code}`, e.params)); // profiles.js 151
const BAD = [{ code: 'badProfile', params: {} }]; // profiles.js 19
const wanted = (name) => name.trim().slice(0, LIMITS.name).trim(); // profiles.js 24
const FACTORY = 'factory:';
const MAX_INT = Number.MAX_SAFE_INTEGER;
// Date.now() as the action gives it (session-store.js 10 stamps the entry)
const at = (time, fn) => { const real = Date.now; Date.now = () => time; try { return fn(); } finally { Date.now = real; } };

// profiles.js 136-141 (`selected` there; the name is the form strip's here): { kind, styleId?, node?, parentId? }; a vanished own node counts as the session
function chosen() {
  if (['session', 'factory', 'mine'].includes(selection)) return { kind: selection === 'factory' ? 'factory-folder' : selection };
  if (selection.startsWith(FACTORY)) return { kind: 'factory', styleId: selection.slice(FACTORY.length) };
  const f = find(tree, selection);
  return f ? { kind: f.node.type, node: f.node, parentId: f.parent?.id ?? null } : { kind: 'session' };
}
// profiles.js 144-148: select an own row and open its folders (a Set in the web: add keeps the place of a key it has)
const opened = (list, key) => (list.includes(key) ? list : [...list, key]);
function select(id) {
  selection = id;
  open = opened(open, 'mine');
  for (let f = find(tree, id); f?.parent; f = find(tree, f.parent.id)) open = opened(open, f.parent.id);
}
// profiles.js 157-167. Review Focus 3, ruled (PROTOKOLL.md section 3): a write that fails changes nothing but the message, where the web keeps `next` until the
// page is loaded again and adds the same key to its message. `openNext`: the open folders importRaw sets before its commit (351), kept only if the commit holds.
// PROTOKOLL.md section 3a, ruled against the web (whose storage never fails to read, and whose next save writes over a tree it could not use): after a profiles.json that
// could not be read, every commit is refused and changes nothing (REFUSED, caught in apply), so that a text the session could not read is never written over; after a
// damaged one, or one of a newer version (the user's decision of 2026-11-24, at loadProfiles), the first commit keeps its text under profiles.damaged.json or
// profiles.newer.json before it writes the tree, and a failing write of that is the failing write of the tree.
const REFUSED = new Error('refused');
const KEPT = { damaged: 'profiles.damaged.json', newer: 'profiles.newer.json' };
function commit(next, selectId, texts, undoable = false, openNext = open) {
  if (problems.profiles === 'unreadable') throw REFUSED;
  const kept = KEPT[problems.profiles];
  if (kept) {
    try { layoutStorage.setItem(KEYS[kept], keepText); } catch { message = [msg('ui.profileNotStored')]; return; }
    problems.profiles += 'Kept'; // damagedKept, newerKept: once, it holds for the session, also if the tree's write fails below
    keepText = null;
  }
  if (!saveTree(layoutStorage, next)) { message = [msg('ui.profileNotStored')]; return; }
  undo = undoable ? { tree, selection } : null;
  tree = next;
  drag = null; // a change of the tree ends a drag
  open = openNext;
  if (selectId) select(selectId);
  message = texts.filter(Boolean);
  if (undo) undo.message = message;
}
// profiles.js 371-386: the visible rows of the tree view (key and whether it opens), in their order
function rows() {
  const out = [{ key: 'session', expandable: false }, { key: 'factory', expandable: true }];
  if (open.includes('factory')) for (const f of factoryProfiles()) out.push({ key: f.key, expandable: false });
  out.push({ key: 'mine', expandable: true });
  const walk = (items) => {
    for (const n of sortItems(items)) {
      out.push({ key: n.id, expandable: n.type === 'folder' });
      if (n.type === 'folder' && open.includes(n.id)) walk(n.items);
    }
  };
  if (open.includes('mine')) walk(tree.items);
  return out;
}
// renderProfiles (393), at every render: a vanished selection goes back to the session
const settleSelection = () => { if (chosen().kind === 'session') selection = 'session'; };
const idsOf = (items, out = new Set()) => { for (const n of items) { out.add(n.id); if (n.type === 'folder') idsOf(n.items, out); } return out; };
// what the window's fields can send (PROTOKOLL.md section 1): a name of the input (maxLength 60, no line breaks), a new id, the checked parts in their order
const isName = (v) => typeof v === 'string' && v.length <= LIMITS.name && !/[\n\r]/.test(v);
const isNewId = (v, used = idsOf(tree.items)) => typeof v === 'string' && v !== '' && !isReservedId(v) && !used.has(v);
const isIdList = (v) => { const used = idsOf(tree.items); return Array.isArray(v) && v.length <= LIMITS.nodes && v.every((id) => isNewId(id, used)) && new Set(v).size === v.length; };
const isPartList = (v) => Array.isArray(v) && v.every((id, i) => PART_IDS.includes(id) && (i === 0 || PART_IDS.indexOf(id) > PART_IDS.indexOf(v[i - 1])))
  && (Boolean(state.track.form) || !v.includes('form')); // profiles.js 440-442: without a form its box is disabled
const isFolderId = (v) => typeof v === 'string' && find(tree, v)?.node.type === 'folder';
const isPlaying = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && int(v.bar, 0, MAX_INT) && int(v.at, 0, MAX_INT);
// app.js 154-155: the session that plays, at the bar it plays in its loop
const remember = ({ bar, at: time }) => { last = at(time, () => saveLast(layoutStorage, readSession(state), bar % loopBars(state.track))); };
// profiles.js 215-218
const nameRefused = (code, value) => { message = [msg(`ui.profileErr.${code === 'nameTaken' ? 'nameTakenHere' : code}`, { name: wanted(value) })]; };
class OutOfIds extends Error {}
// Against the web, on the user's decision of 2026-11-22 ("Die app soll melden wenn das Profil Aus einer neueren version stammt."): a file of a version above the one the app
// writes for its format is read as far as its fields are known, as the web reads it, and the import names that version (src/ stays as it is). `text`: a file parseFile took.
function newerVersion(text) {
  const raw = JSON.parse(text);
  const writes = raw.format === FORMAT_FOLDER ? FOLDER_VERSION : PROFILE_VERSION;
  return typeof raw.version === 'number' && raw.version > writes ? msg('ui.profileNewerVersion', { version: raw.version }) : '';
}

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
      refusals = 0; // progression-editor.js 11
      rollNote = false; // form-strip.js 37
      deriveBars(); // app.js 484
      setFormTemplate('auto'); // app.js 485
      // the profile window, the tree and the last session stay (PROTOKOLL.md section 2)
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
    run: (a) => { if (addChord({ root: a.root, quality: a.quality })) restartIfPlaying(); else refusals++; }, // progression-editor.js 16: addChord counts its refusals
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
  selectPart: { valid: (a) => partIndex(a.index), run: (a) => { rollNote = false; selected = a.index; } }, // choose, 67
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
      if (formNow().sections.every((s) => s.locked)) { rollNote = true; return; } // 133
      rollNote = false; // 136
      const before = state.track.length;
      rollNewForm({ reroll: true });
      if (state.track.length === before) applyLive({ patterns: true });
      else restartIfPlaying({ inPlace: true });
    },
  },
  // mixer.js 34-40, 54-59, 64 with app.js 198-200; save() is mixer.js 21
  setLevel: {
    valid: (a) => oneOf(a.channel, MIX_NAMES) && int(a.value, 0, 100), same: (a) => showsPercent(state.mix[a.channel], a.value),
    run: (a) => { state.mix = { ...state.mix, [a.channel]: a.value / 100 }; saveMix(layoutStorage, state.mix, state.pan); change.mix = true; },
  },
  setPan: {
    valid: (a) => oneOf(a.layer, LAYER_IDS) && int(a.value, -100, 100), same: (a) => showsPercent(state.pan[a.layer], a.value),
    run: (a) => { state.pan = { ...state.pan, [a.layer]: a.value / 100 }; saveMix(layoutStorage, state.mix, state.pan); change.mix = true; },
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
  // ---------- the profile window: profiles.js ----------
  // 52 (onSelect) and 371-386: a click, Enter or Space on a visible row
  profileSelect: { valid: (a) => typeof a.key === 'string' && rows().some((r) => r.key === a.key), run: (a) => { selection = a.key; message = undo?.message ?? null; } },
  // 53-57 (onToggle): the twisty, ArrowRight on a closed row, ArrowLeft on an open one (profile-tree-view.js 81, 97, 101)
  profileToggle: {
    valid: (a) => typeof a.key === 'string' && rows().some((r) => r.key === a.key && r.expandable),
    run: (a) => { open = open.includes(a.key) ? open.filter((k) => k !== a.key) : [...open, a.key]; },
  },
  // PROTOKOLL.md section 3, ruled (the web holds the drag inside profile-drag.js): a drag begins on an own entry (canDrag, 251) and ends (null) with a drop, Escape or a
  // cancel; profiles() names the rows it may be dropped on (dropTarget, 246-249). It changes nothing but the window
  profileDrag: { valid: (a) => a.key === null || (typeof a.key === 'string' && find(tree, a.key) !== null), run: (a) => { drag = a.key; } },
  // 175-185: the session box stands only for the session (410); the folder select is listFolders (436), '' the top level (178)
  saveProfile: {
    valid: (a) => chosen().kind === 'session' && isName(a.name) && (a.folder === null || isFolderId(a.folder)) && isPartList(a.parts) && isNewId(a.id),
    run: (a) => {
      if (!a.parts.length) { message = [msg('ui.profileNeedParts')]; return; }
      const r = addProfile(tree, a.folder, a.name, captureParts(readSession(state), a.parts), () => a.id);
      if (!r.ok) { message = [msg(`ui.profileErr.${r.code}`, { name: wanted(a.name) })]; return; }
      commit(r.tree, r.id, [msg('ui.profileSaved', { name: r.name })]);
    },
  },
  // 202-209: the overwrite button stands only for an own profile (413)
  overwriteProfile: {
    valid: (a) => chosen().kind === 'profile' && isPartList(a.parts),
    run: (a) => {
      if (!a.parts.length) { message = [msg('ui.profileNeedParts')]; return; }
      const { node } = chosen();
      const r = overwriteParts(tree, node.id, captureParts(readSession(state), a.parts));
      if (!r.ok) { message = [msg(`ui.profileErr.${r.code}`)]; return; }
      commit(r.tree, r.id, [msg('ui.profileOverwritten', { name: node.name })], true);
    },
  },
  // 220-224 (doRename): rename stands for an own entry (416)
  renameNode: {
    valid: (a) => ['profile', 'folder'].includes(chosen().kind) && isName(a.name),
    run: (a) => {
      const r = renameNode(tree, chosen().node.id, a.name);
      if (!r.ok) { nameRefused(r.code, a.name); return; }
      commit(r.tree, r.id, [msg('ui.profileRenamed', { name: r.name })]);
    },
  },
  // 226-231 (doSubfolder): the button stands for a folder and for "mine" (415)
  addFolder: {
    valid: (a) => ['folder', 'mine'].includes(chosen().kind) && isName(a.name) && isNewId(a.id),
    run: (a) => {
      const s = chosen();
      const r = addFolder(tree, s.kind === 'mine' ? null : s.node.id, a.name, () => a.id);
      if (!r.ok) { nameRefused(r.code, a.name); return; }
      commit(r.tree, r.id, [msg('ui.profileFolderAdded', { name: r.name })]);
    },
  },
  // 236-243 (move), reached from the move form (95: the selected entry, a target of `targets`, 395) and from a drag (246-254: any own row onto "mine" or an own
  // folder that is not its own and canMove); both are the targets of moveTargets but the entry's folder
  moveNode: {
    valid: (a) => {
      const f = typeof a.id === 'string' ? find(tree, a.id) : null;
      return f !== null && (a.target === null || typeof a.target === 'string') && a.target !== (f.parent?.id ?? null) && moveTargets(tree, a.id).some((t) => t.id === a.target);
    },
    run: (a) => {
      const { node } = find(tree, a.id);
      const where = a.target === null ? null : find(tree, a.target)?.node.name;
      const r = moveNode(tree, a.id, a.target);
      if (!r.ok) { message = [msg(`ui.profileErr.${r.code}`)]; return; }
      commit(r.tree, a.id, [msg(r.name === node.name ? 'ui.profileMoved' : 'ui.profileMovedRenamed', { name: node.name, folder: where ?? null, newName: r.name })], true);
    },
  },
  // 257-261 (remove) after the question of 263-271, which is the page's
  deleteNode: {
    valid: () => ['profile', 'folder'].includes(chosen().kind),
    run: () => {
      const r = removeNode(tree, chosen().node.id);
      if (!r.ok) { message = [msg(`ui.profileErr.${r.code}`)]; return; }
      commit(r.tree, r.parentId ?? 'mine', [msg('ui.profileDeleted', { name: r.removed.name })], true);
    },
  },
  // 274-287: the load button stands for a factory profile and an own profile (411)
  loadProfile: {
    valid: () => ['factory', 'profile'].includes(chosen().kind),
    run: () => {
      const s = chosen();
      if (s.kind === 'factory') {
        applyStyle(s.styleId);
        applyLive({ patterns: true, tempo: true });
        message = [msg('ui.profileLoaded')];
        return;
      }
      const r = applyParts(readSession(state), s.node.parts);
      if (!r.ok) { message = errorsOf(r.errors); return; }
      writeSession(state, r.session);
      restartIfPlaying();
      message = [msg('ui.profileLoaded')];
    },
  },
  // 290-295: the copy button stands for a factory profile (412); `name` is t(`style.${styleId}`) of the page
  copyFactory: {
    valid: (a) => chosen().kind === 'factory' && isName(a.name) && isNewId(a.id),
    run: (a) => {
      const { styleId } = chosen();
      const r = addProfile(tree, null, freeName(tree.items.map((n) => n.name), a.name), factoryParts(styleId), () => a.id);
      if (!r.ok) { message = [msg(`ui.profileErr.${r.code}`)]; return; }
      commit(r.tree, r.id, [msg('ui.profileSaved', { name: r.name })]);
    },
  },
  // 342-368 (importRaw, the text button, the file input): the import box stands for the session, a folder and "mine" (426). A list of ids shorter than the nodes the
  // import makes is the shell's mistake: the action is refused (nothing has changed when importNode asks for one more)
  importProfile: {
    valid: (a) => ['session', 'folder', 'mine'].includes(chosen().kind) && isIdList(a.ids)
      && ((a.from === 'text' && typeof a.text === 'string') || (a.from === 'file' && (typeof a.text === 'string' || a.text === null) && int(a.size, 0, MAX_INT))),
    run: (a) => {
      if (a.from === 'file' && (a.size > LIMITS.file || a.text === null)) { message = errorsOf(BAD); return; } // 366-367
      const r = parseFile(a.text);
      if (!r.ok) { message = errorsOf(r.errors); return; }
      const s = chosen();
      const target = s.kind === 'profile' ? s.parentId : s.kind === 'folder' ? s.node.id : null;
      let n = 0;
      let added;
      try { added = importNode(tree, target, r.node, () => { if (n >= a.ids.length) throw new OutOfIds(); return a.ids[n++]; }); } catch (e) { if (e instanceof OutOfIds) return 'refused'; throw e; }
      if (!added.ok) { message = [msg(`ui.profileErr.${added.code}`)]; return; }
      const node = added.rootId === null ? null : find(added.tree, added.rootId).node;
      const single = node?.type === 'profile';
      commit(added.tree, single ? added.rootId : null, [
        single ? msg('ui.profileImported', { name: node.name })
          : node ? count('ui.profileImportedFolder', added.profiles, { name: node.name }) : count('ui.profileRestored', added.profiles),
        newerVersion(a.text),
        r.skipped ? count('ui.profileSkipped', r.skipped) : '',
        added.dropped ? count('ui.profileDropped', added.dropped) : '',
      ], true, single ? open : opened(open, target ?? 'mine'));
    },
  },
  // 169-172: the button stands while there is something to undo (427)
  undoProfile: { valid: () => undo !== null, run: () => { const u = undo; commit(u.tree, u.selection, [msg('ui.profileUndone')]); } },
  // PROTOKOLL.md section 3a, ruled; the web has no such button (its storage never fails to read): while profiles.json is unreadable, "Erneut lesen" reads it again as the
  // page load does; a read that fails again changes nothing
  reloadProfiles: {
    valid: () => problems.profiles === 'unreadable',
    run: () => {
      const stored = readStored('profiles.json');
      if (stored.problem) return;
      ({ tree, problem: problems.profiles, version: problems.profilesVersion, keep: keepText } = loadProfiles(stored));
      undo = null;
      drag = null;
    },
  },
  // PROTOKOLL.md section 3a, ruled; the web has none: the plan's one-time take-over of what the old page kept in the WebView's storage (backingtrack.profiles, .session, .mix).
  // A text is taken only when nothing is stored under its name, read by the loader of the page load (reload below) for that name, and stored as it is; a text that loader finds
  // unreadable or damaged is not taken, nor a profiles.json while the one stored has a problem. The tree is written first: when it is not stored, nothing else is taken
  // `legacy` (state().legacy), per text sent: 'taken', or why not: 'stored' (the app's own text, read without a problem), 'damaged' (the reader cannot take the old text),
  // 'failed' (the storage could not be read or written just now, or what is stored under the name has a problem that state().storage names: the next load may take it).
  // Each text is judged first (the reads), then written in the order profiles.json, session.json, mix.json: a tree that is not stored takes nothing.
  importLegacy: {
    valid: (a) => ['profiles', 'session', 'mix'].every((k) => Object.hasOwn(a, k) && (a[k] === null || typeof a[k] === 'string')),
    run: (a) => {
      const said = { profiles: null, session: null, mix: null };
      legacy = said;
      const taken = (field, name) => {
        const text = a[field];
        if (text === null) return null;
        if (Buffer.byteLength(text, 'utf8') > STORED_LIMIT) { said[field] = 'damaged'; return null; } // never readable
        try { if (localStorage.getItem(KEYS[name]) !== null) { said[field] = problems[field] === null ? 'stored' : 'failed'; return null; } } catch { said[field] = 'failed'; return null; }
        return text;
      };
      if (problems.profiles !== null && a.profiles !== null) said.profiles = 'failed'; // a profiles.json state().storage names (unreadable, damaged, newer, kept) stays as it is
      const profilesText = problems.profiles === null ? taken('profiles', 'profiles.json') : null;
      const loaded = profilesText === null ? null : loadProfiles({ text: profilesText, problem: null });
      if (loaded) said.profiles = loaded.problem === 'damaged' ? 'damaged' : 'taken'; // a newer tree is taken, and named and kept as the page load does
      const treeTaken = loaded !== null && loaded.problem !== 'damaged';
      const sessionText = taken('session', 'session.json');
      const entry = sessionText === null ? null : loadLast(storeOf('session.json', sessionText));
      if (sessionText !== null) said.session = entry === null ? 'damaged' : 'taken';
      const mixText = taken('mix', 'mix.json');
      const raw = mixText === null ? null : parsedOrNone(mixText);
      const mixTaken = Boolean(raw && isObject(raw.value));
      if (mixText !== null) said.mix = mixTaken ? 'taken' : 'damaged';
      if (treeTaken) {
        try { layoutStorage.setItem(KEYS['profiles.json'], profilesText); } catch {
          message = [msg('ui.profileNotStored')];
          for (const k of Object.keys(said)) if (said[k] === 'taken') said[k] = 'failed';
          return;
        }
        ({ tree, problem: problems.profiles, version: problems.profilesVersion, keep: keepText } = loaded);
        undo = null;
        drag = null;
      }
      if (entry !== null) {
        last = entry;
        try { layoutStorage.setItem(KEYS['session.json'], sessionText); } catch { said.session = 'failed'; } // and named in storage (apply)
      }
      if (mixTaken) {
        state.mix = loadMix(storeOf('mix.json', mixText));
        state.pan = loadPan(storeOf('mix.json', mixText));
        try { layoutStorage.setItem(KEYS['mix.json'], mixText); } catch { said.mix = 'failed'; }
        change.mix = true;
      }
    },
  },
  // ---------- the last session: app.js ----------
  // 153-157, 160: what stop() and pagehide remember while playing; the shell sends it then (PROTOKOLL.md section 3)
  rememberSession: { valid: (a) => int(a.bar, 0, MAX_INT) && int(a.at, 0, MAX_INT), run: (a) => remember(a) },
  // 226-236 ("Weitermachen", shown with lastPlayed: 449): the entry as it is before stop() remembers the session that plays; the start of the playback is the shell's
  resume: {
    valid: (a) => last !== null && (a.playing === null || isPlaying(a.playing)),
    run: (a) => {
      const old = last;
      if (a.playing) remember(a.playing);
      const r = applyParts(readSession(state), old.parts);
      if (!r.ok) { state.errors = r.errors; return; }
      writeSession(state, r.session);
      resumed = { bar: Math.min(old.bar, loopBars(state.track) - 1) }; // 233: startWhenLoaded's bar, never past the end of the loop it restored
      restartIfPlaying();
    },
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

/**
 * Applies the action text as the session does. Returns 'refused' (not valid), 'repeat' (the value its control shows: the web sends no event) or 'applied';
 * the first two change nothing and leave every flag false.
 */
export function apply(text) {
  change = { events: false, sound: false, voices: false, tempo: false, mix: false, restart: false, inPlace: false, profiles: false };
  let action;
  try { action = JSON.parse(text); } catch { return 'refused'; }
  if (action === null || typeof action !== 'object' || Array.isArray(action) || typeof action.action !== 'string' || !Object.hasOwn(ACTIONS, action.action)) return 'refused';
  const def = ACTIONS[action.action];
  if (!def.valid(action)) return 'refused';
  if (def.same?.(action)) return 'repeat';
  const watched = voiceKeys();
  const view = JSON.stringify(profilesView()); // Change.profiles: what profiles() gives, before and after
  const written = writes.length;
  pushed = JSON.stringify(organTuning(state.organ));
  player = state.track.bars.length ? playerOf({ ...state.track, layers: ALL_LAYERS }) : null; // no bars: the state as imported, before the first start (which calls no applyLive)
  const before = [resumed, legacy];
  resumed = null; // the bar of a resume holds for the action that set it only, and what importLegacy did too
  legacy = null;
  let result;
  try { result = def.run(action); } catch (e) { if (e !== REFUSED) throw e; result = 'refused'; }
  if (result === 'refused') { [resumed, legacy] = before; return 'refused'; } // found only on the way (importProfile, a commit after an unreadable read), before anything changed
  // render(): voices-panel.js 89-93, organ-panel.js 62-64, form-strip.js 241, profiles.js 393
  if (voiceKeys() !== watched) change.voices = true;
  renderOrgan();
  renderStrip();
  settleSelection();
  change.profiles = JSON.stringify(profilesView()) !== view;
  // PROTOKOLL.md section 3a, ruled (the web takes a failing write of these two in silence): state().storage names the last write of each, until one holds
  for (const [name, , took] of writes.slice(written)) if (name === 'session.json' || name === 'mix.json') problems[name === 'session.json' ? 'session' : 'mix'] = took ? null : 'notStored';
  return 'applied';
}

/**
 * What the displays show at the playback's position (PROTOKOLL.md section 4, `position(beats)`): `beats` of the transport, wrapped around the loop. The bar is the one
 * the player reports with onBar at that place (play.js: each bar `bars[chordIndex(track, i)].beats` long, counted as beatsUntilChange counts them), in the loop: the web's
 * onBar counts on across loops, which shows the roles of a progression without a form at the wrong entry after the first loop when the length is no multiple of the
 * chords (PROTOKOLL.md section 4). Then the web's own functions, as the displays call them.
 */
export function position(beats) {
  const { track } = state;
  const length = loopBars(track);
  const dur = (i) => track.bars[chordIndex(track, i)].beats;
  let loop = 0;
  for (let i = 0; i < length; i++) loop += dur(i);
  const pos = ((beats % loop) + loop) % loop;
  let bar = 0, start = 0;
  while (bar < length - 1 && start + dur(bar) <= pos) start += dur(bar++);
  const index = chordIndex(track, bar);
  const chord = track.bars[index].chord; // chordAtBar (position.js 9), what onBar brings
  const next = nextDistinctChord(track.bars, track.length, bar, track.form); // tuning.js 41
  const roles = progressionRoles(track, bar); // progression-editor.js 95, tuning.js 75
  // app.js 113-119 (partLabel) and form-strip.js 243
  const total = formLength(track.form);
  const hit = total > 0 ? sectionAt(track.form, bar % total) : null;
  return {
    bar,
    beat: Math.floor(beats + 1e-6), // app.js 104
    chord,
    name: chordName(chord),
    next,
    nextName: next ? chordName(next) : null,
    index,
    progression: track.bars.map((b, i) => ({ name: chordName(b.chord), degree: romanDegree(track.key, b.chord), role: roles[i] })),
    fretboard: fretboardNotes({ key: track.key, scale: state.scale, current: chord, next }), // tuning.js 60-64
    part: hit ? { index: hit.index, type: hit.section.type, n: track.form.sections.slice(0, hit.index + 1).filter((s) => s.type === hit.section.type).length } : null,
    countdown: beatsUntilChange(track, (beats * 60) / track.bpm), // app.js 102: the song's seconds at the track's tempo
    notes: tones(track.key, chord), // fretboard.js 173 (chordSentence)
    nextNotes: next ? tones(track.key, next) : null,
    wheel: wheelAt(track.key, chord, next), // wheel.js 57-58, 96 with wheelState (tuning.js 42-47) while playing
  };
}
// fretboard.js 173 (chordSentence, which takes the text of the page): the tones of a chord in their order, named in the key's spelling
const tones = (key, chord) => chordMidi(chord, 3).map((m) => noteName(key, m % 12));
const same = (a, b) => noteToPc(a.root) === noteToPc(b.root) && a.quality === b.quality; // wheel.js 9
// wheel.js 57-58: the node of the chord that sounds (an allowed chord at the node, nodeMatches) and that of the next one, unless the node is the same; the next one's label (96).
// No chord (chordDisplays: none sounds) has no node (wheel.js 57: `current.current &&`)
function wheelAt(key, chord, next) {
  const { nodes } = layoutWheel(1, key);
  const allowed = allowedChords(key);
  const nodeOf = (c) => { if (!c) return null; const i = nodes.findIndex((n) => allowed.some((a) => same(a, n.chord)) && nodeMatches(n, c, key)); return i < 0 ? null : i; };
  const current = nodeOf(chord), following = nodeOf(next);
  return { current, next: following === current ? null : following, nextShort: next ? chordShort(next) : null };
}

// ---------- the old page of the user's own songs (native/app/web/track.js, removed in Task 32d; in git before it): what its displays show for a chord in a key (PROTOKOLL.md section 4b, chordDisplays) ----------
// track.js 19-20 and 25-31, mirrored (the page touches the shell and the DOM when it loads): the names of the bar's select, and a chord name of the analysis as the app's chord
// object and back. Against the old page, which threw there: a name without a root, or one that is no text, is no chord (null; the old page took String(name)), and a symbol
// is looked up among KINDS' own keys only ('constructor' is no symbol: major, as any unknown one)
const ROOT_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']; // track.js NAMES
const BAR_CHORDS = [...ROOT_NAMES, ...ROOT_NAMES.map((n) => `${n}m`)];
const KINDS = { '': 'maj', m: 'min', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4', 5: 'power', 7: 'dom7', maj7: 'maj7', m7: 'min7', m7b5: 'm7b5', dim7: 'dim7', 6: 'maj6', m6: 'min6', add9: 'add9', 9: 'dom9', m9: 'min9' };
const chordOf = (name) => {
  const m = typeof name === 'string' ? /^([A-G][#b]?)(.*)$/.exec(name) : null;
  return m ? { root: m[1], quality: Object.hasOwn(KINDS, m[2]) ? KINDS[m[2]] : 'maj' } : null;
};
const nameOf = (chord) => chord.root + (Object.keys(KINDS).find((suffix) => KINDS[suffix] === chord.quality) ?? '');
/**
 * What the old page hands its displays for the request's text { key, scale, chords, current, next } (the key and the scale of the analysis or the user's choice, the names of
 * the chords of the part that plays, of the chord at the playhead and of the next one): showBoard (track.js 419: src/ui/fretboard.js paint's fretboardNotes, chordSentence's
 * chordName and tones) and wheel.update (421: src/ui/wheel.js on the parsed chords), with every node's allowed chord named by nameOf (the click, 54). '' without a valid key.
 */
export function chordDisplays(text) {
  let request;
  try { request = JSON.parse(text); } catch { return ''; }
  const { key, scale, chords, current: currentName, next: nextName } = request !== null && typeof request === 'object' ? request : {};
  if (!isValidKey(key)) return '';
  const current = chordOf(currentName), next = chordOf(nextName);
  return JSON.stringify({
    wheel: wheelOf(key, (Array.isArray(chords) ? chords : []).map(chordOf).filter(Boolean), nameOf),
    at: wheelAt(key, current, next),
    fretboard: fretboardNotes({ key, scale, current, next }),
    name: current ? chordName(current) : null, notes: current ? tones(key, current) : null,
    nextName: next ? chordName(next) : null, nextNotes: next ? tones(key, next) : null,
  });
}

// ---------- what the building blocks show that follows from the state (PROTOKOLL.md section 4: derived, tables) ----------
// form-ui.js 12-15, 37-47 (levelLabel, densityLabel) with their texts as messages, for the page that translates: a text needs none, { key, params } is t(key, params) after every
// param that is a message is translated. A transcription; every label is checked against the real function in both languages below.
const minus = (n) => String(Math.round(n)).replace('-', '−');
const span = ([a, b]) => (Math.round(a) === Math.round(b) ? minus(a) : `${minus(a)} … ${minus(b)}`);
const levelMessage = (s, feel) => (s.level != null ? `${minus(s.level)} dB` : msg('form.insp.default', { v: `${span(resolveSection(s, feel).level)} dB` }));
const densityMessage = (s, feel) => (s.density != null ? msg('ui.percent', { n: minus(s.density * 100) })
  : msg('form.insp.default', { v: msg('ui.percent', { n: span(resolveSection(s, feel).density.map((x) => x * 100)) }) }));
const translated = (m) => (typeof m === 'string' ? m : t(m.key, Object.fromEntries(Object.entries(m.params).map(([k, v]) => [k, translated(v)]))));
function checkedLabel(message, label, s, feel) {
  const lang = getLanguage();
  try {
    for (const l of ['de', 'en']) {
      setLanguage(l);
      if (translated(message) !== label(s, feel)) throw new Error(`the label ${JSON.stringify(message)} is not form-ui.js's in ${l}: ${label(s, feel)}`);
    }
  } finally { setLanguage(lang); }
  return message;
}
// wheel.js 14, 28, 41, 54-73 on the nodes of layoutWheel (wheel-geometry.js), without their geometry: the allowed chord at each in the key's spelling (allowedAt; `nameOf`:
// with the name the page of the own songs sends back for it), whether it is diatonic and in the progression, its label; the path of the progression (nodeOf of each chord,
// those without a node left out)
function wheelOf(key, progression, nameOf = null) {
  const { nodes } = layoutWheel(1, key);
  const allowed = allowedChords(key), diatonic = diatonicChords(key);
  return {
    nodes: nodes.map((n) => {
      const chord = allowed.find((c) => same(c, n.chord)) ?? null;
      return { ring: n.ring, index: n.index, allowed: chord && nameOf ? { ...chord, name: nameOf(chord) } : chord, diatonic: Boolean(chord && diatonic.some((d) => same(d, chord))),
        inProgression: Boolean(chord && progression.some((p) => same(p, chord))), short: chordShort(chord ?? n.chord) };
    }),
    path: progression.map((c) => nodes.findIndex((n) => nodeMatches(n, c, key))).filter((i) => i >= 0),
  };
}
/** What the building blocks show that follows from the state alone, by the functions they call (PROTOKOLL.md section 4, derived()). */
export function derived() {
  const { track } = state;
  const form = formNow();
  const voices = completeVoices(track.voices);
  const total = form ? formLength(form) : 0;
  return JSON.parse(JSON.stringify({
    // progression-editor.js 111-126: per root the qualities it allows and the name of every quality of the register on it
    chordOptions: chordOptions(track.key).map(({ root, qualities }) => ({ root, qualities, names: Object.fromEntries(Object.keys(CHORDS).map((quality) => [quality, chordName({ root, quality })])) })),
    wheel: wheelOf(track.key, track.bars.map((b) => b.chord)),
    tagEffect: Object.fromEntries(TAG_CATEGORIES.flatMap((c) => c.tags).map((tag) => [tag, tagEffect(tag, track)])), // tags-ui.js 83, 87; tuning.js 127
    voices, // voices-panel.js 89, organ-panel.js 48
    voiceKind: voiceKind(track.voices), // mixer.js 79, 118
    jobs: completeJobs(track.jobs), // jobs-panel.js 29
    timbre: resolveTrackTimbre(track), // timbre-panel.js 102
    usesTimbreField: Object.fromEntries(Object.entries(DEFAULT_TIMBRE).flatMap(([group, fields]) => Object.keys(fields).map((f) => [`${group}.${f}`, usesTimbreField(track.voices, `${group}.${f}`)]))), // timbre-panel.js 108, voices-panel.js 105
    presetDrive: presetDrive(voices.chords.variant), // organ-panel.js 56
    meter: meterKey(track.meter), // rhythm.js 52
    groove: grooveIdFor(track), // rhythm.js 63
    rhythm: Object.fromEntries(['complexity', 'loose', 'ornaments'].map((field) => [field, track[field] ?? 0.5])), // rhythm.js 66 (in a render function: a transcription)
    formChoice: formChoice(), // form-panel.js 69
    feel: track.form?.feel ?? state.formFeel, // form-panel.js 79 (in a render function: a transcription)
    // form-strip.js 233-245 with form-ui.js: the strip and the inspector stand only with a valid form; per part what the inspector shows of it (183-217), and the grip's longest (85-86)
    form: form ? {
      blocks: stripBlocks(form).map(({ index, width, ...block }) => block), // no block of the page reads index and width (PROTOKOLL.md section 4)
      parts: form.sections.map((s, i) => ({
        transition: resolveSection(s, form.feel).transition, crash: resolveSection(s, form.feel).crash, levelValue: levelValue(s, form.feel), densityValue: densityValue(s, form.feel),
        levelLabel: checkedLabel(levelMessage(s, form.feel), levelLabel, s, form.feel), densityLabel: checkedLabel(densityMessage(s, form.feel), densityLabel, s, form.feel),
        limits: limits(form, i), maxBars: Math.min(FORM_LIMITS.bars, FORM_LIMITS.length - (total - s.bars)),
      })),
    } : null,
  }));
}
/** The constants the page lists and labels (PROTOKOLL.md section 4, tables()); of VOICES, CHORDS and STYLE_PRESETS the fields the page reads. */
export function tables() {
  return JSON.parse(JSON.stringify({
    ROOTS, SCALE_NAMES, SCALES: Object.keys(SCALES), LAYER_IDS, VOICE_LAYERS, // SCALES: the scale select of the own songs' page (track.js 299)
    VOICES: Object.fromEntries(VOICE_LAYERS.map((layer) => [layer, Object.fromEntries(Object.entries(VOICES[layer]).map(([id, v]) => [id, { kind: v.kind, hidden: v.hidden === true, variants: v.variants }]))])),
    jobsFor: Object.fromEntries(LAYER_IDS.map((layer) => [layer, jobsFor(layer)])),
    METERS, groovesFor: Object.fromEntries(Object.keys(METERS).map((key) => [key, groovesFor(key)])),
    CHORD_COLORS, CHORD_GROUPS, CHORDS: Object.fromEntries(Object.entries(CHORDS).map(([id, c]) => [id, { group: c.group }])), MAX_CHORDS, BAR_CHORDS,
    STYLE_PRESETS: STYLE_PRESETS.map((p) => ({ id: p.id, bpm: p.bpm })),
    TAG_CATEGORIES, DEFAULT_TIMBRE, LESLIE_MODES, DEFAULT_ORGAN,
    PART_TYPES, TRANSITIONS, TEMPLATE_IDS, TARGET_SIZES, FEEL_DEFAULTS, DYNAMICS_MAX,
    PART_IDS, PART_PRESETS, LIMITS: { name: LIMITS.name, nodes: LIMITS.nodes, file: LIMITS.file }, FORMAT_FOLDER, STANDARD_TUNING, FRETS, DEFAULT_PAN,
  }));
}

// ---------- loading the page (state.js 58-90, app.js 153 and 484-486, profiles.js 41-47): the session's constructor; the ids of a repaired tree are the session's own ----------
// The ids the session's constructor gives where loadTree calls defaultMakeId (PROTOKOLL.md section 2): "1", "2", ... skipping every `id` of an object in the stored value
const storedIds = (v, out = new Set()) => {
  if (Array.isArray(v)) for (const x of v) storedIds(x, out);
  else if (v !== null && typeof v === 'object') { if (typeof v.id === 'string') out.add(v.id); for (const x of Object.values(v)) storedIds(x, out); }
  return out;
};
function loadTreeWithIds(text) {
  let used = new Set();
  try { used = storedIds(JSON.parse(text)); } catch { /* no JSON: loadTree gives the empty tree then */ }
  let k = 0;
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => { do k++; while (used.has(String(k))); return String(k); } } }); // defaultMakeId asks it
  try { return loadTree(storeOf('profiles.json', text)); } finally { Object.defineProperty(globalThis, 'crypto', real); }
}
// PROTOKOLL.md section 3a, ruled against the web: there localStorage never throws on a read, and loadTree, loadLast, loadMix and loadPan take a failed read, and every
// text they cannot use, for "nothing stored". On a disk a read can fail once (a locked file) and a byte can be damaged, so the session tells three cases apart per name:
// absent (nothing stored), unreadable (the read throws, or the text is above 20,000,000 bytes: it is not parsed), damaged (a text came, and nothing of it is of use). The
// loaders are the web's, on the text that was read.
const STORED_LIMIT = 20e6;
function readStored(name) {
  let text;
  try { text = localStorage.getItem(KEYS[name]); } catch { return { text: null, problem: 'unreadable' }; }
  return text !== null && Buffer.byteLength(text, 'utf8') > STORED_LIMIT ? { text: null, problem: 'unreadable' } : { text, problem: null };
}
const storeOf = (name, text) => ({ getItem: (key) => (key === KEYS[name] ? text : null) }); // the text that was read, for a loader of the web
const parsedOrNone = (text) => { try { return { value: JSON.parse(text) }; } catch { return null; } };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// profiles.json is damaged when it is no JSON, or neither a list (the old flat list, taken over even when it is empty) nor an object with a list `items` (profile-store.js 57-58).
// `keep`: the text to keep before the first write over it (commit); `version`: that of a newer tree, else null.
// Against the web, on the user's decision of 2026-11-24 ("sichern, melden und dann überschreiben klingt gut"): a tree whose version is a number above the one saveTree writes
// (STORED_VERSION, profile-store.js 10, not exported) is read as far as this version knows it, as the web reads it, named with its version ('newer') and kept as
// profiles.newer.json before the first write over it, where the web writes over it in silence (src/ stays as it is)
function loadProfiles({ text, problem }) {
  if (problem) return { tree: newTree(), problem, version: null, keep: null };
  const raw = text === null ? null : parsedOrNone(text);
  if (text !== null && !(raw && (Array.isArray(raw.value) || (isObject(raw.value) && Array.isArray(raw.value.items))))) return { tree: newTree(), problem: 'damaged', version: null, keep: text };
  const version = typeof raw?.value.version === 'number' && raw.value.version > 2 ? raw.value.version : null;
  return { tree: loadTreeWithIds(text), problem: version === null ? null : 'newer', version, keep: version === null ? null : text };
}
/** A fresh page on the store (the session's constructor): the state literal with seed 1 and the stored mixer, the tree, the last session as the offer of "Weitermachen". */
export function reload() {
  const mix = readStored('mix.json'), profiles = readStored('profiles.json'), session = readStored('session.json');
  problems = { profiles: null, profilesVersion: null, session: null, mix: null };
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, structuredClone(initial), { mix: loadMix(storeOf('mix.json', mix.text)), pan: loadPan(storeOf('mix.json', mix.text)) }); // state.js 84-85
  state.track.seed = 1;
  touched = { key: false, style: false, tempo: false, variant: false };
  selected = 0;
  refusals = 0;
  rollNote = false;
  deriveBars();
  setFormTemplate('auto');
  ({ tree, problem: problems.profiles, version: problems.profilesVersion, keep: keepText } = loadProfiles(profiles));
  selection = 'session';
  open = ['mine', 'factory'];
  message = null;
  undo = null;
  drag = null;
  last = loadLast(storeOf('session.json', session.text)); // only the offer: the web applies it on the click (226-236), that is resume
  // damaged: a text from which loadLast reads no entry; a mixer text that is no JSON or no object (a list too), from which loadMix and loadPan read no value
  const mixRaw = mix.text === null ? null : parsedOrNone(mix.text);
  problems.session = session.problem ?? (session.text !== null && last === null ? 'damaged' : null);
  problems.mix = mix.problem ?? (mix.text !== null && !(mixRaw && isObject(mixRaw.value)) ? 'damaged' : null);
  resumed = null;
  legacy = null;
  change = { events: false, sound: false, voices: false, tempo: false, mix: false, restart: false, inPlace: false, profiles: false }; // a new session has called nothing
  renderStrip();
}

// ---------- the export (profiles.js 299-312) for a row's key; `name` stands for the translations the web takes for the session, a factory profile and "mine" ----------
export function exportText(key, name) {
  let data;
  if (key === 'session') data = makeProfileFile({ name, parts: captureParts(readSession(state)) });
  else if (key === 'mine') data = makeFolderFile({ name, items: tree.items, backup: true });
  else if (key.startsWith(FACTORY) && factoryProfiles().some((f) => f.key === key)) data = makeProfileFile({ name, parts: factoryParts(key.slice(FACTORY.length)) });
  else {
    const f = find(tree, key);
    if (!f) return ''; // no row, or "factory" (its exchange box is hidden: 425)
    data = f.node.type === 'profile' ? makeProfileFile(f.node) : makeFolderFile(f.node);
  }
  if (data.format === FORMAT_FOLDER && !data.items.length) return ''; // 312, 315: ui.profileNothing
  return JSON.stringify(data, null, 2);
}

/** The storage for the export's steps: whether writes fail, whether reads find nothing ('none') or throw ('throw'), the log of the writes, the stored texts by the core's names. */
export const storage = {
  failWrites: (on) => { writesFail = on; },
  failReads: (mode) => { readsFail = mode; },
  takeWrites: () => { const out = writes; writes = []; return out; },
  text: (name) => (store.has(KEYS[name]) ? store.get(KEYS[name]) : null),
  set: (name, text) => { if (text === null) store.delete(KEYS[name]); else store.set(KEYS[name], text); },
};

/**
 * What the core's session must give after the action: the flags, state() (with errors as app.js reports them, validateTrack of index.js), profiles(), track() (what app.js
 * 128 and 191 hand the player: every layer on), sound(), tuning().
 */
export function record() {
  return JSON.parse(JSON.stringify({
    change,
    state: {
      track: state.track, formTarget: state.formTarget, formSalt: state.formSalt, formFeel: state.formFeel, scale: state.scale, chordColor: state.chordColor,
      chordColorFromStyle: state.chordColorFromStyle, style: state.style, mix: state.mix, pan: state.pan, organ: state.organ, tempoRef: state.tempoRef ?? null, touched,
      selectedPart: selected, errors: state.errors.length ? state.errors : validateTrack(state.track), // app.js 231 after a failed resume; else what a failed start shows
      last: last && lastView(last),
      resumed,
      legacy,
      loopBars: loopBars(state.track),
      storage: problems,
      notice: state.notice ?? null, refusals, rollNote,
    },
    profiles: profilesView(),
    track: { ...state.track, layers: ALL_LAYERS },
    sound: resolveTrackTimbre(state.track),
    tuning: organTuning(state.organ),
  }));
}
// profiles() (PROTOKOLL.md section 4): the tree lightly, and what the window's building blocks read
function profilesView() {
  const light = (items) => items.map((n) => (n.type === 'profile' ? { id: n.id, type: n.type, name: n.name, parts: partIdsOf(n.parts) } : { id: n.id, type: n.type, name: n.name, items: light(n.items) }));
  const s = chosen();
  const inside = (folder) => { const all = countNodes({ items: folder.items }); const profiles = countProfiles({ type: 'folder', items: folder.items }); return { profiles, folders: all - profiles }; }; // profile-parts-picker.js 19
  return {
    items: light(tree.items), nodes: countNodes(tree), factory: factoryProfiles(), selection, open, undo: undo !== null, message,
    targets: s.node ? moveTargets(tree, s.node.id).filter((f) => f.id !== s.parentId) : [], // profiles.js 395
    counts: s.kind === 'folder' || s.kind === 'mine' ? inside(s.node ?? tree) : null, // 407, 461
    drag: drag === null ? null : { key: drag, targets: dropRows(drag) },
  };
}
// profiles.js 246-249 (dropTarget, not exported): of the rows "mine" and the own folders in the order of listFolders, those the dragged entry may be dropped on
function dropRows(id) {
  const dropTarget = (key) => {
    const to = key === 'mine' ? null : find(tree, key)?.node.type === 'folder' ? key : undefined;
    return to !== undefined && to !== (find(tree, id)?.parent?.id ?? null) && canMove(tree, id, to) ? to : undefined;
  };
  return ['mine', ...listFolders(tree).slice(1).map((f) => f.id)].filter((key) => dropTarget(key) !== undefined);
}
// what the box "Zuletzt gespielt" shows (app.js 450-459)
const lastView = (entry) => ({ bar: entry.bar, at: entry.at, root: entry.parts.harmony.key.root, scale: entry.parts.harmony.scale, style: entry.parts.style.style, bpm: entry.parts.tempo.bpm, seed: entry.parts.variant.seed });

/** The reference's state, read only, for the export's draws. */
export const current = () => ({ state, touched, selected, tree, selection, open, undo, last, rows: rows(), kind: chosen().kind, problems, drag: drag === null ? null : { key: drag, targets: dropRows(drag) } });
/** Back to what the core's constructor gives on an empty storage (the start state of variant 1, the mixer's defaults, no profiles), before each sequence. */
export const reset = () => {
  store.clear();
  writes = [];
  reload();
};
