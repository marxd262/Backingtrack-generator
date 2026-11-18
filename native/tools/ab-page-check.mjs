// Checks the A/B listening page (ab-page.mjs) in Playwright's Chromium, headless, in both ways of loading:
// served over HTTP (the serve mode, --no-open) and opened from file:// (the folder is handed to the page's file input).
// It makes its own folder under the system's temp directory with pairs it synthesises itself (A = 440 Hz, B = 880 Hz),
// so it needs no rendered cases. One line per check; exit code 1 if any fails.
//   node native/tools/ab-page-check.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { writeAbPage } from './ab-page.mjs';
import { wavBytes } from './web-render.mjs';

const tools = dirname(fileURLToPath(import.meta.url));
const RATE = 48000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) {
  try {
    const info = await fn();
    console.log(`ok   ${name}${info ? ` (${info})` : ''}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${name}: ${String(error.message).split('\n')[0]}`);
  }
}

// stereo sine of the given length; a pair is one at 440 Hz (web, A) and one at 880 Hz (nativ, B)
const tone = (seconds, hz) => Float32Array.from({ length: seconds * RATE * 2 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * Math.floor(i / 2)) / RATE));
// The weights pair shows what the gains do: A is a constant 0.5 on the left channel only, B a constant 0.5 on the right channel only. What the
// page plays is then 0.5 * gain of A on the left and 0.5 * gain of B on the right, at every audio sample.
const dc = (seconds, channel) => Float32Array.from({ length: seconds * RATE * 2 }, (_, i) => (i % 2 === channel ? 0.5 : 0));
const folder = mkdtempSync(join(tmpdir(), 'btg-ab-check-'));
for (const [name, seconds] of [['band-lang', 25], ['bass-kurz', 3], ['pad-kurz', 2]]) {
  writeFileSync(join(folder, `${name}-web.wav`), wavBytes(tone(seconds, 440), RATE));
  writeFileSync(join(folder, `${name}-nativ.wav`), wavBytes(tone(seconds, 880), RATE));
}
writeFileSync(join(folder, 'dc-gewichte-web.wav'), wavBytes(dc(12, 0), RATE));
writeFileSync(join(folder, 'dc-gewichte-nativ.wav'), wavBytes(dc(12, 1), RATE));
writeAbPage(folder);

// what the page does with the audio, seen from outside: every start of a source (when, offset), logged before the page's own code runs
const spy = () => {
  window.__starts = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    window.__starts.push({ when, offset, duration });
    return start.call(this, when, offset, duration);
  };
};

const press = (page, key) => page.keyboard.press(key);
const state = (page) => page.evaluate(() => window.__ab.state());
const waitState = (page, test) => page.waitForFunction((t) => new Function('s', `return ${t}`)(window.__ab.state()), test, { timeout: 8000 });
const starts = (page) => page.evaluate(() => window.__starts);
const lastPair = async (page) => { const s = await starts(page); const [a, b] = s.slice(-2); ok(s.length % 2 === 0 && a.when === b.when && a.offset === b.offset, `the two sources start apart: ${JSON.stringify(s.slice(-2))}`); return a; };
// the strongest frequency of what the page sends to the speakers
const heard = (page) => page.evaluate(async () => {
  const { ctx, out } = window.__ab;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  out.connect(analyser);
  await new Promise((r) => setTimeout(r, 150));
  const bins = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(bins);
  out.disconnect(analyser);
  return bins.indexOf(Math.max(...bins)) * (ctx.sampleRate / analyser.fftSize);
});
const near = (hz, want) => Math.abs(hz - want) < 40;

// Taps what the page sends to the speakers with an audio worklet: it runs on the audio thread and loses no sample when the page is busy.
// (A data: URL, because a page opened from file:// may not load a blob: one.)
const tap = (page) => page.evaluate(async () => {
  const { ctx, out } = window.__ab;
  const code = "registerProcessor('tap', class extends AudioWorkletProcessor { process(inputs) { const [l, r] = inputs[0]; if (l && r) this.port.postMessage([l.slice(), r.slice()]); return true; } })";
  await ctx.audioWorklet.addModule('data:text/javascript;base64,' + btoa(code));
  const node = new AudioWorkletNode(ctx, 'tap', { channelCount: 2, channelCountMode: 'explicit' });
  window.__tap = null;
  node.port.onmessage = (e) => window.__tap?.push(e.data);
  out.connect(node);
  node.connect(ctx.destination);
});
// Presses Space at 0 ms and after each delay, records the tap for ms in all, and returns the two gains as they were at every audio sample
// (the weights pair: left is 0.5 * gain of A, right 0.5 * gain of B).
const gainsRun = async (page, delays, ms) => {
  const { l, r } = await page.evaluate(async ([delays, ms]) => {
    window.__tap = [];
    const toggle = () => dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', cancelable: true }));
    toggle();
    for (const d of delays) { await new Promise((done) => setTimeout(done, d)); toggle(); }
    await new Promise((done) => setTimeout(done, ms));
    const chunks = window.__tap;
    window.__tap = null;
    return { l: chunks.flatMap((c) => [...c[0]]), r: chunks.flatMap((c) => [...c[1]]) };
  }, [delays, ms]);
  const top = Math.max(...l, ...r); // a full gain
  ok(top > 0.4, `the tap hears nothing (${top})`);
  return { a: l.map((v) => v / top), b: r.map((v) => v / top) };
};
const open = async (page, name) => { await page.locator(`button[data-name=${name}]`).click(); await waitState(page, `!s.loading && s.ready && s.name === "${name}"`); await sleep(200); }; // 200 ms: the sources start 20 ms after the pair is there

