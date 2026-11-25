// The app under test (Task 33): one app per test, on a storage folder of its own that is new and empty (the web tests' new browser context),
// started as the checks in native/tools start it: muted (BTG_MUTE), on that folder (BTG_STORAGE_DIR; the WebView2 profile with the pages'
// localStorage lies in it too), with the WebView2 debug port (9340 + the worker's index), attached with Playwright over CDP; ended with kill()
// after the browser is closed, the folder removed. Tests import test and expect from here; `page` is the app's generator page, ready.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect, chromium } from '@playwright/test';
import { shown, startApp } from '../../tools/app-window.mjs';

const exe = join(import.meta.dirname, '../../build/app/BackingtrackApp_artefacts/Release/Standalone/Backingtrack Generator.exe');
// The app runs on a Windows desktop of its own (startApp; BTG_SHOW=1 starts the app itself, to watch a test).
// A start takes 1.3 to 2.6 s (160 starts measured: no step over 2 s). After this deadline the start fails, naming its step; ending the app
// (at most 10 s) and removing the folder (at most 5 s) still fit in the fixture's 30 s. The deadline holds for both tries of a start together
// (below): a first try that stands without a page ends about 3 + 5 s after its spawn (the attach, measured up to 3.0 s, then NO_PAGE_MS), its
// app is ended (well under 1 s, at most 10 s), and the second try has the rest of the 15 s; a start of 1.3 to 2.6 s fits in it. If the 15 s
// are over when that app is ended, no second try is made.
const START_S = 15;
// shortcut: on a desktop of its own a start now and then stands with the app's WebView2 running and no page at all (`the browser's pages: []`;
// 6 in about 1900 starts with the workers on one desktop, 1 in about 2150 with a desktop each, never in about 3000 on the user's desktop); why is
// not known. Such a first try is ended after NO_PAGE_MS without any page and the app started once more on the same folder and port, with a line
// in the log ("the app's start was tried again: …") to count it by; every other way a start stands, and every start with BTG_SHOW=1, fails at
// the deadline as before, upgrade: when the cause is found. A normal start has a page 6 ms after the attach (mean of 88; at most 562 ms) and the
// app's own page after 161 ms (at most 1112 ms).
const NO_PAGE_MS = 5000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const portOpen = (port) => fetch(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
// polled by time, not by frame: a page whose window is hidden draws no frames
const drawn = (page) => page.waitForFunction(() => /\S/.test(document.getElementById('go')?.textContent ?? ''), null, { polling: 50 });

// The app on `folder`, its page attached and ready, within START_S: drawn from the session's answer to its sync, in the language of `locale`
// (WebView2's --lang sets navigator.language, which a page without a stored language takes), at `viewport`, with `reducedMotion`. Once it stands,
// the page is loaded again with every problem recorded from the start of its document (the app loaded it before anything could attach). A start
// that does not finish is not tried again (a hanging start of the app is to be known): the app is ended and the error names the step. The one
// exception: a first try on a desktop of its own whose WebView2 has had no page at all since the attach (NO_PAGE_MS above) is tried once more,
// and says so.
async function launch(options) {
  const fresh = () => ({ app: null, browser: null, page: null, closing: false, step: 'check the app and its port', since: Date.now() });
  let run = fresh();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the app's start did not finish within ${START_S} s, at the step: ${run.step}`)), START_S * 1000);
  });
  deadline.catch(() => {}); // it may come while the first try's app is being ended, before the second try races it
  try {
    try {
      await Promise.race([start(run, options, !shown), deadline]);
    } catch (e) {
      if (!e.noPage) throw e;
      const stood = Date.now() - run.since;
      run.step = `end the first try's app, its WebView2 without any page for ${e.noPage} ms after the attach`;
      await quit(run, options.port);
      run = fresh(); // already here: the outer catch would end the first try once more, 5 s for an exit that has come (kill() leaves exitCode null)
      await Promise.race([deadline, null]); // the deadline came while that app was being ended: the start fails with it, no second try
      console.log(`the app's start was tried again: port ${options.port}, the first try stood ${stood} ms, its WebView2 without any page for ${e.noPage} ms after the attach`);
      await Promise.race([start(run, options, false), deadline]);
    }
    return run;
  } catch (e) {
    // what the browser shows instead, for a start that stood before the app's page was there
    const pages = run.browser?.contexts().flatMap((c) => c.pages()).map((p) => p.url()) ?? null;
    if (pages && !run.page) e.message += `; the browser's pages: ${JSON.stringify(pages)}`;
    await quit(run, options.port);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function start(run, { folder, port, locale, viewport, reducedMotion, problems }, retry) {
  if (await portOpen(port)) throw new Error(`port ${port} is taken: does an app of an earlier run still run?`);
  if (run.closing) return; // the deadline came meanwhile and quit() found no app to end: none is started after it
  // shortcut: every start reads the user's %APPDATA%\Backingtrack Generator\Backingtrack Generator.settings (JUCE's StandaloneFilterApp, as in
  // every check of native/tools); kill() keeps the app from writing it, upgrade: when the app gets its own window or a variable for that file.
  // Without SmartScreen: on a new profile WebView2 holds its port and folder until about 6.5 s after its start, also after the app was ended.
  // A 2D canvas drawn in software: an accelerated one goes over to software after the test's first reads (toDataURL), and the same drawing
  // then has other pixels; a test that compares pictures of a canvas would compare the two ways of drawing it.
  // shortcut: one desktop per worker (btg-tests-<port>): with the apps of all workers on one desktop, a start now and then never got its page (the
  // WebView2's browser ran with no page for 15 s; 6 in about 1900 starts); with a desktop each it is rarer (1 in about 2150), not gone (such a
  // start is tried once more: NO_PAGE_MS above); why is not known, upgrade: when the cause is found.
  const downloads = join(folder, 'downloads');
  mkdirSync(downloads, { recursive: true });
  const app = (run.app = startApp(exe, `btg-tests-${port}`, { stdio: 'ignore', env: { ...process.env, BTG_MUTE: '1', BTG_STORAGE_DIR: folder,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --lang=${locale} --disable-features=msSmartScreenProtection --disable-accelerated-2d-canvas` } }));
  run.step = `attach to the app's WebView2 on port ${port}`;
  while (!run.browser) {
    if (run.closing) return; // the deadline came and quit() ended the app
    if (app.exitCode !== null) throw new Error(`the app ended at its start (exit code ${app.exitCode})`);
    await sleep(100);
    // an attempt that stands (its default waits 30 s) is made again. Downloads go into the test's folder, never to the user's Downloads: at every
    // attach Playwright sends Browser.setDownloadBehavior (allowAndName) with artifactsDir as the place; a download is then a `download` event
    // whose path() is that file
    run.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3000, artifactsDir: downloads }).catch(() => null);
  }
  run.step = 'find the page of its own (juce.backend)';
  const attached = Date.now();
  while (!run.page) {
    if (run.closing) return;
    const pages = run.browser.contexts().flatMap((c) => c.pages());
    run.page = pages.find((p) => p.url().includes('juce.backend')) ?? null;
    if (run.page) break;
    // No second try once a page was seen: one that came and went is another failure. shortcut: a page is seen at a look only (every 100 ms), one
    // that came and went between two looks is not, upgrade: the context's 'page' event, when a start shows that.
    retry &&= !pages.length;
    if (retry && Date.now() - attached > NO_PAGE_MS) throw Object.assign(new Error('no page'), { noPage: Date.now() - attached });
    await sleep(100);
  }
  const page = run.page;
  // Over a session of the browser, which stays open with it; only once the page is there: a WebView2 without any page has no browser context yet
  // ("Browser context management is not supported", seen once), and that start is to get its second try above.
  // The download place once more, set by the fixture itself (the same as Playwright's at the attach): a Playwright that changed its default would
  // otherwise first show as a file in the user's Downloads.
  // The clipboard is the user's (the tests' desktops share it): the browser refuses the page's writes ("Kopieren"; the page then marks the text in
  // its field). shortcut: the page's branch of a copy that succeeds (ui.profileCopied) never runs in the tests, upgrade: when the tests get a
  // clipboard of their own (a window station of their own, or a stand-in for navigator.clipboard)
  run.step = 'set the download place, deny writes to the clipboard';
  const cdp = await run.browser.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads });
  await cdp.send('Browser.setPermission', { permission: { name: 'clipboard-write' }, setting: 'denied' });
  run.step = 'the first drawing of the page';
  await drawn(page);
  run.step = 'the fonts of the first load';
  await page.evaluate(() => document.fonts.ready); // nothing of the first load is under way when it loads again
  page.on('console', (m) => { if (!run.closing && m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => { if (!run.closing) problems.push(`pageerror: ${e.message}`); });
  // shortcut: the fixture's own reload is aborted now and then (about 1 start in 500, 6 ms after it was asked for; it is the only navigation asked
  // for, and a whole new document with the init script loads all the same); who aborts it is not known: an aborted navigation belongs to no
  // document, so a navigation that fails while the reload stands is not counted, every problem of the document that then loads is, upgrade: when
  // the cause is found. Any other failed navigation names the step and the time.
  const reloading = () => run.step === 'load the page again' || run.step === 'the drawing after the new load';
  page.on('requestfailed', (r) => {
    if (run.closing || (r.isNavigationRequest() && reloading())) return;
    const where = r.isNavigationRequest() ? ` [a navigation, ${Date.now() - run.since} ms after the app's start, at the step: ${run.step}]` : '';
    problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ''}${where}`);
  });
  run.step = 'reduced motion, the viewport, the init script';
  if (reducedMotion) await page.emulateMedia({ reducedMotion });
  if (viewport) await page.setViewportSize(viewport);
  // for answered() and settled(): the number of the page's last action, of the last answer, whether its profiles are due, the display's ticks
  // since the last answer, the engine's reports in all
  await page.addInitScript(() => {
    const backend = window.__JUCE__.backend;
    const btg = (window.__btg = { sent: 0, answered: 0, profilesDue: false, ticks: 0, reports: 0 });
    const emit = backend.emitEvent.bind(backend);
    backend.emitEvent = (name, data) => { if (data?.type === 'action') btg.sent = data.seq; return emit(name, data); };
    backend.addEventListener('state', (m) => {
      if (typeof m.seq === 'number' && m.seq > btg.answered) btg.answered = m.seq;
      if (m.change?.profiles) btg.profilesDue = true;
      btg.ticks = 0;
    });
    backend.addEventListener('profiles', () => { btg.profilesDue = false; });
    backend.addEventListener('engine', () => { btg.ticks++; btg.reports++; });
  });
  run.step = 'load the page again';
  await page.reload();
  run.step = 'the drawing after the new load';
  await drawn(page);
  if (viewport) expect(await page.evaluate(() => [innerWidth, innerHeight]), 'the viewport in the WebView').toEqual([viewport.width, viewport.height]);
  run.step = 'the test';
}

async function quit(run, port) {
  run.closing = true;
  await run.browser?.close().catch(() => {});
  if (run.app && run.app.exitCode === null) {
    const gone = new Promise((r) => { run.app.once('exit', r); setTimeout(r, 5000); });
    run.app.kill();
    await gone;
  }
  // the app's WebView2 may hold the debug port a moment longer: the next app could not open it
  for (let i = 0; i < 50 && (await portOpen(port)); i++) await sleep(100);
}

// WebView2 still tidies its profile a moment after its port is free; rmSync then can end without an error and remove nothing: again until gone
async function remove(folder) {
  for (let i = 0; ; i++) {
    try { rmSync(folder, { recursive: true, force: true }); } catch { /* an entry is still held: once more */ }
    if (!existsSync(folder)) return;
    if (i === 50) throw new Error(`the test's storage folder ${folder} could not be removed within 5 s`);
    await sleep(100);
  }
}

export const test = base.extend({
  // { page, folder, restart(files) }: restart ends the app, writes `files` ({ name: text }) into its storage folder and starts it again on the
  // folder; it gives the new page. Console errors, page errors and failed requests of every page fail the test.
  app: [async ({ locale, viewport, reducedMotion }, use, testInfo) => {
    const folder = mkdtempSync(join(tmpdir(), 'btg-ui-test-'));
    const port = 9340 + testInfo.parallelIndex;
    const problems = [];
    const options = { folder, port, locale: locale ?? 'de-DE', viewport, reducedMotion, problems };
    let run = null;
    try {
      run = await launch(options);
      await use({
        page: run.page,
        folder,
        async restart(files = {}) {
          await quit(run, port);
          run = null;
          for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
          run = await launch(options);
          return run.page;
        },
      });
    } finally {
      if (run) await quit(run, port);
      await remove(folder);
    }
    expect(problems).toEqual([]);
  }, { timeout: 30_000 }], // the app's start and end, apart from the test's own time
  page: async ({ app }, use) => use(app.page),
});

export { expect };

/** What the page draws from: `tables`, `state`, `derived` or `position` of the session, as the page last got it (native/app/ui/session.js). */
export const fromSession = (page, name) => page.evaluate(async (n) => (await import('./session.js')).session[n], name);

/** The page shows the answers to every action it sent, as the web's page does at once: each is answered (the state names the action), the
 *  profiles of an answer that changed them came, and the display ticked twice since (the shell's engine report, 30 times a second; the position
 *  the session gives after the answer, from which the page draws the progression, the bar and the fretboard, comes at its first free tick).
 *  shortcut: two ticks hold only if at most one tick finds the session's lock taken (by a job of the shell itself, rememberSession at a restart
 *  while playing), upgrade: when a test reads the position right after such a restart, wait for the position that belongs to the answer. */
export const answered = (page) => page.waitForFunction(() => { const b = window.__btg; return b.answered >= b.sent && !b.profilesDue && b.ticks >= 2; },
  null, { polling: 50 });

/** The shell has done everything the page sent before, and the engine has reported twice since: an export goes into the shell's one queue behind
 *  the page's actions, stops and starts and is answered after them, after their engine calls and restarts too (native/PROTOKOLL.md section 7);
 *  a stop or a start they caused is in the reports after it. The export of key '' is empty and nobody on the page waits for it. */
export const settled = (page) => page.evaluate(async () => {
  const backend = window.__JUCE__.backend;
  const name = `settled ${performance.now()}`;
  const done = new Promise((resolve) => backend.addEventListener('export', (m) => { if (m.name === name) resolve(); }));
  backend.emitEvent('btg', { type: 'export', key: '', name });
  await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('settled: the shell did not answer within 10 s')), 10_000))]);
  const from = window.__btg.reports;
  while (window.__btg.reports < from + 2) await new Promise((r) => setTimeout(r, 20));
});

/** The language chosen as the app's strip chooses it (the page's own keys are hidden in the app): the shell's event `language`. */
export const chooseLanguage = (page, lang) => page.evaluate((l) => window.__JUCE__.backend.emitByBackend('language', JSON.stringify(l)), lang);
