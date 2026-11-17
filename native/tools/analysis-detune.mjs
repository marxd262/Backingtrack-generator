// Test tracks that are not tuned to 440 Hz: copies of generated tracks played a little faster or slower (as a tape
// would), with their labels moved along.
//   node native/tools/analysis-detune.mjs [from, default native/build/analysis-set] [to, default native/build/analysis-set-detuned]
// Needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const from = resolve(process.argv[2] ?? join(repo, 'native/build/analysis-set'));
const to = resolve(process.argv[3] ?? join(repo, 'native/build/analysis-set-detuned'));
mkdirSync(to, { recursive: true });
const CASES = [['rock-11', 35], ['funk-12', -40], ['blues-12', 50], ['dreamy-11', -25], ['country-11', 20], ['psych-12', -50]];
for (const [name, cents] of CASES) {
  const speed = 2 ** (cents / 1200);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(from, `${name}.wav`), '-af', `asetrate=${Math.round(44100 * speed)},aresample=44100`, join(to, `${name}${cents > 0 ? '+' : ''}${cents}.wav`)]);
  const label = JSON.parse(readFileSync(join(from, `${name}.json`), 'utf8'));
  const moved = { ...label, title: `${label.title} ${cents > 0 ? '+' : ''}${cents} cents`, group: 'verstimmt', bpm: +(label.bpm * speed).toFixed(2), chordsUntil: label.chordsUntil / speed,
    parts: label.parts.map((p) => ({ ...p, from: p.from / speed, to: p.to / speed })), chords: label.chords.map((c) => ({ ...c, t: +(c.t / speed).toFixed(4) })),
    ...(label.beats ? { beats: label.beats.map((t) => +(t / speed).toFixed(4)), downbeats: label.downbeats.map((t) => +(t / speed).toFixed(4)) } : {}) };
  writeFileSync(join(to, `${name}${cents > 0 ? '+' : ''}${cents}.json`), `${JSON.stringify(moved, null, 1)}\n`);
}
console.log(`${CASES.length} tracks -> ${to}`);
