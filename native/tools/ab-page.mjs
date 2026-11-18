// Writes index.html into a folder of A/B pairs (<name>-web.wav and <name>-nativ.wav, as sound-compare.mjs leaves
// them): one page to switch between the files and between A (web app) and B (native core) at the same position.
//   node native/tools/ab-page.mjs [folder]     default: .superpowers/audio-ab/compare
// Pairs whose name is in none of the case files (native/tools/sound-cases/*.json) are listed last, as older runs.
// sound-compare.mjs calls writeAbPage(folder) at the end of every run of cases.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Writes <folder>/index.html and returns its path and the number of pairs; throws when the folder holds no pair.
export function writeAbPage(folder) {
  const files = new Set(readdirSync(folder));
  const names = [...files].filter((f) => f.endsWith('-web.wav')).map((f) => f.slice(0, -'-web.wav'.length)).filter((n) => files.has(`${n}-nativ.wav`)).sort();
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
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><title>A/B: Web gegen nativ</title>
<style>
body{font:16px system-ui;max-width:900px;margin:24px auto;padding:0 16px}
#now{font-size:96px;font-weight:700;margin:8px 0;line-height:1}
#now small{font-size:24px;font-weight:400;margin-left:12px}
#name{font-size:22px;margin:0}
h2{font-size:14px;margin:18px 0 4px;color:#666;font-weight:600}
p{margin:6px 0}
button{font-size:16px;padding:8px 14px;margin:2px 0}
button.file{font-size:14px;padding:5px 10px}
button.file[aria-current=true]{background:#18a2a6;color:#111;border-color:#18a2a6}
input{width:100%}
.keys{color:#666;font-size:14px}
</style>
<p id="name"></p><div id="now">A<small>Web</small></div>
<p><button id="play">Start / Pause (Enter)</button> <button id="toggle">A / B umschalten (Leertaste)</button> <button id="prev">vorige Datei (↑)</button> <button id="next">nächste Datei (↓)</button></p>
<input id="pos" type="range" min="0" max="1" step="0.001" value="0" aria-label="Stelle">
<p class="keys">A = Web-Version, B = nativer Kern. Beide laufen gleichzeitig im Gleichschritt, eine ist stumm: Umschalten blendet an derselben Stelle in 60 ms über. <span id="time"></span></p>
${list}
<audio id="a" preload="auto"></audio><audio id="b" preload="auto"></audio>
<script>
const a = document.getElementById('a'), b = document.getElementById('b'), pos = document.getElementById('pos'), now = document.getElementById('now');
const buttons = [...document.querySelectorAll('button.file')];
let index = 0;
const seek = (t) => { a.currentTime = b.currentTime = t; };
// side: 0 = A, 1 = B (where the last switch goes); mix: where the sound is, 0 = A only .. 1 = B only.
// Linear, so the two volumes always add up to 1: A and B are nearly the same signal, so only then does their sum stay level.
// The silent one stays at -80 dB, never at 0: at 0 the browser moves it to a silent output of its own, its position then runs about
// 80 ms off, and coming back to the real output costs a hiccup at every switch.
const FADE_MS = 60, QUIET = 1e-4;
let side = 0, mix = 0, fade = null;
const setMix = (m) => { mix = m; const v = Math.min(1 - QUIET, Math.max(QUIET, m)); a.volume = 1 - v; b.volume = v; };
const show = () => { now.innerHTML = side ? 'B<small>Nativ</small>' : 'A<small>Web</small>'; };
// by the clock, so that a slow timer stretches no fade; a switch during a fade turns around from where the fade is
function fadeStep() {
  const k = fade.ms > 0 ? Math.min(1, (performance.now() - fade.start) / fade.ms) : 1;
  setMix(k < 1 ? fade.from + (fade.to - fade.from) * k : fade.to);
  if (k >= 1) { clearInterval(fade.timer); fade = null; }
}
const toggle = () => {
  side = 1 - side;
  (side ? b : a).playbackRate = 1; // the one to be heard plays at exactly 1
  if (fade) clearInterval(fade.timer);
  fade = { from: mix, to: side, start: performance.now(), ms: FADE_MS * Math.abs(side - mix) };
  fade.timer = setInterval(fadeStep, 4);
  fadeStep();
  show();
};
// The silent one follows the heard one: its playbackRate halves the gap at every look, a gap above a quarter of a second is jumped.
// Resampled while nudged, not time-stretched (that works in windows of tens of ms); the silent one's pitch is not heard.
a.preservesPitch = b.preservesPitch = false;
setInterval(() => {
  if (a.paused || fade) return;
  const lead = side ? b : a, follow = side ? a : b, gap = follow.currentTime - lead.currentTime;
  if (Math.abs(gap) > 0.25) { follow.currentTime = lead.currentTime; follow.playbackRate = 1; }
  else follow.playbackRate = Math.abs(gap) < 0.001 ? 1 : Math.min(1.05, Math.max(0.95, 1 - gap / 0.5));
}, 250);
setMix(0);
const start = () => { b.currentTime = a.currentTime; a.play(); b.play(); };
const playPause = () => { if (a.paused) start(); else { a.pause(); b.pause(); } };
// another file: the side chosen (A or B) stays, and it goes on playing if it was playing
function load(i) {
  const playing = !a.paused;
  index = (i + buttons.length) % buttons.length;
  const name = buttons[index].dataset.name;
  a.src = name + '-web.wav';
  b.src = name + '-nativ.wav';
  buttons.forEach((el, k) => el.setAttribute('aria-current', k === index));
  document.getElementById('name').textContent = name;
  document.title = name + ' · A/B';
  buttons[index].scrollIntoView({ block: 'nearest' });
  if (playing) a.addEventListener('canplay', start, { once: true });
}
buttons.forEach((el, k) => { el.onclick = () => { load(k); el.blur(); }; });
document.getElementById('play').onclick = playPause;
document.getElementById('toggle').onclick = toggle;
document.getElementById('prev').onclick = () => load(index - 1);
document.getElementById('next').onclick = () => load(index + 1);
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if (e.code === 'Enter') { e.preventDefault(); playPause(); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); load(index + 1); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); load(index - 1); }
});
const clock = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
a.ontimeupdate = () => { pos.value = a.currentTime / a.duration || 0; document.getElementById('time').textContent = clock(a.currentTime) + ' / ' + clock(a.duration || 0); };
pos.oninput = () => seek(pos.value * a.duration);
load(0);
</script>
`);
  return { page, pairs: names.length };
}

if (import.meta.main) {
  const { page, pairs } = writeAbPage(resolve(process.argv[2] ?? join(repo, '.superpowers/audio-ab/compare')));
  console.log(`${pairs} pairs -> ${page}`);
}
