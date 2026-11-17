// Shows how steady beat lists are and where two of them differ: for looking at one track.
//   node native/tools/beats-inspect.mjs <beats.json> [more ...] [--window 30] [--bpm 76]
// A file is the output of btg_analyze, a file of the beats cache or of the Python reference ({ beats: [seconds] }).
// Per file: the beat distances (median, spread, how many are far from the median) and per window of the track the
// local tempo over 8 beats (lowest to highest) and the beats per window. With two or more files: per window, how
// many beats of the first file have none of the other within 20 ms, and how many the other has on top.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? +args.splice(args.indexOf(name), 2)[1] : fallback);
const windowSec = option('--window', 30), labelBpm = option('--bpm', 0);
const lists = args.map((file) => ({ name: basename(file).slice(0, 28), beats: JSON.parse(readFileSync(file, 'utf8')).beats }));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// local tempo at beat i: over the 8 beat distances around it
export const localTempo = (beats, i) => 60 * 8 / (beats[Math.min(beats.length - 1, i + 4)] - beats[Math.max(0, i - 4)]) * ((Math.min(beats.length - 1, i + 4) - Math.max(0, i - 4)) / 8);

const end = Math.max(...lists.map((l) => l.beats.at(-1)));
for (const { name, beats } of lists) {
  const gaps = beats.slice(1).map((t, i) => t - beats[i]), usual = median(gaps);
  const count = (test) => gaps.filter(test).length;
  console.log(`${name}: ${beats.length} beats, ${beats[0].toFixed(2)} to ${beats.at(-1).toFixed(2)} s, usual distance ${usual.toFixed(4)} s (${(60 / usual).toFixed(1)} bpm), `
    + `within 3 % ${count((g) => Math.abs(g / usual - 1) <= 0.03)}, 3 to 10 % off ${count((g) => Math.abs(g / usual - 1) > 0.03 && Math.abs(g / usual - 1) <= 0.1)}, `
    + `about half ${count((g) => Math.abs(g / usual - 0.5) < 0.1)}, about double ${count((g) => Math.abs(g / usual - 2) < 0.2)}, other ${count((g) => Math.abs(g / usual - 1) > 0.1 && Math.abs(g / usual - 0.5) >= 0.1 && Math.abs(g / usual - 2) >= 0.2)}`);
}
console.log(`\n${'window'.padEnd(11)}${lists.map((l) => l.name.padEnd(30)).join('')}${lists.length > 1 ? 'missing / extra against the first' : ''}`);
for (let from = 0; from < end; from += windowSec) {
  const inside = (beats) => beats.filter((t) => t >= from && t < from + windowSec);
  const cells = lists.map(({ beats }) => {
    const tempi = beats.map((t, i) => (t >= from && t < from + windowSec && i >= 4 && i + 4 < beats.length ? localTempo(beats, i) : null)).filter((v) => v !== null);
    if (!tempi.length) return '–'.padEnd(30);
    const off = labelBpm ? `, ${tempi.filter((v) => Math.abs(v / labelBpm - 1) > 0.03).length} off` : '';
    return `${inside(beats).length} b, ${Math.min(...tempi).toFixed(1)}–${Math.max(...tempi).toFixed(1)} bpm${off}`.padEnd(30);
  });
  const first = inside(lists[0].beats);
  const against = lists.slice(1).map(({ beats }) => `${first.filter((t) => !beats.some((g) => Math.abs(g - t) <= 0.0201)).length} / ${inside(beats).filter((t) => !lists[0].beats.some((g) => Math.abs(g - t) <= 0.0201)).length}`);
  console.log(`${`${from}–${from + windowSec}`.padEnd(11)}${cells.join('')}${against.join('   ')}`);
}
