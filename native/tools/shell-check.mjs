// Checks the app's shell of the session (Task 31, native/PROTOKOLL.md section 7) in the real app, in one step (after native/build.ps1 with the app):
//   node native/tools/shell-check.mjs [app.exe]
// It starts the app muted (BTG_MUTE=1) on a storage folder of its own (BTG_STORAGE_DIR: a fresh folder in the temp directory, removed afterwards, so
// that the user's profiles are never touched), with the WebView2 debug port, attaches Playwright as ui-check.mjs does and talks to the shell through
// the bridge of the app's page (the page stays idle: nothing here clicks it). Its debug port 9334 is position-check.mjs's too: the two cannot run at once.
// (a) The same actions, played once directly on a session (btg_session, native/core/tools/session.cpp) and once sent to the app as `action`
//     messages, give the same texts after each: `state` (and its flags), `profiles`, the lanes (`events`); then the same exports and the same
//     files in the storage folder. Before them, `sync` gives the state, the profile view, the lanes the state names and the voices' state.
// (b) The engine follows the flags, while the session's song plays (`playSession`): the tempo is the session's; a layer's fader at 0 silences
//     that layer and 100 brings it back, as a mute and the master do; a new lead job (a new track) gives the lead a level; the stereo width
//     (the sound), the e-piano for the chords and the organ's drive (the fine values) change the chords' level between two passes over the same
//     span; a restart in place starts again at the bar that played, with the new song; an own profile loaded restarts from bar 1; stop remembers
//     the bar; "Weitermachen" plays from the bar it restored; in 3/4 and 6/8 the starts lie where the lanes put the bars. Each measure fails when the
//     shell leaves out the engine call of its flag. The string voices (from an imported profile) have a level, and with every layer effect at 100
//     the load stays at most 25 % with no dropout. Then two drags of 60 actions (a fader, a timbre knob) and `stop`: the last answer and the stop's
//     effect within 1.0 s. What happens to the page (a navigation, a crash, a close, the app's end) is recorded with its time; after the setup it is
//     a problem. Writes the result to .superpowers/native-screens/shell-check.json and prints it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startApp } from './app-window.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.argv[2] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const program = join(repo, 'native/build/core/Release/btg_session.exe');
const out = join(repo, '.superpowers/native-screens');
mkdirSync(out, { recursive: true });
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const music = JSON.parse(readFileSync(join(repo, 'native/core/data/music.json'), 'utf8'));
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

// (a) the actions: every kind of PROTOKOLL.md section 3 that does not start the playback, valid ones and some that are not
const A = (action, fields = {}) => JSON.stringify({ action, ...fields });
const tags = music.tags[0];
const STEPS = [
  A('start', { variant: 5 }),
  A('setTempo', { bpm: 104, from: 'play' }), A('setTempo', { bpm: 104, from: 'play' }), A('setRoot', { root: 'D', from: 'play' }), A('setScale', { scale: 'dorian', from: 'start' }),
  A('stepVariant', { dir: 1 }), A('newVariant', { variant: 77 }), A('enterVariant', { variant: 5 }), A('toggleTag', { category: tags.id, tag: tags.tags[0] }),
  A('setChordColor', { color: Object.keys(music.chordColors.table)[1] }), A('removeChord', { index: 0 }), A('setMeter', { meter: '3/4' }), A('setMeter', { meter: '4/4' }),
  A('setGroove', { groove: 'latin' }), A('setRhythmKnob', { knob: 'complexity', value: 70 }), A('setFormTemplate', { template: music.form.templateIds[1] }),
  A('setFormFeel', { knob: 'dynamics', value: 80 }), A('releaseStructure'), A('selectPart', { index: 1 }), A('editPart', { field: 'type', value: 'chorus' }),
  A('editPart', { field: 'bars', value: 4 }), A('toggleLock'), A('copyPart'), A('movePart', { dir: 1 }), A('addPart'), A('deletePart'), A('rerollForm'),
  A('setLevel', { channel: 'drums', value: 60 }), A('setLevel', { channel: 'master', value: 80 }), A('setPan', { layer: 'bass', value: -30 }), A('toggleMute', { layer: 'pad' }),
  A('setVoice', { layer: 'chords', id: 'epiano', variant: 'rhodes' }), A('toggleAllVoices'), A('setJob', { layer: 'lead', job: 'melody' }),
  A('setTimbre', { group: 'master', field: 'width', value: 70 }), A('resetTimbre', { group: 'master' }), A('setLeslie', { mode: 'fast' }),
  A('saveProfile', { name: 'Shell 1', folder: null, parts: ['harmony', 'tempo', 'style'], id: 'shell-1' }), A('profileSelect', { key: 'mine' }),
  A('addFolder', { name: 'Ordner', id: 'shell-f' }), A('moveNode', { id: 'shell-1', target: 'shell-f' }), A('undoProfile'), A('profileSelect', { key: 'shell-1' }),
  A('renameNode', { name: 'Shell eins' }), A('loadProfile'), A('profileSelect', { key: 'factory:funk' }), A('loadProfile'), A('copyFactory', { name: 'Funk', id: 'shell-c' }),
  A('deleteNode'), A('profileSelect', { key: 'session' }), A('importProfile', { from: 'text', text: 'kein Profil', ids: [] }),
  A('rememberSession', { bar: 3, at: 1700000000000 }), A('surprise', { variant: 4321, style: 0.3, tempo: 0.5, scale: 0.2, root: 0.7 }),
  'kein JSON', A('nope'), A('setTempo', { bpm: 999, from: 'play' }),
  { export: ['session', 'Export'] }, { export: ['mine', 'Meine Profile'] }, { export: ['shell-1', 'x'] },
];

