// Checks the page for a loaded track inside the real app (WebView2 debug port, Playwright): file formats,
// time to load and analyse, the display against the playback position, the lane (scroll, zoom, jump, loop),
// the speed control and the corrections.
//   node native/tools/track-check.mjs <track.mp3> [app.exe] [output folder]
// The app runs muted (BTG_MUTE) and analyses every file anew (BTG_NO_CACHE), unless BTG_KEEP=1 asks for the kept results. Needs ffmpeg for the format test files.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (!process.argv[2]) throw new Error('usage: track-check.mjs <track.mp3> [app.exe] [output folder]');
const source = resolve(process.argv[2]);
const exe = process.argv[3] ?? join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const out = process.argv[4] ?? join(repo, '.superpowers/native-screens');
const work = join(repo, 'native/build/format-test');
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// one minute of the track in every format to try
const formats = { wav: [], flac: [], mp3: ['-b:a', '160k'], m4a: ['-c:a', 'aac', '-b:a', '160k'], ogg: ['-c:a', 'libvorbis'], aiff: [], wma: ['-c:a', 'wmav2'] };
for (const [type, args] of Object.entries(formats)) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '90', '-t', '60', '-i', source, '-vn', ...args, join(work, `minute.${type}`)]);
}
writeFileSync(join(work, 'broken.mp3'), 'this is not audio');

