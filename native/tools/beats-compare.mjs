// Compares the beats the C++ port of the beat model finds with those of the Python reference.
//   node native/tools/beats-compare.mjs <folder with tracks> <folder with <name>.beats.json from the reference>
// Prints per track how many reference beats and bar starts have a C++ one within 20 ms (one model frame).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const analyze = ['native/build/core/Release/btg_analyze.exe', 'native/build/core/btg_analyze'].map((p) => join(repo, p)).find(existsSync);
const [folder, reference] = process.argv.slice(2);
const work = join(repo, 'native/build/analysis');
mkdirSync(work, { recursive: true });
const share = (want, got) => want.filter((t) => got.some((g) => Math.abs(g - t) <= 0.0201)).length / want.length;
let worst = 1;
for (const file of readdirSync(folder).filter((f) => /\.mp3$/i.test(f))) {
  const ref = join(reference, file.replace(/\.mp3$/i, '.beats.json'));
  if (!existsSync(ref)) continue;
  const label = join(folder, file.replace(/\.mp3$/i, '.json')); // tracks held out for the final check are not measured
  if (existsSync(label) && JSON.parse(readFileSync(label, 'utf8')).heldOut) continue;
  const out = join(work, 'compare.json');
  const began = Date.now();
  execFileSync(analyze, [join(folder, file), out], { stdio: ['ignore', 'pipe', 'pipe'] });
  const found = JSON.parse(readFileSync(out, 'utf8')), want = JSON.parse(readFileSync(ref, 'utf8'));
  const beats = share(want.beats, found.beats), extra = 1 - share(found.beats, want.beats);
  worst = Math.min(worst, beats, 1 - extra);
  console.log(`${file.slice(0, 36).padEnd(36)} beats ${want.beats.length} / ${found.beats.length}, matched ${(100 * beats).toFixed(1)} %, extra ${(100 * extra).toFixed(1)} %, ${Date.now() - began} ms`);
}
console.log(`worst: ${(100 * worst).toFixed(1)} %`);
