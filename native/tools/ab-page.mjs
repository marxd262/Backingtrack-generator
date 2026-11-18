// Writes index.html (and ab-open.cmd) into a folder of A/B pairs (<name>-web.wav and <name>-nativ.wav, as sound-compare.mjs leaves
// them): one page to switch between the files and between A (web app) and B (native core) at the same position.
//   node native/tools/ab-page.mjs [folder]                write the page only; default folder: .superpowers/audio-ab/compare
//   node native/tools/ab-page.mjs --serve [folder]        write it, serve the folder on 127.0.0.1 (GET only), open the browser
//                                                         (--no-open leaves the browser closed); runs until stopped
// Both files of a pair play through Web Audio from one clock (two sources started at the same context time and offset, each
// through its own gain); A/B is a 50 ms cross-fade of the two gains, which always add up to 1. Two <audio> elements had two clocks.
// Pairs whose name is in none of the case files (native/tools/sound-cases/*.json) are listed last, as older runs.
// sound-compare.mjs calls writeAbPage(folder) at the end of every run of cases.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFile, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const repo = resolve(dirname(here), '../..');

// Writes <folder>/index.html and <folder>/ab-open.cmd and returns the page's path and the number of pairs; throws when the folder holds no pair.
export function writeAbPage(folder) {
  const files = new Set(readdirSync(folder));
  const names = [...files].filter((f) => f.endsWith('-web.wav')).map((f) => f.slice(0, -'-web.wav'.length))
    .filter((n) => /^[\w.-]+$/.test(n) && files.has(`${n}-nativ.wav`)).sort();
  if (!names.length) throw new Error(`no pairs <name>-web.wav / <name>-nativ.wav in ${folder}`);

  const casesDir = join(repo, 'native/tools/sound-cases');
  const current = new Set(existsSync(casesDir)
    ? readdirSync(casesDir).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(readFileSync(join(casesDir, f), 'utf8')).map((c) => c.name))
    : names);
  const TITLES = { band: 'Ganze Band', drums: 'Schlagzeug', bass: 'Bass', chords: 'Akkorde', pad: 'Pad', lead: 'Lead', percussion: 'Percussion' };
  const groups = new Map(Object.values(TITLES).map((title) => [title, []]));
  for (const name of names) {
    const title = current.has(name) ? TITLES[name.split('-')[0]] ?? 'Sonstige' : 'Ältere Läufe (nicht mehr in den Fällen)';
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(name);
  }
  const list = [...groups].filter(([, items]) => items.length)
    .map(([title, items]) => `<h2>${title}</h2><p>${items.map((n) => `<button class="file" data-name="${n}">${n.replace(/^[a-z]+-/, '') || n}</button>`).join(' ')}</p>`).join('\n');

  const page = join(folder, 'index.html');
  // String.raw: the page's script keeps its backslashes; it uses no backticks and no dollar-brace of its own
  writeFileSync(page, String.raw`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A/B: Web gegen nativ</title>
<style>
body{font:16px system-ui;max-width:900px;margin:24px auto;padding:0 16px}
#now{font-size:96px;font-weight:700;margin:8px 0;line-height:1}
#now small{font-size:24px;font-weight:400;margin-left:12px}
#name{font-size:22px;margin:0;overflow-wrap:anywhere}
h2{font-size:14px;margin:18px 0 4px;color:#666;font-weight:600}
p{margin:6px 0}
button{font-size:16px;padding:8px 14px;margin:2px 0}
button.file{font-size:14px;padding:5px 10px}
button.file[aria-current=true]{background:#18a2a6;color:#111;border-color:#18a2a6}
#pos{width:100%}
.keys{color:#666;font-size:14px}
#msg{min-height:1.4em;margin:4px 0}
#msg.bad{color:#b00020}
</style>
<p id="name"></p><div id="now">A<small>Web</small></div>
<p><button id="play">Start / Pause (Enter)</button> <button id="toggle">A / B umschalten (Leertaste)</button> <button id="prev">vorige Datei (↑)</button> <button id="next">nächste Datei (↓)</button></p>
<input id="pos" type="range" min="0" max="1" step="0.001" value="0" aria-label="Stelle">
<p id="msg" role="status"></p>
<p id="folder" hidden><button id="folder-btn">Ordner mit den Hörproben wählen</button><input id="folder-input" type="file" webkitdirectory hidden>
<span id="folder-why">Aus einer geöffneten Datei darf die Seite ihre Nachbardateien nicht selbst lesen, deshalb dieser Schritt. Ohne ihn geht es mit ab-open.cmd im selben Ordner (Doppelklick).</span></p>
<p class="keys">A = Web-Version, B = nativer Kern. Beide Dateien laufen aus einer Uhr im Gleichschritt; Umschalten blendet an derselben Stelle in 50 ms über, die beiden Lautstärken ergeben zusammen immer 1. <span id="time"></span></p>
${list}
<script>
const $ = (id) => document.getElementById(id);
const pos = $('pos'), now = $('now'), msg = $('msg'), folder = $('folder'), input = $('folder-input');
const buttons = [...document.querySelectorAll('button.file')];
const names = buttons.map((el) => el.dataset.name);
const fileMode = location.protocol === 'file:';
const FADE = 0.05; // seconds for a full switch
let ctx, out;
try { ctx = new AudioContext(); out = ctx.createGain(); out.connect(ctx.destination); } catch (e) { msg.textContent = 'Web Audio ist in diesem Browser nicht verfügbar.'; msg.className = 'bad'; }

let index = 0, token = 0, bufs = null, dur = 0, loading = false, picked = null;
let side = 0;          // 0 = A, 1 = B: where the last switch goes
let want = false;      // the wish to be playing (it survives loading a file)
let playing = false, paused = 0; // paused: the position while not playing
let g = null, sources = [], t0 = 0, off0 = 0; // gains of A and B; the sources of the running play; context time and offset where it began
const say = (text, bad) => { msg.textContent = text; msg.className = bad ? 'bad' : ''; };
const show = () => { now.innerHTML = side ? 'B<small>Nativ</small>' : 'A<small>Web</small>'; };
// the one clock: the context's
const position = () => (playing ? Math.min(dur, off0 + Math.max(0, ctx.currentTime - t0)) : paused);

function stopSources() {
  for (const s of sources) { s.onended = null; try { s.stop(); } catch (e) {} s.disconnect(); }
  sources = [];
  g = null;
}
function halt() { if (playing) paused = position(); stopSources(); playing = false; }
// Both sources start at one context time and one offset; a little ahead, so that the time is not already past when they are set up.
function start(offset) {
  ctx.resume();
  stopSources();
  if (offset >= dur - 0.01) offset = 0;
  t0 = ctx.currentTime + 0.02; off0 = offset;
  g = { a: ctx.createGain(), b: ctx.createGain() };
  g.a.gain.value = 1 - side; g.b.gain.value = side;
  fade = { t: 0, from: side, to: side, secs: 0 };
  const mine = sources = ['a', 'b'].map((k) => {
    const s = ctx.createBufferSource();
    s.buffer = bufs[k];
    s.connect(g[k]).connect(out);
    s.start(t0, offset, dur - offset);
    return s;
  });
  mine[0].onended = () => { if (sources === mine) { stopSources(); playing = want = false; paused = dur; } };
  playing = true;
}
// B's share of the sound (A has the rest), as a plan in context time: from where it was at t, to 0/1 in 'secs'. Linear, so the two gains always
// add up to 1; a switch during a fade turns round from where the plan is at that moment, not from a reading of the gain.
let fade = { t: 0, from: 0, to: 0, secs: 0 };
const mixAt = (time) => (fade.secs > 0 ? fade.from + (fade.to - fade.from) * Math.min(1, Math.max(0, (time - fade.t) / fade.secs)) : fade.to);
// The new plan begins a little ahead (LEAD), where the sound has not yet been rendered, and the old ramp runs on until then; so there is no
// jump, whatever the clock says is "now" (the audio thread renders a few milliseconds ahead of currentTime).
const LEAD = 0.03;
function toggle() {
  side = 1 - side;
  show();
  if (!g) { fade = { t: 0, from: side, to: side, secs: 0 }; return; }
  const t = ctx.currentTime + LEAD, m = mixAt(t);
  fade = { t, from: m, to: side, secs: FADE * Math.abs(side - m) };
  for (const [k, from, to] of [['a', 1 - m, 1 - side], ['b', m, side]]) {
    const p = g[k].gain;
    p.cancelScheduledValues(t); p.linearRampToValueAtTime(from, t); p.linearRampToValueAtTime(to, t + fade.secs);
  }
}
function playPause() {
  want = !want;
  if (!bufs) return; // still loading: it starts when the pair is there
  if (want) start(paused); else halt();
}
function seek(t) {
  if (!bufs) return;
  t = Math.min(dur, Math.max(0, t));
  if (playing) start(t); else paused = t;
}

async function bytes(file) {
  if (picked) {
    const f = picked.get(file);
    if (!f) throw new Error(file + ': fehlt in dem gewählten Ordner');
    return f.arrayBuffer();
  }
  if (fileMode) throw new Error('Bitte zuerst den Ordner mit den Hörproben wählen.');
  const r = await fetch(file).catch(() => { throw new Error(file + ': lässt sich nicht laden'); });
  if (!r.ok) throw new Error(file + ': nicht gefunden (HTTP ' + r.status + ')');
  return r.arrayBuffer();
}
const decode = async (file) => {
  const raw = await bytes(file);
  return ctx.decodeAudioData(raw).catch(() => { throw new Error(file + ': lässt sich nicht dekodieren'); });
};
function select(i) {
  index = (i + names.length) % names.length;
  buttons.forEach((el, k) => el.setAttribute('aria-current', k === index));
  $('name').textContent = names[index];
  document.title = names[index] + ' · A/B';
  buttons[index].scrollIntoView({ block: 'nearest' });
}
// another pair: decoded when chosen; the side (A or B) stays, and it goes on playing (from the start) if it was
async function load(i) {
  const mine = ++token;
  select(i);
  halt();
  paused = 0; bufs = null; dur = 0; loading = true;
  say('lädt …');
  try {
    const [a, b] = await Promise.all([decode(names[index] + '-web.wav'), decode(names[index] + '-nativ.wav')]);
    if (mine !== token) return;
    bufs = { a, b }; dur = Math.min(a.duration, b.duration); loading = false;
    say('');
    if (want) start(0);
  } catch (e) {
    if (mine !== token) return;
    loading = false; want = false;
    say(e.message, true);
  }
}

buttons.forEach((el, k) => { el.onclick = () => load(k); });
$('play').onclick = playPause;
$('toggle').onclick = toggle;
$('prev').onclick = () => load(index - 1);
$('next').onclick = () => load(index + 1);
addEventListener('click', (e) => { ctx?.resume(); if (e.target.blur) e.target.blur(); }, true);
addEventListener('keydown', (e) => {
  ctx?.resume();
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'Enter') { e.preventDefault(); playPause(); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); load(index + 1); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); load(index - 1); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') e.preventDefault(); }); // a focused button must not click on the space bar's release
const clock = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
let dragging = false;
pos.oninput = () => { dragging = true; $('time').textContent = clock(pos.value * dur) + ' / ' + clock(dur); };
pos.onchange = () => { dragging = false; seek(pos.value * dur); };
setInterval(() => {
  if (dragging || !dur) return;
  pos.value = position() / dur;
  $('time').textContent = clock(position()) + ' / ' + clock(dur);
}, 100);

if (fileMode) {
  folder.hidden = false;
  $('folder-btn').onclick = () => input.click();
  input.onchange = () => { picked = new Map([...input.files].map((f) => [f.name, f])); load(index); };
}
show();
if (fileMode) select(0); else load(0);
// what ab-page-check.mjs looks at
window.__ab = { ctx, out, position, state: () => ({ playing, want, side, name: names[index], loading, ready: !!bufs, duration: dur }) };
</script>
`);

  // a double-click starts the page from this folder with the serve mode, so that it needs no step to choose the folder
  writeFileSync(join(folder, 'ab-open.cmd'), ['@echo off', 'rem Opens the A/B page of this folder in the browser (served on 127.0.0.1); Ctrl+C or closing the window stops it.',
    `node "${here}" --serve "%~dp0."`, 'if errorlevel 1 pause', ''].join('\r\n'));
  return { page, pairs: names.length };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav' };
