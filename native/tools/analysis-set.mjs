// Labelled test tracks for the analysis from the web generator: full band, known chords, key and tempo.
//   node native/tools/analysis-set.mjs [output folder, default native/build/analysis-set]
//   node native/tools/analysis-set.mjs --rich [output folder, default native/build/analysis-set-2]
//   node native/tools/analysis-set.mjs --tempo [output folder, default native/build/analysis-set-tempo-labeled]
// Without --rich: 18 tracks in 4/4 with plain triads. With --rich: the other chord kinds of the app (sevenths, sus,
// power chords, sixths and ninths), the other meters (3/4, 6/8, 12/8, 5/4) and tempi from 60 to 180.
// With --tempo: 8 tracks in 4/4 between 60 and 84 bpm whose tempo moves: slowly faster, slowly slower, one hard
// change, and wavering by up to 3 % as played music does. The generator only knows a steady tempo; the curve is laid
// over it when rendering (web-render.mjs), and the labels follow the same curve.
// Writes <name>.wav and <name>.json (label format as for the real tracks, and on top the generator's own beat and
// bar times: beats, downbeats; with --tempo also tempo, the bpm at every bar). Score them with analysis-score.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderWeb, wavBytes } from './web-render.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const rich = args.includes('--rich') ? args.splice(args.indexOf('--rich'), 1).length > 0 : false;
const moving = args.includes('--tempo') ? args.splice(args.indexOf('--tempo'), 1).length > 0 : false;
const out = resolve(args[0] ?? join(repo, moving ? 'native/build/analysis-set-tempo-labeled' : rich ? 'native/build/analysis-set-2' : 'native/build/analysis-set'));
mkdirSync(out, { recursive: true });
const load = (file) => import(pathToFileURL(join(repo, 'src', file)).href);
const { STYLE_PRESETS, chordTimeline, chordName, validateTrack } = await load('index.js');
const { progressionFor } = await load('core/progressions.js');

