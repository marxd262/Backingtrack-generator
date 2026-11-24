// A generator song as an own song for the checks that load one into the app (track-page-check.mjs, and track-check.mjs and position-check.mjs
// without a file): the funk test track at 100 bpm with chords and pad on, a progression of sevenths, a half-diminished chord and the major
// dominant, rendered by btg_render (after native/build.ps1).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Writes the song of `bars` bars (2.4 s each) to <folder>/song.wav and returns that path; throws when btg_render fails. */
export function renderSong(folder, bars = 16) {
  const { form, ...base } = JSON.parse(readFileSync(join(repo, 'native/core/tests/track-funk.json'), 'utf8'));
  const song = { ...base, key: { root: 'A', mode: 'minor' }, length: bars, layers: { ...base.layers, chords: true, pad: true },
    bars: [['A', 'min7'], ['D', 'min7'], ['G', 'dom7'], ['C', 'maj7'], ['F', 'maj7'], ['B', 'm7b5'], ['E', 'dom7'], ['A', 'min']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })) };
  writeFileSync(join(folder, 'song.json'), JSON.stringify(song));
  const wav = join(folder, 'song.wav');
  const rendered = spawnSync(join(repo, 'native/build/core/Release/btg_render.exe'), [join(folder, 'song.json'), join(repo, 'src/assets/samples'), wav], { encoding: 'utf8' });
  if (rendered.status !== 0) throw new Error(`btg_render failed: ${rendered.stdout}${rendered.stderr}${rendered.error ?? ''}`);
  return wav;
}
