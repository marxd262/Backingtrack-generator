// Checks the app's new page (native/app/ui, Task 32b: it draws what the session gives and sends actions) in the real app, in one step (after
// native/build.ps1 with the app):
//   node native/tools/page-check.mjs [app.exe]        (BTG_UI_NEW=1 node native/tools/ui-check.mjs runs this one)
// It starts the app with BTG_UI_NEW=1, muted (BTG_MUTE=1), on a storage folder of its own (BTG_STORAGE_DIR, removed afterwards, with the WebView2
// profile in it: the user's profiles and the pages' storage are never touched) and with the WebView2 debug port, attaches Playwright and records every
// error of the page's console, its failed requests, what the page sends and what the shell sends it.
// (b) The page plays and shows: the variant typed into the page's field (5, BTG_UI_VARIANT gives another) and the lead's job melody make the song;
//     the song (state and lanes) is the session's for these actions; "Los" plays it: every layer has a level where the lanes give it a note, the
//     position line and the lanes move, the position shows no bar before the engine's clock moves.
// (a) Each rebuilt control sends its action and shows the answer: one control of every rebuilt building block, operated as a user does (a click, a
//     select's choice, a knob's or fader's input event), then what the page shows is compared with the state the session gives for the same actions;
//     the language follows the app's strip. A drag of the drums' fader over 60 steps ends on its last value and never shows a value below one it showed.
// "Weitermachen" restores the remembered session, and every control that showed the hand in (a) now shows the restored values; "Los" clicked twice
// while it starts starts once; a start that fails keeps the start page with err.playFailed.
// Afterwards every action the page sent is played on btg_session (native/core/tools/session.cpp, after the app's own `start`): the state after each
// is the one the page got. Then the app starts once more on a folder where mix.json and session.json are folders (unreadable, and mix.json cannot
// be written): the lines at the mixer and at the box of the last session say so. Writes .superpowers/native-screens/page-check.json and prints it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import de from '../app/ui/i18n/de.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.argv[2] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const program = join(repo, 'native/build/core/Release/btg_session.exe');
const out = join(repo, '.superpowers/native-screens');
mkdirSync(out, { recursive: true });
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const VARIANT = Number(process.env.BTG_UI_VARIANT ?? 5);
const SIX = ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'];

const work = mkdtempSync(join(tmpdir(), 'btg-page-check-'));
const storage = join(work, 'storage');
mkdirSync(storage);
const problems = [];
const result = {};
let run = null; // { app, browser, page } of the app that runs

