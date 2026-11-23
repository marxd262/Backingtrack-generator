// Checks the app's page for the user's own songs (native/app/ui/track.html, Task 32c: what its fretboard and wheel show comes from the core,
// chordDisplays) against the old one (native/app/web/track.html) in the real app, in one step (after native/build.ps1 with the app):
//   node native/tools/track-page-check.mjs [app.exe]
// btg_render renders a generator song (the funk test track with chords and pad on a progression of sevenths, a half-diminished chord and the
// major dominant) to a WAV in a temporary folder. The app, muted and on a storage folder of its own (BTG_STORAGE_DIR, removed afterwards with its
// WebView2 profile), loads it as the user's own song on the old page, analyses and plays it; then a second app run does the same with
// BTG_UI_NEW=1 on the new page. At the same places of the song both show the same chord and next chord, the same tones on the fretboard (the drawn
// dots with their roles and labels, and the text version), the same wheel (its pixels, and the nodes marked as the chord that sounds and the next
// one); clicks on wheel nodes enter the same chords into the bar; the scale select has the same entries; neither page's console has an error.
// The new pages share the language: English chosen on the generator's page (as the app's strip chooses it) shows on the own songs' page, and
// German chosen there shows on the generator's page after "Zum Generator".
// Writes .superpowers/native-screens/track-page-check.json and prints it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

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
  for (let i = 0; i < 40 && (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)); i++) await sleep(250); // the debug port, free again
}

