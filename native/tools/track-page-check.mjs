// Checks the app's page for the user's own songs (native/app/ui/track.html, Task 32c: what its fretboard and wheel show comes from the core,
// chordDisplays) in the real app, in one step (after native/build.ps1 with the app):
//   node native/tools/track-page-check.mjs [app.exe]
// A generator song (render-song.mjs: btg_render, in a temporary folder) is loaded as the user's own song, analysed and played. The app runs muted,
// on a storage folder of its own (BTG_STORAGE_DIR, removed afterwards with its WebView2 profile) and analyses anew (BTG_NO_CACHE: nothing is kept in
// the user's folder). At places of the song (inside every chord the analysis found, and before its end) the page shows what the core's answer to
// the page's own last request says: it asks for the chord and the next chord it shows, and its fretboard (the drawn dots with their roles and labels,
// the text version) and its wheel (the nodes marked as the chord that sounds and the next one) are the answer's. A click on a wheel node enters the
// name the answer allows for that node into the bar; the scale select has the entries of tables(); the window minimised for a moment and restored
// leaves the page with its song as it was. Task 32f: at the same places the chord, the next one, the count to it, bar and beat, the tempo, the
// part's pattern with its place, the legend and the lane's parts are what the core's answer to the page's last trackView question says (the count,
// the tempo, the turn and the place as the page computed them before), and that answer is the reference's for the question; so after the
// corrections; and in the free part of a song of two places. Two quick inputs count as two: the play key and Space, ArrowRight twice, a
// pattern's key twice, ArrowRight and a chord in the bar select (it goes into the bar sought). The events forced into the other order: an
// analysis before the lists (tables) keeps its scale and throws nothing; a click on the wheel before any answer throws nothing, and an answer that
// was lost is asked for again on pageshow. The pages share the language: the one opposite to the system's, chosen on the generator's page as the
// app's strip chooses it, shows here; the system's, chosen here, shows on the generator's page after "Zum Generator", which leads there. No error
// in the page's console. Writes .superpowers/native-screens/track-page-check.json and prints it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import de from '../app/ui/i18n/de.js';
import en from '../app/ui/i18n/en.js';
import TEXT from '../app/ui/track-text.js';
import { renderSong } from './render-song.mjs';
import { showWindow, startApp } from './app-window.mjs';
import { trackView } from './session-reference.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.argv[2] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const out = join(repo, '.superpowers/native-screens');
mkdirSync(out, { recursive: true });
const PORT = 9337;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const result = {};
const work = mkdtempSync(join(tmpdir(), 'btg-track-page-check-'));
let run = null; // { app, browser } of the app that runs

async function quit() {
  if (!run) return;
  await run.browser?.close().catch(() => {});
  const gone = new Promise((r) => { run.app.once('exit', r); setTimeout(r, 5000); });
  run.app.kill();
  await gone;
  run = null;
}

// Before every load of the page: what it sends (window.sent) and what the shell sends it (window.got), and the shell's events of one kind held back
// while the tab's sessionStorage names it (btg.hold): window.release() hands them to the page, window.drop() forgets them (an answer that was lost)
function record() {
  const backend = window.__JUCE__.backend;
  window.sent = [];
  window.got = { chordDisplays: [], trackView: [], analysis: [], engine: [] };
  // the texts the lane draws in its row of parts (y 9), of the frame drawn last (each frame begins with the whole lane's fill)
  window.laneTexts = [];
  const { fillRect, fillText } = CanvasRenderingContext2D.prototype;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) { if (this.canvas.id === 'lane-canvas' && x === 0 && y === 0 && w >= this.canvas.clientWidth) window.laneTexts = []; return fillRect.call(this, x, y, w, h); };
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) { if (this.canvas.id === 'lane-canvas' && y === 9) window.laneTexts.push(text); return fillText.call(this, text, x, y, ...rest); };
  for (const name of Object.keys(window.got)) {
    backend.addEventListener(name, (m) => { const list = window.got[name]; list.push({ ...m, at: performance.now() }); if (list.length > 600) list.splice(0, 300); });
  }
  const emit = backend.emitEvent.bind(backend);
  backend.emitEvent = (name, data) => { window.sent.push({ ...data, at: performance.now() }); emit(name, data); };
  window.bridge = (type, data = {}) => emit('btg', { type, ...data });
  const fromShell = backend.emitByBackend.bind(backend);
  let held = [];
  backend.emitByBackend = (event, payload) => (event === sessionStorage.getItem('btg.hold') ? held.push([event, payload]) : fromShell(event, payload));
  window.release = () => { sessionStorage.removeItem('btg.hold'); for (const [event, payload] of held) fromShell(event, payload); held = []; };
  window.drop = () => { sessionStorage.removeItem('btg.hold'); const n = held.length; held = []; return n; };
}

