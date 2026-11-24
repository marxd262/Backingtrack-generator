// Diagnosis: does the own songs' page show the place the engine plays? Runs the real app muted with BTG_POSITION_LOG
// (WebView2 debug port, Playwright), loads a track, plays stretches of it and sums up the log the page writes:
// shown position against the engine's, twice a second.
//   node native/tools/position-check.mjs [track] [seconds per stretch, default 40] [start seconds ...]
// Without a track it renders a generator song of 96 bars, 230 s (render-song.mjs), and loads that.
// Writes native/build/position/position.log (the raw samples) and app-analysis.json (the analysis as the app made it,
// to compare with btg_analyze). By hand, with sound: start the app with BTG_POSITION_LOG=<file> set and play.
// The app runs on a storage folder of its own (BTG_STORAGE_DIR, removed afterwards with the rendered song): the developer's profiles are never touched.
// Its debug port 9334 is shell-check.mjs's too: the two cannot run at once.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { renderSong } from './render-song.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const storage = mkdtempSync(join(tmpdir(), 'btg-position-check-'));
const source = process.argv[2] ? resolve(process.argv[2]) : renderSong(storage, 96), stretch = Number(process.argv[3] ?? 40);
const starts = process.argv.slice(4).map(Number);
const exe = join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
const work = join(repo, 'native/build/position'), log = join(work, 'position.log');
mkdirSync(work, { recursive: true });
rmSync(log, { force: true });
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

const app = spawn(exe, [], { env: { ...process.env, BTG_MUTE: '1', BTG_NO_CACHE: '1', BTG_POSITION_LOG: log, BTG_STORAGE_DIR: storage, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; !browser && i < 40; i++) { await sleep(500); browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`).catch(() => null); }
  if (!browser) throw new Error('WebView2 debug port did not open');
  let page;
  for (let i = 0; !page && i < 40; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('juce.backend')); if (!page) await sleep(250); }
  if (!page) throw new Error('no page from the resource provider');
  const trackPage = new URL('/app/track.html', page.url()).href;
  await page.waitForLoadState('load').catch(() => {});
  await page.goto(trackPage).catch(async () => { await sleep(1500); await page.goto(trackPage); });
  await page.locator('#open').waitFor({ state: 'visible', timeout: 15000 });
  const json = await page.evaluate(async (path) => {
    const backend = window.__JUCE__.backend;
    window.bridge = (type, data = {}) => backend.emitEvent('btg', { type, ...data });
    const done = new Promise((r) => backend.addEventListener('analysis', (m) => r(m.json)));
    window.bridge('loadFile', { path });
    return Promise.race([done, new Promise((r) => setTimeout(() => r(null), 90000))]);
  }, source);
  if (!json) throw new Error('the track did not load');
  writeFileSync(join(work, 'app-analysis.json'), json);
  const seconds = JSON.parse(json).chords.at(-1).end;
  let lines = 0;
  for (const from of starts.length ? starts : [60, Math.max(0, seconds - 150)]) {
    await page.evaluate((f) => window.bridge('playFile', { from: f }), from);
    await sleep(1000 * stretch);
    await page.evaluate(() => window.bridge('stop'));
    await sleep(700);
    const rows = (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').slice(1) : []).slice(lines).map((l) => l.split('\t'));
    lines += rows.length;
    if (!rows.length) { console.log(`from ${from} s: no samples in the log`); continue; }
    const col = (i) => rows.map((r) => Number(r[i]));
    const behind = col(2);
    console.log(`from ${from.toFixed(0)} s, ${rows.length} samples: shown behind the engine median ${median(behind).toFixed(1)} ms (${Math.min(...behind).toFixed(1)} to ${Math.max(...behind).toFixed(1)}) | round trip median ${median(col(3)).toFixed(1)} ms, longest ${Math.max(...col(3)).toFixed(1)} | age of the engine's message up to ${Math.max(...col(4)).toFixed(0)} ms | `
      + `frames per second ${(median(col(5)) * 2).toFixed(0)}, longest frame ${Math.max(...col(6)).toFixed(0)} ms | device ${rows[0][8]} Hz, buffer ${rows[0][9]}, output latency ${rows[0][10]} ms`);
  }
} finally {
  await browser?.close().catch(() => {});
  const gone = new Promise((r) => { app.once('exit', r); setTimeout(r, 5000); });
  app.kill();
  await gone;
  // the folder holds the app's WebView2 profile too, which its browser may hold a moment after the app ended: retried, and never a failure of the check
  try { rmSync(storage, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 }); } catch (error) { console.error(`position-check: could not remove ${storage}: ${error.message}`); }
}
