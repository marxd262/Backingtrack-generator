// Klingt das Sample auf der Taste, die das Mapping nennt? Grundton per Autokorrelation (0,3–0,6 s nach dem Anschlag) gegen pitch_keycenter.
// Aufruf: node scripts/pitch-check.mjs <library-ordner> <sfz relativ> [muster im Pfad]
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [lib, sfzRel, pattern = ''] = process.argv.slice(2);
const m = await import(pathToFileURL(resolve('scripts/import-sfz.mjs')).href);
const sfz = resolve(lib, sfzRel);
const { regions } = m.defaultRegions(m.parseSfz(m.expandSfz(sfz)), dirname(sfz));
const seen = new Set();
for (const r of regions.filter((x) => !x.silent && x.trigger === 'attack' && x.path.includes(pattern))) {
  if (seen.has(r.path) || seen.size >= 8) continue;
  seen.add(r.path);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', r.path, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).subarray(13230, 26460);
  let best = 0, lag = 0;
  for (let l = 40; l < 2400; l++) { let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; if (s > best) { best = s; lag = l; } }
  // kleinste Periode mit fast gleicher Korrelation (Oktavfehler der Autokorrelation vermeiden)
  for (let d = 2; d <= 4; d++) { const l = Math.round(lag / d); let s = 0; for (let i = 0; i + l < x.length; i++) s += x[i] * x[i + l]; if (s > 0.9 * best) lag = l; }
  const hz = 44100 / lag, midi = 69 + 12 * Math.log2(hz / 440);
  console.log(`${r.path.split(/[\\/]/).slice(-2).join('/')}: Taste ${r.lokey}-${r.hikey}, Grundton laut Mapping ${r.center}, gemessen ${hz.toFixed(1)} Hz = MIDI ${midi.toFixed(1)} (${(midi - r.center).toFixed(1)} Halbtöne)`);
}