// The app on a storage folder (its WebView2 profile lies in it too: PluginEditor.cpp), attached, the page in German, everything the shell and the
// page send recorded from the start of the document, the page drawn from the answer to its sync
async function launch(folder) {
  const app = spawn(exe, [], { env: { ...process.env, BTG_UI_NEW: '1', BTG_MUTE: '1', BTG_STORAGE_DIR: folder, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
  run = { app, browser: null, page: null };
  for (let i = 0; !run.browser && i < 40; i++) {
    await sleep(500);
    run.browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
  }
  if (!run.browser) throw new Error('WebView2 debug port did not open');
  let page;
  for (let i = 0; !page && i < 40; i++) {
    page = run.browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('juce.backend'));
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no page from the resource provider');
  run.page = page;
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('backingtrack.lang', 'de')); // the checks read German labels
  // what the shell sends and what the page sends, recorded from the start of the document (an init script runs before the page's modules)
  await page.addInitScript(() => {
    const backend = window.__JUCE__.backend;
    window.got = { state: [], derived: [], tables: [], events: [], position: [], engine: [], voices: [] };
    for (const name of Object.keys(window.got)) {
      backend.addEventListener(name, (m) => {
        const list = window.got[name];
        if (name === 'events' && list.length) delete list.at(-1).json; // the newest lanes keep their text (about 1 MB)
        list.push({ ...m, at: performance.now() });
        if (list.length > 3000) list.splice(0, 1500);
      });
    }
    window.sent = [];
    const emit = backend.emitEvent.bind(backend);
    backend.emitEvent = (name, data) => {
      window.sent.push({ ...data, at: performance.now() });
      // a start that fails (see below): held back, and answered as the shell answers a failed start
      if (window.failStart && data.type === 'playSession') {
        setTimeout(() => backend.emitByBackend('engine', JSON.stringify({ ...window.lastEngine(), run: data.seq, playing: false, standing: false, error: 'page-check: a start that fails' })), 50);
        return;
      }
      emit(name, data);
    };
    window.bridge = (type, data = {}) => emit('btg', { type, ...data });
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.lastEngine = () => window.got.engine.at(-1);
    // the answer to the last action the page sent: its state event (the seq it names covers the action) and the lanes it names, at most 15 s each
    window.answered = async () => {
      const seq = window.sent.findLast((s) => s.type === 'action')?.seq ?? 0;
      for (let i = 0; i < 750 && !window.got.state.some((s) => s.seq >= seq); i++) await window.wait(20);
      const state = window.got.state.find((s) => s.seq >= seq) ?? null;
      for (let i = 0; i < 750 && state && !window.got.events.some((e) => e.number === state.events); i++) await window.wait(20);
      await window.wait(30); // the page draws on the events; a few ms for what comes behind them
      return state;
    };
  });
  await page.reload();
  await page.waitForFunction(() => document.getElementById('variant').value !== '', null, { timeout: 15000 });
  return page;
}
// The app ends; its folder is removed at the end of the check
async function quit() {
  if (!run) return;
  await run.browser?.close().catch(() => {});
  const gone = new Promise((r) => { run.app.once('exit', r); setTimeout(r, 5000); });
  run.app.kill();
  await gone;
  run = null;
}

try {
  const page = await launch(storage);
  const url = page.url();
  if (!url.includes('/app/index.html')) problems.push(`the app shows ${url}, not its new page`);
  const startVariant = Number(await page.locator('#variant').inputValue()); // the app's own start
  result.page = { url, startVariant };
  await page.screenshot({ path: join(out, 'page-1-start.png') });

  // ---------- (b) the page plays and shows ----------
  const setValue = (selector, value, events = ['input', 'change']) => page.evaluate(([s, v, list]) => {
    const el = document.querySelector(s);
    el.value = v;
    for (const e of list) el.dispatchEvent(new Event(e, { bubbles: true }));
  }, [selector, String(value), events]);
  const answered = () => page.evaluate(() => window.answered());
  await setValue('#variant', VARIANT);
  await answered();
  await setValue('#job-lead', 'melody', ['change']); // the lead's default job plays nothing: a melody, as the user chooses it
  await answered();
  const song = await page.evaluate(() => ({ state: window.got.state.at(-1).json, lanes: window.got.events.at(-1) }));
  const songState = JSON.parse(song.state);
  result.song = { variant: songState.track.seed, bpm: songState.track.bpm, lanes: song.lanes?.number, sent: await page.evaluate(() => window.sent.filter((s) => s.type === 'action').map((s) => s.json)) };
  if (songState.track.seed !== VARIANT) problems.push(`(b) the page's song is variant ${songState.track.seed}, not the ${VARIANT} typed into its field`);
  const lanes = JSON.parse(song.lanes.json), lanesBpm = song.lanes.bpm;

  // "Los": the lead (the clock stands 0.15 s after a start) shows no bar before the clock moves; the play page shows
  await page.evaluate(() => {
    window.posShown = [];
    const field = document.getElementById('play-position');
    new MutationObserver(() => window.posShown.push({ at: performance.now(), text: field.textContent })).observe(field, { subtree: true, childList: true, characterData: true });
  });
  const clickedAt = await page.evaluate(() => performance.now());
  await page.locator('#go').click();
  await sleep(1500);
  result.lead = await page.evaluate((from) => {
    const shown = window.posShown.find((m) => m.at > from && /\d/.test(m.text));
    const moved = window.got.engine.find((m) => m.at > from && m.playing && !m.standing && m.beats > 1e-6);
    return { sent: window.sent.some((s) => s.type === 'playSession' && s.at > from), shownAt: shown && +shown.at.toFixed(1), clockMovedAt: moved && +moved.at.toFixed(1),
      shownBeforeClockMovedMs: shown && moved ? +(moved.at - shown.at).toFixed(1) : null, playPage: !document.getElementById('play').hidden };
  }, clickedAt);
  if (!result.lead.sent || !result.lead.playPage) problems.push(`(b) "Los" did not send playSession or show the play page: ${JSON.stringify(result.lead)}`);
  if (result.lead.shownBeforeClockMovedMs === null) problems.push(`(b) lead: the position never showed or the clock never moved: ${JSON.stringify(result.lead)}`);
  else if (result.lead.shownBeforeClockMovedMs > 10) problems.push(`(b) lead: the page showed its position ${result.lead.shownBeforeClockMovedMs} ms before the engine's clock moved`);
  result.voices = await page.evaluate(() => window.got.voices.at(-1) ?? null);
  if (!SIX.every((l) => result.voices?.[l] === 'ready')) problems.push(`(b) voices after the start: ${JSON.stringify(result.voices)}`);

  // the position line and the lanes move: over 6 s the line shows more than one bar, counting up, and the lanes' picture changes; the layers'
  // lights flash with their notes and hits (.hit, .sound) and the beat LED with the beats
  result.moves = await page.evaluate(async () => {
    const canvas = document.getElementById('lanes');
    const texts = [document.getElementById('play-position').textContent], pictures = [canvas.toDataURL()], countdown = new Set();
    const lit = new Set();
    const watch = new MutationObserver((list) => { for (const m of list) if (/\b(hit|sound)\b/.test(m.target.className)) lit.add(m.target.dataset.layer ?? m.target.dataset.activity ?? m.target.id); });
    for (const el of document.querySelectorAll('#lane-buttons [data-layer], #beat-led')) watch.observe(el, { attributes: true, attributeFilter: ['class'] });
    for (let i = 0; i < 12; i++) {
      await window.wait(500);
      texts.push(document.getElementById('play-position').textContent);
      pictures.push(canvas.toDataURL());
      countdown.add(document.getElementById('play-countdown').textContent);
    }
    watch.disconnect();
    const bars = texts.map((s) => Number(/\d+/.exec(s)?.[0] ?? NaN));
    return { texts: [...new Set(texts)], bars, pictures: new Set(pictures).size, countdown: [...countdown], lit: [...lit], ledsOn: [...document.querySelectorAll('#lane-buttons .on')].map((b) => b.dataset.layer) };
  });
  const bars = result.moves.bars;
  if (!(result.moves.texts.length >= 2 && bars.every((b, i) => Number.isFinite(b) && (i === 0 || b >= bars[i - 1])))) problems.push(`(b) the position line does not count the bars: ${JSON.stringify(result.moves.texts)}`);
  if (!result.moves.countdown.some((c) => /\d/.test(c))) problems.push(`(b) the countdown shows nothing while playing: ${JSON.stringify(result.moves.countdown)}`);
  if (!(result.moves.pictures >= 2)) problems.push('(b) the lanes do not move');
  if (!['beat-led', 'drums', 'bass'].every((l) => result.moves.lit.includes(l))) problems.push(`(b) the lights do not flash with the beats and the notes: ${JSON.stringify(result.moves.lit)}`);
  delete result.moves.bars;

  // every layer: switched on with its mute key, seek to its first note or hit in the lanes the page has, then its level over 2.5 s (as ui-check.mjs
  // measures the old page)
  for (const layer of await page.evaluate(() => [...document.querySelectorAll('button[data-mute][aria-pressed="true"]')].map((b) => b.dataset.mute))) {
    await page.evaluate((l) => document.querySelector(`button[data-mute="${l}"]`).click(), layer);
    await answered();
  }
  result.everyLayer = {};
  for (const layer of SIX) {
    const first = lanes.find((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit'));
    if (!first) { problems.push(`(b) ${layer}: the lanes have no note or hit for it`); continue; }
    const beat = (first.t * lanesBpm) / 60;
    const peak = await page.evaluate(async ([b, l]) => {
      const from = performance.now();
      window.bridge('seek', { beats: Math.max(0, b - 0.5) });
      await window.wait(2500);
      return +Math.max(0, ...window.got.engine.filter((m) => m.at >= from).map((m) => m.peaks?.[l] ?? 0)).toFixed(3);
    }, [beat, layer]);
    result.everyLayer[layer] = { firstBeat: +beat.toFixed(2), peak };
    if (!(peak > 0)) problems.push(`(b) ${layer}: no level where the lanes give it its first note`);
  }
  await page.screenshot({ path: join(out, 'page-2-play.png') });
  // stop: the shell remembers the bar (a state without flags), the page shows "Los" again
  const statesBefore = await page.evaluate(() => window.got.state.length);
  const stopAt = await page.evaluate(() => window.sent.filter((s) => s.type === 'action').length); // the actions before the stop
  await page.locator('#play-go').click();
  await page.waitForFunction((n) => window.got.state.length > n, statesBefore, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const stopped = await page.evaluate((n) => ({ state: window.got.state[n]?.json ?? null, change: window.got.state[n]?.change ?? null, go: document.getElementById('play-go').textContent, playing: window.lastEngine().playing }), statesBefore);
  const remembered = stopped.state && JSON.parse(stopped.state).last;
  result.stop = { remembered, go: stopped.go, playing: stopped.playing };
  if (!remembered || stopped.change || stopped.playing || stopped.go !== 'Los') problems.push(`(b) stop: ${JSON.stringify(result.stop)}`);

  // ---------- (a) each rebuilt control sends its action and shows the answer ----------
  await page.locator('#mode-switch').click(); // the rack
  await sleep(300);
  const tables = JSON.parse(await page.evaluate(() => window.got.tables.at(-1).json));
  const tag = tables.TAG_CATEGORIES[0];
  const steps = [
    // [name, how the user operates it, what the page shows afterwards (in the page), what the session's texts say it must show: (state, derived)]
    ['root', () => setValue('#key-select', 'D', ['change']), () => page.evaluate(() => [document.getElementById('key-select').value, document.getElementById('play-key').textContent]),
      (s) => [s.track.key.root, `${s.track.key.root}${s.track.key.mode === 'minor' ? 'm' : ''}`]],
    ['scale', () => setValue('#scale-select', 'dorian', ['change']), () => page.evaluate(() => document.getElementById('scale-select').value), (s) => s.scale],
    ['tempo', () => setValue('#tuning-tempo', 104, ['input']), () => page.evaluate(() => document.getElementById('tuning-tempo-out').textContent), (s) => `${s.track.bpm} bpm`],
    ['tag', () => page.evaluate(([c, w]) => document.querySelector(`#tags button[data-category="${c}"][data-tag="${w}"]`).click(), [tag.id, tag.tags[0]]),
      () => page.evaluate(([c, w]) => document.querySelector(`#tags button[data-category="${c}"][data-tag="${w}"]`).getAttribute('aria-pressed'), [tag.id, tag.tags[0]]),
      (s) => String((s.track.tags[tag.id] ?? []).includes(tag.tags[0]))],
    ['chord colour', () => page.evaluate((c) => document.querySelector(`#chord-color [data-color="${c}"]`).click(), tables.CHORD_COLORS[2]),
      () => page.evaluate(() => [...document.querySelectorAll('#chord-color [aria-pressed="true"]')].map((b) => b.dataset.color)), (s) => [s.chordColor]],
    ['fader', () => setValue('#mix-bass', 60, ['input']), () => page.evaluate(() => [document.getElementById('mix-bass').value, document.getElementById('mix-bass').closest('.mix-ch').querySelector('output').textContent]),
      (s) => [String(Math.round(s.mix.bass * 100)), `${Math.round(s.mix.bass * 100)} %`]],
    ['pan', () => setValue('#pan-bass', -30, ['input']), () => page.evaluate(() => document.getElementById('pan-bass').value), (s) => String(Math.round(s.pan.bass * 100))],
    ['mute', () => page.evaluate(() => document.querySelector('button[data-mute="pad"]').click()),
      () => page.evaluate(() => [document.querySelector('button[data-mute="pad"]').getAttribute('aria-pressed'), document.querySelector('#lane-buttons [data-layer="pad"]').dataset.muted]),
      (s) => [String(!s.track.layers.pad), String(!s.track.layers.pad)]],
    ['rhythm knob', () => setValue('#complexity', 70, ['input']), () => page.evaluate(() => [document.getElementById('complexity').value, document.getElementById('complexity-out').textContent]),
      // the 50 % while the field is missing is the page's shortcut (rhythm.js), not a text of the session
      (s) => [String(Math.round((s.track.complexity ?? 0.5) * 100)), `${Math.round((s.track.complexity ?? 0.5) * 100)} %`]],
    ['groove', () => page.evaluate(() => { const g = document.getElementById('groove-select'); g.value = g.options[g.options.length - 1].value; g.dispatchEvent(new Event('change', { bubbles: true })); }),
      () => page.evaluate(() => document.getElementById('groove-select').value), (s, d) => d.groove],
    ['timbre knob', () => setValue('#timbre-master-width', 70, ['input']), () => page.evaluate(() => document.getElementById('timbre-master-width').value),
      (s, d) => String(Math.round(d.timbre.master.width * 100))],
    ['voice', () => setValue('#voice-chords', 'organ/jazz', ['change']), () => page.evaluate(() => [document.getElementById('voice-chords').value, document.getElementById('organ-leslie').closest('.knob-cell').hidden]),
      (s, d) => [`${d.voices.chords.id}/${d.voices.chords.variant}`, d.voices.chords.id !== 'organ']],
    ['job', () => setValue('#job-percussion', tables.jobsFor.percussion.at(-1), ['change']), () => page.evaluate(() => document.getElementById('job-percussion').value), (s, d) => d.jobs.percussion],
    ['organ', () => setValue('#organ-leslie', 3, ['input']), () => page.evaluate(() => document.getElementById('organ-leslie').value), (s) => String(tables.LESLIE_MODES.indexOf(s.organ.leslie))],
  ];
  const derivedNow = async () => JSON.parse(await page.evaluate(() => window.got.derived.at(-1).json)); // the derived text the shell sent last (before its state)
  result.controls = {};
  for (const [name, operate, shown, wanted] of steps) {
    const before = await page.evaluate(() => window.sent.filter((s) => s.type === 'action').length);
    await operate();
    const state = await answered();
    const sent = await page.evaluate((n) => window.sent.filter((s) => s.type === 'action').slice(n).map((s) => JSON.parse(s.json)), before);
    const shows = await shown();
    const want = state && wanted(JSON.parse(state.json), await derivedNow());
    result.controls[name] = { sent, shows };
    if (sent.length !== 1) problems.push(`(a) ${name}: the page sent ${sent.length} actions`);
    else if (!state) problems.push(`(a) ${name}: no answer`);
    else if (JSON.stringify(shows) !== JSON.stringify(want)) problems.push(`(a) ${name}: the page shows ${JSON.stringify(shows)}, the session's state says ${JSON.stringify(want)}`);
  }
  // the language: the app's strip sends it, the page follows and remembers it
  result.language = await page.evaluate(async () => {
    const say = async (lang) => { window.__JUCE__.backend.emitByBackend('language', JSON.stringify(lang)); await window.wait(300); return `${document.documentElement.lang}: ${document.title}`; };
    return { en: await say('en'), de: await say('de'), stored: localStorage.getItem('backingtrack.lang'), chipsShown: document.querySelector('.lang').checkVisibility(), told: window.sent.filter((s) => s.type === 'language').map((s) => s.lang) };
  });
  if (!result.language.en.startsWith('en: Backing track') || !result.language.de.startsWith('de: ') || result.language.stored !== 'de' || result.language.chipsShown || result.language.told.at(-1) !== 'de')
    problems.push(`(a) the page does not follow the language of the app: ${JSON.stringify(result.language)}`);
  // a drag of the drums' fader: 60 steps as fast as the page takes them; every value the fader and its text show on the way, sampled each frame and on every change
  result.drag = await page.evaluate(async () => {
    const fader = document.getElementById('mix-drums'), text = fader.closest('.mix-ch').querySelector('output');
    const seen = [];
    const look = () => seen.push(Number(fader.value), Number(/\d+/.exec(text.textContent)?.[0] ?? NaN));
    const watch = new MutationObserver(look);
    watch.observe(text, { subtree: true, childList: true, characterData: true });
    let sampling = true;
    const frame = () => { look(); if (sampling) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const listen = (m) => { if (typeof m.seq === 'number') look(); };
    window.__JUCE__.backend.addEventListener('state', listen);
    for (let i = 0; i < 60; i++) {
      fader.value = String(40 + i);
      fader.dispatchEvent(new Event('input', { bubbles: true }));
      look();
      await window.wait(4);
    }
    const answer = await window.answered();
    await window.wait(300);
    look();
    sampling = false;
    watch.disconnect();
    window.__JUCE__.backend.removeEventListener('state', listen);
    const back = seen.findIndex((v, i) => i > 0 && v < Math.max(...seen.slice(0, i)));
    return { shownEnd: [Number(fader.value), text.textContent], state: answer && JSON.parse(answer.json).mix.drums, samples: seen.length, firstJumpBack: back < 0 ? null : seen.slice(Math.max(0, back - 3), back + 2) };
  });
  if (result.drag.shownEnd[0] !== 99 || result.drag.shownEnd[1] !== '99 %' || result.drag.state !== 0.99 || result.drag.firstJumpBack)
    problems.push(`(a) the fader drag of 60 steps: ${JSON.stringify(result.drag)}`);
  await page.screenshot({ path: join(out, 'page-3-rack.png') });

  // "Zuletzt gespielt" on the start page: the bar the stop remembered; "Weitermachen" restores it and plays from there on the play page.
  // (After the comparison below: the shell sets the action's `playing`.)
  const resumeAt = await page.evaluate(() => window.sent.filter((s) => s.type === 'action').length);
  await page.locator('#play-back').click();
  result.resume = await page.evaluate(async () => ({ box: !document.getElementById('last').hidden, summary: document.getElementById('last-summary').textContent }));
  await page.locator('#resume').click();
  const resumed = await answered();
  await sleep(1500);
  Object.assign(result.resume, await page.evaluate(() => ({ playPage: !document.getElementById('play').hidden, playing: window.lastEngine().playing, position: document.getElementById('play-position').textContent })),
    { resumed: resumed && JSON.parse(resumed.json).resumed });
  if (!result.resume.box || !result.resume.summary.includes(`Takt ${remembered?.bar + 1}`) || result.resume.resumed?.bar !== remembered?.bar || !result.resume.playPage || !result.resume.playing
    || !result.resume.position.startsWith(`Takt ${remembered?.bar + 1} `)) problems.push(`(b) "Weitermachen": ${JSON.stringify(result.resume)}`);
  // ... and every control that showed the hand in (a) now shows the restored session (a hold that is never let go keeps the values of (a));
  // the five named first must differ from (a), or this proves nothing
  if (resumed) {
    const state = JSON.parse(resumed.json), derived = await derivedNow();
    result.resume.controls = {};
    for (const [name, , shown, wanted] of steps.filter(([n]) => ['root', 'scale', 'tempo', 'rhythm knob', 'job', 'fader', 'pan', 'groove', 'timbre knob', 'voice', 'organ'].includes(n))) {
      const shows = await shown(), want = wanted(state, derived);
      result.resume.controls[name] = shows;
      if (['root', 'scale', 'tempo', 'rhythm knob', 'job'].includes(name) && JSON.stringify(want) === JSON.stringify(result.controls[name].shows))
        problems.push(`(b) "Weitermachen" restores ${name} to what (a) set (${JSON.stringify(want)}): the step cannot tell a hold that is never let go`);
      if (JSON.stringify(shows) !== JSON.stringify(want)) problems.push(`(b) after "Weitermachen" ${name} shows ${JSON.stringify(shows)}, the restored session says ${JSON.stringify(want)}`);
    }
  }
  await page.locator('#play-go').click();
  await page.waitForFunction(() => !window.lastEngine().playing, null, { timeout: 5000 }).catch(() => {});

  // "Los" as the web app's start() (src/ui/app.js): a second click while the start is under way does nothing; a start that fails keeps the start page
  // and shows err.playFailed. No start of the session's song fails in the shell today without a change of native/core (a pack that cannot be read
  // is a voice's status, not a failure), so the failure is the event alone: the page's playSession is held back and the shell's report of that
  // start (an engine report whose `run` is the start's number, not playing, with the error) is sent to the page.
  await page.locator('#play-back').click();
  const failed = await page.evaluate(async () => {
    window.failStart = true;
    document.getElementById('go').click();
    const seq = window.sent.findLast((s) => s.type === 'playSession')?.seq;
    for (let i = 0; i < 100 && !window.got.engine.some((m) => m.run === seq); i++) await window.wait(20);
    await window.wait(300);
    window.failStart = false;
    return { startPage: !document.getElementById('start').hidden, message: document.getElementById('message').textContent, go: document.getElementById('go').textContent, playing: window.lastEngine().playing };
  });
  result.failedStart = failed;
  if (!failed.startPage || failed.message !== 'Die Wiedergabe konnte nicht starten.' || failed.go !== 'Los' || failed.playing) problems.push(`(b) a start that fails: ${JSON.stringify(failed)}`);
  const twice = await page.evaluate(async () => {
    const from = window.sent.length, go = document.getElementById('go');
    go.click();
    go.click(); // before the engine reports the start
    for (let i = 0; i < 150 && !window.lastEngine().playing; i++) await window.wait(20);
    await window.wait(500);
    return { starts: window.sent.slice(from).filter((s) => s.type === 'playSession').length, stops: window.sent.slice(from).filter((s) => s.type === 'stop').length,
      playing: window.lastEngine().playing, playPage: !document.getElementById('play').hidden, message: document.getElementById('message').textContent };
  });
  result.secondClick = twice;
  if (twice.starts !== 1 || twice.stops !== 0 || !twice.playing || !twice.playPage || twice.message !== '') problems.push(`(b) "Los" clicked twice while it starts: ${JSON.stringify(twice)}`);
  await page.locator('#play-go').click();

  // ---------- every action the page sent, played on the session after the app's own start ----------
  const sentList = await page.evaluate((n) => window.sent.filter((s) => s.type === 'action').slice(0, n).map((s) => ({ json: s.json, seq: s.seq })), resumeAt);
  const states = await page.evaluate(() => window.got.state.filter((s) => typeof s.seq === 'number').map((s) => ({ seq: s.seq, json: s.json })));
  const lanesGot = await page.evaluate(() => window.got.events.map((e) => ({ number: e.number, bpm: e.bpm })));
  // the steps: the app's start, the actions in order; after the stop, the bar and time the shell remembered (rememberSession, PROTOKOLL.md section 7)
  const program_steps = [JSON.stringify({ action: 'start', variant: startVariant }), ...sentList.slice(0, stopAt).map((s) => s.json),
    JSON.stringify({ action: 'rememberSession', bar: remembered?.bar ?? 0, at: remembered?.at ?? 0 }), ...sentList.slice(stopAt).map((s) => s.json)];
  writeFileSync(join(work, 'steps.json'), JSON.stringify(program_steps));
  const ran = spawnSync(program, [join(work, 'steps.json'), join(work, 'expected.json')], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(`btg_session failed: ${ran.stdout}${ran.stderr}${ran.error ?? ''}`);
  const expected = JSON.parse(readFileSync(join(work, 'expected.json'), 'utf8'));
  const at = (i) => (i < stopAt ? i + 1 : i + 2); // the record of sent action i in the program's list
  let same = 0;
  for (let i = 0; i < sentList.length; i++) {
    const got = states.find((s) => s.seq === sentList[i].seq); // a dropped step has no answer of its own (none of these is a knob's step with a key)
    if (!got) { problems.push(`no answer to ${sentList[i].json}`); continue; }
    if (got.json !== expected[at(i)].state) problems.push(`the state after ${sentList[i].json} is not the session's`);
    else same++;
  }
  // the song of (b): the lanes the page drew are the session's for the variant typed and the job
  const songLanes = [...expected.slice(0, result.song.sent.length + 1)].reverse().find((r) => r.events !== undefined)?.events;
  if (!songLanes || fnv(songLanes) !== fnv(song.lanes.json)) problems.push("(b) the lanes the page drew are not the session's for the variant typed into its field");
  result.session = { actions: sentList.length, sameState: same, lanes: lanesGot.length };

  // ---------- the storage's problems (PROTOKOLL.md section 3a): a line at the box of the last session and one at the mixer ----------
  // A second start of the app on a folder where mix.json and session.json are folders: neither can be read, and mix.json cannot be written.
  await quit();
  const broken = join(work, 'broken');
  for (const name of ['mix.json', 'session.json']) mkdirSync(join(broken, name), { recursive: true });
  const second = await launch(broken);
  const lines = () => second.evaluate(() => {
    const line = (id) => (document.getElementById(id).hidden ? null : document.getElementById(id).textContent);
    return { storage: JSON.parse(window.got.state.at(-1).json).storage, box: !document.getElementById('last').hidden, session: line('last-storage'), mix: line('mix-storage') };
  });
  const atStart = await lines();
  await second.evaluate(() => { const fader = document.getElementById('mix-drums'); fader.value = '50'; fader.dispatchEvent(new Event('input', { bubbles: true })); });
  await second.evaluate(() => window.answered());
  const afterWrite = await lines();
  result.storage = { atStart, afterWrite };
  await second.screenshot({ path: join(out, 'page-4-storage-start.png') });
  await second.locator('#tune-btn').click(); // the play page with the rack
  await second.locator('#mix-storage').scrollIntoViewIfNeeded();
  await second.screenshot({ path: join(out, 'page-5-storage-mixer.png') });
  const text = (key) => de[key] ?? `(no text ${key})`;
  if (atStart.storage.session !== 'unreadable' || atStart.box || atStart.session !== text('ui.storage.session.unreadable'))
    problems.push(`storage: an unreadable session.json is not told at the box of the last session: ${JSON.stringify(atStart)}`);
  if (atStart.storage.mix !== 'unreadable' || atStart.mix !== text('ui.storage.mix.unreadable')) problems.push(`storage: an unreadable mix.json is not told at the mixer: ${JSON.stringify(atStart)}`);
  if (afterWrite.storage.mix !== 'notStored' || afterWrite.mix !== text('ui.storage.mix.notStored')) problems.push(`storage: a mix.json that cannot be written is not told at the mixer: ${JSON.stringify(afterWrite)}`);
} catch (error) {
  problems.push(`the check stopped: ${error.message.split('\n')[0]}`);
} finally {
  await quit();
  // the folder holds the app's WebView2 profile too, which its browser may hold a moment after the app ended: retried, and never a failure of the check
  try { rmSync(work, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }); } catch (error) { console.error(`page-check: could not remove ${work}: ${error.message}`); }
}
result.problems = [...new Set(problems)];
writeFileSync(join(out, 'page-check.json'), JSON.stringify(result, null, 2));
process.exitCode = result.problems.length ? 1 : 0;
await new Promise((done) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, done)); // written out before ui-check.mjs ends the process
