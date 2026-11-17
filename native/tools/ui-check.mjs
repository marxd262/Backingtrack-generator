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
    const peak = (name) => +Math.max(...log.map((m) => m.peaks[name])).toFixed(3);
    return {
      clockErrorMs: last.playing ? { mean: +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1), max: +Math.max(...errors).toFixed(1) } : undefined,
      messagesPerSecond: +((log.length - 1) / seconds).toFixed(1),
      playing: last.playing,
      bpmReported: last.bpm,
      bpmMeasured: +(((last.beats - first.beats) / seconds) * 60).toFixed(1),
      peaks: { drums: peak('drums'), bass: peak('bass'), master: peak('master') },
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

  await page.locator('#go').click();
  await sleep(1500);
  await page.evaluate(() => window.bridge('seek', { beats: 24 })); // past the intro of a rolled form: drums and bass play
  await sleep(600);
  result.playing = await engine(4000);
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
} finally {
  await browser?.close().catch(() => {});
  app.kill();
}