const app = spawn(exe, [], { env: { ...process.env, BTG_MUTE: '1', ...(process.env.BTG_KEEP ? {} : { BTG_NO_CACHE: '1' }), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
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
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:')) problems.push(`request failed: ${r.url()}`); }); // a jump in the video drops its pending reads
  // helpers inside the page; a reload drops them
  const inject = () => page.evaluate(() => {
    const backend = window.__JUCE__.backend;
    window.log = { engine: [], analysis: [] };
    backend.addEventListener('engine', (m) => window.log.engine.push({ ...m, at: performance.now() }));
    backend.addEventListener('analysis', (m) => window.log.analysis.push(m));
    window.bridge = (type, data = {}) => backend.emitEvent('btg', { type, ...data });
    window.engineNow = () => window.log.engine.at(-1);
  });
  // The generator page may still be loading; a navigation that cuts into that ends on the web view's error page.
  const trackPage = new URL('/native/track.html', page.url()).href;
  await page.waitForLoadState('load').catch(() => {});
  await page.goto(trackPage).catch(async () => { await sleep(1500); await page.goto(trackPage); });
  await page.locator('#open').waitFor({ state: 'visible', timeout: 15000 });
  problems.length = 0; // leaving the generator page cut its requests off; load the track page once more and count from here
  await page.reload();
  await page.locator('#open').waitFor({ state: 'visible', timeout: 15000 });
  await inject();
  // loads a file through the app and waits for its analysis or its error
  const load = (path) => page.evaluate(async (p) => {
    const name = p.split(/[\\/]/).pop(), before = window.log.analysis.length, t0 = performance.now();
    window.log.engine.length = 0;
    window.bridge('loadFile', { path: p });
    for (;;) {
      await new Promise((r) => setTimeout(r, 50));
      const done = window.log.analysis.slice(before).find((a) => a.name === name);
      const state = window.engineNow()?.file;
      const steps = new Set(window.log.engine.map((m) => m.file?.progress).filter((x) => x > 0 && x < 1)).size;
      if (done) {
        const a = JSON.parse(done.json);
        return { ok: true, seconds: +done.seconds.toFixed(1), loadMs: Math.round(done.loadMs), analysisMs: Math.round(done.analysisMs), waitedMs: Math.round(performance.now() - t0), progressSteps: steps, bpm: a.bpm, key: `${a.key.root} ${a.key.mode}`, chords: a.chords.length };
      }
      if (state && !state.loading && state.name === name && state.error) return { ok: false, error: state.error };
      if (performance.now() - t0 > 60000) return { ok: false, error: 'timeout' };
    }
  }, path);
  const text = (id) => page.locator(`#${id}`).innerText();
  const position = () => page.evaluate(() => window.engineNow().beats);

  const result = { formats: {} };
  for (const type of [...Object.keys(formats), 'broken']) result.formats[type] = await load(join(work, type === 'broken' ? 'broken.mp3' : `minute.${type}`));
  result.whole = await load(source);
  await sleep(400);
  result.shown = {
    title: await text('title'), tempo: await text('tempo'), key: await text('key'), scale: await page.locator('#scale').inputValue(),
    patterns: await page.locator('#sections button').allInnerTexts(),
    fretboardNotes: await page.locator('#fretboard svg .fret-note').count(),
    wheelDrawn: await page.evaluate(() => { const c = document.getElementById('wheel'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n > 1000; }),
  };

  // playback: the display follows the engine
  await page.evaluate(() => window.bridge('playFile', { from: 120 }));
  await sleep(1500);
  result.sync = await page.evaluate(async () => {
    const a = JSON.parse(window.log.analysis.at(-1).json), rows = [], board = document.getElementById('fretboard'), sizes = new Set();
    let scrolls = false;
    window.log.engine.length = 0; // from here on the engine plays
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const e = window.engineNow(), t = e.beats + (performance.now() - e.at) / 1000;
      rows.push({ shown: document.getElementById('chord').textContent, want: a.chords.findLast((c) => c.t <= t + 0.01)?.chord });
      sizes.add(`${board.clientWidth}x${board.clientHeight}`);
      if (board.scrollWidth > board.clientWidth || board.scrollHeight > board.clientHeight) scrolls = true;
    }
    const first = window.log.engine[0], last = window.engineNow();
    return { secondsPerSecond: +((last.beats - first.beats) / ((last.at - first.at) / 1000)).toFixed(3), chordMatches: `${rows.filter((r) => r.shown === r.want).length}/${rows.length}`, fretboardSizes: [...sizes], fretboardScrolls: scrolls };
  });
  if (result.sync.fretboardSizes.length > 1 || result.sync.fretboardScrolls) problems.push(`the fretboard changes its size or scrolls while the track plays: ${result.sync.fretboardSizes.join(', ')}`);
  // the fretboard's switches are the generator's: degrees instead of names, even frets instead of real ones
  result.fretboard = await page.evaluate(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 150));
    const labels = () => [...new Set([...document.querySelectorAll('#fretboard .fret-note:not([hidden]) text')].map((t) => t.textContent))];
    const wires = () => [1, 2, 12].map((n) => Number(document.querySelector(`#fretboard .fret-wire[data-fret="${n}"]`).getAttribute('x1')));
    const even = () => { const [a, b, c] = wires(); return Math.abs((c - b) / 10 - (b - a)) < 0.5; };
    const out = { names: labels().slice(0, 4), evenAtFirst: even(), legend: document.querySelectorAll('#fretboard-legend li').length };
    document.querySelector('[data-labels="degrees"]').click();
    document.querySelector('[data-frets="even"]').click();
    await wait();
    out.degrees = labels().slice(0, 4);
    out.evenAfter = even();
    out.stored = localStorage.getItem('backingtrack.layout');
    document.querySelector('[data-labels="names"]').click();
    document.querySelector('[data-frets="real"]').click();
    await wait();
    out.namesAgain = labels().slice(0, 4);
    return out;
  });
  if (result.fretboard.evenAtFirst || !result.fretboard.evenAfter || !result.fretboard.degrees.every((d) => /^b?[1-7]$/.test(d)) || !result.fretboard.namesAgain.every((n) => /^[A-G]/.test(n)) || result.fretboard.legend < 6) problems.push('the fretboard does not switch between names and degrees or between real and even frets');
  // the language comes from the app's strip (here: the event the strip sends) and is remembered for every page
  const speak = (lang) => page.evaluate(async (l) => {
    window.__JUCE__.backend.emitByBackend('language', JSON.stringify(l));
    await new Promise((r) => setTimeout(r, 200));
    return { html: document.documentElement.lang, open: document.getElementById('open').textContent, scale: document.querySelector('#scale option[value="wholeTone"]').textContent, legend: document.querySelector('#fretboard-legend span').textContent,
      label: document.getElementById('next-label').textContent, stored: localStorage.getItem('backingtrack.lang'), empty: [...document.querySelectorAll('[data-i18n]')].filter((el) => !el.textContent || el.textContent === el.dataset.i18n).map((el) => el.dataset.i18n) };
  }, lang);
  result.language = { en: await speak('en'), de: await speak('de') };
  if (result.language.en.open !== 'Load file …' || result.language.en.scale !== 'whole tone' || result.language.en.legend !== 'Scale note' || !result.language.en.label.startsWith('Next') || result.language.en.stored !== 'en'
    || result.language.de.open !== 'Datei laden …' || result.language.de.stored !== 'de' || result.language.en.empty.length || result.language.de.empty.length) problems.push('the track page does not follow the language of the app');
  result.laneHeight = await page.evaluate(() => document.getElementById('lane').offsetHeight);
  if (result.laneHeight > 150) problems.push(`the lane is ${result.laneHeight} px high`);
  result.playing = { chord: await text('chord'), next: await text('next'), nextLabel: await text('next-label'), pattern: await text('pattern-label'), patternChords: await page.locator('#pattern li').allInnerTexts(), position: await text('position'), time: await text('time') };
  // a video file: its picture is shown and runs where the engine plays
  if (/\.(mp4|m4v|mov|mkv|webm)$/i.test(source)) {
    result.video = await page.evaluate(() => {
      const v = document.getElementById('video'), e = window.engineNow();
      return { shown: !document.getElementById('mod-video').hidden, ready: v.readyState, width: v.videoWidth, height: v.videoHeight, paused: v.paused,
        behind: +(e.beats + (performance.now() - e.at) / 1000 - v.currentTime).toFixed(2), error: v.error?.message ?? null };
    });
    if (!result.video.shown || result.video.ready < 2 || !result.video.width || result.video.paused || Math.abs(result.video.behind) > 0.4) problems.push('the video does not run along with the track');
  } else if (await page.evaluate(() => !document.getElementById('mod-video').hidden)) problems.push('a video is shown for a file without a picture');
  // the page itself must never scroll sideways (only the lane does, in itself)
  result.pageOverflow = await page.evaluate(() => {
    const root = document.documentElement, wide = [];
    for (const el of document.querySelectorAll('main *')) {
      if (el.closest('#lane') && el.id !== 'lane') continue;
      const r = el.getBoundingClientRect();
      if (r.right > root.clientWidth + 1) wide.push(`${el.tagName.toLowerCase()}#${el.id || el.className} +${Math.round(r.right - root.clientWidth)}`);
    }
    return { sideways: root.scrollWidth - root.clientWidth, viewport: `${root.clientWidth}x${root.clientHeight}`, pageHeight: root.scrollHeight, tooWide: wide.slice(0, 8) };
  });
  await page.screenshot({ path: join(out, '5-track.png'), fullPage: true });

  // speed: 75 % plays 0.75 seconds of the track per second
  await page.locator('#rate').evaluate((input) => { input.value = '75'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  result.speed75 = await page.evaluate(async () => {
    window.log.engine.length = 0;
    await new Promise((r) => setTimeout(r, 3000));
    const first = window.log.engine[0], last = window.engineNow();
    return +((last.beats - first.beats) / ((last.at - first.at) / 1000)).toFixed(3);
  });
  await page.locator('#rate').evaluate((input) => { input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => window.bridge('stop'));
  await sleep(400);

  // the lane, stopped: the wheel scrolls and zooms the view and never moves the position; a click jumps; a drag loops
  const lane = page.locator('#lane');
  await lane.scrollIntoViewIfNeeded(); // with a video above it the lane starts below the window's edge
  const box = await lane.boundingBox();
  const view = () => page.evaluate(() => ({ scroll: Math.round(document.getElementById('lane').scrollLeft), width: Math.round(parseFloat(document.getElementById('lane-spacer').style.width)) }));
  const before = { position: await position(), ...(await view()) };
  await page.locator('#zoom-in').click();
  await page.locator('#zoom-in').click();
  await page.mouse.move(box.x + 300, box.y + 80);
  await page.mouse.wheel(0, 600);
  await sleep(300);
  const scrolled = { position: await position(), ...(await view()) };
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await sleep(300);
  const zoomed = { position: await position(), ...(await view()) };
  result.lane = { before, afterZoomButtonsAndWheel: scrolled, afterCtrlWheel: zoomed, positionUntouched: before.position === scrolled.position && before.position === zoomed.position };
  await page.locator('#zoom-all').click();
  await sleep(200);
  await page.mouse.click(box.x + box.width / 2, box.y + 80); // the middle of the whole track (zoom "Alles")
  await sleep(400);
  result.jump = { expected: +(result.whole.seconds / 2).toFixed(1), engine: +(await position()).toFixed(1), position: await text('position') };
  await page.mouse.move(box.x + box.width * 0.25, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.27, box.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => window.bridge('playFile', { from: window.engineNow().beats }));
  await sleep(300); // the jump into the loop has arrived by then
  result.loop = await page.evaluate(async () => {
    window.log.engine.length = 0;
    await new Promise((r) => setTimeout(r, 12000)); // the loop is about ten seconds long
    const beats = window.log.engine.filter((m) => m.playing).map((m) => m.beats);
    return { lowest: +Math.min(...beats).toFixed(1), highest: +Math.max(...beats).toFixed(1), wraps: beats.filter((b, i) => i > 0 && b < beats[i - 1]).length };
  });
  await page.screenshot({ path: join(out, '6-track-loop.png'), fullPage: true });
  await page.locator('#loop-off').click();
  await page.evaluate(() => window.bridge('stop'));

  // corrections: chord of the bar at the playhead, the "one" moved by a beat, reset; they survive a reload
  await page.evaluate(() => window.bridge('seek', { beats: 200 }));
  await sleep(400);
  const chordBefore = await text('chord');
  await page.locator('#edit').selectOption('F#m');
  await sleep(300);
  result.edit = { before: chordBefore, after: await text('chord'), stored: await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('btg.track.')).length) };
  await page.reload();
  await page.locator('#sections button').first().waitFor({ timeout: 10000 });
  await inject();
  await sleep(400);
  result.edit.afterReload = await text('chord');
  // every scale of the list: the fretboard marks as many different notes as the scale has steps
  result.scales = await page.evaluate(async () => {
    const { SCALES } = await import('/core/music.js');
    const select = document.getElementById('scale'), wrong = [];
    for (const [id, steps] of Object.entries(SCALES)) {
      select.value = id;
      select.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 120));
      const shown = new Set([...document.querySelectorAll('#fretboard .fret-note[data-role~="scale"]:not([hidden]) text')].map((t) => t.textContent)).size;
      const sound = steps[0] === 0 && steps.every((s, i) => s < 12 && (i === 0 || s > steps[i - 1]));
      if (select.value !== id || shown !== steps.length || !sound) wrong.push(`${id}: ${shown} notes for ${steps.length} steps`);
    }
    return { count: Object.keys(SCALES).length, wrong };
  });
  if (result.scales.wrong.length) problems.push(`scales on the fretboard: ${result.scales.wrong.join('; ')}`);
  const parts = () => page.locator('#sections button').allInnerTexts();
  result.shift = { before: (await parts()).slice(0, 3) };
  await page.locator('#one-on').click();
  await sleep(300);
  result.shift.after = (await parts()).slice(0, 3);
  await page.locator('#reset').click();
  await sleep(300);
  result.shift.reset = (await parts()).slice(0, 3);
  // counting at half the tempo: the tempo shown halves, the bars get twice as long; reset brings it back
  const tempoShown = async () => parseFloat(await text('tempo'));
  result.count = { tempo: await tempoShown() };
  await page.locator('#tempo-half').click();
  await sleep(300);
  result.count.half = await tempoShown();
  result.count.halfParts = (await parts()).slice(0, 2);
  await page.locator('#tempo-double').click();
  await page.locator('#tempo-double').click();
  await sleep(300);
  result.count.double = await tempoShown();
  await page.locator('#reset').click();
  await sleep(300);
  result.count.reset = await tempoShown();
  if (Math.abs(result.count.half * 2 - result.count.tempo) > 1.5 || Math.abs(result.count.double - 2 * result.count.tempo) > 3 /* the tempo shown is rounded and local */ || result.count.reset !== result.count.tempo) problems.push('counting at half or double tempo does not show');
  result.edit.afterReset = await text('chord');
  result.problems = [...new Set(problems)];
  writeFileSync(join(out, 'track-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
}
