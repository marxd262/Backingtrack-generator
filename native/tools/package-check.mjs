// Checks that the program's folder runs on its own, without the repository (Task 34), in one step (after native/build.ps1 with the app):
//   node native/tools/package-check.mjs
// It copies the folder of the built program (native/build/app/BackingtrackApp_artefacts/Release/Standalone, with the ui/, samples/ and models/ the
// build put beside it) to a folder of its own in the temp directory and marks the copy: its generator page gets a meta tag, a licence text of its
// packs a line. Then page-check.mjs runs against the copy (0 problems). Then it removes a pack of the start choice from the copy (bass-finger, which
// stays in the repository) and starts the copy once more, unseen and muted, on a storage folder of its own, with neither BTG_UI_DIR nor BTG_PACKS_DIR
// (startApp would otherwise give it the repository's pages): the page that runs carries the mark, the shell reports the removed pack as not loading
// and the drums' pack as ready, and the licence text it serves carries the mark. The repository is not renamed or moved (the user's editor and his
// worktrees hang on it): the marks show from where the copy reads. The copy's folder has characters outside ASCII and Windows-1252 in its name.
// The page check has PAGE_CHECK_S; the folder is removed at the end, also after a failure; the exit code is 1 when a claim fails.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { startApp } from './app-window.mjs';

const repo = join(import.meta.dirname, '../..');
const program = join(repo, 'native/build/app/BackingtrackApp_artefacts/Release/Standalone');
const PORT = 9335;
const PAGE_CHECK_S = 600;
const PACK = 'bass-finger', LICENCE = 'LICENSE-drums-naked.md';
const mark = `package-check ${process.pid} ${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = () => fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false);
// the environment of the copy's apps: no folder named for its pages or packs (BTG_UI_DIR empty: startApp then gives it none)
const env = { ...process.env, BTG_UI_DIR: '' };
delete env.BTG_PACKS_DIR;

let failed = 0;
const claim = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${detail}`}`);
};

if (!existsSync(join(program, 'ui')) || !existsSync(join(program, 'samples'))) throw new Error(`no ui/ and samples/ beside the program in ${program}: build it first (native/build.ps1)`);
// characters outside ASCII and outside Windows-1252 in the folder's name: the app at a path as a user's folder may have it
const work = mkdtempSync(join(tmpdir(), 'btg-package-check-ö-ž-日-'));
console.log(`the copy's folder: ${work}`);
const copy = join(work, 'Standalone'), exe = join(copy, 'Backingtrack Generator.exe');
let app = null, browser = null;
try {
  cpSync(program, copy, { recursive: true });
  const index = join(copy, 'ui/index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', `<head><meta name="btg-mark" content="${mark}">`));
  appendFileSync(join(copy, 'samples', LICENCE), `\n${mark}\n`);

  // page-check.mjs prints its result (JSON) and nothing else
  console.log('page-check.mjs against the copy ...');
  // it took 131 s; ended by the limit, its app ends with it (the runner's job, app-window.mjs). shortcut: a page check ended so leaves its own
  // storage folder (btg-page-check-*) in the temp directory, upgrade: when the limit is seen to hit
  const checked = spawnSync(process.execPath, [join(import.meta.dirname, 'page-check.mjs'), '5', exe], { env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: PAGE_CHECK_S * 1000 });
  let problems;
  try { problems = JSON.parse(checked.stdout).problems; } catch { problems = null; }
  claim('page-check.mjs runs against the copy with 0 problems', checked.status === 0 && problems?.length === 0,
    checked.error?.code === 'ETIMEDOUT' ? `it did not end within ${PAGE_CHECK_S} s and was ended`
      : `exit code ${checked.status}, problems ${JSON.stringify(problems)} ${checked.stderr ?? ''}`.trim());

  for (const file of [`${PACK}.json`, `${PACK}.pcm`]) rmSync(join(copy, 'samples', file));
  const storage = join(work, 'storage');
  mkdirSync(storage);
  app = await startApp(exe, `btg-tools-${PORT}`, { env: { ...env, BTG_MUTE: '1', BTG_STORAGE_DIR: storage, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: 'ignore' });
  for (let i = 0; !browser && i < 40; i++) {
    await sleep(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 3000 }).catch(() => null); // every wait of this part is bounded
  }
  if (!browser) throw new Error('the WebView2 debug port did not open');
  let page;
  for (let i = 0; !page && i < 40; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('juce.backend'));
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('no page from the resource provider');
  await page.waitForLoadState('load');
  const shown = await page.evaluate(async (licence) => {
    const { session } = await import('./session.js');
    const told = () => session.voices && ['bass', 'drums'].every((l) => session.voices[l] && session.voices[l] !== 'silent');
    for (let i = 0; i < 300 && !told(); i++) await new Promise((r) => setTimeout(r, 50));
    return { url: location.href, mark: document.querySelector('meta[name="btg-mark"]')?.content ?? null, voices: session.voices,
      licence: await fetch(`/samples/${licence}`).then((r) => r.text(), (e) => `not served: ${e.message}`) };
  }, LICENCE);
  claim('the page that runs is the copy\'s (it carries the mark)', shown.url.includes('/app/index.html') && shown.mark === mark, `${shown.url}, mark ${JSON.stringify(shown.mark)}`);
  claim(`the removed pack ${PACK} is reported as not loading, while it lies in the repository`,
    shown.voices?.bass?.startsWith('error') && shown.voices.bass.includes(PACK) && existsSync(join(repo, 'src/assets/samples', `${PACK}.json`)), `bass: ${JSON.stringify(shown.voices?.bass)}`);
  claim('another pack (the drums\') loads', shown.voices?.drums === 'ready', `drums: ${JSON.stringify(shown.voices?.drums)}`);
  claim(`the licence text ${LICENCE} is served from the copy (it carries the mark)`, shown.licence.includes(mark), shown.licence.slice(-120));
} catch (error) {
  claim('the check ran to its end', false, error.message.split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  if (app && app.exitCode === null) {
    const gone = new Promise((r) => { app.once('exit', r); setTimeout(r, 5000); });
    app.kill();
    await gone;
  }
  for (let i = 0; i < 40 && (await portOpen()); i++) await sleep(250);
  // the storage holds the app's WebView2 profile, which its browser may hold a moment after the app ended
  try { rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch (error) { console.error(`package-check: could not remove ${work}: ${error.message}`); failed++; }
}
console.log(failed ? `package-check: ${failed} failed` : 'package-check: every claim holds');
process.exitCode = failed ? 1 : 0;
