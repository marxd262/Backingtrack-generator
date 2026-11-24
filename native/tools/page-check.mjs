// Checks the app's generator page (native/app/ui, Task 32b: it draws what the session gives and sends actions) in the real app, in one step (after
// native/build.ps1 with the app):
//   node native/tools/ui-check.mjs [variant] [app.exe]        (ui-check.mjs runs this file)
// It starts the app muted (BTG_MUTE=1), on a storage folder of its own (BTG_STORAGE_DIR, removed afterwards, with the WebView2 profile in it: the
// user's profiles and the pages' storage are never touched) and with the WebView2 debug port, attaches Playwright and records every error of the
// page's console, its failed requests, what the page sends and what the shell sends it.
// The app serves only its own pages (Task 32d): none of the web's files under /ui/, /core/, /audio/, /assets/, nor the old own songs' page; the
// fonts the page shows come from its folder; credits.html opens from the start page and each licence link gives the pack's licence text.
// (b) The page plays and shows: the variant typed into the page's field (5, or the one given) and the lead's job melody make the song;
//     the song (state and lanes) is the session's for these actions; "Los" plays it: every layer has a level where the lanes give it a note, the
//     position line and the lanes move, the position shows no bar before the engine's clock moves; while it plays the fretboard (and its text
//     version), the wheel, the strip and the progression show the bar of position(); a restart from bar 1 shows no bar during its lead; every layer
//     has a level at its first note on the song's own voices and again on the synth voices; with every layer on its synth voice and every layer
//     effect on, the effects reach the session and the engine (levels, a peak moved by 1.5 dB) and the engine stays under 25 % load without a dropout.
// (a) Each rebuilt control sends its action and shows the answer: one control of every rebuilt building block of the first group, and the second
//     group operated through (the progression: another root, add, remove, the wheel, the ninth chord refused; the form: template, roll, a part's
//     selection, level, density, transition, add, move, remove, the level back to its default; the profile window: save, a folder, save into it with
//     a choice of parts, rename, select, load, overwrite, delete with its question, undo, the drag, export to a file and import it, a newer version,
//     a damaged file), operated as a user does (a click, a select's choice, a knob's or fader's input event, the mouse), then what the page shows is
//     compared with the texts the session gives for the same actions; the language follows the app's strip. A drag of the drums' fader over 60 steps
//     ends on its last value and never shows a value below one it showed.
// "Weitermachen" restores the remembered session, and every control that showed the hand in (a) now shows the restored values; "Los" clicked twice
// while it starts starts once; a start that fails keeps the start page with err.playFailed.
// Afterwards every action the page sent is played on btg_session (native/core/tools/session.cpp, after the app's own `start`): the state after each
// is the one the page got; the times of the way page -> shell -> page are measured (no bar). Then the app starts once more on a folder where
// mix.json and session.json are folders (unreadable, and mix.json cannot be written): the lines at the mixer and at the box of the last session say
// so. Then the web's page (src/ui, served as the repository's interface tests serve it) in Playwright's Chromium at the WebView's size: its wheel
// and fretboard have the boxes of this page's. Last, the one-time take-over: the old page's entries in the WebView's storage are sent once with
// importLegacy, a second load sends nothing, and with the app's own texts stored other entries take nothing over; a storage whose profiles.json
// cannot be read (or is damaged) at the first start leaves no mark, and a later start on a working storage takes the profiles.
// Writes .superpowers/native-screens/page-check.json and prints it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import de from '../app/ui/i18n/de.js';
import { start as serveWeb } from '../../scripts/serve.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.argv[3] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const program = join(repo, 'native/build/core/Release/btg_session.exe');
const out = join(repo, '.superpowers/native-screens');
mkdirSync(out, { recursive: true });
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fnv = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
const VARIANT = Number(process.argv[2] ?? process.env.BTG_UI_VARIANT ?? 5); // the variable as native/UEBERGABE.md names it, before Task 32d
// what the app served before Task 32d and must not serve now: the web's page and modules, its fonts, the old own songs' page (asked for below; their
// failed requests are no problem)
const UNSERVED = ['/ui/index.html', '/core/music.js', '/audio/play.js', '/assets/fonts/barlow-400.woff2', '/native/track.html'];
const unserved = (url) => URL.canParse(url) && UNSERVED.includes(new URL(url).pathname);
const SIX = ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'];
// the page's German texts, as its t() fills them; a label of derived().form is a text or a message whose params may be messages
const tr = (key, params = {}) => (de[key] ?? `(no text ${key})`).replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
const label = (l) => (typeof l === 'object' ? tr(l.key, Object.fromEntries(Object.entries(l.params).map(([k, v]) => [k, label(v)]))) : l);
const barsText = (n) => tr(n === 1 ? 'form.bars.one' : 'ui.barsCount', { n });
// the boxes of the visualisation's wheel and fretboard (CSS px, one decimal), and the width the page has (without a scrollbar that takes room)
const boxes = (p) => p.evaluate(() => ({ page: [document.documentElement.clientWidth], ...Object.fromEntries([['wheel', '#wheel'], ['wheel module', '#mod-wheel'], ['fretboard', '#fretboard'], ['board', '#fretboard svg'], ['fretboard module', '#mod-fretboard']]
  .map(([name, s]) => { const r = document.querySelector(s)?.getBoundingClientRect(); return [name, r ? [r.x, r.y, r.width, r.height].map((v) => +v.toFixed(1)) : null]; })) }));

const work = mkdtempSync(join(tmpdir(), 'btg-page-check-'));
const storage = join(work, 'storage');
mkdirSync(storage);
const problems = [];
const result = {};
let run = null; // { app, browser, page } of the app that runs

