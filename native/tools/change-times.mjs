// Where in the audio does the bass move to the next root, measured without the beats: for the diagnosis of chord
// changes that are shown late.
//   node native/tools/change-times.mjs <audio> <label.json> <analysis.json> [--list]
// For every labelled change of root: the strength of the old and of the new root in the bass (two octaves from C2,
// 0.4 s windows every 50 ms) and the moment that splits "old" from "new" best within 1.2 s around the label. Printed:
// that moment against the label, against the nearest found beat (in beats; -0.5 = an eighth note before the beat)
// and against the found change to that root. Needs ffmpeg. The label only says which roots; its time sets the window.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const list = args.includes('--list') ? args.splice(args.indexOf('--list'), 1).length > 0 : false;
const [audio, labelFile, foundFile] = args;
const RATE = 11025, WIN = 4410, HOP = 551;
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', audio, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
const x = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
const label = JSON.parse(readFileSync(labelFile, 'utf8')), found = JSON.parse(readFileSync(foundFile, 'utf8'));
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const root = (name) => (PC[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;
const hann = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN));
// strength of a pitch class in the bass in the window centred on t
function strength(pc, t) {
  const start = Math.round(t * RATE) - WIN / 2;
  if (start < 0 || start + WIN > x.length) return 0;
  let sum = 0;
  for (let midi = 36; midi < 60; midi++) {
    if (midi % 12 !== pc) continue;
    const w = 2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) / RATE;
    let re = 0, im = 0;
    for (let i = 0; i < WIN; i++) { const v = x[start + i] * hann[i]; re += v * Math.cos(w * i); im += v * Math.sin(w * i); }
    sum += Math.hypot(re, im);
  }
  return sum;
}
const median = (v) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN);
const rows = [];
for (let i = 1; i < label.chords.length; i++) {
  const now = label.chords[i], before = label.chords[i - 1];
  if (!now.chord || !before.chord || root(now.chord) === root(before.chord)) continue;
  const diff = [];
  for (let t = now.t - 1.2; t <= now.t + 1.2001; t += HOP / RATE) {
    const a = strength(root(before.chord), t), b = strength(root(now.chord), t);
    diff.push({ t, d: (b - a) / (a + b + 1e-9) });
  }
  // the step from "old" to "new" that fits best
  let best = { score: -Infinity }, left = 0;
  const total = diff.reduce((s, p) => s + p.d, 0);
  for (let k = 1; k < diff.length; k++) {
    left += diff[k - 1].d;
    const score = (total - left) - left;
    if (score > best.score) best = { score, t: (diff[k - 1].t + diff[k].t) / 2 };
  }
  if (best.score / diff.length < 0.25) continue; // the bass does not show this change clearly
  const beat = found.beats.reduce((n, t, b) => (Math.abs(t - best.t) < Math.abs(found.beats[n] - best.t) ? b : n), 0);
  const period = (found.beats[Math.min(found.beats.length - 1, beat + 1)] - found.beats[Math.max(0, beat - 1)]) / 2;
  let change = null;
  for (let k = 1; k < found.chords.length; k++) {
    const f = found.chords[k];
    if (f.root === root(now.chord) && f.root !== found.chords[k - 1].root && Math.abs(f.t - best.t) <= 2 && (change === null || Math.abs(f.t - best.t) < Math.abs(change - best.t))) change = f.t;
  }
  rows.push({ label: now.t, chord: now.chord, heard: best.t, toLabel: best.t - now.t, inBeats: (best.t - found.beats[beat]) / period, shown: change === null ? NaN : change - best.t });
}
const ms = (v) => `${(1000 * v).toFixed(0)} ms`;
const share = (test) => `${(100 * rows.filter(test).length / rows.length).toFixed(0)} %`;
console.log(`${rows.length} changes of root clear in the bass | heard minus label: median ${ms(median(rows.map((r) => r.toLabel)))} | against the nearest found beat: on it (within a quarter beat) ${share((r) => Math.abs(r.inBeats) <= 0.25)}, before it ${share((r) => r.inBeats < -0.25)}, after it ${share((r) => r.inBeats > 0.25)}`
  + ` | found change minus heard: median ${ms(median(rows.filter((r) => Number.isFinite(r.shown)).map((r) => r.shown)))}, more than 0.3 s late ${share((r) => r.shown > 0.3)}, more than 0.3 s early ${share((r) => r.shown < -0.3)}, none found ${share((r) => !Number.isFinite(r.shown))}`);
if (list) for (const r of rows) console.log(`  ${r.label.toFixed(2).padStart(7)} ${r.chord.padEnd(7)} heard ${r.heard.toFixed(2).padStart(7)}  to label ${ms(r.toLabel).padStart(8)}  in beats ${r.inBeats.toFixed(2).padStart(5)}  found minus heard ${Number.isFinite(r.shown) ? ms(r.shown) : 'none'}`);