// What the page shows at the playhead against the core's answer to its last request: the chord and the next chord it shows and asked for, the
// board's visible dots (string:fret:roles:label) and text version, and the wheel's nodes marked in pink (the chord that sounds) and teal (the next
// one), sampled in each node above its label, all as the answer gives them
const look = (page) => page.evaluate(async () => {
  const { layoutWheel } = await import('/app/wheel-geometry.js');
  const { t } = await import('/app/i18n/index.js');
  const request = window.sent.findLast((s) => s.type === 'chordDisplays');
  const answer = window.got.chordDisplays.find((m) => m.seq === request?.seq);
  const a = answer?.json ? JSON.parse(answer.json) : null;
  const text = (id) => document.getElementById(id).textContent;
  const asked = JSON.parse(request.json);
  const shown = { chord: text('chord'), next: text('next') };
  if (!a) return { shown, asked: { current: asked.current, next: asked.next }, answered: false };
  const degrees = document.getElementById('labels-degrees').getAttribute('aria-pressed') === 'true';
  const roles = (n) => [n.scale && 'scale', n.current && n.next ? 'both' : n.current ? 'current' : n.next && 'next', n.root && 'root', !n.scale && 'outside'].filter(Boolean).join(' ');
  const part = (k, chord, tones) => t(k, { chord, notes: tones.join(', ') });
  const canvas = document.getElementById('wheel'), ctx = canvas.getContext('2d'), ratio = canvas.width / canvas.clientWidth;
  const near = (rgb, [r, g, b]) => Math.abs(rgb[0] - r) + Math.abs(rgb[1] - g) + Math.abs(rgb[2] - b) < 40;
  const marks = layoutWheel(canvas.clientWidth).nodes.map((n, k) => {
    const rgb = ctx.getImageData(Math.round(n.x * ratio), Math.round((n.y - 0.7 * n.r) * ratio), 1, 1).data;
    return near(rgb, [0xe3, 0x46, 0x5e]) ? `${k}:now` : near(rgb, [0x18, 0xa2, 0xa6]) ? `${k}:next` : null;
  }).filter(Boolean);
  const place = (i) => (a.wheel.nodes[i].ring === 'outer' ? 0 : 12) + a.wheel.nodes[i].index;
  return {
    shown, asked: { current: asked.current, next: asked.next }, answered: true,
    board: [...document.querySelectorAll('#fretboard svg g.fret-note:not([hidden])')].map((g) => `${g.dataset.string}:${g.dataset.fret}:${g.dataset.role}:${g.querySelector('text').textContent}`).sort().join(' '),
    boardWanted: a.fretboard.map((n) => `${n.string}:${n.fret}:${roles(n)}:${degrees ? n.degree : n.name}`).sort().join(' '),
    text: text('fretboard-text'),
    textWanted: !a.notes ? '' : a.nextNotes ? `${part('ui.fretboardNow', a.name, a.notes)}. ${part('ui.fretboardNext', a.nextName, a.nextNotes)}` : part('ui.fretboardNow', a.name, a.notes),
    marks: marks.sort().join(' '),
    marksWanted: [a.at.current !== null && `${place(a.at.current)}:now`, a.at.next !== null && `${place(a.at.next)}:next`].filter(Boolean).sort().join(' '),
  };
});
// the differences of a look() from what the page asked and the answer gave, as text; empty when there is none
const wrong = (s) => (!s.answered ? ['no answer to its last request'] : [
  s.asked.current !== (s.shown.chord === '–' ? null : s.shown.chord) && `it shows the chord ${s.shown.chord} and asked for ${s.asked.current}`,
  s.asked.next !== (s.shown.next === '–' ? null : s.shown.next) && `it shows the next chord ${s.shown.next} and asked for ${s.asked.next}`,
  s.board !== s.boardWanted && 'the fretboard is not the answer\'s', s.text !== s.textWanted && `its text version is "${s.text}", the answer's "${s.textWanted}"`,
  s.marks !== s.marksWanted && `the wheel marks ${s.marks}, the answer ${s.marksWanted}`,
].filter(Boolean));