const KEYS = [
  { root: 'A', mode: 'minor' }, { root: 'C', mode: 'major' }, { root: 'D', mode: 'dorian' }, { root: 'E', mode: 'minor' }, { root: 'G', mode: 'major' },
  { root: 'G', mode: 'dorian' }, { root: 'F#', mode: 'minor' }, { root: 'Bb', mode: 'major' }, { root: 'B', mode: 'minor' },
];
const RATE = 44100;
const tracks = [], names = [], curves = []; // curves: with --tempo, the bpm at a beat of the track
if (moving) {
  const ramp = (from, to) => (beat, beats) => from + (to - from) * beat / beats;
  const step = (from, to) => (beat, beats) => (beat < beats / 2 ? from : to);
  const live = (bpm) => (beat) => bpm * (1 + 0.02 * Math.sin(2 * Math.PI * beat / 29) + 0.01 * Math.sin(2 * Math.PI * beat / 7.3 + 1));
  const CASES = [['faster-70-84', ramp(70, 84)], ['faster-60-66', ramp(60, 66)], ['slower-80-66', ramp(80, 66)], ['slower-72-64', ramp(72, 64)],
    ['step-64-80', step(64, 80)], ['step-80-62', step(80, 62)], ['live-76', live(76)], ['live-60', live(60)]];
  CASES.forEach(([name, curve], i) => {
    const style = STYLE_PRESETS[i % STYLE_PRESETS.length], key = KEYS[(i * 2 + 3) % KEYS.length], seed = 41 + i;
    tracks.push({ key, bpm: Math.round(curve(0, 96)), seed, length: 24, variety: true, tags: style.tags, voices: style.voices, bars: progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })) });
    names.push(`${name}-${style.id}`);
    curves.push(curve);
  });
} else if (!rich) {
  STYLE_PRESETS.forEach((style, s) => {
    for (const seed of [11, 12]) {
      const key = KEYS[(s * 2 + seed) % KEYS.length];
      tracks.push({ key, bpm: style.bpm, seed, length: 16, variety: true, tags: style.tags, voices: style.voices, bars: progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })) });
      names.push(`${style.id}-${seed}`);
    }
  });
} else {
  // Another kind for every chord, by its triad and its place in the progression (twice through, so every chord
  // comes in two kinds). The app only takes kinds that fit the degree of the key, so the triad decides the choice.
  const FLAVOURS = {
    sevenths: { maj: ['maj7', 'dom7'], min: ['min7', 'min7'], dim: ['m7b5', 'dim'] },
    open: { maj: ['sus4', 'power', 'maj', 'sus2'], min: ['power', 'sus4', 'min', 'sus2'], dim: ['dim', 'dim'] },
    colours: { maj: ['maj6', 'add9', 'dom9'], min: ['min6', 'min9', 'min7'], dim: ['dim7', 'dim'] },
  };
  const add = (name, track) => {
    const problems = validateTrack(track).filter?.((p) => p.level !== 'warning') ?? [];
    if (problems.length) { console.log(`skipped ${name}: ${problems.map((p) => p.code ?? p).join(', ')}`); return; }
    tracks.push(track);
    names.push(name);
  };
  STYLE_PRESETS.forEach((style, s) => {
    const seed = 21 + s, key = KEYS[(s * 2 + 1) % KEYS.length];
    const flavour = Object.keys(FLAVOURS)[s % 3];
    const twice = [...progressionFor(key, seed), ...progressionFor(key, seed)];
    const bars = twice.map((chord, i) => ({ chord: { ...chord, quality: FLAVOURS[flavour][chord.quality]?.[(i + Math.floor(i / 4)) % FLAVOURS[flavour][chord.quality].length] ?? chord.quality }, beats: 4 }));
    add(`${style.id}-${flavour}`, { key, bpm: style.bpm, seed, length: 24, variety: true, tags: style.tags, voices: style.voices, bars });
    // the same band in another meter and at another tempo, plain triads
    const meter = [[3, 4], [6, 8], [12, 8], [5, 4]][s % 4], beats = { '3/4': 3, '6/8': 2, '12/8': 4, '5/4': 5 }[meter.join('/')];
    const bpm = [60, 72, 90, 132, 160, 180][s % 6];
    add(`${style.id}-${meter.join('')}-${bpm}`, { key: KEYS[(s * 2 + 4) % KEYS.length], meter, bpm, seed: seed + 20, length: 16, variety: true, tags: style.tags, voices: style.voices,
      bars: progressionFor(KEYS[(s * 2 + 4) % KEYS.length], seed + 20).map((chord) => ({ chord, beats })) });
  });
}
// Where a time of the steady track lands under its tempo curve: the time of every sixteenth of a beat, summed up.
const STEP = 1 / 16;
const warps = tracks.map((track, i) => {
  if (!curves[i]) return null;
  const beats = chordTimeline(track).reduce((sum, bar) => sum + bar.durationSec, 0) * track.bpm / 60;
  const points = [[0, 0]];
  for (let beat = 0; beat < beats + 4; beat += STEP) points.push([(beat + STEP) * 60 / track.bpm, points.at(-1)[1] + STEP * 60 / curves[i](Math.min(beats, beat + STEP / 2), beats)]);
  return points;
});
const moved = (points, t) => {
  if (!points) return t;
  const i = Math.max(1, Math.min(points.length - 1, points.findIndex((p) => p[0] >= t)));
  return +(points[i - 1][1] + (t - points[i - 1][0]) * (points[i][1] - points[i - 1][1]) / (points[i][0] - points[i - 1][0])).toFixed(4);
};
const rendered = await renderWeb(repo, tracks, RATE, warps);
tracks.forEach((track, i) => {
  const bars = chordTimeline(track), at = (t) => moved(warps[i], t);
  const chords = [];
  for (const bar of bars) if (chords.at(-1)?.chord !== chordName(bar.chord)) chords.push({ t: at(bar.time), chord: chordName(bar.chord) });
  const whole = bars.at(-1).time + bars.at(-1).durationSec, end = at(whole);
  // the generator's own beats (in 6/8 and 12/8 the dotted ones, as the tempo counts) and bar starts
  const beats = Array.from({ length: Math.round(whole * track.bpm / 60) }, (_, b) => at(+(b * 60 / track.bpm).toFixed(6)));
  const label = { title: `generated ${names[i]}`, ...(moving ? { group: 'tempo' } : rich ? { group: 'generiert-2' } : {}), key: track.key, bpm: curves[i] ? null : track.bpm,
    ...(curves[i] ? { tempo: bars.map((bar) => ({ t: at(bar.time), bpm: +curves[i](bar.time * track.bpm / 60, beats.length).toFixed(2) })) } : {}),
    meter: track.meter ?? [4, 4], parts: [{ kind: 'jam', from: 0, to: end }], chordsUntil: end, chords, beats, downbeats: bars.map((bar) => at(bar.time)) };
  writeFileSync(join(out, `${names[i]}.wav`), wavBytes(rendered[i], RATE));
  writeFileSync(join(out, `${names[i]}.json`), `${JSON.stringify(label, null, 1)}\n`);
});
console.log(`${tracks.length} tracks -> ${out}`);
