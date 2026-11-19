// Checks the web UI inside the real app: starts the app with the WebView2 debug port, attaches Playwright,
// records console errors and failed requests, plays, and measures what the engine reports back:
// position, levels, reaction time of controls at the buffer sizes given, jump and loop.
// Usage: node native/tools/ui-check.mjs [app.exe] [output folder]
// The app runs muted (BTG_MUTE): levels are measured, nothing is heard.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildEvents } from '../../src/index.js';

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
    backend.addEventListener('voices', (m) => window.voiceLog.push(m));
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

  // The sound reaches the engine: the song from the same beat at master.width 0 and at 1 (each pass begins with a `play` at that beat: a
  // start resets the voices' random draws, so both passes play the same notes), through the page's own width knob (the page sends
  // `timbre`, the shell queues it, control() calls setSound). The layers' levels the engine reports come from behind the balance, whose
  // places the width multiplies (masterParams.width = 2 * knob, so knob 1 doubles the places): the peak of a mono layer at place p is
  // 1 + |p| times its level, so a layer away from the middle is louder at knob 1 by 20 log10 (1 + 2 |p|) dB than at 0 (chords p 0.3:
  // 4.1 dB, pad -0.2: 2.9 dB, percussion -0.4: 5.1 dB; the places are the fine values of 'mix/pan'). Every layer that sounds in both
  // passes must reach at least half of its predicted gain, and at least one must sound. The figures (predicted beside measured) are in
  // the output; with the `timbre` case of control() taken out the gains are about 0 dB.
  const PLACES = { chords: 0.3, pad: -0.2, percussion: -0.4 };
  const widthLevels = async (value) => {
    await setRange('timbre-master-width', value);
    await page.evaluate(() => { const play = window.sent.findLast((s) => s.type === 'play'); window.bridge('play', { startBeats: 64, bpm: play.bpm }); window.engineLog.length = 0; });
    await sleep(3200);
    return page.evaluate((layers) => Object.fromEntries(layers.map((l) => [l, Math.max(0, ...window.engineLog.map((m) => m.peaks?.[l] ?? 0))])), Object.keys(PLACES));
  };
  if (await page.evaluate(() => !document.getElementById('timbre-master-width'))) problems.push('timbre: the width knob is not on the page');
  else {
    const narrow = await widthLevels(0), wide = await widthLevels(100);
    await setRange('timbre-master-width', 50);
    const predicted = Object.fromEntries(Object.entries(PLACES).map(([l, p]) => [l, +(20 * Math.log10(1 + 2 * Math.abs(p))).toFixed(2)]));
    const gainDb = Object.fromEntries(Object.keys(PLACES).map((l) => [l, narrow[l] > 0 && wide[l] > 0 ? +(20 * Math.log10(wide[l] / narrow[l])).toFixed(2) : null]));
    result.timbreReachesEngine = { width0: Object.fromEntries(Object.entries(narrow).map(([l, v]) => [l, +v.toFixed(3)])), width1: Object.fromEntries(Object.entries(wide).map(([l, v]) => [l, +v.toFixed(3)])), predictedDb: predicted, gainDb };
    const sounding = Object.keys(PLACES).filter((l) => gainDb[l] !== null), short = sounding.filter((l) => !(gainDb[l] >= predicted[l] / 2));
    if (!sounding.length || short.length) problems.push(`timbre: the engine did not hear the width (gain at width 1 against 0 in dB, measured against predicted: ${JSON.stringify(Object.fromEntries(Object.keys(PLACES).map((l) => [l, [gainDb[l], predicted[l]]])))}${sounding.length ? '' : '; no layer sounded'})`);
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
      for (let i = 0; i < 40; i++) { // an effect control: the drive on the bass
        window.bridge('drive', { value: i % 2 ? 0.6 : 0.2 });
        await pause(90 + (i % 7) * 4);
        control.push(window.lastEngine().reactionMs);
      }
      window.bridge('drive', { value: 0 });
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
      const message = window.sent.slice(before).find((s) => s.type === 'drive');
      if (message) times.push(message.at - t0);
    }
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return times.length ? { n: times.length, mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), max: +Math.max(...times).toFixed(2) } : 'no drive message';
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