// The app on a folder of its own, attached, on its page for own songs (the new one with BTG_UI_NEW=1); errors are recorded from the page's second load
// (leaving the generator's page cuts its requests off)
async function launch(fresh) {
  const folder = join(work, fresh ? 'new' : 'old');
  mkdirSync(folder);
  const app = spawn(exe, [], { env: { ...process.env, BTG_UI_NEW: fresh ? '1' : '', BTG_MUTE: '1', BTG_NO_CACHE: '1', BTG_STORAGE_DIR: folder, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
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
  const name = fresh ? 'new page' : 'old page';
  let recording = false;
  page.on('console', (m) => { if (recording && m.type() === 'error') problems.push(`${name}, console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (recording) problems.push(`${name}, page error: ${e.message}`); });
  page.on('requestfailed', (r) => { if (recording && !r.url().startsWith('blob:')) problems.push(`${name}, request failed: ${r.url()}`); });
  await page.waitForLoadState('load').catch(() => {});
  // the language: on the new pages English is chosen on the generator's page as the app's strip chooses it (the own songs' page must show it,
  // check() reads it); the old pages are simply set to German
  await page.evaluate((l) => (l === 'en' ? window.__JUCE__.backend.emitByBackend('language', JSON.stringify(l)) : localStorage.setItem('backingtrack.lang', l)), fresh ? 'en' : 'de');
  const url = new URL(fresh ? '/app/track.html' : '/native/track.html', page.url()).href;
  await page.goto(url).catch(async () => { await sleep(1500); await page.goto(url); });
  const ready = () => page.waitForFunction(() => document.getElementById('scale').options.length > 0 && document.querySelector('#fretboard svg'), null, { timeout: 15000 });
  await ready();
  recording = true;
  await page.reload();
  await ready();
  return page;
}

// What the page shows at the playhead: the chord and the next one, the board's visible dots (string:fret:roles:label), its text version, the wheel's
// pixels (a hash of them) and the nodes it marks as the chord that sounds (pink) and the next one (teal), sampled in each node above its label
const shown = (page) => page.evaluate(async () => {
  const { layoutWheel } = await import('/app/wheel-geometry.js');
  const text = (id) => document.getElementById(id).textContent;
  const board = [...document.querySelectorAll('#fretboard svg .fret-note')].filter((g) => !g.hasAttribute('hidden')).map((g) => `${g.dataset.string}:${g.dataset.fret}:${g.dataset.role}:${g.textContent}`);
  const canvas = document.getElementById('wheel'), ctx = canvas.getContext('2d'), ratio = canvas.width / canvas.clientWidth;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i += 1) { hash ^= pixels[i]; hash = Math.imul(hash, 0x01000193) >>> 0; }
  const near = (rgb, [r, g, b]) => Math.abs(rgb[0] - r) + Math.abs(rgb[1] - g) + Math.abs(rgb[2] - b) < 40;
  const marks = layoutWheel(canvas.clientWidth).nodes.map((n, k) => {
    const rgb = ctx.getImageData(Math.round(n.x * ratio), Math.round((n.y - 0.7 * n.r) * ratio), 1, 1).data;
    return near(rgb, [0xe3, 0x46, 0x5e]) ? `${k}:now` : near(rgb, [0x18, 0xa2, 0xa6]) ? `${k}:next` : null;
  }).filter(Boolean);
  return { chord: text('chord'), next: text('next'), board, boardText: text('fretboard-text'), wheel: hash.toString(16), marks };
});

async function check(fresh, wav) {
  const page = await launch(fresh);
  // the two pages share the language: the one chosen on the generator's page shows here; German chosen here (as the strip does) shows on the
  // generator's page after "Zum Generator" (below), and the comparisons read German on both runs
  const languages = { opened: await page.evaluate(() => document.documentElement.lang) };
  if (fresh) await page.evaluate(() => window.__JUCE__.backend.emitByBackend('language', JSON.stringify('de')));
  await page.evaluate(() => {
    const backend = window.__JUCE__.backend;
    window.log = { engine: [], analysis: [] };
    backend.addEventListener('engine', (m) => { window.log.engine.push({ ...m, at: performance.now() }); if (window.log.engine.length > 600) window.log.engine.splice(0, 300); });
    backend.addEventListener('analysis', (m) => window.log.analysis.push(m));
    window.bridge = (type, data = {}) => backend.emitEvent('btg', { type, ...data });
  });
  const analysis = await page.evaluate(async (path) => {
    const name = path.split(/[\\/]/).pop();
    window.bridge('loadFile', { path });
    for (let i = 0; i < 1200; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const done = window.log.analysis.find((a) => a.name === name);
      if (done) return { json: done.json, seconds: done.seconds };
    }
    return null;
  }, wav);
  if (!analysis) throw new Error(`${fresh ? 'new' : 'old'} page: the song was not analysed`);
  await sleep(500);
  const seen = { analysis: analysis.json, languages };
  seen.scales = await page.evaluate(() => [...document.getElementById('scale').options].map((o) => `${o.value}=${o.textContent}`));
  seen.scale = await page.locator('#scale').inputValue();
  seen.edits = await page.evaluate(() => [...document.getElementById('edit').options].map((o) => o.value));
  // it plays: the transport moves and the display follows
  await page.evaluate(() => window.bridge('playFile', { from: 0, rate: 1 }));
  await sleep(2500);
  seen.playing = await page.evaluate(() => { const e = window.log.engine.at(-1); return { playing: e.playing, beats: +e.beats.toFixed(2), chord: document.getElementById('chord').textContent }; });
  await page.evaluate(() => window.bridge('stop'));
  await sleep(300);
  // the places: inside every chord the analysis found (a quarter second after its start) and just before the end
  const chords = JSON.parse(analysis.json).chords;
  seen.places = [];
  for (const t of [...chords.map((c) => c.t + 0.25), analysis.seconds - 0.5]) {
    await page.evaluate((beats) => window.bridge('seek', { beats }), t);
    await sleep(350);
    seen.places.push({ t: +t.toFixed(2), ...(await shown(page)) });
  }
  // clicks on wheel nodes at one place: C, Am, the outer node on B, E, F#, each with what the bar at the playhead stores and shows then
  const at = chords[Math.floor(chords.length / 2)].t + 0.25;
  await page.evaluate((beats) => window.bridge('seek', { beats }), at);
  await sleep(350);
  seen.clicks = [];
  for (const k of [0, 12, 5, 4, 6]) {
    const place = await page.evaluate(async (node) => {
      const { layoutWheel } = await import('/app/wheel-geometry.js');
      const n = layoutWheel(document.getElementById('wheel').clientWidth).nodes[node];
      return { x: n.x, y: n.y };
    }, k);
    await page.locator('#wheel').click({ position: place });
    await sleep(400);
    seen.clicks.push({ node: k, stored: await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('btg.track.')).map(([, v]) => v)), ...(await shown(page)) });
  }
  await page.screenshot({ path: join(out, `track-page-${fresh ? 'new' : 'old'}.png`) });
  // "Zum Generator" leads to the generator's page of the same kind
  await Promise.all([page.waitForURL(/index\.html/, { timeout: 15000 }), page.locator('#generator').click()]);
  seen.generator = new URL(page.url()).pathname;
  await page.waitForFunction(() => document.getElementById('variant')?.value, null, { timeout: 15000 }).catch(() => {}); // the generator's page drawn
  languages.back = await page.evaluate(() => document.documentElement.lang);
  await quit();
  return seen;
}

try {
  // the song: the funk test track with chords and pad on, 16 bars of a progression with sevenths, a half-diminished chord and the major dominant
  const { form, ...base } = JSON.parse(readFileSync(join(repo, 'native/core/tests/track-funk.json'), 'utf8'));
  const song = { ...base, key: { root: 'A', mode: 'minor' }, length: 16, layers: { ...base.layers, chords: true, pad: true },
    bars: [['A', 'min7'], ['D', 'min7'], ['G', 'dom7'], ['C', 'maj7'], ['F', 'maj7'], ['B', 'm7b5'], ['E', 'dom7'], ['A', 'min']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })) };
  writeFileSync(join(work, 'song.json'), JSON.stringify(song));
  const wav = join(work, 'song.wav');
  const rendered = spawnSync(join(repo, 'native/build/core/Release/btg_render.exe'), [join(work, 'song.json'), join(repo, 'src/assets/samples'), wav], { encoding: 'utf8' });
  if (rendered.status !== 0) throw new Error(`btg_render failed: ${rendered.stdout}${rendered.stderr}`);
  const old = await check(false, wav);
  const fresh = await check(true, wav);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const analysed = JSON.parse(old.analysis);
  result.song = { key: `${analysed.key.root} ${analysed.key.mode}`, scale: old.scale, chords: [...new Set(analysed.chords.map((c) => c.chord))], places: old.places.length };
  result.playing = { old: old.playing, new: fresh.playing };
  if (!same(old.analysis, fresh.analysis)) problems.push('the two app runs analysed the song differently: the pages cannot be compared');
  if (!old.playing.playing || old.playing.beats < 1 || !fresh.playing.playing || fresh.playing.beats < 1 || fresh.playing.chord === '–') problems.push(`the song does not play: ${JSON.stringify(result.playing)}`);
  for (const field of ['scales', 'scale', 'edits']) if (!same(old[field], fresh[field])) problems.push(`the ${field} differ: old ${JSON.stringify(old[field])}, new ${JSON.stringify(fresh[field])}`);
  result.scales = fresh.scales.length;
  // at each place every field the same; and the old page shows something there (a board with dots, a marked node), so that two empty pages do not pass
  const fields = ['chord', 'next', 'board', 'boardText', 'wheel', 'marks'];
  result.places = Object.fromEntries(fields.map((f) => [f, `${old.places.filter((p, i) => same(p[f], fresh.places[i]?.[f])).length}/${old.places.length}`]));
  old.places.forEach((p, i) => {
    const q = fresh.places[i];
    for (const f of fields) if (!same(p[f], q?.[f])) problems.push(`at ${p.t} s the ${f} differs: old ${JSON.stringify(p[f]).slice(0, 300)}, new ${JSON.stringify(q?.[f]).slice(0, 300)}`);
  });
  result.shownOnOld = { withDots: old.places.filter((p) => p.board.length).length, withMarks: old.places.filter((p) => p.marks.length).length, withText: old.places.filter((p) => p.boardText).length, kinds: [...new Set(old.places.map((p) => p.chord))] };
  if (!result.shownOnOld.withDots || !result.shownOnOld.withMarks || !result.shownOnOld.withText) problems.push(`the old page shows no board, text or marked node: ${JSON.stringify(result.shownOnOld)}`);
  result.clicks = old.clicks.map((c, i) => ({ node: c.node, chord: c.chord, same: same(c, fresh.clicks[i]) }));
  old.clicks.forEach((c, i) => { if (!same(c, fresh.clicks[i])) problems.push(`a click on node ${c.node}: old ${JSON.stringify(c).slice(0, 300)}, new ${JSON.stringify(fresh.clicks[i]).slice(0, 300)}`); });
  if (old.clicks.every((c) => !c.stored.length)) problems.push('no click on the wheel entered a chord on the old page');
  result.languages = { old: old.languages, new: fresh.languages };
  if (fresh.languages.opened !== 'en' || fresh.languages.back !== 'de') problems.push(`the new pages do not share the language (English chosen on the generator's page, German on the own songs' page): ${JSON.stringify(fresh.languages)}`);
  result.generator = { old: old.generator, new: fresh.generator };
  if (old.generator !== '/ui/index.html' || fresh.generator !== '/app/index.html') problems.push(`"Zum Generator" leads to ${JSON.stringify(result.generator)}`);
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