// ---------- the serve mode ----------
const server = spawn(process.execPath, [join(tools, 'ab-page.mjs'), '--serve', folder, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
const address = await new Promise((done) => {
  const timer = setTimeout(() => done(null), 8000);
  const look = () => { const m = serverLog.match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) { clearTimeout(timer); done(m[0]); } else if (server.exitCode === null) setTimeout(look, 50); else { clearTimeout(timer); done(null); } };
  look();
});

const browser = await chromium.launch();
try {
  await check('serve mode: prints an address on 127.0.0.1 and runs', async () => {
    ok(address, `no address from the serve mode: ${serverLog.trim().split('\n')[0] || 'no output'}`);
    return address;
  });

  if (address) {
    await check('server: GET only, and nothing but the page and the WAV files of the folder', async () => {
      const status = (path, method = 'GET') => new Promise((done, fail) => { const r = request(address + path, { method }, (res) => { res.resume(); done(res.statusCode); }); r.on('error', fail); r.end(); });
      const code = await Promise.all([status('', 'POST'), status('band-lang-web.wav'), status('%2e%2e%2fab-page-check.mjs'), status('ab-open.cmd'), status('nothing.wav')]);
      ok(code[0] === 405 && code[1] === 200 && code[2] === 404 && code[3] === 404 && code[4] === 404, `POST ${code[0]}, wav ${code[1]}, outside ${code[2]}, cmd ${code[3]}, missing ${code[4]}`);
      await new Promise((done) => get(address, (res) => { res.resume(); done(); }));
    });

    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
    await page.addInitScript(spy);

    // a pair that loads slowly says so; a file that is missing is told in words on the page
    await page.route('**/pad-kurz-nativ.wav', (route) => route.fulfill({ status: 404, body: '' }));
    await page.route('**/bass-kurz-web.wav', async (route) => { await sleep(700); await route.continue(); });
    await page.goto(address);
    await page.waitForFunction(() => window.__ab, null, { timeout: 8000 }).catch(() => {});
    await check('the first pair loads; nothing is left of the two audio elements', async () => {
      await waitState(page, '!s.loading && s.ready');
      ok(await page.evaluate(() => !document.querySelector('audio')), 'there is still an <audio> element');
      ok(await page.locator('#folder').isHidden(), 'the folder button is shown although the page is served');
    });
    await check('keys while loading do nothing harmful, and the page says "lädt"', async () => {
      await press(page, 'ArrowDown'); // bass-kurz: slow
      await page.waitForFunction(() => /lädt/.test(document.getElementById('msg').textContent));
      await press(page, 'Space'); await press(page, 'Space'); await press(page, 'Enter'); await press(page, 'Enter');
      await waitState(page, '!s.loading && s.ready');
      ok(!(await state(page)).playing, 'playing after Enter twice');
      ok(await page.locator('#msg').innerText() === '', 'the message did not go away');
      await press(page, 'ArrowUp');
      await waitState(page, '!s.loading && s.ready && s.name === "band-lang"');
    });
    await check('a missing file is shown on the page in words', async () => {
      await page.locator('button[data-name=pad-kurz]').click();
      await page.waitForFunction(() => /pad-kurz-nativ\.wav/.test(document.getElementById('msg').textContent));
      const text = await page.locator('#msg').innerText();
      ok(/nicht gefunden/.test(text), text);
      await press(page, 'Enter'); await press(page, 'Enter'); await press(page, 'Space'); await press(page, 'Space'); // nothing loaded: still no harm
      await page.locator('button[data-name=band-lang]').click();
      await waitState(page, '!s.loading && s.ready && s.name === "band-lang"');
    });

    await check('start: both sources start at the same context time and the same offset', async () => {
      await press(page, 'Enter');
      await waitState(page, 's.playing');
      const s = await starts(page);
      ok(s.length === 2, `${s.length} sources started`);
      await lastPair(page);
    });
    await check('A is heard first, B after Space, A again', async () => {
      const first = await heard(page);
      await press(page, 'Space'); await sleep(150);
      const second = await heard(page);
      await press(page, 'Space'); await sleep(150);
      const third = await heard(page);
      ok(near(first, 440) && near(second, 880) && near(third, 440), `heard ${first.toFixed(0)}, ${second.toFixed(0)}, ${third.toFixed(0)} Hz`);
      return `${first.toFixed(0)}, ${second.toFixed(0)}, ${third.toFixed(0)} Hz`;
    });
    await check('a switch is a linear fade of 50 ms; the gains add up to 1 at every sample and end at exactly 0 and 1', async () => {
      await open(page, 'dc-gewichte'); // plays on from the start, side A
      await tap(page);
      const { a, b } = await gainsRun(page, [], 300);
      const worst = Math.max(...a.map((v, i) => Math.abs(v + b[i] - 1)));
      const first = a.findIndex((v) => v < 0.9999), last = a.findIndex((v) => v === 0);
      const line = (i) => 1 - (i - first) / (last - first);
      const bent = Math.max(...a.slice(first, last).map((v, k) => Math.abs(v - line(first + k))));
      ok(worst < 1e-4, `a + b off from 1 by ${worst}`);
      ok(a.at(-1) === 0 && b.at(-1) === 1, `ends at ${a.at(-1)} / ${b.at(-1)}`);
      ok(last - first > 0.045 * RATE && last - first < 0.056 * RATE, `the fade is ${((last - first) / RATE * 1000).toFixed(1)} ms long`);
      ok(bent < 0.02, `the fade is ${bent} off a straight line`);
      return `${last - first} samples across the fade (${((last - first) / RATE * 1000).toFixed(1)} ms), worst sum error ${worst.toExponential(1)}, ends at 0 / 1`;
    });
    await check('a switch during a fade turns around from where the gains are, and ends on the right side', async () => {
      const before = await state(page); // B now
      const { a, b } = await gainsRun(page, [20, 15], 300); // three switches in a row: ends on the other side
      const worst = Math.max(...a.map((v, i) => Math.abs(v + b[i] - 1)));
      const jump = Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i])));
      ok(worst < 1e-4, `a + b off from 1 by ${worst}`);
      ok(jump < 0.0015, `a gain jumps by ${jump}`); // a full fade moves 0.0004 per sample
      const after = await state(page);
      ok(after.side === 1 - before.side, `side ${before.side} -> ${after.side}`);
      ok(a.at(-1) === 1 - after.side && b.at(-1) === after.side, `ends at ${a.at(-1)} / ${b.at(-1)} for side ${after.side}`);
      return `no jump above ${jump.toExponential(1)} per sample, ends on ${'AB'[after.side]}`;
    });
    await check('a switch to the same side again changes nothing (two quick switches end where they began)', async () => {
      const before = await state(page);
      const { a, b } = await gainsRun(page, [10], 300);
      const after = await state(page);
      ok(after.side === before.side && a.at(-1) === 1 - after.side && b.at(-1) === after.side, `side ${before.side} -> ${after.side}, ends at ${a.at(-1)} / ${b.at(-1)}`);
      await open(page, 'band-lang');
      await press(page, 'Space'); await press(page, 'Space'); // the file keeps its side and plays on
    });
    await check('forty switches in twenty seconds: the position stays with the clock (5 ms), no source is started again', async () => {
      if ((await state(page)).side) await press(page, 'Space');
      await sleep(300);
      const before = (await starts(page)).length;
      let worst = 0;
      const t0 = Date.now();
      for (let i = 1; i <= 40; i++) {
        await press(page, 'Space');
        const miss = await page.evaluate(() => {
          const { ctx } = window.__ab, first = window.__starts.at(-1);
          return Math.abs(window.__ab.position() - (first.offset + Math.max(0, ctx.currentTime - first.when))) * 1000;
        });
        worst = Math.max(worst, miss);
        await sleep(Math.max(0, t0 + i * 500 - Date.now()));
      }
      ok((await starts(page)).length === before, 'a switch started the sources again');
      ok(worst < 5, `the position is ${worst.toFixed(1)} ms off`);
      const after = await state(page);
      ok(after.side === 0 && after.playing, `side ${after.side}, playing ${after.playing}`);
      return `worst ${worst.toFixed(2)} ms, ${((Date.now() - t0) / 1000).toFixed(0)} s`;
    });
    await check('a change of file while playing keeps the side and plays on', async () => {
      await press(page, 'Space'); // B
      await sleep(100);
      await press(page, 'ArrowDown');
      await waitState(page, 's.playing && s.name === "bass-kurz"');
      const s = await state(page);
      ok(s.side === 1, `side ${s.side}`);
      const [pair, hz] = [await lastPair(page), await heard(page)];
      ok(pair.offset === 0 && near(hz, 880), `offset ${pair.offset}, heard ${hz.toFixed(0)} Hz`);
      await press(page, 'Space'); // back to A
    });
    await check('seek while playing: both sources start again at the new offset, together', async () => {
      const dur = (await state(page)).duration;
      await page.evaluate(() => { const pos = document.getElementById('pos'); pos.value = 0.5; pos.dispatchEvent(new Event('input', { bubbles: true })); pos.dispatchEvent(new Event('change', { bubbles: true })); });
      await sleep(50);
      const pair = await lastPair(page);
      ok(Math.abs(pair.offset - dur / 2) < 0.01, `offset ${pair.offset} of ${dur}`);
      ok((await state(page)).playing, 'stopped playing');
    });
    await check('pause holds the position; resume goes on from there', async () => {
      await press(page, 'Enter');
      const a = await page.evaluate(() => window.__ab.position());
      await sleep(400);
      const b = await page.evaluate(() => window.__ab.position());
      ok(!(await state(page)).playing && a === b, `playing ${(await state(page)).playing}, ${a} then ${b}`);
      await press(page, 'Enter');
      await waitState(page, 's.playing');
      const pair = await lastPair(page);
      ok(Math.abs(pair.offset - b) < 0.001, `resumed at ${pair.offset}, paused at ${b}`);
    });
    await check('the end of the file stops playing, and Enter plays it again from the start', async () => {
      const dur = (await state(page)).duration;
      await page.evaluate((d) => { const pos = document.getElementById('pos'); pos.value = (d - 0.3) / d; pos.dispatchEvent(new Event('change', { bubbles: true })); }, dur);
      await waitState(page, '!s.playing');
      const end = await page.evaluate(() => window.__ab.position());
      ok(Math.abs(end - dur) < 0.05, `stopped at ${end} of ${dur}`);
      await press(page, 'Enter');
      await waitState(page, 's.playing');
      ok((await lastPair(page)).offset === 0, 'did not start from 0');
      await press(page, 'Enter');
    });
    await check('no sideways scroll at 400 px', async () => {
      await page.setViewportSize({ width: 400, height: 800 });
      const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      ok(scroll <= width, `scrollWidth ${scroll} > ${width}`);
    });
    await check('no console errors', async () => { ok(!problems.length, problems.join(' | ')); });
    await context.close();
  } else {
    for (const name of ['the page over HTTP (start, switch, files, seek, pause, end, errors, scroll)']) await check(name, async () => { throw new Error('no server'); });
  }

  // ---------- from file:// ----------
  const fileContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const file = await fileContext.newPage();
  file.setDefaultTimeout(8000);
  const fileProblems = [];
  file.on('console', (m) => { if (m.type() === 'error') fileProblems.push(`console: ${m.text()}`); });
  file.on('pageerror', (e) => fileProblems.push(`error: ${e.message}`));
  await file.addInitScript(spy);
  await file.goto(pathToFileURL(join(folder, 'index.html')).href);
  await check('file://: the button to choose the folder appears, with the reason and ab-open.cmd', async () => {
    await file.locator('#folder').waitFor({ state: 'visible' });
    ok(/Ordner mit den Hörproben wählen/.test(await file.locator('#folder').innerText()), 'the button has another text');
    ok(/ab-open\.cmd/.test(await file.locator('#folder-why').innerText()), 'no word about ab-open.cmd');
  });
  await check('file://: with the folder given to the input, start and switch work', async () => {
    await file.locator('#folder-input').setInputFiles(folder);
    await waitState(file, '!s.loading && s.ready');
    await press(file, 'Enter');
    await waitState(file, 's.playing');
    ok((await starts(file)).length === 2, 'two sources did not start');
    await lastPair(file);
    const first = await heard(file);
    await press(file, 'Space'); await sleep(150);
    const second = await heard(file);
    ok(near(first, 440) && near(second, 880), `heard ${first.toFixed(0)}, ${second.toFixed(0)} Hz`);
    await open(file, 'dc-gewichte');
    await tap(file);
    const { a, b } = await gainsRun(file, [], 300);
    const worst = Math.max(...a.map((v, i) => Math.abs(v + b[i] - 1)));
    ok(worst < 1e-4 && a.at(-1) === 1 && b.at(-1) === 0, `sum off by ${worst}, ends at ${a.at(-1)} / ${b.at(-1)}`);
    ok(!fileProblems.length, fileProblems.join(' | '));
  });
} finally {
  await browser.close().catch(() => {});
  server.kill();
  rmSync(folder, { recursive: true, force: true });
}
console.log(failed ? `${failed} check(s) failed` : 'all checks ok');
process.exit(failed ? 1 : 0);
