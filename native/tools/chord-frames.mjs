// Prepares the labels of a jam-track video: finds every moment the display of the current chord changes and
// writes still images for someone to read off.
//   node native/tools/chord-frames.mjs <video> <output folder> <start seconds> <end seconds> [options]
// Options (pixels of the video, x,y,w,h):
//   --region x,y,w,h   where a change means "new chord" (default: the big CURRENT letter of Elevated Jam Tracks at 854x480)
//   --cell x,y,w,h     what is cut out for reading (default: CURRENT and NEXT of that layout)
//   --mode white|diff  white: compare the pure-white pixels (a white letter on a moving background);
//                      diff: compare the whole region (a highlight that moves, text that is replaced)
//   --threshold n      diff mode: mean grey difference (0..255) that counts as a change, default 5
// Output: segments.json [{ index, start, end }], sheet_NN.png (20 numbered cut-outs each, in the order of
// segments.json, row by row), frame_N.png (whole picture: chord chart, tempo, scale).
// Needs ffmpeg. The videos stay outside the repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args.splice(i, 2)[1]; };
const region = option('region', '55,285,160,120').split(',').map(Number);
const cell = option('cell', '40,245,280,165').split(',').map(Number);
const mode = option('mode', 'white');
const threshold = Number(option('threshold', '5'));
const [video, outArg, startArg, endArg] = args;
if (!video || !outArg || !startArg || !endArg) throw new Error('usage: chord-frames.mjs <video> <output folder> <start seconds> <end seconds> [--region x,y,w,h] [--cell x,y,w,h] [--mode white|diff] [--threshold n]');
const out = resolve(outArg), start = Number(startArg), end = Number(endArg);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'cells'), { recursive: true });
const ffmpeg = (a, options = {}) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { maxBuffer: 1 << 29, ...options });
const crop = ([x, y, w, h]) => `crop=${w}:${h}:${x}:${y}`;

// four pictures a second of the region, small and grey
const FPS = 4, W = 64, H = 48, WHITE = 215;
const raw = ffmpeg(['-ss', String(start), '-to', String(end), '-i', video, '-vf', `fps=${FPS},${crop(region)},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']);
const frames = Math.floor(raw.length / (W * H));
const picture = (f) => (mode === 'white' ? raw.subarray(f * W * H, (f + 1) * W * H).map((v) => (v > WHITE ? 1 : 0)) : raw.subarray(f * W * H, (f + 1) * W * H));
const differs = mode === 'white'
  ? (a, b) => { let diff = 0, white = 0; for (let i = 0; i < a.length; i++) { diff += a[i] ^ b[i]; white += a[i] | b[i]; } return white > 0 && diff / white > 0.25; }
  : (a, b) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]); return sum / a.length > threshold; };
// a new segment starts where the picture differs from the current one and then holds for half a second
const segments = [];
let current = picture(0), from = 0;
for (let f = 1; f + 2 < frames; f++) {
  const p = picture(f);
  if (!differs(current, p) || differs(p, picture(f + 1)) || differs(p, picture(f + 2))) continue;
  segments.push({ start: from / FPS, end: f / FPS });
  current = p;
  from = f;
}
segments.push({ start: from / FPS, end: frames / FPS });
const list = segments.map((s, index) => ({ index: index + 1, start: +(start + s.start).toFixed(2), end: +(start + s.end).toFixed(2) }));
writeFileSync(join(out, 'segments.json'), `${JSON.stringify(list, null, 1)}\n`);

// one cut-out per segment from its middle, numbered, twenty to a sheet (cut-outs wider than 280 are scaled down)
const font = process.platform === 'win32' ? "fontfile='C\\:/Windows/Fonts/arial.ttf':" : '';
const scale = cell[2] > 280 ? `,scale=280:-2` : '';
for (const s of list) {
  const at = Math.min(s.end - 0.2, (s.start + s.end) / 2);
  ffmpeg(['-ss', String(at), '-i', video, '-frames:v', '1', '-vf',
    `${crop(cell)}${scale},drawtext=${font}text='${s.index}':x=4:y=2:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.7`,
    join(out, 'cells', `cell_${String(s.index).padStart(4, '0')}.png`)]);
}
ffmpeg(['-start_number', '1', '-i', join(out, 'cells', 'cell_%04d.png'), '-vf', 'tile=5x4', join(out, 'sheet_%02d.png')]);
rmSync(join(out, 'cells'), { recursive: true });
[start + 8, (start + end) / 2, end - 8].forEach((at, i) => ffmpeg(['-ss', String(at), '-i', video, '-frames:v', '1', join(out, `frame_${i + 1}.png`)]));
console.log(`${list.length} segments, ${Math.ceil(list.length / 20)} sheets -> ${out}`);