// Serves the page and the WAV files that lie directly in the folder, GET only, on 127.0.0.1 at a free port; resolves to the address.
export function serveFolder(folder, { open = true } = {}) {
  const server = createServer((req, res) => {
    const fail = (code) => res.writeHead(code, { Allow: 'GET' }).end();
    if (req.method !== 'GET') return fail(405);
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html'; } catch { return fail(404); }
    const type = TYPES[extname(name).toLowerCase()];
    if (!type || name !== basename(name)) return fail(404); // no path, no other kind of file
    readFile(join(folder, name), (error, data) => {
      if (error) return fail(404);
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store' }).end(data);
    });
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    if (open) {
      const [cmd, ...args] = process.platform === 'win32' ? ['rundll32', 'url.dll,FileProtocolHandler', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => console.log(`could not open a browser; open ${url} yourself`)).unref();
    }
    done(url);
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === here) {
  const args = process.argv.slice(2), flag = (f) => args.includes(f);
  const folder = resolve(args.find((a) => !a.startsWith('--')) ?? join(repo, '.superpowers/audio-ab/compare'));
  const { page, pairs } = writeAbPage(folder);
  console.log(`${pairs} pairs -> ${page}`);
  if (flag('--serve')) console.log(`A/B page: ${await serveFolder(folder, { open: !flag('--no-open') })} (Ctrl+C stops)`);
}
