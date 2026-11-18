// Writes index.html into a folder of A/B pairs (<name>-web.wav and <name>-nativ.wav, as sound-compare.mjs leaves
// them): one page to switch between the files and between A (web app) and B (native core) at the same position.
//   node native/tools/ab-page.mjs [folder]     default: .superpowers/audio-ab/compare
// Pairs whose name is in none of the case files (native/tools/sound-cases/*.json) are listed last, as older runs.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folder = resolve(process.argv[2] ?? join(repo, '.superpowers/audio-ab/compare'));
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

writeFileSync(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>A/B: Web gegen nativ</title>
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
<p class="keys">A = Web-Version, B = nativer Kern. Beide laufen gleichzeitig, eine ist stumm: Umschalten wechselt an derselben Stelle. <span id="time"></span></p>
${list}
<audio id="a" preload="auto"></audio><audio id="b" preload="auto" muted></audio>
<script>
const a = document.getElementById('a'), b = document.getElementById('b'), pos = document.getElementById('pos'), now = document.getElementById('now');
const buttons = [...document.querySelectorAll('button.file')];
let index = 0;
const seek = (t) => { a.currentTime = b.currentTime = t; };
const show = () => { now.innerHTML = a.muted ? 'B<small>Nativ</small>' : 'A<small>Web</small>'; };
// no seek here: both run side by side from the same start, so the switch is immediate and without a gap
const toggle = () => { a.muted = !a.muted; b.muted = !a.muted; show(); };
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
console.log(`${names.length} pairs -> ${join(folder, 'index.html')}`);