const work = mkdtempSync(join(tmpdir(), 'btg-shell-check-'));
const storage = join(work, 'storage');
mkdirSync(storage);
writeFileSync(join(work, 'steps.json'), JSON.stringify(STEPS));
const ran = spawnSync(program, [join(work, 'steps.json'), join(work, 'expected.json')], { encoding: 'utf8' });
if (ran.status !== 0) { rmSync(work, { recursive: true, force: true }); throw new Error(`btg_session failed: ${ran.stdout}${ran.stderr}${ran.error ?? ''}`); }
const expected = JSON.parse(readFileSync(join(work, 'expected.json'), 'utf8'));

const problems = [];
const result = {};
const began = Date.now(), pageLog = [];
let setupDone = Infinity; // the index in pageLog from which an entry is a problem
const app = startApp(exe, `btg-tools-${PORT}`, { env: { ...process.env, BTG_MUTE: '1', BTG_STORAGE_DIR: storage, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let killed = false;
app.on('exit', (code, signal) => { if (!killed) pageLog.push({ ms: Date.now() - began, what: `the app ended by itself (code ${code}, signal ${signal})` }); });
let browser;
try {
  for (let i = 0; !browser && i < 40; i++) {
    await sleep(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
  }
  if (!browser) throw new Error('WebView2 debug port did not open');
  let page;
  for (let i = 0; !page && i < 40; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('juce.backend'));
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no page from the resource provider');
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  // what happens to the page, with the time: a navigation, a reload, a crash, a close, the app's end; one after the setup is a problem with its cause
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) pageLog.push({ ms: Date.now() - began, what: `navigated to ${f.url()}` }); });
  page.on('load', () => pageLog.push({ ms: Date.now() - began, what: 'load' }));
  page.on('crash', () => pageLog.push({ ms: Date.now() - began, what: 'the page crashed' }));
  page.on('close', () => pageLog.push({ ms: Date.now() - began, what: 'the page closed' }));
  // the page's own listeners; set up again when the page navigates under the setup (a load of the page while the app starts: see below)
  const setup = (fnvText) => {
    const backend = window.__JUCE__.backend;
    const fnvOf = new Function(`return ${fnvText}`)();
    window.got = { state: [], profiles: [], events: [], position: [], engine: [], voices: [], export: [] };
    for (const name of Object.keys(window.got)) {
      backend.addEventListener(name, (m) => {
        const entry = name === 'events' ? { number: m.number, bpm: m.bpm, hash: fnvOf(m.json), length: m.json.length, json: m.json } : { ...m };
        if (name === 'events' && window.got.events.length) delete window.got.events.at(-1).json; // the newest one only keeps its text (about 1 MB)
        window.got[name].push({ ...entry, at: performance.now() });
        if (name === 'engine' && window.got.engine.length > 2000) window.got.engine.splice(0, 1000);
      });
    }
    window.bridge = (type, data = {}) => backend.emitEvent('btg', { type, ...data });
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // waits for the next event of `name` after `count` of them, at most `ms`
    window.next = async (name, count, ms = 15000) => { for (let i = 0; i < ms / 20 && window.got[name].length <= count; i++) await window.wait(20); return window.got[name][count] ?? null; };
    // an action and its answer: the `state` event right after it, the `profiles` event with it when its flag says so
    window.act = async (json) => {
      const states = window.got.state.length, profiles = window.got.profiles.length;
      window.bridge('action', { json });
      const state = await window.next('state', states);
      const view = state?.change?.profiles ? await window.next('profiles', profiles, 3000) : null;
      return { state, profiles: view };
    };
    window.lanes = async (number) => { for (let i = 0; i < 750 && !window.got.events.some((e) => e.number === number); i++) await window.wait(20); return window.got.events.find((e) => e.number === number) ?? null; };
  };
  // Task 31 saw a second load of the page while the app started; the only way found in JUCE's code is a window hidden and shown again (its default,
  // until Task 32d, blanked a hidden page and went back to it), which the shell no longer allows; six probed starts in Task 32d, three of them with
  // the old default, showed no second load. The wait stays, harmless: until one document has stood for 1.5 s (the same timeOrigin twice), then set up
  let origin = null; // the document the check sets up in: another one at the end is a reload (also one that Playwright reports no navigation for)
  for (let i = 0; i < 20; i++) {
    await page.waitForLoadState('load').catch(() => {});
    const now = await page.evaluate(() => performance.timeOrigin).catch(() => null);
    if (now !== null && now === origin) break;
    if (origin !== null) pageLog.push({ ms: Date.now() - began, what: 'the page loaded again before the setup' });
    origin = now;
    await sleep(1500);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await page.waitForLoadState('load');
      await page.evaluate(setup, fnv.toString());
      break;
    } catch (error) {
      if (attempt === 3 || !/Execution context was destroyed/.test(error.message)) throw error;
      pageLog.push({ ms: Date.now() - began, what: `the page navigated during the setup (try ${attempt}): set up again` });
      await sleep(500);
    }
  }
  origin = await page.evaluate(() => performance.timeOrigin);

  // ---------- (a) the same texts ----------
  setupDone = pageLog.length;
  // sync: what a page that loaded draws from: the state, the profile view, the lanes the state names (also the first, of the start), the voices' state
  const [syncStates, syncViews, syncVoices] = await page.evaluate(() => [window.got.state.length, window.got.profiles.length, window.got.voices.length]);
  await page.evaluate(() => window.bridge('sync'));
  const synced = await page.evaluate((n) => window.next('state', n), syncStates);
  const syncedView = await page.evaluate((n) => window.next('profiles', n, 3000), syncViews);
  if (!synced) throw new Error('no state after sync: the shell does not answer');
  const syncedVoices = await page.evaluate((n) => window.next('voices', n, 5000), syncVoices);
  const syncedLanes = await page.evaluate((n) => window.lanes(n), synced.events);
  result.sync = { events: synced.events, lanes: syncedLanes ? { number: syncedLanes.number, length: syncedLanes.length } : null,
    voices: syncedVoices && Object.fromEntries(Object.entries(syncedVoices).filter(([k]) => k !== 'at')) };
  if (!(synced.events >= 1) || !syncedLanes) problems.push(`sync: the state names lanes ${synced.events}, the lanes did not come: ${JSON.stringify(result.sync)}`);
  if (!syncedVoices || !['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'].every((l) => typeof syncedVoices[l] === 'string'))
    problems.push(`sync: no voices' state: ${JSON.stringify(result.sync)}`);
  if (JSON.parse(synced.json).track.seed === 5) await page.evaluate(() => window.act('{"action":"start","variant":6}')); // so that start 5 below makes new lanes, as in the program
  if (syncedView?.json !== expected[0].profiles) problems.push('sync: the profile view is not the session\'s after its constructor');
  let lanesNumber = await page.evaluate(() => window.got.state.at(-1).events);
  const flags = (c) => JSON.stringify(Object.keys(c ?? {}).sort().map((k) => [k, c[k]]));
  const a = { steps: 0, valid: 0, lanes: 0, exports: 0 };
  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i], want = expected[i];
    const what = typeof step === 'string' ? step.slice(0, 80) : JSON.stringify(step);
    if (typeof step !== 'string') {
      const exports = await page.evaluate(() => window.got.export.length);
      await page.evaluate(([key, name]) => window.bridge('export', { key, name }), step.export);
      const got = await page.evaluate((n) => window.next('export', n, 5000), exports);
      if (got?.json !== want.export) problems.push(`(a) export ${what}: the app's text is not the session's`);
      a.exports++;
      continue;
    }
    const { state, profiles } = await page.evaluate((json) => window.act(json), step);
    a.steps++;
    if (!state) { problems.push(`(a) ${what}: no state event`); break; }
    if (Object.values(want.change).some(Boolean)) a.valid++;
    if (state.json !== want.state) problems.push(`(a) ${what}: state differs from the session's`);
    if (flags(state.change) !== flags(want.change)) problems.push(`(a) ${what}: the flags ${JSON.stringify(state.change)} are not the session's ${JSON.stringify(want.change)}`);
    if (want.change.profiles && profiles?.json !== want.profiles) problems.push(`(a) ${what}: the profile view differs from the session's`);
    if (want.events !== undefined) {
      if (state.events !== lanesNumber + 1) problems.push(`(a) ${what}: new lanes are due, the state names lanes ${state.events} after ${lanesNumber}`);
      lanesNumber = state.events;
      const lanes = await page.evaluate((n) => window.lanes(n), lanesNumber);
      if (!lanes || lanes.hash !== fnv(want.events) || lanes.length !== want.events.length || lanes.bpm !== JSON.parse(want.track).bpm)
        problems.push(`(a) ${what}: the lanes ${lanes?.number} differ from the session's (${lanes?.length} against ${want.events.length} characters)`);
      a.lanes++;
    } else if (state.events !== lanesNumber) problems.push(`(a) ${what}: no new lanes are due, the state names lanes ${state.events} after ${lanesNumber}`);
  }
  // the storage folder holds what the session's storage holds, and no side file (beside the WebView2 profile, which lies there too: PROTOKOLL.md section 7)
  const stored = expected.at(-1).stored;
  const files = readdirSync(storage).filter((name) => name !== 'WebView2');
  for (const [name, text] of Object.entries(stored)) if (!files.includes(name) || readFileSync(join(storage, name), 'utf8') !== text) problems.push(`(a) the app's ${name} is not the session's text`);
  for (const name of files) if (!(name in stored) && !(name.endsWith('.bak') && name.slice(0, -4) in stored)) problems.push(`(a) the storage folder holds ${name}`);
  result.a = { ...a, stored: Object.keys(stored), files };

  // ---------- (b) the engine follows ----------
  const act = (json) => page.evaluate((j) => window.act(j), json);
  const stateNow = async () => JSON.parse(await page.evaluate(() => window.got.state.at(-1).json));
  const peaks = (ms) => page.evaluate(async (t) => {
    window.got.engine.length = 0;
    await window.wait(t);
    const log = window.got.engine.filter((m) => m.playing && !m.standing);
    return Object.fromEntries(['drums', 'bass', 'chords', 'pad', 'lead', 'percussion', 'master'].map((l) => [l, +Math.max(0, ...log.map((m) => m.peaks?.[l] ?? 0)).toFixed(4)]));
  }, ms);
  const seek = async (beats) => { await page.evaluate((b) => window.bridge('seek', { beats: b }), beats); await sleep(250); };
  const lastEngine = () => page.evaluate(() => window.got.engine.at(-1));
  const lanesNow = async () => JSON.parse(await page.evaluate(() => window.got.events.at(-1).json));
  // the first beat from `from` on after which every layer of `layers` has a note or hit 0.2 to 1.8 s into the song (at the lanes' tempo)
  const busyBeat = (events, bpm, layers, from = 16) => {
    const plays = (layer, beat) => events.some((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit') && e.t >= (beat * 60) / bpm + 0.2 && e.t < (beat * 60) / bpm + 1.8);
    for (let beat = from; beat < 2000; beat++) if (layers.every((l) => plays(l, beat))) return beat;
    return null;
  };
  // the beat at which a bar begins: its chord event, at the lanes' tempo
  const barStart = (events, bpm, bar) => { const e = events.find((x) => x.type === 'chord' && x.bar === bar); return e ? (e.t * bpm) / 60 : null; };
  const db = (x, y) => (x > 0 && y > 0 ? +(20 * Math.log10(y / x)).toFixed(2) : null);
  const b = {};

  await act(A('start', { variant: 5 }));
  const voicesBefore = await page.evaluate(() => window.got.voices.length);
  await page.evaluate(() => window.bridge('playSession'));
  const ready = await page.evaluate((n) => window.next('voices', n, 20000), voicesBefore);
  if (ready?.drums !== 'ready' || ready?.bass !== 'ready' || ready?.chords !== 'ready') problems.push(`(b) playSession: voices ${JSON.stringify(ready)}`);
  await sleep(800);
  let lanes = await lanesNow(), bpm = (await page.evaluate(() => window.got.events.at(-1).bpm));
  const B0 = busyBeat(lanes, bpm, ['drums', 'bass', 'chords']);
  b.song = { variant: (await stateNow()).track.seed, bpm, busyBeat: B0 };
  if (B0 === null) throw new Error('the song of variant 5 has no beat after which drums, bass and chords play');
  const pass = async (beat, ms = 1800) => { await seek(beat); return peaks(ms); };

  // tempo: the transport takes the session's bpm
  const tempo = await act(A('setTempo', { bpm: 140, from: 'play' }));
  await sleep(400);
  b.tempo = { session: JSON.parse(tempo.state.json).track.bpm, engine: (await lastEngine()).bpm };
  if (b.tempo.session !== 140 || b.tempo.engine !== 140) problems.push(`(b) tempo: the engine plays at ${b.tempo.engine}, the session says ${b.tempo.session}`);
  await act(A('setTempo', { bpm, from: 'play' }));
  await sleep(300);

  // levels, mute, master
  const plain = await pass(B0);
  await act(A('setLevel', { channel: 'drums', value: 0 }));
  const drumsDown = await pass(B0);
  await act(A('setLevel', { channel: 'drums', value: 100 }));
  const drumsUp = await pass(B0);
  b.level = { plain: plain.drums, down: drumsDown.drums, up: drumsUp.drums };
  if (!(plain.drums > 0) || drumsDown.drums !== 0 || !(drumsUp.drums > 0)) problems.push(`(b) level: the drums' fader at 0 and 100 gives ${JSON.stringify(b.level)}`);
  await act(A('toggleMute', { layer: 'bass' }));
  const bassMuted = await pass(B0);
  await act(A('toggleMute', { layer: 'bass' }));
  const bassBack = await pass(B0);
  b.mute = { plain: plain.bass, muted: bassMuted.bass, back: bassBack.bass };
  if (!(plain.bass > 0) || bassMuted.bass !== 0 || !(bassBack.bass > 0)) problems.push(`(b) mute: the bass muted and back gives ${JSON.stringify(b.mute)}`);
  await act(A('setLevel', { channel: 'master', value: 0 }));
  const masterDown = await pass(B0);
  await act(A('setLevel', { channel: 'master', value: 100 }));
  const masterUp = await pass(B0);
  b.master = { plain: plain.master, down: masterDown.master, up: masterUp.master };
  if (!(plain.master > 0) || masterDown.master !== 0 || !(masterUp.master > 0)) problems.push(`(b) master: at 0 and 100 it gives ${JSON.stringify(b.master)}`);

  // a new track: the lead's job "off" plays nothing; with "melody" the lead has a level where the new lanes give it notes
  const leadOff = (await stateNow()).track.jobs.lead;
  const job = await act(A('setJob', { layer: 'lead', job: 'melody' }));
  const jobLanes = await page.evaluate((n) => window.lanes(n), job.state.events);
  lanes = JSON.parse(await page.evaluate(() => window.got.events.at(-1).json));
  bpm = jobLanes?.bpm ?? bpm;
  const leadBeat = busyBeat(lanes, bpm, ['lead']);
  await sleep(600); // the engine's setTrack after the answer
  const lead = leadBeat === null ? null : await pass(leadBeat, 2500);
  b.track = { jobBefore: leadOff, change: job.state.change, leadBeat, lead: lead?.lead ?? null };
  if (leadOff !== 'off' || !job.state.change.events || !(lead?.lead > 0)) problems.push(`(b) track: the lead with the job melody ${JSON.stringify(b.track)}`);
  await act(A('setJob', { layer: 'lead', job: 'off' }));

  // the sound: the stereo width moves the chords (the place mix/pan gives them is 0.3); two passes over the same span, width 0 and 1
  await act(A('setTimbre', { group: 'master', field: 'width', value: 0 }));
  await sleep(400);
  const narrow = await pass(B0, 2500);
  const width = await act(A('setTimbre', { group: 'master', field: 'width', value: 100 }));
  await sleep(400);
  const wide = await pass(B0, 2500);
  b.sound = { change: width.state.change, narrow: narrow.chords, wide: wide.chords, gainDb: db(narrow.chords, wide.chords) };
  if (!width.state.change.sound || !(b.sound.gainDb >= 1.5)) problems.push(`(b) sound: the chords at width 0 and 1 ${JSON.stringify(b.sound)}`);
  await act(A('resetTimbre', { group: 'master' }));

  // a voice: the chords from the song's voice to the e-piano; the engine reports the voices, and the chords' level changes (the voices are
  // levelled against each other: from sample/funk the classic synth moves the peak by 0.1 dB, the e-piano by about -4 dB, two passes of the
  // same voice differ by up to 0.5 dB)
  const ownChords = (await stateNow()).track.voices.chords;
  const before = await pass(B0, 2500);
  const voicesCount = await page.evaluate(() => window.got.voices.length);
  const voiceAct = await act(A('setVoice', { layer: 'chords', id: 'epiano', variant: 'rhodes' }));
  const reported = await page.evaluate((n) => window.next('voices', n, 5000), voicesCount);
  const after = await pass(B0, 2500);
  b.voices = { from: `${ownChords.id}/${ownChords.variant}`, change: voiceAct.state.change, reported: reported?.chords ?? null, before: before.chords, after: after.chords,
    gainDb: db(before.chords, after.chords) };
  if (!voiceAct.state.change.voices || reported?.chords !== 'ready' || !(Math.abs(b.voices.gainDb ?? 0) >= 1.5)) problems.push(`(b) voices: ${JSON.stringify(b.voices)}`);

  // the sound's fine values (tuning(): organTuning, the organ's Leslie and drive), which setSound does not carry: the chords on the jazz organ, the
  // Leslie off (6 s for the rotor to stop: a turning rotor's phase runs on across a seek, and passes over the same span differ by up to 3.6 dB), then
  // two passes over the same span with the drive at 0 and at 1: the drive flattens the organ's peaks (probes t31f-tuning-probe*.mjs: -8 to -10 dB;
  // with the rotor stopped two passes of one drive agree within 0.2 dB). Without the fine values the Leslie keeps turning ("auto") and the drive stays
  // the preset's: the passes then differ by the rotor's phase alone, by +3.4 dB in a red run with 2.5 s passes; so 5 s passes and a bar of -5 dB
  await act(A('setVoice', { layer: 'chords', id: 'organ', variant: 'jazz' }));
  const leslieOff = await act(A('setLeslie', { mode: 'off' }));
  await sleep(6000);
  const drive0 = await act(A('setOrganDrive', { value: 0 }));
  await sleep(400);
  const dry = await pass(B0, 5000);
  const drive1 = await act(A('setOrganDrive', { value: 100 }));
  await sleep(400);
  const driven = await pass(B0, 5000);
  b.tuning = { change: drive1.state.change, organ: JSON.parse(drive1.state.json).organ, drive0: dry.chords, drive1: driven.chords, gainDb: db(dry.chords, driven.chords) };
  if (!leslieOff.state.change.sound || !drive0.state.change.sound || !drive1.state.change.sound || !(b.tuning.gainDb !== null && b.tuning.gainDb <= -5))
    problems.push(`(b) tuning: the organ's drive 0 and 1 with the Leslie off ${JSON.stringify(b.tuning)}`);
  await act(A('setVoice', { layer: 'chords', id: ownChords.id, variant: ownChords.variant }));

  // the next engine report that stands in a lead (a new start), after send(); null when none comes within 5 s
  const standingAfter = async (send) => {
    await page.evaluate(() => { window.got.engine.length = 0; });
    const answer = await send();
    const standing = await page.evaluate(async () => {
      for (let i = 0; i < 250; i++) { const s = window.got.engine.find((m) => m.standing); if (s) return s; await window.wait(20); }
      return null;
    });
    return { answer, standing };
  };
  // a restart in place: at bar 10 a new variant starts again at the bar that played (modulo the new loop), in a new lead; the shell remembered it
  const start10 = barStart(lanes, bpm, 10);
  const oldLanes = await lanesNow(), oldBpm = await page.evaluate(() => window.got.events.at(-1).bpm); // the song before the restart
  await seek(start10 + 0.5);
  await sleep(300);
  const { answer: restart, standing } = await standingAfter(() => act(A('newVariant', { variant: 77 })));
  const restartState = JSON.parse(restart.state.json);
  const restartLanes = await page.evaluate((n) => window.lanes(n), restart.state.events);
  const newLanes = JSON.parse(await page.evaluate(() => window.got.events.at(-1).json));
  const loop = restartState.loopBars;
  const startsAt = [10, 11].map((bar) => ({ bar: bar % loop, beats: barStart(newLanes, restartLanes?.bpm ?? bpm, bar % loop) }));
  const hit = standing && startsAt.find((s) => Math.abs(s.beats - standing.beats) < 1e-6);
  b.restart = { change: restart.state.change, loopBars: loop, standingBeats: standing?.beats ?? null, expected: startsAt, remembered: restartState.last?.bar ?? null };
  if (!restart.state.change.restart || !restart.state.change.inPlace || !hit) problems.push(`(b) restart in place: ${JSON.stringify(b.restart)}`);
  else if (restartState.last?.bar !== hit.bar) problems.push(`(b) restart in place: the shell did not remember the bar that played: ${JSON.stringify(b.restart)}`);
  lanes = newLanes;
  bpm = restartLanes?.bpm ?? bpm;
  // ... "with everything": the engine plays the new song: a layer the new song plays in a span where the old one has no note of it (4 s before, for
  // the tails) has a level there
  const plays = (events, layer, from, to) => events.some((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit') && e.t >= from && e.t < to);
  let tell = null;
  for (let beat = 0; beat < 400 && !tell; beat++) {
    const layer = ['drums', 'bass', 'chords', 'pad', 'lead'].find((l) => plays(newLanes, l, (beat * 60) / bpm + 0.3, (beat * 60) / bpm + 1.8)
      && !plays(oldLanes, l, (beat * 60) / oldBpm - 4, (beat * 60) / oldBpm + 2.5));
    if (layer) tell = { beat, layer };
  }
  const told = tell ? await pass(tell.beat, 1800) : null;
  b.restartEverything = { ...tell, peak: told && told[tell.layer] };
  if (!tell) problems.push('(b) restart with everything: no span where only the new song plays a layer');
  else if (!(told[tell.layer] > 0)) problems.push(`(b) restart with everything: the engine still plays the old song ${JSON.stringify(b.restartEverything)}`);

  // stop remembers the bar that plays; "Weitermachen" (not playing) plays from the bar it restored; again while playing it remembers first
  await sleep(1500);
  const position = await page.evaluate(() => JSON.parse(window.got.position.at(-1).json));
  const states = await page.evaluate(() => window.got.state.length);
  await page.evaluate(() => window.bridge('stop'));
  const stopped = await page.evaluate((n) => window.next('state', n, 5000), states);
  const stopState = stopped && JSON.parse(stopped.json);
  b.stop = { positionBar: position.bar, remembered: stopState?.last?.bar ?? null, change: stopped?.change ?? null };
  if (!stopState || !(stopState.last?.bar >= position.bar && stopState.last.bar <= position.bar + 1) || stopped.change) problems.push(`(b) stop: ${JSON.stringify(b.stop)}`);
  await sleep(500);
  const idle = await page.evaluate(async () => { const n = window.got.position.length; await window.wait(1500); return window.got.position.length - n; });
  const resumeFrom = async () => {
    const { answer, standing: s } = await standingAfter(() => act(A('resume')));
    return { answer, state: JSON.parse(answer.state.json), standing: s };
  };
  const resumed = await resumeFrom();
  const resumeBeats = barStart(lanes, bpm, resumed.state.resumed?.bar);
  b.resume = { change: resumed.state && resumed.answer.state.change, resumedBar: resumed.state.resumed?.bar ?? null, standingBeats: resumed.standing?.beats ?? null, expectedBeats: resumeBeats };
  if (!resumed.answer.state.change.restart || resumed.state.resumed?.bar !== stopState?.last?.bar || !(Math.abs((resumed.standing?.beats ?? -1) - resumeBeats) < 1e-6))
    problems.push(`(b) resume: ${JSON.stringify(b.resume)}`);
  await sleep(1000);
  await seek(barStart(lanes, bpm, 30) + 0.5); // another bar than the one the stop remembered
  await sleep(600);
  const playingBar = await page.evaluate(() => JSON.parse(window.got.position.at(-1).json).bar);
  const again = await resumeFrom();
  b.resumePlaying = { playingBar, remembered: again.state.last?.bar ?? null, resumedBar: again.state.resumed?.bar ?? null, standingBeats: again.standing?.beats ?? null };
  if (!(again.state.last?.bar >= playingBar && again.state.last.bar <= playingBar + 1) || again.state.resumed?.bar !== resumed.state.resumed?.bar || !again.standing)
    problems.push(`(b) resume while playing: ${JSON.stringify(b.resumePlaying)}`);

  // a restart without inPlace while playing (an own profile loaded at bar 10): from bar 1, beat 0
  await act(A('profileSelect', { key: 'session' }));
  await act(A('saveProfile', { name: 'Shell b', folder: null, parts: ['harmony', 'tempo', 'style'], id: 'shell-b' }));
  await seek(barStart(lanes, bpm, 10) + 0.5);
  await sleep(300);
  const { answer: loaded, standing: fromOne } = await standingAfter(() => act(A('loadProfile')));
  b.restartFromOne = { change: loaded.state.change, standingBeats: fromOne?.beats ?? null };
  if (!loaded.state.change.restart || loaded.state.change.inPlace || fromOne?.beats !== 0) problems.push(`(b) restart from bar 1: ${JSON.stringify(b.restartFromOne)}`);

  // meters other than 4/4: the change of meter restarts in place; then in 3/4 a new variant restarts in place, in 6/8 "Weitermachen" plays from the bar
  // it restored. Each start is measured where the engine stands (its own position) against the bar's start in the lanes it plays (the chord event's t)
  b.meters = {};
  const near = (x, y) => x !== null && y !== null && Math.abs(x - y) < 1e-4;
  for (const [meter, then] of [['3/4', 'restart'], ['6/8', 'resume']]) {
    const m = (b.meters[meter] = {});
    await seek(barStart(lanes, bpm, 6) + 0.5);
    await sleep(300);
    const from = await page.evaluate(() => JSON.parse(window.got.position.at(-1).json).bar);
    const changed = await standingAfter(() => act(A('setMeter', { meter })));
    const meterLanes = await page.evaluate((n) => window.lanes(n), changed.answer.state.events);
    lanes = await lanesNow();
    bpm = meterLanes?.bpm ?? bpm;
    let loopBars = JSON.parse(changed.answer.state.json).loopBars;
    const starts = (bars) => bars.map((bar) => barStart(lanes, bpm, bar % loopBars));
    m.change = { flags: changed.answer.state.change, from, standing: changed.standing?.beats ?? null, expected: starts([from, from + 1]) };
    if (!changed.answer.state.change.restart || !changed.answer.state.change.inPlace || !m.change.expected.some((x) => near(x, m.change.standing)))
      problems.push(`(b) ${meter}: the change of meter does not restart at its bar ${JSON.stringify(m.change)}`);
    await seek(barStart(lanes, bpm, 10) + 0.5);
    await sleep(400);
    if (then === 'restart') {
      const again3 = await standingAfter(() => act(A('newVariant', { variant: 33 })));
      const variantLanes = await page.evaluate((n) => window.lanes(n), again3.answer.state.events);
      lanes = await lanesNow();
      bpm = variantLanes?.bpm ?? bpm;
      loopBars = JSON.parse(again3.answer.state.json).loopBars;
      m.restart = { meter: JSON.parse(again3.answer.state.json).track.meter, standing: again3.standing?.beats ?? null, expected: starts([10, 11]) };
      if (!again3.answer.state.change.inPlace || !m.restart.expected.some((x) => near(x, m.restart.standing))) problems.push(`(b) ${meter}: a restart in place ${JSON.stringify(m.restart)}`);
    } else {
      const count = await page.evaluate(() => window.got.state.length);
      await page.evaluate(() => window.bridge('stop'));
      const halted = await page.evaluate((n) => window.next('state', n, 5000), count);
      const remembered = halted ? JSON.parse(halted.json).last?.bar ?? null : null;
      await sleep(400);
      const back = await resumeFrom();
      m.resume = { meter: back.state.track.meter, remembered, resumed: back.state.resumed?.bar ?? null, standing: back.standing?.beats ?? null,
        expected: back.state.resumed ? barStart(lanes, bpm, back.state.resumed.bar) : null };
      if (remembered === null || back.state.resumed?.bar !== remembered || !near(m.resume.standing, m.resume.expected)) problems.push(`(b) ${meter}: resume ${JSON.stringify(m.resume)}`);
    }
  }
  // the position only when its text changes: a few a second while playing (its beat changes), none while nothing plays
  const busy = await page.evaluate(async () => { await window.wait(500); const n = window.got.position.length; await window.wait(4000); return window.got.position.length - n; });
  b.position = { whilePlaying4s: busy, whileStopped1500ms: idle, bpm };
  if (!(busy > 0 && busy <= 4 * (bpm / 60 + 2)) || idle !== 0) problems.push(`(b) position: ${JSON.stringify(b.position)}`);

  // a drag: 60 actions of one control as fast as the bridge takes them, then `stop`, while the session's song plays. The bar, set before measuring
  // (the old page's check had it for its timbre bursts, before Task 32d): the stop's effect (the engine's first report that it does not play) and the answer of the
  // last action at most 1.0 s after the first send.
  const burst = (texts) => page.evaluate(async (list) => {
    const states = window.got.state.length;
    window.got.engine.length = 0;
    const t0 = performance.now();
    for (const json of list) window.bridge('action', { json });
    window.bridge('stop');
    const stopped = () => window.got.engine.find((m) => m.at > t0 && !m.playing);
    // the stop's own answer (it remembers the bar: a state without change) comes after the last action's; a dropped action has no answer of its own
    const stopAnswered = () => window.got.state.slice(states).some((s) => !s.change);
    for (let i = 0; i < 1500 && !(stopped() && stopAnswered()); i++) await window.wait(20);
    const answers = window.got.state.slice(states).filter((s) => s.change);
    return { answers: answers.length, lastAnswerMs: answers.length ? +(answers.at(-1).at - t0).toFixed(0) : null, stopMs: stopped() ? +(stopped().at - t0).toFixed(0) : null };
  }, texts);
  const fader = await burst(Array.from({ length: 60 }, (_, i) => A('setLevel', { channel: 'drums', value: 40 + i })));
  await act(A('setLevel', { channel: 'drums', value: 100 }));
  await page.evaluate(() => window.bridge('playSession'));
  await sleep(1500);
  const knob = await burst(Array.from({ length: 60 }, (_, i) => A('setTimbre', { group: 'master', field: 'width', value: 20 + i })));
  await act(A('resetTimbre', { group: 'master' }));
  // the expensive case: on string voices every timbre step makes the engine build the voices' tones anew. Bass and chords get string voices as a
  // user gets them, through a profile's voices (the page's menus hide them): imported, loaded, played; then 60 steps of the chords' brightness
  await act(A('profileSelect', { key: 'session' }));
  const strings = { format: 'backingtrack-profile', version: 2, name: 'Saiten', parts: { voices: { voices: { bass: { id: 'string', variant: 'finger' }, chords: { id: 'string', variant: 'electric' } } } } };
  await act(A('importProfile', { from: 'text', text: JSON.stringify(strings), ids: ['shell-strings'] }));
  const loadedStrings = await act(A('loadProfile'));
  const stringVoices = JSON.parse(loadedStrings.state.json).track.voices;
  const voicesBeforePlay = await page.evaluate(() => window.got.voices.length);
  await page.evaluate(() => window.bridge('playSession'));
  const stringsReady = await page.evaluate((n) => window.next('voices', n, 20000), voicesBeforePlay);
  await sleep(1500);
  // ... the string voices themselves (the bars of the old page's check, its string step, which sent them with the old `track` message): a pass of
  // 2.5 s at a beat where bass and chords each start a note gives both a level; the same pass with every layer effect at 100 (setTimbre on bass,
  // chords, pad and lead) keeps the engine's load at most 25 % with no dropout; then the effects back (resetTimbre). An `export` waits for the jobs
  // before it (the engine builds the string voices' tones anew for each step of the sound), so that the passes and the drag below start on an idle queue
  const settled = async () => {
    const n = await page.evaluate(() => window.got.export.length);
    await page.evaluate(() => window.bridge('export', { key: 'session', name: 'Warten' }));
    await page.evaluate((k) => window.next('export', k, 20000), n);
  };
  const stringBeat = busyBeat(await lanesNow(), await page.evaluate(() => window.got.events.at(-1).bpm), ['bass', 'chords']);
  const stringPlain = stringBeat === null ? null : await pass(stringBeat, 2500);
  const fxGroups = ['bass', 'chords', 'pad', 'lead'], fxTaken = [];
  for (const group of fxGroups) for (const field of ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']) if ((await act(A('setTimbre', { group, field, value: 100 }))).state?.change?.sound) fxTaken.push(`${group}.${field}`);
  await settled();
  const fxStart = await lastEngine();
  const stringFx = stringBeat === null ? null : await pass(stringBeat, 2500);
  const fxEnd = await lastEngine();
  for (const group of fxGroups) await act(A('resetTimbre', { group }));
  await settled();
  b.strings = { beat: stringBeat, plain: stringPlain && { bass: stringPlain.bass, chords: stringPlain.chords }, effectsTaken: fxTaken.length,
    withEffects: stringFx && { bass: stringFx.bass, chords: stringFx.chords }, load: +fxEnd.load.toFixed(3), dropouts: fxEnd.xruns - fxStart.xruns };
  if (stringBeat === null || !(stringPlain.bass > 0) || !(stringPlain.chords > 0)) problems.push(`(b) the string voices have no level: ${JSON.stringify(b.strings)}`);
  if (fxTaken.length !== 20 || !(b.strings.load <= 0.25) || b.strings.dropouts !== 0) problems.push(`(b) the string voices with every effect on: ${JSON.stringify(b.strings)} (load at most 0.25, no dropout)`);
  const stringKnob = await burst(Array.from({ length: 60 }, (_, i) => A('setTimbre', { group: 'chords', field: 'brightness', value: 20 + i })));
  const stringEnd = JSON.parse(await page.evaluate(() => window.got.state.filter((s) => s.change).at(-1).json)).track.timbre?.chords?.brightness ?? null;
  b.drag = { fader, knob, stringKnob: { ...stringKnob, voices: `${stringVoices.bass.id}/${stringVoices.bass.variant} ${stringVoices.chords.id}/${stringVoices.chords.variant}`,
    ready: stringsReady && `${stringsReady.bass} ${stringsReady.chords}`, endBrightness: stringEnd } };
  if (stringVoices.chords.id !== 'string' || stringVoices.bass.id !== 'string' || stringsReady?.chords !== 'ready' || stringEnd !== 0.79)
    problems.push(`(b) the string voices for the drag: ${JSON.stringify(b.drag.stringKnob)}`);
  // two knobs taken in turns (the chords' brightness and the stereo width, 30 steps each, alternating): neither is lost, both end values arrive
  await page.evaluate(() => window.bridge('playSession'));
  await sleep(1500);
  const turns = await burst(Array.from({ length: 60 }, (_, i) => (i % 2 ? A('setTimbre', { group: 'master', field: 'width', value: 20 + (i >> 1) })
    : A('setTimbre', { group: 'chords', field: 'brightness', value: 30 + (i >> 1) }))));
  const turnsEnd = JSON.parse(await page.evaluate(() => window.got.state.filter((s) => s.change).at(-1).json)).track.timbre;
  const twoKnobs = { ...turns, brightness: turnsEnd?.chords?.brightness ?? null, width: turnsEnd?.master?.width ?? null };
  if (twoKnobs.brightness !== 0.59 || twoKnobs.width !== 0.49) problems.push(`(b) two knobs in turns: an end value is lost ${JSON.stringify(twoKnobs)}`);
  for (const [what, m] of Object.entries(b.drag))
    if (!(m.stopMs !== null && m.stopMs <= 1000 && m.lastAnswerMs !== null && m.lastAnswerMs <= 1000)) problems.push(`(b) a ${what} drag of 60 actions: ${JSON.stringify(m)} (at most 1000 ms each)`);
  b.drag.twoKnobs = twoKnobs;
  await page.evaluate(() => window.bridge('stop'));
  await sleep(300);
  result.b = b;
  if (await page.evaluate(() => performance.timeOrigin) !== origin) pageLog.push({ ms: Date.now() - began, what: 'the page is another document than at the setup (it was loaded again)' });
} catch (error) {
  problems.push(`the check stopped at ${Date.now() - began} ms: ${error.message.split('\n')[0]}`);
} finally {
  result.page = pageLog.slice();
  const lost = pageLog.slice(setupDone);
  if (lost.length) problems.push(`the page after the setup: ${lost.map((e) => `${e.what} at ${e.ms} ms`).join('; ')}`);
  await browser?.close().catch(() => {});
  killed = true;
  const gone = new Promise((r) => { app.once('exit', r); setTimeout(r, 5000); });
  app.kill();
  await gone;
  // the folder holds the app's WebView2 profile too, which its browser may hold a moment after the app ended: retried, and never a failure of the check
  try { rmSync(work, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }); } catch (error) { console.error(`shell-check: could not remove ${work}: ${error.message}`); }
}
result.problems = [...new Set(problems)];
writeFileSync(join(out, 'shell-check.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.problems.length ? 1 : 0;