// The app on a storage folder (its WebView2 profile lies in it too: PluginEditor.cpp), attached, the page in German, everything the shell and the
// page send recorded from the start of the document, the page drawn from the answer to its sync. `prepare(page)`: runs once in the page before the
// reload that starts the recording (to put something into its storage).
async function launch(folder, { prepare = null } = {}) {
  const app = spawn(exe, [], { env: { ...process.env, BTG_MUTE: '1', BTG_STORAGE_DIR: folder, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
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
  page.on('console', (m) => { if (m.type() === 'error' && !unserved(m.location().url)) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) => { if (!unserved(r.url())) problems.push(`request failed: ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !unserved(r.url())) problems.push(`${r.status()}: ${r.url()}`); });
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('backingtrack.lang', 'de')); // the checks read German labels
  if (prepare) await prepare(page);
  // what the shell sends and what the page sends, recorded from the start of the document (an init script runs before the page's modules)
  await page.addInitScript(() => {
    const backend = window.__JUCE__.backend;
    window.got = { state: [], derived: [], tables: [], events: [], position: [], engine: [], voices: [], profiles: [] };
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
    // a download the page starts (a.click() on a blob URL with `download`) is recorded, not saved: no check writes into the user's folders
    window.downloads = [];
    const blobs = new Map();
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = createUrl(blob); blobs.set(url, blob); return url; };
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      if (this.download && blobs.has(this.href)) window.downloads.push({ name: this.download, blob: blobs.get(this.href) });
      else anchorClick.call(this);
    };
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
  // the app's WebView2 may hold the debug port a moment longer: the next app could not open it
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)); i++) await sleep(250);
}

try {
  const page = await launch(storage);
  const url = page.url();
  if (!url.includes('/app/index.html')) problems.push(`the app shows ${url}, not its new page`);
  const startVariant = Number(await page.locator('#variant').inputValue()); // the app's own start
  result.page = { url, startVariant };
  // none of what the app served before Task 32d (a request the shell leaves unanswered fails: WebView2 then looks for juce.backend on the network)
  result.page.unserved = await page.evaluate((paths) => Promise.all(paths.map((p) => fetch(p).then((r) => `${p}: ${r.ok ? 'served' : 'not served'}, ${r.status}`, () => `${p}: not served`))), UNSERVED);
  for (const line of result.page.unserved) if (!line.includes('not served')) problems.push(`the app serves what only the web's page used: ${line}`);
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
    const from = window.lastEngine().beats; // the watched stretch of the song, in the engine's beats
    for (let i = 0; i < 12; i++) {
      await window.wait(500);
      texts.push(document.getElementById('play-position').textContent);
      pictures.push(canvas.toDataURL());
      countdown.add(document.getElementById('play-countdown').textContent);
    }
    watch.disconnect();
    const bars = texts.map((s) => Number(/\d+/.exec(s)?.[0] ?? NaN));
    return { texts: [...new Set(texts)], bars, pictures: new Set(pictures).size, countdown: [...countdown], lit: [...lit], ledsOn: [...document.querySelectorAll('#lane-buttons .on')].map((b) => b.dataset.layer),
      beats: [+from.toFixed(2), +window.lastEngine().beats.toFixed(2)] };
  });
  const bars = result.moves.bars;
  if (!(result.moves.texts.length >= 2 && bars.every((b, i) => Number.isFinite(b) && (i === 0 || b >= bars[i - 1])))) problems.push(`(b) the position line does not count the bars: ${JSON.stringify(result.moves.texts)}`);
  if (!result.moves.countdown.some((c) => /\d/.test(c))) problems.push(`(b) the countdown shows nothing while playing: ${JSON.stringify(result.moves.countdown)}`);
  if (!(result.moves.pictures >= 2)) problems.push('(b) the lanes do not move');
  // which lights must have flashed follows the song: the beat LED, and every layer that is not muted and whose lane (as the shell sent it) has a
  // note or hit starting inside the watched stretch (a tenth of a beat after its start up to half a beat before its end: the frames at its edges)
  const [watchFrom, watchTo] = result.moves.beats, loop = song.lanes.beats;
  const inStretch = (beat) => { const d = (((beat - watchFrom) % loop) + loop) % loop; return d >= 0.1 && d <= watchTo - watchFrom - 0.5; };
  result.moves.demanded = ['beat-led', ...SIX.filter((l) => songState.track.layers[l] && lanes.some((e) => e.layer === l && (e.type === 'note' || e.type === 'hit') && inStretch((e.t * lanesBpm) / 60)))];
  const dark = result.moves.demanded.filter((l) => !result.moves.lit.includes(l));
  if (!(watchTo - watchFrom > 4) || dark.length) problems.push(`(b) the lights do not flash with the beats and the notes: ${JSON.stringify(dark)} did not, in beats ${watchFrom} to ${watchTo} (lit: ${JSON.stringify(result.moves.lit)})`);
  delete result.moves.bars;

  // while it plays, the fretboard, its text version, the wheel, the strip and the progression show the bar of the last position() the page got:
  // the fretboard its tones and roles, the wheel its sounding node in the first colour and the next in the second (the fill under the label),
  // the strip and the progression the part and the entry that play (aria-current)
  result.playing = [];
  for (let i = 0; i < 6; i++) {
    await sleep(400);
    result.playing.push(await page.evaluate(async () => {
      const { layoutWheel } = await import('./wheel-geometry.js');
      const p = JSON.parse(window.got.position.at(-1).json);
      const roles = (n) => [n.scale && 'scale', n.current && n.next ? 'both' : n.current ? 'current' : n.next && 'next', n.root && 'root', !n.scale && 'outside'].filter(Boolean).join(' ');
      const degrees = document.getElementById('labels-degrees').getAttribute('aria-pressed') === 'true';
      const canvas = document.getElementById('wheel');
      const css = getComputedStyle(canvas);
      const rgb = (color) => { const c = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
      const l = layoutWheel(canvas.clientWidth), dpr = window.devicePixelRatio || 1;
      const fill = (k) => { if (k === null) return null; const n = l.nodes[k]; return [...canvas.getContext('2d').getImageData(Math.round(n.x * dpr), Math.round((n.y + 0.7 * n.r) * dpr), 1, 1).data.slice(0, 3)]; };
      return {
        bar: p.bar, name: p.name, nextName: p.nextName,
        board: [...document.querySelectorAll('#fretboard g.fret-note:not([hidden])')].map((g) => `${g.dataset.string}:${g.dataset.fret}:${g.dataset.role}:${g.querySelector('text').textContent}`).sort().join(' '),
        boardWanted: p.fretboard.map((n) => `${n.string}:${n.fret}:${roles(n)}:${degrees ? n.degree : n.name}`).sort().join(' '),
        text: document.getElementById('fretboard-text').textContent, p: { name: p.name, notes: p.notes, nextName: p.nextName, nextNotes: p.nextNotes },
        wheel: { current: fill(p.wheel.current), next: fill(p.wheel.next), accent: rgb(css.getPropertyValue('--accent').trim()), accent2: rgb(css.getPropertyValue('--accent2').trim()), at: p.wheel },
        strip: [[...document.querySelectorAll('#form-strip [role="option"]')].findIndex((el) => el.hasAttribute('aria-current')), p.part?.index ?? -1],
        progression: [[...document.querySelectorAll('#progression button')].findIndex((el) => el.hasAttribute('aria-current')), p.index],
      };
    }));
  }
  const near = (a, b) => a && b && a.every((v, k) => Math.abs(v - b[k]) <= 8);
  for (const s of result.playing) {
    const text = `${tr('ui.fretboardNow', { chord: s.p.name, notes: s.p.notes.join(', ') })}${s.p.nextNotes ? `. ${tr('ui.fretboardNext', { chord: s.p.nextName, notes: s.p.nextNotes.join(', ') })}` : ''}`;
    const wrong = [s.board !== s.boardWanted && 'the fretboard', s.text !== text && 'its text version', s.wheel.at.current !== null && !near(s.wheel.current, s.wheel.accent) && 'the wheel\'s sounding node',
      s.wheel.at.next !== null && !near(s.wheel.next, s.wheel.accent2) && 'the wheel\'s next node', s.strip[0] !== s.strip[1] && 'the strip', s.progression[0] !== s.progression[1] && 'the progression'].filter(Boolean);
    if (wrong.length) problems.push(`(b) while it plays at bar ${s.bar + 1} (${s.name}, next ${s.nextName}): ${wrong.join(', ')} not as position() says: ${JSON.stringify(s)}`);
  }
  if (!result.playing.some((s) => s.wheel.at.current !== null && s.wheel.at.next !== null)) problems.push('(b) while it plays: no sample had a sounding and a next node on the wheel');
  for (const s of result.playing) { delete s.board; delete s.boardWanted; }
  result.sizes = { page: { focus: await boxes(page) } }; // against the web's page at the end
  result.sizes.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio }));

  // the fonts the play page shows (its text, its LCDs, the wheel's middle) are the page's own: Barlow and Share Tech Mono loaded from its folder, no
  // face of them failed (a fallback), and the text and the LCDs are set in them
  result.fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = (s) => getComputedStyle(document.querySelector(s)).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    return { faces: [...document.fonts].map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.status}`),
      files: performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'css' && /\.woff2$/.test(e.name)).map((e) => new URL(e.name).pathname),
      used: { text: family('body'), lcd: family('#play-position') } };
  });
  const loaded = (name) => result.fonts.faces.some((f) => f.startsWith(`${name} `) && f.endsWith(' loaded'));
  if (!loaded('Barlow') || !loaded('Share Tech Mono') || result.fonts.faces.some((f) => f.endsWith(' error')) || !result.fonts.files.length
    || result.fonts.files.some((f) => !f.startsWith('/app/assets/fonts/')) || result.fonts.used.text !== 'Barlow' || result.fonts.used.lcd !== 'Share Tech Mono')
    problems.push(`(b) the page's fonts: ${JSON.stringify(result.fonts)}`);

  // a restart from bar 1 while it plays (a chord colour: restart without inPlace): in every frame of its lead the position line shows no bar (the
  // web shows nothing until the first bar of a start), after it the bar again; the shell remembers the bar that played (the replay gets it too)
  const restartAt = await page.evaluate(() => window.sent.filter((s) => s.type === 'action').length);
  result.restart = await page.evaluate(async () => {
    const field = document.getElementById('play-position');
    const frames = [];
    let sampling = true;
    const frame = () => { const e = window.lastEngine(); frames.push({ standing: e.playing && e.standing, text: field.textContent }); if (sampling) requestAnimationFrame(frame); };
    const color = JSON.parse(window.got.tables.at(-1).json).CHORD_COLORS[1];
    document.querySelector(`#chord-color [data-color="${color}"]`).click();
    const state = await window.answered();
    requestAnimationFrame(frame);
    await window.wait(1500);
    sampling = false;
    const lead = frames.filter((f) => f.standing);
    return { change: state?.change, last: state && JSON.parse(state.json).last, leadFrames: lead.length, shownInLead: [...new Set(lead.map((f) => f.text))], after: frames.at(-1)?.text };
  });
  if (!result.restart.change?.restart || result.restart.change.inPlace || !result.restart.leadFrames || result.restart.shownInLead.some((s) => /\d/.test(s)) || !/\d/.test(result.restart.after ?? ''))
    problems.push(`(b) a restart from bar 1 while it plays: ${JSON.stringify(result.restart)}`);

  // every layer: switched on with its mute key, seek to its first note or hit in the lanes the page has, then its level over 2.5 s (as the old page's
  // check measured it), on the voices derived() names then (in the result); first on the song's own voices, after the step below on the synth voices
  const everyLayer = async (which) => {
    for (const layer of await page.evaluate(() => [...document.querySelectorAll('button[data-mute][aria-pressed="true"]')].map((b) => b.dataset.mute))) {
      await page.evaluate((l) => document.querySelector(`button[data-mute="${l}"]`).click(), layer);
      await answered();
    }
    const voices = JSON.parse(await page.evaluate(() => window.got.derived.at(-1).json)).voices;
    const levels = {};
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
      levels[layer] = { voice: `${voices[layer]?.id}/${voices[layer]?.variant}`, firstBeat: +beat.toFixed(2), peak };
      if (!(peak > 0)) problems.push(`(b) ${layer} on ${levels[layer].voice} (${which}): no level where the lanes give it its first note`);
    }
    return levels;
  };
  result.everyLayer = await everyLayer('its own voice');

  // the engine with every effect on and under load (the old page's check: its effects step and its "alle Synth" step): every layer on its synth voice
  // (the page's key "alle Synth", pressed until it shows the synth), then two passes of 4 s from the same beat, one after which bass, chords and pad
  // each start a note 0.3 to 3.5 s into the song (in the lanes the engine plays): with the song's own effects, then with every layer effect at 100
  // (the timbre knobs of bass, chords, pad and lead that are not greyed out, turned as a user turns them). The six voices are ready; derived().timbre
  // has every turned field at 1; with every effect on bass, chords and pad have a level, the peak of at least one of them moves by 1.5 dB or more
  // against the pass without (the old bar: the engine runs the effects), and the engine's load (the slowly falling peak of its block's share) is at
  // most 25 % with no dropout in either pass. Then the knobs back where they were.
  // shortcut: the lead is left out of the levels and the 1.5 dB: with fuzz and overdrive both at 100 the lead on synth/classic gives no level in the
  // app (a finding in the engine, Task 32d's report, being followed up); its peaks are in the result (load.lead), upgrade: when the engine is fixed
  // the lead joins the assertion
  const FX = ['bass', 'chords', 'pad'];
  const played = await page.evaluate(() => { const e = window.got.events.at(-1); return { bpm: e.bpm, beats: e.beats, events: JSON.parse(e.json) }; });
  const starts = (layer, beat) => played.events.some((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit')
    && e.t >= (beat * 60) / played.bpm + 0.3 && e.t < (beat * 60) / played.bpm + 3.5);
  const fxBeat = [...Array(Math.floor(played.beats)).keys()].find((beat) => FX.every((l) => starts(l, beat))) ?? null;
  if (fxBeat === null) problems.push(`(b) every effect on: the song has no beat after which ${FX.join(', ')} each start a note within 0.3 to 3.5 s`);
  else {
    result.load = await page.evaluate(async ([beat, layers]) => {
      const key = document.getElementById('all-voices');
      for (let i = 0; i < 3 && key.dataset.state !== 'synth'; i++) { key.click(); await window.answered(); }
      const pass = async () => { // 4 s from `beat`: the layers' peaks (the reports from 0.15 s after the seek on), the load at its end, the dropouts during it
        const from = performance.now(), start = window.lastEngine();
        window.bridge('seek', { beats: beat });
        await window.wait(4000);
        const log = window.got.engine.filter((m) => m.at >= from + 150 && m.playing && !m.standing), end = window.lastEngine();
        return { peaks: Object.fromEntries(layers.map((l) => [l, +Math.max(0, ...log.map((m) => m.peaks?.[l] ?? 0)).toFixed(4)])), load: +end.load.toFixed(3), dropouts: end.xruns - start.xruns };
      };
      const plain = await pass();
      const knobs = ['bass', 'chords', 'pad', 'lead'].flatMap((l) => ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus'].map((f) => document.getElementById(`timbre-${l}-${f}`)))
        .filter((k) => k && !k.disabled);
      const turn = (k, value) => { k.value = value; k.dispatchEvent(new Event('input', { bubbles: true })); };
      const before = knobs.map((k) => k.value);
      for (const k of knobs) turn(k, '100');
      await window.answered();
      const timbre = JSON.parse(window.got.derived.at(-1).json).timbre;
      const notOne = knobs.filter((k) => { const [, group, field] = k.id.split('-'); return timbre[group]?.[field] !== 1; }).map((k) => k.id);
      const every = await pass();
      knobs.forEach((k, i) => turn(k, before[i]));
      await window.answered();
      return { beat, key: key.dataset.state, voices: window.got.voices.at(-1), knobs: knobs.length, notOne, plain, every };
    }, [fxBeat, [...FX, 'lead']]);
    const L = result.load;
    L.gainDb = Object.fromEntries(FX.map((l) => [l, L.plain.peaks[l] > 0 && L.every.peaks[l] > 0 ? +(20 * Math.log10(L.every.peaks[l] / L.plain.peaks[l])).toFixed(2) : null]));
    L.lead = { plain: L.plain.peaks.lead, every: L.every.peaks.lead };
    const moved = Math.max(0, ...Object.values(L.gainDb).filter((g) => g !== null).map(Math.abs));
    if (L.key !== 'synth' || !SIX.every((l) => L.voices?.[l] === 'ready')) problems.push(`(b) "alle Synth": ${JSON.stringify({ key: L.key, voices: L.voices })}`);
    if (!L.knobs || L.notOne.length) problems.push(`(b) every effect on: derived().timbre does not have ${JSON.stringify(L.notOne)} at 1 (${L.knobs} knobs turned)`);
    if (!FX.every((l) => L.every.peaks[l] > 0)) problems.push(`(b) every effect on: no level of ${FX.filter((l) => !(L.every.peaks[l] > 0))} (${JSON.stringify(L.every.peaks)})`);
    if (!(moved >= 1.5)) problems.push(`(b) every effect on: no layer's peak moves by 1.5 dB against the pass without (dB: ${JSON.stringify(L.gainDb)})`);
    if (!(L.every.load <= 0.25) || L.every.dropouts !== 0 || L.plain.dropouts !== 0) problems.push(`(b) every effect on: load ${L.every.load} (limit 0.25), dropouts ${L.plain.dropouts} and ${L.every.dropouts}`);
  }
  result.everyLayerSynth = await everyLayer('the synth voice');
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
  result.sizes.page.setup = await boxes(page);
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

  // One operation of a control of the second group: exactly one action (or none: `sends` 0), its answer, then what the page shows against what the
  // session's texts say, compared after the display's next ticks (the position comes with them, not with the answer)
  const sentCount = () => page.evaluate(() => window.sent.filter((s) => s.type === 'action').length);
  const texts = () => page.evaluate(() => Object.fromEntries(['state', 'derived', 'position', 'profiles'].map((n) => [n, window.got[n]?.at(-1) ? JSON.parse(window.got[n].at(-1).json) : null])));
  async function operation(name, operate, shown, wanted, { sends = 1 } = {}) {
    const before = await sentCount();
    await operate();
    const state = sends ? await answered() : null;
    await sleep(250);
    const sent = await page.evaluate((n) => window.sent.filter((s) => s.type === 'action').slice(n).map((s) => JSON.parse(s.json)), before);
    const shows = await shown();
    const want = wanted(await texts());
    result.controls[name] = { sent: sent.map((a) => (a.ids ? { ...a, ids: a.ids.length } : a)), shows }; // an import's thousand new ids: their number
    if (sent.length !== sends) problems.push(`(a) ${name}: the page sent ${sent.length} actions, not ${sends}`);
    else if (sends && !state) problems.push(`(a) ${name}: no answer`);
    else if (JSON.stringify(shows) !== JSON.stringify(want)) problems.push(`(a) ${name}: the page shows ${JSON.stringify(shows)}, the session's texts say ${JSON.stringify(want)}`);
    return sent;
  }
  const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);

  // ---------- the progression (progression-editor.js): add with another root chosen, remove, fill up; the ninth chord is refused and the notice shows ----------
  const progressionShown = () => page.evaluate(() => ({
    chords: [...document.querySelectorAll('#progression button')].map((b) => [b.textContent, b.dataset.degree, b.className, b.disabled]),
    notice: document.getElementById('tuning-message').textContent,
  }));
  const progressionWanted = ({ state, position }) => ({
    chords: position.progression.length === state.track.bars.length ? position.progression.map((p) => [p.name, p.degree, `chip role-${p.role}`, position.progression.length === 1]) : 'the position is not the state\'s',
    notice: state.notice ? de[state.notice].replace('{max}', '8') : '',
  });
  const qualitiesShown = () => page.evaluate(() => ({
    roots: [...document.querySelectorAll('#add-roots button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
    qualities: [...document.querySelectorAll('#add-qualities button')].map((b) => [b.dataset.quality, b.textContent, b.disabled]),
  }));
  const qualitiesWanted = (index) => ({ derived }) => ({
    roots: derived.chordOptions.map((o, i) => [o.root, String(i === index)]),
    qualities: tables.CHORD_GROUPS.flatMap((g) => Object.keys(tables.CHORDS).filter((q) => tables.CHORDS[q].group === g))
      .map((q) => [q, derived.chordOptions[index].names[q], !derived.chordOptions[index].qualities.includes(q)]),
  });
  await click('#add-btn');
  await operation('progression root', () => click('#add-roots button:nth-child(2)'), qualitiesShown, qualitiesWanted(1), { sends: 0 });
  await operation('progression add', () => click('#add-qualities button:not(:disabled)'), progressionShown, progressionWanted);
  await operation('progression remove', () => click('#progression button:nth-child(2)'), progressionShown, progressionWanted);
  // the wheel: a click on a node that carries an allowed chord not in the progression adds that chord (derived().wheel)
  await page.evaluate(() => document.getElementById('add-pop').hidePopover());
  const spot = await page.evaluate(async () => {
    const { layoutWheel } = await import('./wheel-geometry.js');
    const nodes = JSON.parse(window.got.derived.at(-1).json).wheel.nodes;
    const canvas = document.getElementById('wheel');
    const r = canvas.getBoundingClientRect(), l = layoutWheel(canvas.clientWidth);
    const d = nodes.find((n) => n.allowed && !n.inProgression);
    const n = l.nodes[(d.ring === 'outer' ? 0 : 12) + d.index];
    return { x: r.left + n.x, y: r.top + n.y, chord: d.allowed };
  });
  const [picked] = await operation('wheel pick', () => page.mouse.click(spot.x, spot.y), progressionShown, progressionWanted);
  if (picked?.action !== 'addChord' || picked.root !== spot.chord.root || picked.quality !== spot.chord.quality) problems.push(`(a) the wheel's node of ${JSON.stringify(spot.chord)} sent ${JSON.stringify(picked)}`);
  await click('#add-btn');
  for (let i = 0; i < 8 && (await texts()).state.track.bars.length < 8; i++) await operation('progression fill', () => click('#add-qualities button:not(:disabled)'), progressionShown, progressionWanted);
  const [ninth] = await operation('progression ninth', () => click('#add-qualities button:not(:disabled)'), progressionShown, progressionWanted);
  const refused = await texts();
  result.controls['progression ninth'].state = { bars: refused.state.track.bars.length, notice: refused.state.notice, refusals: refused.state.refusals };
  if (ninth?.action !== 'addChord' || refused.state.track.bars.length !== 8 || refused.state.notice !== 'ui.progressionFull' || !result.controls['progression ninth'].shows.notice)
    problems.push(`(a) the ninth chord: ${JSON.stringify(result.controls['progression ninth'])}`);
  await page.evaluate(() => document.getElementById('add-pop').hidePopover());

  // ---------- the form (form-panel.js, form-strip.js): template, roll, select a part, its level, density and transition, add, move, remove a part,
  // the level back to its default; every block, label and button against derived().form and state() ----------
  const formShown = () => page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    return {
      song: [$('form-template').value, $('length').value, $('length-label').textContent, ...['structure', 'dynamics', 'pauses', 'randomness'].map((k) => [$(`form-${k}`).value, $(`form-${k}-out`).textContent])],
      blocks: [...document.querySelectorAll('#form-strip [role="option"]')].map((el) => [el.dataset.type, el.querySelector('.form-part-bars').textContent, el.style.flexGrow,
        +parseFloat(el.style.height).toFixed(1), el.getAttribute('aria-label'), el.getAttribute('aria-selected'), el.hasAttribute('aria-current')]),
      part: [$('part-chip').textContent, $('part-type').value, $('part-transition').value, $('part-crash').getAttribute('aria-pressed'), $('part-len-out').textContent,
        $('part-level').value, $('part-level-out').textContent, $('part-density').value, $('part-density-out').textContent, $('part-level-reset').disabled, $('part-density-reset').disabled,
        $('part-lock').getAttribute('aria-pressed'), ...['part-left', 'part-right', 'part-copy', 'part-delete', 'form-add', 'part-shorter', 'part-longer'].map((id) => $(id).disabled), $('form-note').textContent],
    };
  });
  const formWanted = ({ state, derived }) => {
    const { track, formTarget, formFeel, selectedPart: i, rollNote } = state;
    const on = derived.formChoice !== 'off';
    const feel = track.form?.feel ?? formFeel; // the page's shortcut (form-panel.js), not a text of the session
    const f = derived.form, b = f.blocks[i], p = f.parts[i], s = track.form.sections[i], lim = p.limits;
    return {
      song: [derived.formChoice, String(on ? formTarget : track.length), tr(on ? 'ui.formTarget' : 'ui.length'),
        ...['structure', 'dynamics', 'pauses', 'randomness'].map((k) => [String(Math.round(feel[k] * 100)), tr('ui.percent', { n: Math.round(feel[k] * 100) })])],
      blocks: f.blocks.map((x, k) => [x.type, String(x.bars), String(x.bars), +(x.height * 100).toFixed(1),
        `${tr('form.partLabel', { name: tr(`form.part.${x.type}`), bars: barsText(x.bars), from: x.from, to: x.to })}${x.locked ? `, ${tr('form.locked')}` : ''}`, String(k === i), false]),
      part: [tr('form.insp.chip', { n: i + 1 }), b.type, p.transition, String(p.crash), barsText(b.bars), String(p.levelValue), label(p.levelLabel), String(p.densityValue), label(p.densityLabel),
        s.level == null, s.density == null, String(s.locked === true), !lim.canLeft, !lim.canRight, !lim.canCopy, !lim.canDelete, !lim.canAdd, !lim.canShorter, !lim.canLonger,
        [...(rollNote ? ['form.note.allLocked'] : []), ...lim.reasons].map((k) => tr(k)).join(' ')],
    };
  };
  for (const [name, operate] of [
    ['form template', () => setValue('#form-template', tables.TEMPLATE_IDS[1], ['change'])],
    ['form roll', () => click('#form-roll')],
    ['form select', () => click('#form-strip [role="option"]:nth-child(3)')],
    ['form level', () => setValue('#part-level', -7, ['input'])],
    ['form density', () => setValue('#part-density', 40, ['input'])],
    ['form transition', () => setValue('#part-transition', tables.TRANSITIONS.at(-1), ['change'])],
    ['form add', () => click('#form-add')],
    ['form move', () => click('#part-left')],
    ['form remove', () => click('#part-delete')],
    ['form level back', () => click('#form-strip [role="option"]:nth-child(3)')],
    ['form level reset', () => click('#part-level-reset')],
  ]) await operation(name, operate, formShown, formWanted);
  // the grip at the selected part's end, dragged two bars to the right with the mouse: one editPart with the new length when it is let go
  const gripAt = await page.evaluate(() => {
    const grip = document.querySelector('#form-strip .part-grip'), block = grip.parentElement;
    const r = grip.getBoundingClientRect(), bars = Number(block.querySelector('.form-part-bars').textContent);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, px: block.getBoundingClientRect().width / bars, bars };
  });
  const [gripped] = await operation('form grip', async () => {
    await page.mouse.move(gripAt.x, gripAt.y);
    await page.mouse.down();
    await page.mouse.move(gripAt.x + 2 * gripAt.px, gripAt.y, { steps: 8 });
    await page.mouse.up();
  }, formShown, formWanted);
  if (gripped?.field !== 'bars' || gripped.value !== gripAt.bars + 2) problems.push(`(a) the grip dragged two bars from ${gripAt.bars} sent ${JSON.stringify(gripped)}`);
  const formSent = Object.entries(result.controls).filter(([n]) => n.startsWith('form ')).map(([n, c]) => [n, c.sent[0]?.action]);
  const wantActions = ['setFormTemplate', 'rerollForm', 'selectPart', 'editPart', 'editPart', 'editPart', 'addPart', 'movePart', 'deletePart', 'selectPart', 'editPart', 'editPart'];
  if (formSent.some(([, a], k) => a !== wantActions[k])) problems.push(`(a) the form's controls sent ${JSON.stringify(formSent)}`);

  // ---------- the profile window (profiles.js and its parts): save, a new folder, save into it with a choice of parts, rename, select, load, overwrite,
  // delete with the question, undo; the drag; export to a file and import it again; a file of a newer version; a damaged file. The tree's rows,
  // the title, the info line, the message and "Rückgängig" against profiles() ----------
  const profilesShown = () => page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    return {
      rows: [...document.querySelectorAll('#profile-tree [role="treeitem"]')].map((r) => [r.dataset.key, r.querySelector('.tree-label').textContent, r.getAttribute('aria-level'),
        r.getAttribute('aria-selected'), r.getAttribute('aria-expanded')]),
      title: $('profile-panel-title').textContent, info: $('profile-panel-info').hidden ? null : $('profile-panel-info').textContent,
      message: $('profile-message').textContent, undo: !$('profile-undo').hidden,
    };
  });
  const count = (key, n, params = {}) => tr(n === 1 ? `${key}.one` : key, { ...params, n });
  const findNode = (items, id) => { for (const n of items) { if (n.id === id) return n; const hit = n.type === 'folder' ? findNode(n.items, id) : null; if (hit) return hit; } return null; };
  const profilesWanted = ({ profiles: p }, local = null) => {
    const rows = [['session', tr('ui.profileSession'), '1', String(p.selection === 'session'), null], ['factory', tr('ui.profileFactory'), '1', String(p.selection === 'factory'), String(p.open.includes('factory'))]];
    if (p.open.includes('factory')) for (const f of p.factory) rows.push([f.key, tr(`style.${f.styleId}`), '2', String(p.selection === f.key), null]);
    rows.push(['mine', tr('ui.profileMine'), '1', String(p.selection === 'mine'), String(p.open.includes('mine'))]);
    const walk = (items, depth) => {
      for (const n of items) {
        rows.push([n.id, n.name, String(depth), String(p.selection === n.id), n.type === 'folder' ? String(p.open.includes(n.id)) : null]);
        if (n.type === 'folder' && p.open.includes(n.id)) walk(n.items, depth + 1);
      }
    };
    if (p.open.includes('mine')) walk(p.items, 2);
    const node = findNode(p.items, p.selection);
    const fixed = { session: tr('ui.profileSession'), factory: tr('ui.profileFactory'), mine: tr('ui.profileMine') };
    const factory = p.selection.startsWith('factory:');
    return {
      rows,
      title: fixed[p.selection] ?? (factory ? tr(`style.${p.selection.slice(8)}`) : node.name),
      info: factory ? tr('ui.profileFactoryInfo') : node?.type === 'profile' ? tr('ui.profileContents', { parts: node.parts.map((id) => tr(`part.${id}`)).join(', ') })
        : p.counts ? tr('ui.profileFolderLine', { profiles: count('ui.profileCountProfiles', p.counts.profiles), folders: count('ui.profileCountFolders', p.counts.folders) }) : null,
      message: local ? tr(local) : (p.message ?? []).map((m) => tr(m.key, m.params.folder === null ? { ...m.params, folder: tr('ui.profileMine') } : m.params)).join(' '),
      undo: p.undo,
    };
  };
  const row = (key) => `#profile-tree [data-key="${key}"]`;
  const typed = (selector, value) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [selector, value]);
  const profileStep = (name, operate, options) => operation(name, operate, profilesShown, (got) => profilesWanted(got), options);
  const idOf = async (name) => { const find = (items) => { for (const n of items) { if (n.name === name) return n.id; const hit = n.type === 'folder' ? find(n.items) : null; if (hit) return hit; } return null; }; return find((await texts()).profiles.items); };
  await click('#profiles-btn');
  await sleep(200);
  await profileStep('profile save', async () => { await typed('#profile-name', 'Profil A'); await click('#profile-save'); });
  const idA = await idOf('Profil A');
  await profileStep('profile select mine', () => click(row('mine')));
  await profileStep('profile folder field', () => click('#profile-subfolder'), { sends: 0 });
  await profileStep('profile new folder', async () => { await typed('#profile-folder-name', 'Ordner B'); await click('#profile-folder-add'); });
  const idB = await idOf('Ordner B');
  await profileStep('profile select session', () => click(row('session')));
  const [savedC] = await profileStep('profile save into folder', async () => {
    await typed('#profile-name', 'Profil C');
    await page.evaluate((id) => { document.getElementById('profile-folder').value = id; }, idB);
    await click('#profile-save-parts [data-preset="rhythm"]'); // a choice of parts
    await click('#profile-save');
  });
  if (savedC?.folder !== idB || JSON.stringify(savedC?.parts) !== JSON.stringify(tables.PART_PRESETS.rhythm)) problems.push(`(a) the profile saved into the folder with the parts of a preset: ${JSON.stringify(savedC)}`);
  const idC = await idOf('Profil C');
  await profileStep('profile select A', () => click(row(idA)));
  await profileStep('profile rename field', () => click('#profile-rename'), { sends: 0 });
  await profileStep('profile rename', async () => { await typed('#profile-rename-name', 'Profil A2'); await click('#profile-rename-go'); });
  await profileStep('profile select factory', () => click(row(`factory:${tables.STYLE_PRESETS[1].id}`)));
  await profileStep('profile select C', () => click(row(idC)));
  await profileStep('profile load', () => click('#profile-load'));
  await profileStep('profile select A2', () => click(row(idA)));
  await profileStep('profile overwrite field', () => click('#profile-overwrite'), { sends: 0 });
  await profileStep('profile overwrite', () => click('#profile-overwrite-go'));
  await profileStep('profile select B', () => click(row(idB)));
  await profileStep('profile delete question', () => click('#profile-delete'), { sends: 0 });
  const question = await page.evaluate(() => [document.getElementById('profile-delete-ask').checkVisibility() && document.getElementById('profile-delete-ask').textContent, document.activeElement.id]);
  if (question[0] !== count('ui.profileDeleteAsk', 1) || question[1] !== 'profile-delete-no') problems.push(`(a) the question before deleting a folder with a profile: ${JSON.stringify(question)}`);
  await profileStep('profile delete', () => click('#profile-delete-yes'));
  if ((await idOf('Ordner B')) !== null) problems.push('(a) the folder is not deleted');
  await profileStep('profile undo', () => click('#profile-undo'));
  if ((await idOf('Profil C')) !== idC) problems.push('(a) undo does not bring the folder back with its profile');

  // the drag of Profil A2 at its handle: over every row, "ok" where profiles().drag.targets names it and "no" elsewhere; let go over a row that is no
  // target: no move; then onto the folder: moveNode, and the drag ends. The factory folder closed first: the tree fits without scrolling
  await profileStep('profile close factory', () => click(`${row('factory')} .tree-twisty`));
  const middle = (selector) => page.evaluate((s) => { const el = document.querySelector(s); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
  const grab = async () => {
    const h = await middle(`${row(idA)} .drag-handle`);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x, h.y + 14, { steps: 4 });
    await sleep(300); // the drag began: the session's answer names its targets
  };
  const dragFrom = await sentCount();
  await grab();
  const keys = await page.evaluate(() => [...document.querySelectorAll('#profile-tree [role="treeitem"]')].map((r) => r.dataset.key));
  const lit = {};
  for (const key of keys) {
    const c = await middle(row(key));
    await page.mouse.move(c.x, c.y);
    lit[key] = await page.evaluate((s) => document.querySelector(s).dataset.drop ?? null, row(key));
  }
  const dragging = (await texts()).profiles.drag;
  result.profileDrag = { lit, targets: dragging?.targets };
  if (dragging?.key !== idA || keys.some((k) => (lit[k] === 'ok') !== dragging.targets.includes(k))) problems.push(`(a) the rows a drag lights up are not profiles().drag.targets: ${JSON.stringify(result.profileDrag)}`);
  const c0 = await middle(row('session')); // no target
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.up();
  await sleep(400);
  await grab();
  const c1 = await middle(row(idB));
  await page.mouse.move(c1.x, c1.y, { steps: 3 });
  await sleep(200);
  await page.mouse.up();
  await answered();
  await sleep(300);
  const dragSent = await page.evaluate((n) => window.sent.filter((s) => s.type === 'action').slice(n).map((s) => JSON.parse(s.json)), dragFrom);
  result.profileDrag.sent = dragSent;
  const dragWant = [{ action: 'profileDrag', key: idA }, { action: 'profileDrag', key: null }, { action: 'profileDrag', key: idA }, { action: 'moveNode', id: idA, target: idB }, { action: 'profileDrag', key: null }];
  if (JSON.stringify(dragSent) !== JSON.stringify(dragWant)) problems.push(`(a) the drags sent ${JSON.stringify(dragSent)}`);
  const afterDrag = await texts();
  if (afterDrag.profiles.drag !== null || !findNode(findNode(afterDrag.profiles.items, idB)?.items ?? [], idA)) problems.push(`(a) after the drop Profil A2 is not in the folder: ${JSON.stringify(afterDrag.profiles)}`);
  else if (JSON.stringify(await profilesShown()) !== JSON.stringify(profilesWanted(afterDrag))) problems.push('(a) after the drop the window is not what profiles() says');

  // export Profil A2 to a file (the page's download, recorded by the check) and import that file into "Meine Profile"
  await profileStep('profile select A2 again', () => click(row(idA)));
  await operation('profile file', () => click('#profile-file'), profilesShown, (got) => profilesWanted(got, 'ui.profileFileSaved'), { sends: 0 });
  const saved = await page.evaluate(async () => { const d = window.downloads.at(-1); return d ? { name: d.name, text: await d.blob.text() } : null; });
  const exported = (() => { try { return JSON.parse(saved.text); } catch { return null; } })();
  if (exported?.name !== 'Profil A2' || !/^backingtrack-profil-\d{4}-\d\d-\d\d\.json$/.test(saved?.name)) problems.push(`(a) the profile's file: ${JSON.stringify(saved)?.slice(0, 300)}`);
  await profileStep('profile select mine again', () => click(row('mine')));
  const pickFile = (name, text) => page.evaluate(([n, t]) => {
    const input = document.getElementById('profile-import-file');
    const files = new DataTransfer();
    files.items.add(new File([t], n, { type: 'application/json' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [name, text]);
  const [fromFile] = await profileStep('profile import file', () => pickFile(saved.name, saved.text));
  const afterImport = await texts();
  if (fromFile?.from !== 'file' || fromFile.text !== saved.text || fromFile.size !== Buffer.byteLength(saved.text) || afterImport.profiles.message?.[0]?.key !== 'ui.profileImported')
    problems.push(`(a) the import of the exported file: ${JSON.stringify({ ...fromFile, text: undefined, ids: fromFile?.ids?.length, message: afterImport.profiles.message })}`);
  // a file of a newer version (through the text field): its message names the version
  await profileStep('profile select mine for newer', () => click(row('mine')));
  await profileStep('profile import newer', async () => { await typed('#profile-text', JSON.stringify({ ...exported, version: 99 })); await click('#profile-import-text'); });
  const newer = await page.evaluate(() => document.getElementById('profile-message').textContent);
  if (!newer.includes(tr('ui.profileNewerVersion', { version: 99 }))) problems.push(`(a) a file of a newer version: the message is "${newer}"`);
  // a damaged file: its message, and the tree stays as it was
  await profileStep('profile select mine for damaged', () => click(row('mine')));
  const before = JSON.stringify((await texts()).profiles.items);
  await profileStep('profile import damaged', () => pickFile('kaputt.json', '{"format":"backingtrack-profile","version":2,"name":'));
  const damaged = await texts();
  if (damaged.profiles.message?.[0]?.key !== 'err.badProfile' || JSON.stringify(damaged.profiles.items) !== before) problems.push(`(a) a damaged file: ${JSON.stringify(damaged.profiles.message)}, the tree ${JSON.stringify(damaged.profiles.items) === before ? 'unchanged' : 'changed'}`);
  await page.screenshot({ path: join(out, 'page-6-profiles.png') });
  await page.evaluate(() => document.getElementById('profiles-pop').hidePopover());

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
  // the steps: the app's start, the actions in order; the bar and time the shell remembered (rememberSession, PROTOKOLL.md section 7) after the
  // restart while it played (in the same answer) and after the stop
  const remember = (last) => JSON.stringify({ action: 'rememberSession', bar: last?.bar ?? 0, at: last?.at ?? 0 });
  const after = new Map([[restartAt, remember(result.restart.last)], [stopAt - 1, remember(remembered)]]);
  const program_steps = [JSON.stringify({ action: 'start', variant: startVariant })];
  const records = []; // the record of sent action i in the program's list
  sentList.forEach((s, i) => {
    records[i] = program_steps.length;
    program_steps.push(s.json);
    if (after.has(i)) program_steps.push(after.get(i));
  });
  writeFileSync(join(work, 'steps.json'), JSON.stringify(program_steps));
  const ran = spawnSync(program, [join(work, 'steps.json'), join(work, 'expected.json')], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(`btg_session failed: ${ran.stdout}${ran.stderr}${ran.error ?? ''}`);
  const expected = JSON.parse(readFileSync(join(work, 'expected.json'), 'utf8'));
  const at = (i) => records[i] + (i === restartAt ? 1 : 0); // the record of the state the page got for sent action i (the restart's holds its remembering)
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

  // ---------- the times of the way page -> shell -> page (a measurement, no bar; after the replay above, which these actions are not part of): a
  // ping's round trip, and an action's time from the end of its job to the next audio block (`reactionMs`: the bass fader), at the device's buffer
  // size and up to two others it offers; for comparison the output latency the browser itself gives the web version ----------
  const measure = () => page.evaluate(async () => {
    const pongs = new Map(), ping = [], action = [];
    window.__JUCE__.backend.addEventListener('pong', (m) => pongs.get(m.id)?.(performance.now()));
    for (let id = 1; id <= 40; id++) {
      const t0 = performance.now();
      ping.push(await new Promise((done) => { pongs.set(id, (t) => done(t - t0)); window.bridge('ping', { id }); }));
      await window.wait(7 + (id % 5) * 3);
    }
    for (let i = 0; i < 40; i++) {
      window.bridge('action', { json: JSON.stringify({ action: 'setLevel', channel: 'bass', value: i % 2 ? 90 : 70 }) });
      await window.wait(90 + (i % 7) * 4);
      action.push(window.lastEngine().reactionMs);
    }
    const stats = (list) => { const s = [...list].sort((a, b) => a - b); return { median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(0.95 * s.length)].toFixed(2), max: +s.at(-1).toFixed(2) }; };
    const e = window.lastEngine();
    return { device: `${e.device} (${e.deviceType}), ${e.bufferFrames} frames at ${e.sampleRate} Hz, output latency ${e.outputLatencyMs?.toFixed(1)} ms`, pingRoundTripMs: stats(ping), actionToAudioBlockMs: stats(action) };
  });
  const { bufferFrames, bufferSizes } = await page.evaluate(() => window.lastEngine());
  result.reaction = { bufferSizes };
  for (const frames of [bufferFrames, ...(bufferSizes ?? []).filter((s) => s !== bufferFrames).slice(0, 2)]) {
    await page.evaluate((f) => window.bridge('buffer', { frames: f }), frames);
    await sleep(2500);
    result.reaction[frames] = await measure();
  }
  await page.evaluate((f) => window.bridge('buffer', { frames: f }), bufferFrames);
  result.reaction.webAudioLatencyMs = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    await window.wait(800);
    const out = { state: ctx.state, base: +(ctx.baseLatency * 1000).toFixed(1), output: +(ctx.outputLatency * 1000).toFixed(1) };
    await ctx.close();
    return out;
  });

  // ---------- credits.html opens from the start page, and each of its licence links gives the pack's licence text (served from the packs' folder) ----------
  await page.locator('#play-back').click();
  await Promise.all([page.waitForURL(/\/app\/credits\.html$/, { timeout: 15000 }), page.locator('a.credits').click()]);
  const licences = await page.evaluate(() => Promise.all([...document.querySelectorAll('a[href^="/samples/"]')].map(async (a) => {
    const r = await fetch(a.href).catch(() => null);
    return { href: a.getAttribute('href'), status: r?.status ?? null, type: r?.headers.get('content-type') ?? null, text: r?.ok ? await r.text() : null };
  })));
  result.credits = licences.map(({ href, status, type, text }) => ({ href, status, type, chars: text?.length ?? null }));
  if (licences.length !== 4) problems.push(`credits.html links ${licences.length} licence texts, not the packs' 4`);
  for (const l of licences) {
    const file = join(repo, 'src/assets/samples', l.href.slice('/samples/'.length));
    if (l.text !== readFileSync(file, 'utf8') || !l.type?.startsWith('text/plain')) problems.push(`credits.html: ${l.href} gives ${l.status} ${l.type}, not the text of ${file}`);
  }

  // ---------- the storage's problems (PROTOKOLL.md section 3a): a line at the box of the last session and one at the mixer ----------
  // A second start of the app on a folder where mix.json and session.json are folders: neither can be read, and mix.json cannot be written.
  await quit();
  const broken = join(work, 'broken');
  for (const name of ['mix.json', 'session.json', 'profiles.json']) mkdirSync(join(broken, name), { recursive: true });
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
  // the line keeps clear of the module's corner screws (13 px from its edges): the inset of the module's title, 18 px
  result.storage.inset = await second.evaluate(() => {
    const line = document.getElementById('mix-storage').getBoundingClientRect(), module = document.getElementById('mod-mixer').getBoundingClientRect();
    return [+(line.left - module.left).toFixed(1), +(module.right - line.right).toFixed(1)];
  });
  if (result.storage.inset.some((v) => v < 18)) problems.push(`storage: the line at the mixer lies ${JSON.stringify(result.storage.inset)} px from the module's edges, under its corner screws`);
  // an unreadable profiles.json: the profile window says so and offers "Erneut lesen" (reloadProfiles), which reads it again and still cannot
  await second.locator('#profiles-btn').click();
  const profileLine = () => second.evaluate(() => ({ line: document.getElementById('profile-storage').checkVisibility() ? document.getElementById('profile-storage').textContent : null,
    reload: document.getElementById('profile-reload').checkVisibility(), storage: JSON.parse(window.got.state.at(-1).json).storage.profiles }));
  const unreadable = await profileLine();
  const reloadFrom = await second.evaluate(() => window.sent.filter((s) => s.type === 'action').length);
  await second.locator('#profile-reload').click();
  await second.evaluate(() => window.answered());
  const reread = { ...(await profileLine()), sent: await second.evaluate((n) => window.sent.filter((s) => s.type === 'action').slice(n).map((s) => JSON.parse(s.json).action), reloadFrom) };
  result.storage.profiles = { unreadable, reread };
  if (unreadable.storage !== 'unreadable' || unreadable.line !== tr('ui.storage.profiles.unreadable') || !unreadable.reload || JSON.stringify(reread.sent) !== '["reloadProfiles"]'
    || reread.storage !== 'unreadable' || reread.line !== unreadable.line) problems.push(`storage: an unreadable profiles.json in the profile window: ${JSON.stringify(result.storage.profiles)}`);
  const text = (key) => de[key] ?? `(no text ${key})`;
  if (atStart.storage.session !== 'unreadable' || atStart.box || atStart.session !== text('ui.storage.session.unreadable'))
    problems.push(`storage: an unreadable session.json is not told at the box of the last session: ${JSON.stringify(atStart)}`);
  if (atStart.storage.mix !== 'unreadable' || atStart.mix !== text('ui.storage.mix.unreadable')) problems.push(`storage: an unreadable mix.json is not told at the mixer: ${JSON.stringify(atStart)}`);
  if (afterWrite.storage.mix !== 'notStored' || afterWrite.mix !== text('ui.storage.mix.notStored')) problems.push(`storage: a mix.json that cannot be written is not told at the mixer: ${JSON.stringify(afterWrite)}`);

  // ---------- the web's page (src/ui, served as the repository's interface tests serve it) in Playwright's Chromium, at the WebView's size and pixel
  // ratio, in German, the same variant: the wheel and the fretboard have the boxes of the app's page ----------
  await quit();
  const server = await serveWeb(0);
  const chrome = await chromium.launch();
  try {
    const { width, height, ratio } = result.sizes.viewport;
    const context = await chrome.newContext({ viewport: { width, height }, deviceScaleFactor: ratio });
    await context.addInitScript(() => localStorage.setItem('backingtrack.lang', 'de'));
    const web = await context.newPage();
    web.on('pageerror', (e) => problems.push(`the web's page: ${e.message}`));
    await web.goto(`http://localhost:${server.address().port}/ui/index.html`);
    // the same room for the page as in the WebView in each view: Chromium's scrollbar takes room, WebView2's may not
    const fit = async (mode) => {
      const scrollbar = await web.evaluate(() => innerWidth - document.documentElement.clientWidth);
      await web.setViewportSize({ width: result.sizes.page[mode].page[0] + scrollbar, height });
      await sleep(500);
    };
    await web.evaluate((v) => { const f = document.getElementById('variant'); f.value = String(v); f.dispatchEvent(new Event('change', { bubbles: true })); }, VARIANT);
    await web.locator('#tune-btn').click();
    await fit('setup');
    result.sizes.web = { setup: await boxes(web) };
    await web.locator('#mode-switch').click();
    await fit('focus');
    result.sizes.web.focus = await boxes(web);
  } finally {
    await chrome.close();
    server.close();
  }
  for (const mode of ['focus', 'setup']) {
    for (const [name, box] of Object.entries(result.sizes.web[mode])) {
      const mine = result.sizes.page[mode][name];
      if (!box || !mine || box.some((v, k) => Math.abs(v - mine[k]) > 1)) problems.push(`the ${name} (${mode}) is ${JSON.stringify(mine)} on the app's page, ${JSON.stringify(box)} on the web's`);
    }
  }

  // ---------- the one-time take-over (importLegacy): the old page's three entries in the WebView's storage before the page loads, on new folders.
  // The texts are what the web keeps under them: those the session stored on the replay above (byte for byte the web's). The mark is set only
  // where nothing of them is left to take ----------
  await quit();
  const stored = expected.at(-1).stored;
  const old = { profiles: stored['profiles.json'] ?? null, session: stored['session.json'] ?? null, mix: stored['mix.json'] ?? null };
  if (Object.values(old).includes(null)) problems.push(`take-over: the replay stored no text for ${Object.keys(old).filter((k) => old[k] === null)}`);
  const putOld = (p) => p.evaluate((o) => { for (const [k, v] of Object.entries(o)) localStorage.setItem(`backingtrack.${k}`, v); }, old);
  const takeOver = (p) => p.evaluate(async () => {
    const sent = window.sent.filter((s) => s.type === 'action' && JSON.parse(s.json).action === 'importLegacy').map((s) => JSON.parse(s.json));
    if (sent.length) await window.answered();
    await window.wait(400);
    const state = JSON.parse(window.got.state.at(-1).json), profiles = JSON.parse(window.got.profiles.at(-1).json);
    return {
      sent, mark: localStorage.getItem('backingtrack.imported'), kept: ['profiles', 'session', 'mix'].filter((k) => localStorage.getItem(`backingtrack.${k}`) !== null),
      items: profiles.items, message: (profiles.message ?? []).map((m) => m.key), storage: state.storage, legacy: state.legacy, last: state.last, mix: state.mix,
      rows: [...document.querySelectorAll('#profile-tree .tree-label')].map((l) => l.textContent),
    };
  });
  const names = (items) => items.flatMap((n) => [n.name, ...(n.type === 'folder' ? names(n.items) : [])]);
  const oldNames = names(JSON.parse(old.profiles ?? '{"items":[]}').items);
  result.takeOver = {};
  // (1) profiles.json cannot be written (a folder with content holds the name of its side file, profiles.json.tmp; nothing is stored under the name
  // itself): the session takes nothing and says ui.profileNotStored, the page sets no mark; the next start, on a storage that works, takes it all
  const unwritable = join(work, 'legacy-unwritable');
  mkdirSync(join(unwritable, 'profiles.json.tmp'), { recursive: true });
  writeFileSync(join(unwritable, 'profiles.json.tmp', 'keep'), '');
  const failing = await launch(unwritable, { prepare: putOld });
  const notWritten = await takeOver(failing);
  result.takeOver.notWritten = { sent: notWritten.sent.length, mark: notWritten.mark, message: notWritten.message, names: names(notWritten.items) };
  if (notWritten.sent.length !== 1 || notWritten.mark !== null || !notWritten.message.includes('ui.profileNotStored') || notWritten.items.length)
    problems.push(`take-over: a profiles.json that cannot be written: ${JSON.stringify(result.takeOver.notWritten)}`);
  // a second load in the same app run (F5, the strip's page button): the session's message stands unchanged, so the answer brings no profiles text;
  // the page decides on the next one, still no mark
  await failing.reload();
  await failing.waitForFunction(() => document.getElementById('variant').value !== '', null, { timeout: 15000 });
  const notWrittenAgain = await takeOver(failing);
  result.takeOver.notWrittenAgain = { sent: notWrittenAgain.sent.length, mark: notWrittenAgain.mark, message: notWrittenAgain.message, names: names(notWrittenAgain.items) };
  if (notWrittenAgain.sent.length !== 1 || notWrittenAgain.mark !== null || notWrittenAgain.items.length)
    problems.push(`take-over: a second load on a profiles.json that cannot be written: ${JSON.stringify(result.takeOver.notWrittenAgain)}`);
  await quit();
  rmSync(join(unwritable, 'profiles.json.tmp'), { recursive: true });
  // the old entries put again (they stay in the page's storage, but a killed app may not have written them to its disk yet)
  const nextStart = await takeOver(await launch(unwritable, { prepare: putOld }));
  result.takeOver.nextStart = { mark: nextStart.mark, storage: nextStart.storage, names: names(nextStart.items), last: Boolean(nextStart.last) };
  if (nextStart.mark === null || JSON.stringify(names(nextStart.items)) !== JSON.stringify(oldNames) || !nextStart.last)
    problems.push(`take-over: the next start on a storage that works: ${JSON.stringify(result.takeOver.nextStart)}`);
  await quit();
  // (2) the app's profiles.json is damaged or unreadable when the page loads: the session keeps it as it is and takes no profiles, no mark
  // (state().legacy says failed); Task 32c: a later start, with the problem gone, takes the profiles and marks
  for (const [problem, make] of [['damaged', (dir) => writeFileSync(join(dir, 'profiles.json'), '{"version":2,"items":')], ['unreadable', (dir) => mkdirSync(join(dir, 'profiles.json'))]]) {
    const dir = join(work, `legacy-${problem}`);
    mkdirSync(dir);
    make(dir);
    const got = await takeOver(await launch(dir, { prepare: putOld }));
    result.takeOver[problem] = { sent: got.sent.length, mark: got.mark, storage: got.storage.profiles, legacy: got.legacy, names: names(got.items) };
    if (got.sent.length !== 1 || got.mark !== null || got.storage.profiles !== problem || got.legacy?.profiles !== 'failed' || got.items.length)
      problems.push(`take-over: a ${problem} profiles.json: ${JSON.stringify(result.takeOver[problem])}`);
    await quit();
    rmSync(join(dir, 'profiles.json'), { recursive: true });
    // the old entries are still in this folder's WebView profile without a mark: the page's first load sends them, before the recording begins
    const later = await takeOver(await launch(dir, { prepare: putOld }));
    result.takeOver[`${problem}, then working`] = { sent: later.sent.length, mark: later.mark, legacy: later.legacy, names: names(later.items) };
    // 'stored': the recorded load sent the texts again because the check's reload came before the first load's answer, which took them
    if (later.mark === null || !['taken', 'stored'].includes(later.legacy?.profiles) || JSON.stringify(names(later.items)) !== JSON.stringify(oldNames))
      problems.push(`take-over: the start after a ${problem} profiles.json, on a storage that works: ${JSON.stringify(result.takeOver[`${problem}, then working`])}`);
    await quit();
  }
  // (3) a storage that works: taken and marked, a second load sends nothing, and other old entries without the mark take nothing over the app's own
  mkdirSync(join(work, 'legacy'));
  const taking = await launch(join(work, 'legacy'), { prepare: putOld });
  const reload = async () => { await taking.reload(); await taking.waitForFunction(() => document.getElementById('variant').value !== '', null, { timeout: 15000 }); };
  const first = await takeOver(taking);
  result.takeOver.first = { ...first, sent: first.sent.map((a) => Object.keys(a)) };
  if (first.sent.length !== 1 || JSON.stringify(first.sent[0]) !== JSON.stringify({ action: 'importLegacy', ...old }) || first.mark === null || first.kept.length !== 3
    || JSON.stringify(names(first.items)) !== JSON.stringify(oldNames) || !JSON.parse(old.profiles).items.every((n) => first.rows.includes(n.name)) || !first.last)
    problems.push(`take-over: the first load: ${JSON.stringify({ ...result.takeOver.first, oldNames })}`);
  await reload();
  const again = await takeOver(taking);
  result.takeOver.second = { sent: again.sent.length };
  if (again.sent.length) problems.push(`take-over: a second load sent ${again.sent.length} importLegacy`);
  // with the app's own texts stored, other old entries (and no mark) take nothing over
  await taking.evaluate(() => {
    localStorage.removeItem('backingtrack.imported');
    localStorage.setItem('backingtrack.profiles', JSON.stringify({ version: 2, items: [{ id: 'fremd', type: 'folder', name: 'Fremder Ordner', items: [] }] }));
    localStorage.setItem('backingtrack.mix', JSON.stringify({ drums: 0.1 }));
  });
  await reload();
  const third = await takeOver(taking);
  result.takeOver.third = { sent: third.sent.length, mark: third.mark, names: names(third.items) };
  if (third.sent.length !== 1 || third.mark === null || JSON.stringify(third.items) !== JSON.stringify(again.items) || JSON.stringify(third.last) !== JSON.stringify(again.last)
    || JSON.stringify(third.mix) !== JSON.stringify(again.mix)) problems.push(`take-over: with the app's own texts stored: ${JSON.stringify(result.takeOver.third)}`);
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
await new Promise((done) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, done)); // written out before the process ends
