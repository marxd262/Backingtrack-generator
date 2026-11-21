// Checks the web UI inside the real app: starts the app with the WebView2 debug port, attaches Playwright,
// records console errors and failed requests, plays, and measures what the engine reports back:
// position, levels, reaction time of controls at the buffer sizes given, jump and loop.
// Usage: node native/tools/ui-check.mjs [app.exe] [output folder]
// The app runs muted (BTG_MUTE): levels are measured, nothing is heard.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildEvents } from '../../src/index.js';
import { VOICES } from '../../src/core/voices.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.argv[2] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const out = process.argv[3] ?? join(repo, '.superpowers/native-screens');
mkdirSync(out, { recursive: true });
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
  return { n: sorted.length, mean: +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2), median: at(0.5), p95: at(0.95), max: at(1) };
};

const app = spawn(exe, [], { env: { ...process.env, BTG_MUTE: '1', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; !browser && i < 40; i++) {
    await sleep(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null);
  }
  if (!browser) throw new Error('WebView2 debug port did not open');
  let page;
  for (let i = 0; !page && i < 40; i++) { // the port opens before the page has its address
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('juce.backend'));
    if (!page) await sleep(250);
  }
  if (!page) throw new Error(`no page from the resource provider: ${browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()).join(', ') || 'no pages'}`);

  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
  let requests = 0;
  page.on('request', () => requests++);
  await page.waitForLoadState('load'); // a first load still running would be cut off by the reload and count as failed requests
  await page.evaluate(() => localStorage.setItem('backingtrack.lang', 'de')); // the checks below read German labels, whatever language the app was left in
  await page.reload(); // listeners attached first, so load errors are seen
  await page.locator('#go').waitFor({ state: 'visible', timeout: 15000 });
  await sleep(500);
  await page.screenshot({ path: join(out, '1-start.png') });

  // Everything the engine sends with its arrival time, and everything the UI sends with its send time.
  await page.evaluate(() => {
    const backend = window.__JUCE__.backend;
    window.engineLog = [];
    window.sent = [];
    window.pongs = new Map();
    backend.addEventListener('engine', (m) => window.engineLog.push({ ...m, at: performance.now() }));
    backend.addEventListener('pong', (m) => window.pongs.get(m.id)?.(performance.now()));
    window.voiceLog = [];
    window.voiceAt = []; // the arrival time of each entry of voiceLog
    backend.addEventListener('voices', (m) => { window.voiceLog.push(m); window.voiceAt.push(performance.now()); });
    backend.addEventListener('pack', (m) => (window.packLog ??= []).push(m));
    const emit = backend.emitEvent.bind(backend);
    backend.emitEvent = (name, data) => { window.sent.push({ ...data, at: performance.now() }); emit(name, data); };
    window.bridge = (type, data = {}) => emit('btg', { type, ...data });
    window.lastEngine = () => window.engineLog.at(-1);
  });
  const engine = async (ms) => {
    await page.evaluate(() => { window.engineLog.length = 0; });
    await sleep(ms);
    const log = await page.evaluate(() => window.engineLog);
    const first = log[0], last = log.at(-1);
    const seconds = (last.at - first.at) / 1000;
    // how far the UI's running-on position is off when the next message arrives
    const errors = log.slice(1).map((m, i) => Math.abs(log[i].beats + ((m.at - log[i].at) / 1000) * (log[i].bpm / 60) - m.beats) * (60000 / m.bpm));
    const peak = (name) => +Math.max(...log.map((m) => m.peaks?.[name] ?? 0)).toFixed(3);
    return {
      clockErrorMs: last.playing ? { mean: +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1), max: +Math.max(...errors).toFixed(1) } : undefined,
      messagesPerSecond: +((log.length - 1) / seconds).toFixed(1),
      playing: last.playing,
      bpmReported: last.bpm,
      bpmMeasured: +(((last.beats - first.beats) / seconds) * 60).toFixed(1),
      peaks: Object.fromEntries(['drums', 'bass', 'chords', 'pad', 'lead', 'percussion', 'master'].map((n) => [n, peak(n)])),
      error: last.error || undefined,
    };
  };
  const setRange = (id, value) => page.evaluate(([i, v]) => {
    const input = document.getElementById(i);
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, String(value)]);
  const result = { requests, idle: await engine(1000) };

  await page.evaluate(() => { // the lead's default job plays nothing: give it a melody, as the user does with the job menu
    const job = document.getElementById('job-lead');
    job.value = 'melody';
    job.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The lead: the engine's clock stands for 0.15 s after a start, and the page must not show a position (a bar) before the clock moves.
  // The first text the page's position field shows after the click, against the first engine report whose beats have left the start.
  await page.evaluate(() => {
    window.posShown = [];
    const field = document.getElementById('play-position');
    new MutationObserver(() => window.posShown.push({ at: performance.now(), text: field.textContent })).observe(field, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  const clickedAt = await page.evaluate(() => performance.now());
  await page.locator('#go').click();
  await sleep(1500);
  result.lead = await page.evaluate((from) => {
    const start = window.sent.findLast((s) => s.type === 'play')?.startBeats;
    const shown = window.posShown.find((m) => m.at > from && /\d/.test(m.text));
    const moved = window.engineLog.find((m) => m.at > from && m.playing && m.beats > start + 1e-6);
    return { startBeats: start, shownAt: shown && +shown.at.toFixed(1), clockMovedAt: moved && +moved.at.toFixed(1), shownBeforeClockMovedMs: shown && moved ? +(moved.at - shown.at).toFixed(1) : null, standingReports: window.engineLog.filter((m) => m.at > from && m.playing && m.beats <= start + 1e-6).length };
  }, clickedAt);
  if (result.lead.shownBeforeClockMovedMs === null) problems.push(`lead: the position never showed or the clock never moved: ${JSON.stringify(result.lead)}`);
  else if (result.lead.shownBeforeClockMovedMs > 10) problems.push(`lead: the page showed its position ${result.lead.shownBeforeClockMovedMs} ms before the engine's clock moved (it runs on during the lead)`);
  result.voices = await page.evaluate(() => window.voiceLog.at(-1) ?? null);
  if (result.voices?.drums !== 'ready' || result.voices?.bass !== 'ready') problems.push(`voices after the start: ${JSON.stringify(result.voices)}`);
  await page.evaluate(() => window.bridge('seek', { beats: 24 })); // past the intro of a rolled form: drums and bass play
  await sleep(600);
  result.playing = await engine(4000);
  // 8 s of play: per switched-on layer the loudest level the engine reported and whether its light went on.
  // A layer that lights up must sound; drums and bass play past the intro in every style.
  const startXruns = await page.evaluate(() => window.lastEngine().xruns);
  result.layers = await page.evaluate(async () => {
    const on = [...document.querySelectorAll('#lane-buttons [data-layer]')].filter((b) => b.dataset.muted === 'false').map((b) => b.dataset.layer);
    const lit = new Set();
    const watch = new MutationObserver((list) => { for (const m of list) if (/\b(hit|sound)\b/.test(m.target.className)) lit.add(m.target.dataset.activity ?? m.target.dataset.layer); });
    for (const el of document.querySelectorAll('.led[data-activity], #lane-buttons [data-layer]')) watch.observe(el, { attributes: true, attributeFilter: ['class'] });
    window.engineLog.length = 0;
    await new Promise((r) => setTimeout(r, 8000));
    watch.disconnect();
    return Object.fromEntries(on.map((layer) => [layer, { lit: lit.has(layer), peak: +Math.max(0, ...window.engineLog.map((m) => m.peaks?.[layer] ?? 0)).toFixed(3) }]));
  });
  for (const [layer, { lit, peak }] of Object.entries(result.layers)) if (lit && !(peak > 0)) problems.push(`${layer}: its light goes on, but it is silent`);
  for (const layer of ['drums', 'bass']) if (!(result.layers[layer]?.peak > 0)) problems.push(`${layer}: silent after the start`);
  // All six layers: switch each on with its mute key, seek to its first note or hit in the track the page sent, and read its level.
  // Every switched-on layer must show a level above 0; a layer without any event in the track cannot show that and fails too.
  await page.evaluate(() => { for (const key of document.querySelectorAll('button[data-mute]')) if (key.getAttribute('aria-pressed') === 'true') key.click(); });
  const sentTrack = JSON.parse(await page.evaluate(() => window.sent.findLast((s) => s.type === 'track').json));
  const events = buildEvents({ ...sentTrack, layers: Object.fromEntries(Object.keys(sentTrack.layers).map((id) => [id, true])) }); // where the layers play, whatever the page sent
  result.everyLayer = {};
  for (const layer of ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion']) {
    const first = events.find((e) => e.layer === layer && (e.type === 'note' || e.type === 'hit'));
    if (!first) { result.everyLayer[layer] = 'no event in the track'; problems.push(`${layer}: the track has no note or hit for it`); continue; }
    const beat = (first.t * sentTrack.bpm) / 60;
    await page.evaluate((b) => { window.bridge('seek', { beats: b }); window.engineLog.length = 0; }, Math.max(0, beat - 0.5));
    await sleep(2500);
    const state = await page.evaluate((l) => ({ muted: document.querySelector(`#lane-buttons [data-layer="${l}"]`).dataset.muted, peak: +Math.max(0, ...window.engineLog.map((m) => m.peaks?.[l] ?? 0)).toFixed(3) }), layer);
    result.everyLayer[layer] = { firstBeat: +beat.toFixed(2), ...state };
    if (state.muted !== 'false') problems.push(`${layer}: could not be switched on`);
    else if (!(state.peak > 0)) problems.push(`${layer}: switched on, but its level stays 0`);
  }
  // a voice change while playing: the chords switch to another sample guitar, the engine reports it ready, no error
  result.voiceChange = await page.evaluate(async () => {
    const select = document.getElementById('voice-chords');
    const next = select.value === 'sample/funk' ? 'sample/jazz' : 'sample/funk';
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2000));
    const sent = window.sent.filter((s) => s.type === 'voices').at(-1);
    return { next, sent: sent ? JSON.parse(sent.json).chords : null, status: window.voiceLog.at(-1)?.chords ?? null, peak: window.lastEngine().peaks?.chords ?? null };
  });
  if (`${result.voiceChange.sent?.id}/${result.voiceChange.sent?.variant}` !== result.voiceChange.next || result.voiceChange.status !== 'ready') problems.push(`voice change: ${JSON.stringify(result.voiceChange)}`);
  const afterBand = await page.evaluate(() => window.lastEngine());
  result.dropoutsWhilePlaying = afterBand.xruns - startXruns;
  result.loadWhilePlaying = +afterBand.load.toFixed(3);
  if (result.dropoutsWhilePlaying > 0) problems.push(`dropouts while playing: ${result.dropoutsWhilePlaying}`);
  if (afterBand.load > 0.25) problems.push(`engine load ${(100 * afterBand.load).toFixed(1)} % (limit 25 %)`);
  // Every layer effect (Tasks 18 and 19): fuzz, overdrive, distortion, vibrato and chorus of bass, chords, pad and lead at 1, so every chain
  // is built and computes each frame; 4 s of play: the load stays under the plan's 25 %, no dropout, the bass keeps a level. That the effects
  // reach the engine: the same 4 s from beat 64 (each pass begins with a `play` there, so both play the same notes) first with the page's
  // own timbre, then with every effect on; the largest change of an fx layer's peak between the passes must be at least 1.5 dB (measured
  // in two runs, whose songs differ: bass -3.5 and -2.6, chords -2.2 and +0.2, lead -2.7 and -4.6 dB; with the knobs left at the page's
  // values every layer's change is 0.00 dB). Then the page's own timbre again.
  result.effects = await page.evaluate(async () => {
    const before = window.sent.findLast((s) => s.type === 'timbre').json, timbre = JSON.parse(before);
    for (const layer of ['bass', 'chords', 'pad', 'lead']) Object.assign(timbre[layer], { fuzz: 1, overdrive: 1, distortion: 1, vibrato: 1, chorus: 1 });
    const bpm = window.sent.findLast((s) => s.type === 'play').bpm;
    const pass = async (json) => { // 4 s from beat 64, the layers' peaks
      window.bridge('timbre', { json });
      window.bridge('play', { startBeats: 64, bpm });
      window.engineLog.length = 0;
      await new Promise((r) => setTimeout(r, 4000));
      return Object.fromEntries(['bass', 'chords', 'pad', 'lead'].map((l) => [l, +Math.max(0, ...window.engineLog.map((m) => m.peaks?.[l] ?? 0)).toFixed(3)]));
    };
    const plain = await pass(before);
    const start = window.lastEngine();
    const peaks = await pass(JSON.stringify(timbre));
    const end = window.lastEngine();
    window.bridge('timbre', { json: before });
    const gainDb = Object.fromEntries(Object.keys(peaks).map((l) => [l, plain[l] > 0 && peaks[l] > 0 ? +(20 * Math.log10(peaks[l] / plain[l])).toFixed(2) : null]));
    return { load: +end.load.toFixed(3), dropouts: end.xruns - start.xruns, plain, peaks, gainDb };
  });
  if (result.effects.dropouts > 0) problems.push(`dropouts with every effect on: ${result.effects.dropouts}`);
  if (!(result.effects.load <= 0.25)) problems.push(`engine load with every effect on ${(100 * result.effects.load).toFixed(1)} % (limit 25 %)`);
  if (!(result.effects.peaks.bass > 0)) problems.push('bass: no level with every effect on');
  const moved = Math.max(0, ...Object.values(result.effects.gainDb).filter((g) => g !== null).map(Math.abs));
  if (!(moved >= 1.5)) problems.push(`effects: no layer's peak changes with every effect on (dB against the page's timbre): ${JSON.stringify(result.effects.gainDb)}`);
  // The helpers of the voice steps below (the e-piano's, the organ's, the classic synth's), in the page.
  await page.evaluate(() => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.peakOf = (log, layer, digits = 4) => +Math.max(0, ...log.map((m) => m.peaks?.[layer] ?? 0)).toFixed(digits);
    window.pageOwn = () => { // what the page sent last: its track, voices (the track's when it sent none), tuning and sound
      const last = (type) => window.sent.findLast((s) => s.type === type)?.json;
      const own = { track: last('track'), tuning: last('tuning') ?? '{}', timbre: last('timbre') };
      own.voices = last('voices') ?? JSON.stringify(JSON.parse(own.track).voices);
      return own;
    };
    window.voicesReported = async (send) => { // the engine's next `voices` event after send(), null when none comes within 3 s
      const before = window.voiceLog.length;
      send();
      for (let i = 0; i < 30 && window.voiceLog.length === before; i++) await window.wait(100);
      return window.voiceLog.length > before ? window.voiceLog.at(-1) : null;
    };
    // a play from beat 0: its reports from beat 0.2 (not the lead, nor the tail of what played before the `play`) to the engine's first
    // report of beat `until`, waiting at most tries x 0.1 s; null when that report does not come
    window.playUntil = async (bpm, until, tries) => {
      window.engineLog.length = 0;
      window.bridge('play', { startBeats: 0, bpm });
      const span = () => { const from = window.engineLog.findIndex((m) => m.playing && m.beats < 0.2); return from < 0 ? [] : window.engineLog.slice(from); };
      for (let i = 0; i < tries && !span().some((m) => m.beats >= until); i++) await window.wait(100);
      const log = span(), end = log.findIndex((m) => m.beats >= until);
      return end < 0 ? null : log.slice(0, end + 1).filter((m) => m.beats >= 0.2);
    };
    // playUntil with the timbre `json` sent before it: the layers' peaks, the load at its end, the dropouts during it
    window.passWith = async (json, bpm, until, tries, layers) => {
      window.bridge('timbre', { json });
      const xruns = window.lastEngine().xruns, log = await window.playUntil(bpm, until, tries), end = window.lastEngine();
      return { peaks: Object.fromEntries(layers.map((l) => [l, log ? window.peakOf(log, l) : null])), load: +end.load.toFixed(3), dropouts: end.xruns - xruns };
    };
    window.everyEffect = (sound) => { // the sound with every layer effect on, as the effects phase sets them
      const every = structuredClone(sound);
      for (const l of ['bass', 'chords', 'pad', 'lead']) Object.assign(every[l], { fuzz: 1, overdrive: 1, distortion: 1, vibrato: 1, chorus: 1 });
      return every;
    };
    // the page's own track, voices, tuning and sound again (`own` from pageOwn), shown by a play from beat 64: the `voices` event of the
    // page's voices and the page's drums' peak over 2 s of it
    window.restorePage = async (own) => {
      window.bridge('track', { json: own.track });
      const restored = await window.voicesReported(() => window.bridge('voices', { json: own.voices }));
      window.bridge('tuning', { json: own.tuning });
      window.bridge('timbre', { json: own.timbre });
      window.bridge('play', { startBeats: 64, bpm: window.sent.findLast((s) => s.type === 'play').bpm });
      await window.wait(500);
      window.engineLog.length = 0;
      await window.wait(2000);
      return { restored, drumsBack: window.peakOf(window.engineLog, 'drums') };
    };
  });
  // The e-piano (Task 21): the page's chords voice set to chords/epiano/rhodes through the bridge, as the page sends `voices` (the voices it
  // sent last, the chords changed); the engine's `voices` event reports the chords ready, 4 s of play from beat 64 give them a level; then
  // the page's own voices again. Red when the core has no voice for the key (the chords stay silent).
  result.epiano = await page.evaluate(async () => {
    const own = window.pageOwn().voices;
    const chords = async (send) => (await window.voicesReported(send))?.chords ?? 'no voices event';
    const status = await chords(() => window.bridge('voices', { json: JSON.stringify({ ...JSON.parse(own), chords: { id: 'epiano', variant: 'rhodes' } }) }));
    window.bridge('play', { startBeats: 64, bpm: window.sent.findLast((s) => s.type === 'play').bpm });
    window.engineLog.length = 0;
    await window.wait(4000);
    const peak = window.peakOf(window.engineLog, 'chords', 3), load = +window.lastEngine().load.toFixed(3);
    return { status, peak, load, restored: await chords(() => window.bridge('voices', { json: own })) };
  });
  if (result.epiano.status !== 'ready' || !(result.epiano.peak > 0) || result.epiano.restored !== 'ready') problems.push(`e-piano: ${JSON.stringify(result.epiano)}`);
  // A failed queued message of any type shows in the strip as a failed track's (Phase 5's fix wave, PluginEditor.cpp done()): a `pack`
  // message for a pack that does not exist fails, and the engine's reports then carry its failure as `error`; the page's own track sent
  // after it clears it as a track clears it. Then the page's own track, voices, tuning and sound again. Red when done() takes a failure
  // only from a track or voices (it returned before it for every other type). A timbre's or tuning's text never fails (engine.h: no valid
  // JSON counts as the default), only a voice or convolver that cannot be built (out of memory), which a page cannot cause.
  result.failure = await page.evaluate(async () => {
    const own = window.pageOwn();
    const errorAfter = async (send) => { send(); await window.wait(600); return window.lastEngine().error ?? ''; };
    const shown = await errorAfter(() => window.bridge('pack', { id: 'ui-check-no-such-pack' }));
    const cleared = await errorAfter(() => window.bridge('track', { json: own.track }));
    const { restored, drumsBack } = await window.restorePage(own);
    return { shown, cleared, restored, drumsBack };
  });
  if (!result.failure.shown.includes('ui-check-no-such-pack') || result.failure.cleared !== '' || !(result.failure.drumsBack > 0))
    problems.push(`a failed message: ${JSON.stringify(result.failure)}`);
  // The organ (Task 20): a track of the step's own, sent through the bridge as the page sends `track` (with its voices), so that both passes
  // play the same known notes: the track of organ.json's case organ-rock-drive-0 (the chords alone on chords/organ/rock, a verse with the
  // swell pedal at -3 dB and a chorus at 0 dB, 8 bars at 124 bpm), with that case's sound. Why it shows the drive: the tube's curve keeps a
  // chord at the pre-drive level 0.4 (organ.js DRIVE_REF) and flattens what lies above it, and the chorus's chords reach above it. The
  // engine's `voices` event reports the chords ready. The drive as the page's organ panel sends it (src/ui/organ-tuning.js organTuning: the
  // same override for all four presets): two passes of the whole song from beat 0, drive 0, then drive 1, each closed by the engine's first
  // report of beat 32 (the song's end: a report a hair past it adds nothing, the song's first 0.1 s are silent) and leaving out the reports
  // before beat 0.2 (the lead, and the tail of what played before the `play`). Predicted offline with the core before measuring (btg_render,
  // dry, this track, sound and drive; t20-r1-predict.mjs of Task 20's fix round 1): the chords' peak 0.6536 at beat 29.78 with drive 0,
  // 0.4710 at beat 17.07 with drive 1: -2.84 dB. The app measures -3.61 dB (1.1663 and 0.7701, the same in every run): its `play` has the
  // lead of 0.15 s, so the song begins 32 frames into a render quantum, not on its first frame as in btg_render, which moves the Leslie
  // LFOs' first quantum; the core played as the app plays it (the lead, blocks of 480, takePeak: t20-r1-lead-probe.cpp) gives these figures
  // to four digits. The measure, fixed before measuring: the chords' largest reported peak with drive 1
  // against drive 0 differs by at least 1.5 dB, both have a level, the drums none (the track has no drums). Red when the core ignores the
  // drive (both passes play the preset's 0.5). Then the page's own track, voices, tuning and sound again, shown by a play from beat 64 in
  // which the page's drums have a level.
  const organCase = JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases/organ.json'), 'utf8')).find((c) => c.name === 'organ-rock-drive-0');
  result.organ = await page.evaluate(async ([track, sound]) => {
    const own = window.pageOwn();
    const chords = async (send) => (await window.voicesReported(send))?.chords ?? 'no voices event';
    window.bridge('timbre', { json: JSON.stringify(sound) });
    const status = await chords(() => window.bridge('track', { json: JSON.stringify(track) }));
    const pass = (drive) => { // the reports from beat 0.2 to the first of beat 32, of a play from beat 0
      window.bridge('tuning', { json: JSON.stringify(Object.fromEntries(['jazz', 'rock', 'gospel', 'ballad'].map((v) => [`chords/organ/${v}`, { drive }]))) });
      return window.playUntil(track.bpm, 32, 250);
    };
    const passes = [await pass(0), await pass(1)];
    const [drive0, drive1] = passes.map((log) => (log ? window.peakOf(log, 'chords') : null)), drums = Math.max(...passes.map((log) => (log ? window.peakOf(log, 'drums') : 0)));
    const load = +window.lastEngine().load.toFixed(3);
    const back = await window.restorePage(own);
    return { status, drive0, drive1, gainDb: drive0 > 0 && drive1 > 0 ? +(20 * Math.log10(drive1 / drive0)).toFixed(2) : null, drums, load,
      restored: back.restored?.chords ?? 'no voices event', drumsBack: back.drumsBack };
  }, [organCase.track, organCase.sound]);
  if (result.organ.status !== 'ready' || !(result.organ.drive0 > 0) || !(result.organ.drive1 > 0) || !(Math.abs(result.organ.gainDb) >= 1.5) || result.organ.drums !== 0
    || result.organ.restored !== 'ready' || !(result.organ.drumsBack > 0))
    problems.push(`organ: ${JSON.stringify(result.organ)}`);
  // The classic synth (Task 22) on bass, chords, pad and lead: a track of the step's own, sent through the bridge as the page sends `track`,
  // the track of band.json's case band-funk (all six layers with sample voices, 100 bpm; bass, chords, pad and lead each have a note at beat
  // 0), with that case's sound. Then the four layers set to synth/classic as the page sends `voices` (the track's voices, those four
  // changed): the engine's `voices` event reports all four ready, and a play from beat 0 up to the engine's first report of beat 8 (the
  // reports from beat 0.2 on, as the organ's) gives each of the four a level. Red when the core has no voice for one of the keys (that layer
  // is reported silent and has no level). Then the page's own track, voices,
  // tuning and sound again, shown by a play from beat 64 in which the page's drums have a level.
  const bandCase = JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases/band.json'), 'utf8')).find((c) => c.name === 'band-funk');
  result.classic = await page.evaluate(async ([track, sound]) => {
    const LAYERS = ['bass', 'chords', 'pad', 'lead'];
    const own = window.pageOwn();
    window.bridge('timbre', { json: JSON.stringify(sound) });
    await window.voicesReported(() => window.bridge('track', { json: JSON.stringify(track) }));
    const voices = { ...track.voices, ...Object.fromEntries(LAYERS.map((l) => [l, { id: 'synth', variant: 'classic' }])) };
    const status = await window.voicesReported(() => window.bridge('voices', { json: JSON.stringify(voices) }));
    const played = await window.playUntil(track.bpm, 8, 100);
    const peaks = Object.fromEntries(LAYERS.map((l) => [l, played && window.peakOf(played, l)]));
    const load = +window.lastEngine().load.toFixed(3);
    const { restored, drumsBack } = await window.restorePage(own);
    return { status: status && Object.fromEntries(LAYERS.map((l) => [l, status[l]])), peaks, load, restored, drumsBack };
  }, [bandCase.track, bandCase.sound]);
  if (!['bass', 'chords', 'pad', 'lead'].every((l) => result.classic.status?.[l] === 'ready' && result.classic.peaks[l] > 0 && result.classic.restored?.[l] === 'ready')
    || !(result.classic.drumsBack > 0))
    problems.push(`classic: ${JSON.stringify(result.classic)}`);
  // Every layer on its synth voice ("alle Synth", Task 23): the page's own key #all-voices (src/ui/mixer.js 72 to 81, setAllVoices) pressed
  // until the page shows the synth kind (from 'mixed' the first press chooses the samples): the `voices` message the page sends then names
  // a voice whose registry kind is not 'sample' on all six layers, and the engine's `voices` event reports all six ready. Then a track of
  // the step's own, sent through the bridge as the organ's step does: band-synth.json's case band-synth-funk (every layer on synth/classic,
  // 100 bpm; drums and percussion from beat 16), with that case's sound, played from beat 0 to the engine's first report of beat 20 (the
  // reports from beat 0.2 on, as the organ's): each of the six layers has a level. The same span again with every layer effect on (as the
  // effects phase sets them): the load the engine reports (the slowly falling peak of the audio callback's share of its block) is at most
  // 0.25 and no dropout comes (phase 5 ruling 12). Red when makeVoice has no voice for drums/synth/classic (the drums are reported silent and
  // have no level). Then the page's voices of before the step chosen again through its voice selects (#voice-<layer>, a change event each,
  // as the user chooses a voice; the key would choose DEFAULT_VOICES): the `voices` message the page sends last must name them on all six
  // layers, a problem line of its own when it does not (a voice the selects do not offer cannot be chosen back). Then the page's own track,
  // voices, tuning and sound of before the step (restorePage), shown by a play from beat 64 in which the page's drums have a level.
  const SIX = ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'];
  const synthCase = JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases/band-synth.json'), 'utf8')).find((c) => c.name === 'band-synth-funk');
  result.allSynth = await page.evaluate(async ([track, sound, layers]) => {
    const key = document.getElementById('all-voices'), kind = () => key.dataset.state;
    const voicesSent = () => JSON.parse(window.sent.findLast((s) => s.type === 'voices')?.json ?? '{}');
    const own = window.pageOwn(), before = JSON.parse(own.voices); // the page's own, before the step
    let status = null; // the engine's `voices` event after the last press
    for (let i = 0; i < 3 && kind() !== 'synth'; i++) status = await window.voicesReported(() => key.click());
    const shown = kind(), sent = voicesSent();
    window.bridge('timbre', { json: JSON.stringify(sound) });
    await window.voicesReported(() => window.bridge('track', { json: JSON.stringify(track) }));
    const pass = (json) => window.passWith(json, track.bpm, 20, 200, layers); // from beat 0.2 to the first report of beat 20
    const plain = await pass(JSON.stringify(sound)), effects = await pass(JSON.stringify(window.everyEffect(sound)));
    for (const l of layers) { // the page's own voices again, as the user chooses them
      const select = document.getElementById(`voice-${l}`), value = `${before[l]?.id}/${before[l]?.variant}`;
      if (!select || ![...select.options].some((o) => o.value === value)) continue;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const after = voicesSent(), { restored, drumsBack } = await window.restorePage(own);
    return { shown, sent, status: status && Object.fromEntries(layers.map((l) => [l, status[l]])), plain, effects, before, after, restored, drumsBack };
  }, [synthCase.track, synthCase.sound, SIX]);
  const allSynth = result.allSynth, synthVoice = (l) => !!VOICES[l][allSynth.sent[l]?.id] && VOICES[l][allSynth.sent[l].id].kind !== 'sample';
  const back = (l) => allSynth.after[l]?.id === allSynth.before[l]?.id && allSynth.after[l]?.variant === allSynth.before[l]?.variant;
  if (allSynth.shown !== 'synth' || !SIX.every((l) => synthVoice(l) && allSynth.status?.[l] === 'ready' && allSynth.plain.peaks[l] > 0))
    problems.push(`all synth: ${JSON.stringify({ shown: allSynth.shown, sent: allSynth.sent, status: allSynth.status, peaks: allSynth.plain.peaks })}`);
  if (!SIX.every((l) => back(l) && allSynth.restored?.[l] === 'ready') || !(allSynth.drumsBack > 0))
    problems.push(`all synth: the page's own voices are not back: ${JSON.stringify({ before: allSynth.before, after: allSynth.after, restored: allSynth.restored, drumsBack: allSynth.drumsBack })}`);
  if (allSynth.effects.dropouts > 0 || !(allSynth.effects.load <= 0.25)) problems.push(`all synth with every effect on: load ${allSynth.effects.load} (limit 0.25), dropouts ${allSynth.effects.dropouts}`);
  // The string voices (Task 24): the page's voice selects do not offer them (hidden, src/core/voices.js 23 and 28), so a track of the step's
  // own goes through the bridge as the organ's step sends one: band.json's case band-funk with the bass on bass/string/finger and the chords
  // on chords/string/electric (the track's voices), with that case's sound. The engine's `voices` event after the track reports both ready;
  // a play from beat 0 to the engine's first report of beat 20 (from beat 0.2 on, as the organ's) gives both a level; the same span with
  // every layer effect on: the load at its end at most 0.25 and no dropout during it, read as the all-synth step reads them. Printed: the
  // time the `track` message took (the engine's buildMs: setTrack on the processor's loader thread, PluginEditor.cpp control(), the string
  // voices' prepare in it) and the page's wait from sending it to its `voices` event. Red when makeVoice has no voice for bass/string/finger
  // (the bass is reported silent and has no level). Then the page's own track, voices, tuning and sound again (restorePage), checked as
  // the all-synth step checks it: every layer reported ready and the page's drums with a level.
  const stringTrack = { ...bandCase.track, voices: { ...bandCase.track.voices, bass: { id: 'string', variant: 'finger' }, chords: { id: 'string', variant: 'electric' } } };
  result.strings = await page.evaluate(async ([track, sound, layers]) => {
    const own = window.pageOwn();
    window.bridge('timbre', { json: JSON.stringify(sound) });
    const sentAt = performance.now();
    const status = await window.voicesReported(() => window.bridge('track', { json: JSON.stringify(track) }));
    const waitMs = Math.round(performance.now() - sentAt);
    await window.wait(200); // the engine's next reports carry the track's buildMs
    const buildMs = +window.lastEngine().buildMs.toFixed(1);
    const pass = (json) => window.passWith(json, track.bpm, 20, 200, layers);
    const plain = await pass(JSON.stringify(sound)), effects = await pass(JSON.stringify(window.everyEffect(sound)));
    const { restored, drumsBack } = await window.restorePage(own);
    return { status: status && { bass: status.bass, chords: status.chords }, buildMs, waitMs, plain, effects, restored, drumsBack };
  }, [stringTrack, bandCase.sound, SIX]);
  const strings = result.strings;
  if (strings.status?.bass !== 'ready' || strings.status?.chords !== 'ready' || !(strings.plain.peaks.bass > 0) || !(strings.plain.peaks.chords > 0))
    problems.push(`string voices: ${JSON.stringify({ status: strings.status, peaks: strings.plain.peaks })}`);
  if (strings.effects.dropouts > 0 || !(strings.effects.load <= 0.25)) problems.push(`string voices with every effect on: load ${strings.effects.load} (limit 0.25), dropouts ${strings.effects.dropouts}`);
  if (!SIX.every((l) => strings.restored?.[l] === 'ready') || !(strings.drumsBack > 0))
    problems.push(`string voices: the page's own state is not back: ${JSON.stringify({ restored: strings.restored, drumsBack: strings.drumsBack })}`);
  // Bursts of timbre and of tuning messages (Task 24, fix round 1): each such message carries the whole state, and a queued one whose job
  // finds that a newer one of its type has arrived does not run (PluginEditor.cpp handle()). The string track of the step above with its
  // case's sound, and a play from beat 0 to the engine's first report of beat 8: the chords' plain peak. Then one timbre message with the
  // chords' brightness moved (a string knob: the chords' set computed anew) and a `voices` message: the time from that send to the
  // `voices` event (one knob, printed). Then 30 timbre messages in one burst, the chords' brightness another value in each (each one that
  // runs computes the chords' set anew), the last one also with every layer effect on, then one `voices` message: its `voices` event at
  // most 1.0 s after the first send (the bar, set before any measurement). A play to beat 8 then gives the chords at most half the plain
  // peak (every effect on: about -9 dB in the step above): the burst's last message is what the engine plays (the 29th would leave the
  // plain peak). Then the case's sound again (its `voices` event awaited), and the same with 30 tuning messages: chords/string/electric's
  // decay another value in each (its buffers depend on it), the last one also with its level at the fine value's minimum 0.2 (-12.6 dB
  // against 0.85). Red without the dropping (both bursts later than 1.0 s); every time is printed. Then the page's own state again,
  // checked as the step above checks it.
  result.bursts = await page.evaluate(async ([track, sound]) => {
    const own = window.pageOwn(), voicesJson = JSON.stringify(track.voices);
    const timed = async (send) => { // ms from send() (the first message sent) to the `voices` event of a `voices` message sent after it
      const before = window.voiceAt.length, sentAt = performance.now();
      send();
      window.bridge('voices', { json: voicesJson });
      for (let i = 0; i < 300 && window.voiceAt.length === before; i++) await window.wait(50);
      return window.voiceAt.length > before ? Math.round(window.voiceAt[before] - sentAt) : null;
    };
    const chordsPeak = async () => { const log = await window.playUntil(track.bpm, 8, 100); return log ? window.peakOf(log, 'chords') : null; };
    const brightness = (b, every) => { const s = every ? window.everyEffect(sound) : structuredClone(sound); s.chords.brightness = b; return JSON.stringify(s); };
    const tuning = (decay, last) => JSON.stringify({ ...JSON.parse(own.tuning), 'chords/string/electric': { decay, ...(last ? { level: 0.2 } : {}) } });
    window.bridge('timbre', { json: JSON.stringify(sound) });
    await window.voicesReported(() => window.bridge('track', { json: JSON.stringify(track) }));
    const plain = await chordsPeak();
    const oneKnobMs = await timed(() => window.bridge('timbre', { json: brightness(0.3, false) }));
    const timbreMs = await timed(() => { for (let i = 0; i < 30; i++) window.bridge('timbre', { json: brightness(0.2 + i / 50, i === 29) }); });
    const timbrePeak = await chordsPeak();
    const plainAgainMs = await timed(() => window.bridge('timbre', { json: JSON.stringify(sound) }));
    const tuningMs = await timed(() => { for (let i = 0; i < 30; i++) window.bridge('tuning', { json: tuning(0.5 + i / 10, i === 29) }); });
    const tuningPeak = await chordsPeak();
    const { restored, drumsBack } = await window.restorePage(own);
    return { plain, oneKnobMs, timbreMs, timbrePeak, plainAgainMs, tuningMs, tuningPeak, restored, drumsBack };
  }, [stringTrack, bandCase.sound]);
  const bursts = result.bursts;
  for (const [what, ms] of [['timbre', bursts.timbreMs], ['tuning', bursts.tuningMs]])
    if (!(ms !== null && ms <= 1000)) problems.push(`30 ${what} messages: the voices event ${ms} ms after the first send (at most 1000)`);
  for (const [what, peak] of [['timbre', bursts.timbrePeak], ['tuning', bursts.tuningPeak]])
    if (!(bursts.plain > 0 && peak > 0 && peak <= 0.5 * bursts.plain)) problems.push(`30 ${what} messages: the last one is not what plays (chords peak ${peak} against ${bursts.plain} without it)`);
  if (!SIX.every((l) => bursts.restored?.[l] === 'ready') || !(bursts.drumsBack > 0))
    problems.push(`bursts: the page's own state is not back: ${JSON.stringify({ restored: bursts.restored, drumsBack: bursts.drumsBack })}`);
  result.position = await page.locator('#play-position').innerText();
  result.chord = await page.locator('#play-now').innerText();
  result.framesPerSecond = await page.evaluate(() => new Promise((done) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : done(Math.round(n / 2)); };
    requestAnimationFrame(f);
  }));
  await page.screenshot({ path: join(out, '2-play-focus.png') });

  // UI -> engine: rack view, tempo knob, master fader, mixer
  await page.locator('#mode-switch').click();
  await sleep(800);
  await page.screenshot({ path: join(out, '3-play-rack.png') });
  await page.locator('#mixer').scrollIntoViewIfNeeded();
  await sleep(600);
  // highest reading of the mixer's LED meters within two seconds (0..1)
  result.meters = await page.evaluate(async () => {
    const top = {};
    for (let i = 0; i < 100; i++) {
      for (const name of ['master', 'drums', 'bass', 'chords']) {
        const level = Number(document.querySelector(`#mix-${name}`).parentElement.querySelector('.meter').style.getPropertyValue('--level'));
        top[name] = Math.max(top[name] ?? 0, level);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return top;
  });
  await page.screenshot({ path: join(out, '4-rack-mixer.png') });
  await setRange('tuning-tempo', 140);
  await sleep(500);
  result.afterTempo140 = await engine(2000);
  await setRange('mix-master', 50);
  await sleep(500);
  result.afterMaster50 = await engine(2000);
  await setRange('mix-master', 100);
  await setRange('mix-drums', 0);
  await sleep(300);
  result.drumsFaderDown = await engine(1500);
  await setRange('mix-drums', 100);

  // The app's transport: jump and loop (what the test strip of the app does).
  await page.evaluate(() => window.bridge('seek', { beats: 64 }));
  await sleep(400);
  result.afterJump = { beats: +(await page.evaluate(() => window.lastEngine().beats)).toFixed(2), position: await page.locator('#play-position').innerText() };
  await page.evaluate(() => window.bridge('loop', { start: 64, end: 72 }));
  result.loop = await page.evaluate(async () => {
    window.engineLog.length = 0;
    await new Promise((r) => setTimeout(r, 6000)); // 14 beats at 140 bpm: more than one round of the 8-beat loop
    const beats = window.engineLog.map((m) => m.beats);
    return { lowest: +Math.min(...beats).toFixed(2), highest: +Math.max(...beats).toFixed(2), wraps: beats.filter((b, i) => i > 0 && b < beats[i - 1]).length };
  });
  await page.evaluate(() => window.bridge('loop', { start: 0, end: 0 }));

  // The sound reaches the engine: a track of the step's own, sent through the bridge as the organ's step does, band.json's case band-funk
  // (100 bpm; chords and pad from beat 0, percussion from beat 16), at master.width 0 and at 1, each pass a play from beat 0 to the engine's
  // first report of beat 20 (playUntil: a start resets the voices' random draws, so both passes play the same notes over the same span of
  // the song), through the page's own width knob (the page sends `timbre`, the shell queues it, control() calls setSound). The layers'
  // levels the engine reports come from behind the balance, whose places the width multiplies (masterParams.width = 2 * knob, so knob 1
  // doubles the places): the peak of a mono layer at place p is 1 + |p| times its level, so a layer away from the middle is louder at knob 1
  // by 20 log10 (1 + 2 |p|) dB than at 0 (chords p 0.3: 4.1 dB, pad -0.2: 2.9 dB, percussion -0.4: 5.1 dB; the places are the fine values
  // of 'mix/pan'). Each of the three must sound in both passes and reach at least half of its predicted gain. The figures (predicted beside
  // measured) are in the output; with the `timbre` case of control() taken out the gains are about 0 dB. Then the page's own track,
  // voices, tuning and sound again (restorePage).
  const PLACES = { chords: 0.3, pad: -0.2, percussion: -0.4 };
  const widthCase = JSON.parse(readFileSync(join(repo, 'native/tools/sound-cases/band.json'), 'utf8')).find((c) => c.name === 'band-funk');
  const widthLevels = async (value) => {
    await setRange('timbre-master-width', value);
    return page.evaluate(async ([bpm, layers]) => {
      const log = await window.playUntil(bpm, 20, 200);
      return Object.fromEntries(layers.map((l) => [l, log ? window.peakOf(log, l) : 0]));
    }, [widthCase.track.bpm, Object.keys(PLACES)]);
  };
  if (await page.evaluate(() => !document.getElementById('timbre-master-width'))) problems.push('timbre: the width knob is not on the page');
  else {
    const own = await page.evaluate(() => window.pageOwn());
    await page.evaluate((track) => window.voicesReported(() => window.bridge('track', { json: JSON.stringify(track) })), widthCase.track);
    const narrow = await widthLevels(0), wide = await widthLevels(100);
    await setRange('timbre-master-width', 50);
    await page.evaluate((o) => window.restorePage(o), own);
    const predicted = Object.fromEntries(Object.entries(PLACES).map(([l, p]) => [l, +(20 * Math.log10(1 + 2 * Math.abs(p))).toFixed(2)]));
    const gainDb = Object.fromEntries(Object.keys(PLACES).map((l) => [l, narrow[l] > 0 && wide[l] > 0 ? +(20 * Math.log10(wide[l] / narrow[l])).toFixed(2) : null]));
    result.timbreReachesEngine = { width0: narrow, width1: wide, predictedDb: predicted, gainDb };
    const short = Object.keys(PLACES).filter((l) => !(gainDb[l] >= predicted[l] / 2)); // a layer silent in a pass (null) is short too
    if (short.length) problems.push(`timbre: the engine did not hear the width (gain at width 1 against 0 in dB, measured against predicted: ${JSON.stringify(Object.fromEntries(Object.keys(PLACES).map((l) => [l, [gainDb[l], predicted[l]]])))})`);
  }

  // Reaction time. One way UI -> app is half a ping round trip; then the control waits for the next audio block
  // (reactionMs, measured in the app); then the audio needs the limiter's 6 ms and the output latency of the device.
  const measure = async () => {
    const m = await page.evaluate(async () => {
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const ping = [], control = [], track = [], build = [];
      for (let id = 1; id <= 40; id++) {
        const t0 = performance.now();
        ping.push(await new Promise((done) => { window.pongs.set(id, (t) => done(t - t0)); window.bridge('ping', { id }); }));
        await pause(7 + (id % 5) * 3);
      }
      for (let i = 0; i < 40; i++) { // a direct control: the bass fader (the old drive message went with Task 18)
        window.bridge('level', { layer: 'bass', value: i % 2 ? 0.9 : 0.7 });
        await pause(90 + (i % 7) * 4);
        control.push(window.lastEngine().reactionMs);
      }
      window.bridge('level', { layer: 'bass', value: 1 });
      const last = window.sent.findLast((s) => s.type === 'track'); // a new event stream, as the ornaments knob sends
      for (let i = 0; i < 20; i++) {
        window.bridge('track', { json: last.json });
        await pause(100 + (i % 7) * 4);
        track.push(window.lastEngine().reactionMs);
        build.push(window.lastEngine().buildMs);
      }
      const e = window.lastEngine();
      return { ping, control, track, build, device: { name: e.device, type: e.deviceType, bufferFrames: e.bufferFrames, sampleRate: e.sampleRate, outputLatencyMs: +e.outputLatencyMs.toFixed(1), xruns: e.xruns, load: +e.load.toFixed(3), bufferSizes: e.bufferSizes } };
    });
    return { device: m.device, pingRoundTripMs: stats(m.ping), controlToAudioBlockMs: stats(m.control), trackToAudioBlockMs: stats(m.track), buildEventsMs: stats(m.build) };
  };
  // at the buffer size in use and up to two others the device offers (WASAPI shared usually offers only one)
  const { bufferFrames, bufferSizes } = await page.evaluate(() => window.lastEngine());
  result.bufferSizesOffered = bufferSizes;
  result.reaction = {};
  for (const frames of [bufferFrames, ...bufferSizes.filter((s) => s !== bufferFrames).slice(0, 2)]) {
    await page.evaluate((f) => window.bridge('buffer', { frames: f }), frames);
    await sleep(2500);
    result.reaction[frames] = await measure();
  }
  await page.evaluate((f) => window.bridge('buffer', { frames: f }), bufferFrames);
  // the same control through the real knob of the UI: time from the input event to the message leaving the page
  result.knobToBridgeMs = await page.evaluate(async () => {
    const input = document.getElementById('timbre-bass-overdrive');
    if (!input) return 'knob not found';
    const times = [];
    for (let i = 0; i < 20; i++) {
      const before = window.sent.length, t0 = performance.now();
      input.value = String(20 + i * 3);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const message = window.sent.slice(before).find((s) => s.type === 'timbre');
      if (message) times.push(message.at - t0);
    }
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return times.length ? { n: times.length, mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), max: +Math.max(...times).toFixed(2) } : 'no timbre message';
  });
  // what the web version would get on this machine: latency of the browser's own audio output
  result.webAudioLatencyMs = await page.evaluate(async () => {
    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const osc = ctx.createOscillator(), quiet = ctx.createGain();
    quiet.gain.value = 0;
    osc.connect(quiet).connect(ctx.destination);
    osc.start();
    await new Promise((r) => setTimeout(r, 800));
    const out = { state: ctx.state, base: +(ctx.baseLatency * 1000).toFixed(1), output: +(ctx.outputLatency * 1000).toFixed(1), quantumMs: +((128 / ctx.sampleRate) * 1000).toFixed(1) };
    await ctx.close();
    return out;
  });

  await page.locator('#play-go').click();
  await sleep(500);
  result.stopped = await engine(800);
  result.localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  // browser mechanisms the profile window relies on (export file, copy text)
  const download = page.waitForEvent('download', { timeout: 3000 }).then(() => 'starts', () => 'no download');
  await page.evaluate(() => {
    const a = Object.assign(document.createElement('a'), { download: 'probe.json', href: URL.createObjectURL(new Blob(['{}'])) });
    document.body.append(a);
    a.click();
    a.remove();
  });
  result.fileDownload = await download;
  result.clipboard = await page.evaluate(() => navigator.clipboard.writeText('probe').then(() => 'works', (e) => `fails: ${e.message}`));
  result.secureContext = await page.evaluate(() => isSecureContext);
  // one of the modes the engine has to know too: the scale is taken, a progression of the mode plays, no error
  await page.locator('#scale-select').selectOption('mixolydian');
  await sleep(1500);
  result.mixolydian = await page.evaluate(() => ({ scale: document.getElementById('play-scale').textContent, chords: [...document.querySelectorAll('#wheel-prog .chip')].map((c) => `${c.textContent} ${c.dataset.degree}`) }));
  if (result.mixolydian.scale !== 'Mixolydisch' || !result.mixolydian.chords.some((c) => c.endsWith(' bVII'))) problems.push('the generator does not play in mixolydian');
  // the language comes from the app's strip (here: the event the strip sends); the page's own chips are hidden
  result.language = await page.evaluate(async () => {
    const say = async (lang) => { window.__JUCE__.backend.emitByBackend('language', JSON.stringify(lang)); await new Promise((r) => setTimeout(r, 300)); return `${document.documentElement.lang}: ${document.title}`; };
    return { en: await say('en'), de: await say('de'), stored: localStorage.getItem('backingtrack.lang'), chipsShown: document.querySelector('.lang').checkVisibility() };
  });
  if (!result.language.en.startsWith('en: Backing track') || !result.language.de.startsWith('de: ') || result.language.stored !== 'de' || result.language.chipsShown) problems.push('the generator page does not follow the language of the app');
  result.problems = [...new Set(problems)];
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.problems.length ? 1 : 0;
} finally {
  await browser?.close().catch(() => {});
  app.kill();
}