// Task 32f: what the page shows at the engine's place (stopped) against the core's answer to its last trackView question: the chord, the next one, the count to
// it, bar and beat, the tempo, the part's pattern with its place, the legend and the lane's parts. Looked up in the answer by time as the page looks up; the
// count, the tempo, the turn and the place as the page computed them before Task 32f (track.js 428, 433-434, 444-445 at 2f33cc8), from the answer's beats and bars
const shows = (page, length) => page.evaluate(async (length) => {
  const TEXT = (await import('/app/track-text.js')).default, lang = document.documentElement.lang;
  const tr = (key, params) => TEXT[lang][key].replace(/\{(\w+)\}/g, (m, name) => String(params?.[name] ?? m));
  const request = window.sent.findLast((s) => s.type === 'trackView');
  const answer = window.got.trackView.find((m) => m.seq === request?.seq);
  if (!answer?.json) return { answered: false };
  const v = JSON.parse(answer.json), { meter } = JSON.parse(request.json).analysis, t = Math.min(length, window.got.engine.at(-1).beats);
  const now = v.changes.findLastIndex((c) => c.t <= t + 0.01), next = v.changes[now + 1];
  const bar = v.bars.findIndex((b) => t < b.end), beat = bar >= 0 ? v.bars[bar].beats.findLastIndex((b) => b <= t + 0.01) : -1;
  const part = bar >= 0 ? v.bars[bar].part : -1, s = v.sections[part], first = v.bars.findIndex((b) => b.part === part);
  const left = next ? Math.max(1, v.beats.filter((b) => b > t && b <= next.t + 0.01).length) : 0;
  const here = Math.max(4, Math.min(v.beats.length - 5, v.beats.findLastIndex((b) => b <= t)));
  const text = (id) => document.getElementById(id).textContent;
  const items = (selector) => [...document.querySelectorAll(selector)].map((el) => `${el.textContent}${el.classList.contains('on') ? ' (on)' : ''}`);
  return {
    answered: true,
    shown: { chord: text('chord'), next: text('next'), count: text('next-label'), position: text('position'), tempo: text('tempo'), pattern: text('pattern-label'),
      places: items('#pattern li'), legend: items('#sections button'), lane: window.laneTexts },
    wanted: {
      chord: now >= 0 ? v.changes[now].chord : '–', next: next ? next.chord : '–',
      count: !next ? tr('track.next') : left === 1 ? tr('track.nextInOne') : tr('track.nextIn', { n: left }),
      position: bar >= 0 ? tr('track.position', { bar: bar + 1, beat: Math.max(1, beat + 1) }) : '–',
      tempo: v.beats.length > 9 ? `${Math.round(60 * 8 / (v.beats[here + 4] - v.beats[here - 4]) / (meter.endsWith('/8') ? 3 : 1))} bpm · ${meter}` : text('tempo'),
      pattern: s?.pattern ? tr('track.patternAt', { name: s.name, turn: Math.floor((bar - first) / s.pattern.length) + 1, repeats: s.repeats }) : tr('track.noPattern'),
      places: (s?.pattern ?? []).map((p, i) => `${p}${i === (bar - first) % s.pattern.length ? ' (on)' : ''}`),
      legend: v.legend.map((l) => `${l.name}:  ${l.pattern.join(' | ')}   (${l.count}×)${l.name === s?.name ? ' (on)' : ''}`),
      lane: v.sections.map((p) => (p.pattern ? `${p.name}  ${p.pattern.join(' | ')}` : p.name)),
    },
  };
}, length);
// the differences of a shows() as text
const differs = (d) => (!d.answered ? ['no answer to its last trackView question'] : Object.keys(d.wanted).filter((k) => JSON.stringify(d.shown[k]) !== JSON.stringify(d.wanted[k]))
  .map((k) => `it shows ${k} ${JSON.stringify(d.shown[k])}, the core's answer ${JSON.stringify(d.wanted[k])}`));
// the answer to the page's last trackView question against the reference (session-reference.mjs: the page's lines before Task 32f) for the same question, byte for byte
const answeredRight = async (page) => {
  const { request, answer } = await page.evaluate(() => {
    const asked = window.sent.findLast((s) => s.type === 'trackView');
    return { request: asked?.json, answer: window.got.trackView.find((m) => m.seq === asked?.seq)?.json };
  });
  return typeof request === 'string' && answer === trackView(request) && answer !== '';
};

try {
  const wav = renderSong(work);
  const folder = join(work, 'storage');
  mkdirSync(folder);
  const app = await startApp(exe, `btg-tools-${PORT}`, { env: { ...process.env, BTG_MUTE: '1', BTG_NO_CACHE: '1', BTG_STORAGE_DIR: folder, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
  run = { app, browser: null };
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
  let recording = false; // from the own songs' page's second load on (leaving the generator's page cuts its requests off)
  page.on('console', (m) => { if (recording && m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (recording) problems.push(`page error: ${e.message}`); });
  page.on('requestfailed', (r) => { if (recording && !r.url().startsWith('blob:')) problems.push(`request failed: ${r.url()}`); });
  const navigated = []; // the page's main frame navigating
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated.push(f.url()); });

  // the language: the one opposite to the system's chosen on the generator's page, as the app's strip chooses it (a fresh profile shows the system's)
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(() => document.getElementById('variant')?.value, null, { timeout: 15000 });
  const system = await page.evaluate(async () => (await import('/app/i18n/index.js')).detectLanguage(navigator.language));
  const chosen = system === 'de' ? 'en' : 'de';
  await page.evaluate((l) => window.__JUCE__.backend.emitByBackend('language', JSON.stringify(l)), chosen);
  await page.waitForFunction((l) => document.documentElement.lang === l, chosen, { timeout: 5000 });
  await page.addInitScript(record);
  const url = new URL('/app/track.html', page.url()).href;
  await page.goto(url).catch(async () => { await sleep(1500); await page.goto(url); });
  const ready = () => page.waitForFunction(() => document.getElementById('scale').options.length > 0 && document.querySelector('#fretboard svg'), null, { timeout: 15000 });
  await ready();
  recording = true;
  await page.reload();
  await ready();
  // drawn in the chosen language: the title, and a text the page writes (the static page has none)
  result.languages = { system, chosen, opened: await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, open: document.getElementById('open').textContent })) };
  if (JSON.stringify(result.languages.opened) !== JSON.stringify({ lang: chosen, title: TEXT[chosen]['track.title'], open: TEXT[chosen]['track.open'] }))
    problems.push(`the language chosen on the generator's page does not show here: ${JSON.stringify(result.languages)}`);
  // the system's language chosen here, as the strip does: the comparisons below read it, and the generator's page shows it after "Zum Generator"
  await page.evaluate((l) => window.__JUCE__.backend.emitByBackend('language', JSON.stringify(l)), system);
  await sleep(300);

  // the song, loaded as the user's own, analysed
  const analysis = await page.evaluate(async (path) => {
    const name = path.split(/[\\/]/).pop();
    window.bridge('loadFile', { path });
    for (let i = 0; i < 1200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const done = window.got.analysis.find((a) => a.name === name);
      if (done) return { ...done, at: undefined };
    }
    return null;
  }, wav);
  if (!analysis) throw new Error('the song was not analysed');
  await sleep(500);
  const analysed = JSON.parse(analysis.json);
  result.song = { key: `${analysed.key.root} ${analysed.key.mode}`, scale: analysed.scale, chords: [...new Set(analysed.chords.map((c) => c.chord))] };

  // the scale select: the entries of tables(), in the page's language, the analysis' scale chosen
  result.scales = await page.evaluate(async () => {
    const { session } = await import('/app/session.js');
    const { t } = await import('/app/i18n/index.js');
    const options = [...document.getElementById('scale').options].map((o) => `${o.value}=${o.textContent}`);
    return { same: JSON.stringify(options) === JSON.stringify(session.tables.SCALES.map((id) => `${id}=${t(`scale.${id}`)}`)), count: options.length, value: document.getElementById('scale').value };
  });
  if (!result.scales.same || result.scales.value !== analysed.scale) problems.push(`the scale select: ${JSON.stringify(result.scales)}, the analysis' scale ${analysed.scale}`);

  // it plays: the transport moves and the display follows
  await page.evaluate(() => window.bridge('playFile', { from: 0, rate: 1 }));
  await sleep(2500);
  result.playing = await page.evaluate(() => { const e = window.got.engine.at(-1); return { playing: e.playing, beats: +e.beats.toFixed(2), chord: document.getElementById('chord').textContent }; });
  await page.evaluate(() => window.bridge('stop'));
  await sleep(300);
  if (!result.playing.playing || result.playing.beats < 1 || result.playing.chord === '–') problems.push(`the song does not play: ${JSON.stringify(result.playing)}`);

  // the places: inside every chord the analysis found (a quarter second after its start) and just before the end
  const seek = async (t) => { await page.evaluate((beats) => window.bridge('seek', { beats }), t); await sleep(350); };
  const places = [];
  await page.locator('#zoom-all').click(); // the whole song in the lane: it draws every part
  for (const t of [...analysed.chords.map((c) => c.t + 0.25), analysis.seconds - 0.5]) {
    await seek(t);
    places.push({ t: +t.toFixed(2), ...(await look(page)), view: await shows(page, analysis.seconds) });
  }
  for (const p of places) for (const w of [...wrong(p), ...differs(p.view)]) problems.push(`at ${p.t} s ${w}`);
  if (!(await answeredRight(page))) problems.push('the answer to the page\'s question for the song is not the reference\'s (trackView)');
  result.places = { count: places.length, withDots: places.filter((p) => p.board).length, withNext: places.filter((p) => p.asked.next).length, withMarks: places.filter((p) => p.marks).length };
  if (!result.places.withDots || !result.places.withNext || !result.places.withMarks) problems.push(`the page shows no board, no next chord or no marked node: ${JSON.stringify(result.places)}`);

  // clicks on wheel nodes at one place: each enters the name the answer allows for the node into the bar at the playhead, and the page shows it
  await seek(analysed.chords[Math.floor(analysed.chords.length / 2)].t + 0.25);
  result.clicks = [];
  for (let i = 0; i < 4; i++) {
    const node = await page.evaluate(async (n) => {
      const { layoutWheel } = await import('/app/wheel-geometry.js');
      const a = JSON.parse(window.got.chordDisplays.at(-1).json);
      const shown = document.getElementById('chord').textContent;
      const allowed = a.wheel.nodes.filter((x) => x.allowed && x.allowed.name !== shown), d = allowed[n % allowed.length];
      const p = layoutWheel(document.getElementById('wheel').clientWidth).nodes[(d.ring === 'outer' ? 0 : 12) + d.index];
      return { name: d.allowed.name, x: p.x, y: p.y };
    }, i * 2);
    await page.locator('#wheel').click({ position: { x: node.x, y: node.y } });
    await sleep(400);
    const after = await page.evaluate(() => ({ chord: document.getElementById('chord').textContent,
      stored: Object.entries(localStorage).filter(([key]) => key.startsWith('btg.track.')).flatMap(([, v]) => Object.values(JSON.parse(v).edits ?? {})) }));
    result.clicks.push({ allowed: node.name, ...after });
    if (after.chord !== node.name || !after.stored.includes(node.name)) problems.push(`a click on the node of ${node.name}: the bar shows ${after.chord}, stored ${JSON.stringify(after.stored)}`);
  }
  // the question after the corrections above (back to none) gets its own answer, and the page shows it
  const edited = await page.evaluate(() => window.sent.filter((s) => s.type === 'trackView').length);
  await page.locator('#reset').click();
  await sleep(300);
  result.reset = { asked: await page.evaluate(() => window.sent.filter((s) => s.type === 'trackView').length) - edited, right: await answeredRight(page) };
  for (const w of differs(await shows(page, analysis.seconds))) problems.push(`after the corrections ${w}`);
  if (result.reset.asked !== 1 || !result.reset.right) problems.push(`the question after the corrections: ${JSON.stringify(result.reset)} (asked once, the reference's answer)`);
  await page.screenshot({ path: join(out, 'track-page.png') });

  // two quick inputs are two (Task 32f), both in one task of the page, before the engine reports the first: the play key and then Space start and stop (not start
  // twice); ArrowRight twice in the lane goes one bar on and then another
  result.quick = {};
  result.quick.play = await page.evaluate(() => {
    const from = window.sent.length;
    document.getElementById('play').click();
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    return window.sent.slice(from).map((s) => s.type);
  });
  await sleep(1100); // the page's last wish (the stop) gives way after a second: the seek below, through the bridge, is none of the page's
  await page.evaluate(() => window.bridge('stop'));
  await seek(0);
  result.quick.arrows = await page.evaluate(() => {
    const lane = document.getElementById('lane'), from = window.sent.length;
    for (let i = 0; i < 2; i++) lane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    return window.sent.slice(from).filter((s) => s.type === 'seek').map((s) => s.beats);
  });
  await sleep(300);
  // ... and so from a tenth of a second before a bar's end, with a report of the engine from before the first key arriving between the two (as one the shell sent
  // before it took the seek): the first seek lies near the place reported, and that report must not end what the page asked for
  const third = await page.evaluate(() => JSON.parse(window.got.trackView.at(-1).json).bars[2].end);
  await seek(third - 0.1);
  result.quick.late = await page.evaluate(() => {
    const lane = document.getElementById('lane'), from = window.sent.length, report = { ...window.got.engine.at(-1), at: undefined };
    const right = () => lane.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    right();
    window.__JUCE__.backend.emitByBackend('engine', JSON.stringify(report));
    right();
    return window.sent.slice(from).filter((s) => s.type === 'seek').map((s) => s.beats);
  });
  await sleep(300);
  // ... and a seek and an entry at once (ArrowRight in the lane, then a chord in the bar select, in one task): the chord goes into the bar sought, not
  // into the one the engine reported last (the page's last wish, of the keys above, has given way after a second)
  await sleep(1100);
  await seek(0);
  result.quick.edit = await page.evaluate(() => {
    const select = document.getElementById('edit'), firsts = JSON.parse(window.got.trackView.at(-1).json).bars.slice(0, 2).map((b) => b.first);
    document.getElementById('lane').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    const edits = Object.entries(localStorage).filter(([key]) => key.startsWith('btg.track.')).map(([, v]) => JSON.parse(v).edits ?? {});
    return { firsts, edited: edits.flatMap((e) => Object.keys(e).map(Number)) };
  });
  await page.locator('#reset').click(); // the song as analysed for the steps below
  await sleep(300);
  if (JSON.stringify(result.quick.edit.edited) !== JSON.stringify([result.quick.edit.firsts[1]]))
    problems.push(`ArrowRight and at once a chord in the bar select: the chord went into the bars starting at beat ${JSON.stringify(result.quick.edit.edited)}, not into the second bar (${result.quick.edit.firsts[1]})`);
  if (!(result.quick.late.length === 2 && result.quick.late[1] > result.quick.late[0])) problems.push(`ArrowRight twice at once near a bar's end, a late report between, sought ${JSON.stringify(result.quick.late)}, not two bars on`);
  if (JSON.stringify(result.quick.play) !== '["playFile","stop"]') problems.push(`the play key and then Space at once sent ${JSON.stringify(result.quick.play)}, not a start and a stop`);
  if (!(result.quick.arrows.length === 2 && result.quick.arrows[1] > result.quick.arrows[0])) problems.push(`ArrowRight twice at once sought ${JSON.stringify(result.quick.arrows)}, not two bars on`);

  // the window minimised for a moment and restored, as a user does: the page stays loaded with the song and its view (the same document, no
  // navigation, the song's name, its parts and the scale as before)
  const view = () => page.evaluate(() => ({ origin: performance.timeOrigin, title: document.getElementById('title').textContent,
    parts: [...document.getElementById('sections').children].map((b) => b.textContent), scale: document.getElementById('scale').value })).catch((e) => ({ failed: e.message.split('\n')[0] }));
  const navigatedBefore = navigated.length, beforeHidden = await view();
  showWindow(run.app, 'minimise');
  await sleep(1500);
  showWindow(run.app, 'restore');
  await sleep(2000);
  result.hidden = { before: beforeHidden, after: await view(), navigations: navigated.slice(navigatedBefore) };
  if (result.hidden.after.failed || JSON.stringify(result.hidden.after) !== JSON.stringify(beforeHidden) || result.hidden.navigations.length || !beforeHidden.parts.length)
    problems.push(`the window minimised and restored: the page did not stay as it was: ${JSON.stringify(result.hidden)}`);

  // An analysis as the app gives it: two bars, Am F C G twice, Dm held four bars, Am F C G twice, in which the page finds free parts and a pattern at two places
  // (the reloads below bring the song's own analysis back). The page shows the free part at its start as the core's answer says (Task 32f) ...
  const P4 = ['Am', 'F', 'C', 'G'], two = ['Bb', 'Eb', ...P4, ...P4, 'Dm', 'Dm', 'Dm', 'Dm', ...P4, ...P4];
  const twice = { ...analysed, beatsPerBar: 4, meter: '4/4', beat1: 0, bars: two.map((_, m) => 4 * m), beats: Array.from({ length: 4 * two.length }, (_, k) => +(0.3 + 0.4 * k).toFixed(3)),
    chords: two.map((chord, m) => ({ t: +(0.3 + 1.6 * m).toFixed(3), end: +(1.9 + 1.6 * m).toFixed(3), chord })) };
  await page.evaluate((m) => window.__JUCE__.backend.emitByBackend('analysis', JSON.stringify(m)), { ...analysis, json: JSON.stringify(twice) });
  await page.waitForFunction(() => document.querySelectorAll('#sections button').length === 2, null, { timeout: 5000 }).catch(() => {});
  await page.locator('#zoom-all').click();
  await seek(0);
  result.free = await shows(page, analysis.seconds);
  for (const w of differs(result.free)) problems.push(`in the free part ${w}`);
  if (!result.free.wanted?.lane.includes('–')) problems.push(`the song of two places has no free part: ${JSON.stringify(result.free.wanted?.lane)}`);
  // ... and a pattern's key twice at once (Task 32f) goes to the pattern's next place and then to the one after
  result.quick.pattern = await page.evaluate(() => {
    const button = document.querySelector('#sections button'), from = window.sent.length;
    button?.click();
    button?.click();
    return window.sent.slice(from).filter((s) => s.type === 'seek').map((s) => s.beats);
  });
  if (!(result.quick.pattern.length === 2 && result.quick.pattern[0] !== result.quick.pattern[1])) problems.push(`a pattern's key twice at once sought ${JSON.stringify(result.quick.pattern)}, not two of its places`);

  // the events in the other order, forced: the lists (tables) held back over a load and the analysis sent before them, as when it lands first
  await page.evaluate(() => sessionStorage.setItem('btg.hold', 'tables'));
  await page.reload();
  await page.waitForLoadState('load');
  await sleep(500);
  // with another scale than the list's first entry (the song's own, minor pentatonic, is the first: a select that lost it would show it all the same)
  const early = { ...analysis, json: JSON.stringify({ ...analysed, scale: 'dorian' }) };
  await page.evaluate((m) => window.__JUCE__.backend.emitByBackend('analysis', JSON.stringify(m)), early);
  await sleep(500);
  // the select as the lists build it, read in the same turn (the analysis the page then asks for again with `hello` cannot have come yet)
  result.analysisFirst = await page.evaluate(() => {
    const before = { options: document.getElementById('scale').options.length, title: document.getElementById('title').textContent };
    window.release();
    return { ...before, scale: document.getElementById('scale').value };
  });
  await ready();
  await sleep(500);
  if (result.analysisFirst.options !== 0 || result.analysisFirst.title !== analysis.name || result.analysisFirst.scale !== 'dorian')
    problems.push(`an analysis before the lists: ${JSON.stringify(result.analysisFirst)} (its scale: dorian)`);
  // ... and every answer to the page's questions lost over a load: a click on the wheel before any answer, then the page shown again (pageshow)
  await page.evaluate(() => sessionStorage.setItem('btg.hold', 'chordDisplays'));
  await page.reload();
  await ready();
  await page.waitForFunction(() => window.got.analysis.length && window.sent.some((s) => s.type === 'chordDisplays' && JSON.parse(s.json).current), null, { timeout: 15000 });
  await sleep(300);
  const top = await page.evaluate(async () => { const { layoutWheel } = await import('/app/wheel-geometry.js'); const n = layoutWheel(document.getElementById('wheel').clientWidth).nodes[0]; return { x: n.x, y: n.y }; });
  await page.locator('#wheel').click({ position: top });
  await sleep(300);
  const lost = await page.evaluate(() => ({ dropped: window.drop(), asked: window.sent.filter((s) => s.type === 'chordDisplays').length }));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await sleep(500);
  const again = await look(page);
  result.lostAnswers = { ...lost, askedAfter: await page.evaluate(() => window.sent.filter((s) => s.type === 'chordDisplays').length), wrong: wrong(again) };
  if (!(lost.dropped > 0) || result.lostAnswers.askedAfter <= lost.asked || result.lostAnswers.wrong.length || !again.marks)
    problems.push(`answers lost, then pageshow: ${JSON.stringify(result.lostAnswers)}`);
  // ... and the answer to the question for a song that comes anew lost too (Task 32f): until an answer comes the page shows the song without bars, changes and parts
  // (not the song before); on pageshow it asks that question again and shows its answer
  const views = () => page.evaluate(() => window.sent.filter((s) => s.type === 'trackView').length);
  await page.evaluate(() => sessionStorage.setItem('btg.hold', 'trackView'));
  const before = { shown: await shows(page, analysis.seconds), asked: await views() };
  await page.evaluate((m) => window.__JUCE__.backend.emitByBackend('analysis', JSON.stringify(m)), analysis);
  await sleep(500);
  result.newSong = await page.evaluate(() => ({ buttons: document.querySelectorAll('#sections button').length, position: document.getElementById('position').textContent, parts: window.laneTexts }));
  Object.assign(result.newSong, { partsBefore: before.shown.shown?.lane, askedOnAnalysis: (await views()) - before.asked, dropped: await page.evaluate(() => window.drop()) });
  const asked = await views();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await sleep(500);
  await page.locator('#zoom-all').click(); // the analysis set the zoom anew: the whole song in the lane again, so that it draws every part
  await sleep(200);
  Object.assign(result.newSong, { askedOnPageshow: (await views()) - asked, wrong: differs(await shows(page, analysis.seconds)) });
  if (!result.newSong.partsBefore?.length || result.newSong.buttons || result.newSong.position !== '–' || result.newSong.parts.length || result.newSong.askedOnAnalysis !== 1 || result.newSong.dropped !== 1)
    problems.push(`a song that comes anew, its answer held back: the page does not show it without bars, changes and parts: ${JSON.stringify(result.newSong)}`);
  if (result.newSong.askedOnPageshow !== 1 || result.newSong.wrong.length) problems.push(`a song whose answer was lost, then pageshow: ${JSON.stringify(result.newSong)}`);

  // "Zum Generator" leads to the generator's page, drawn (from the session: its variant; its title is written by the page) in the language chosen here
  await Promise.all([page.waitForURL(/\/app\/index\.html$/, { timeout: 15000 }), page.locator('#generator').click()]);
  await page.waitForFunction(() => document.getElementById('variant')?.value, null, { timeout: 15000 });
  result.languages.back = await page.evaluate(() => ({ path: location.pathname, lang: document.documentElement.lang, title: document.title }));
  if (JSON.stringify(result.languages.back) !== JSON.stringify({ path: '/app/index.html', lang: system, title: { de, en }[system]['ui.title'] }))
    problems.push(`"Zum Generator" or the language chosen on the own songs' page: ${JSON.stringify(result.languages.back)}`);
} catch (error) {
  problems.push(`the check stopped: ${error.message.split('\n')[0]}`);
} finally {
  await quit();
  try { rmSync(work, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }); } catch (error) { console.error(`track-page-check: could not remove ${work}: ${error.message}`); }
}
result.problems = [...new Set(problems)];
writeFileSync(join(out, 'track-page-check.json'), JSON.stringify(result, null, 2));
process.exitCode = result.problems.length ? 1 : 0;
await new Promise((done) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, done));
