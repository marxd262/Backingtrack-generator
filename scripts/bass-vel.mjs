// Verteilung der Bass-Anschläge (0..127) in den Fällen von render-step (ART_CASES) und Anteil je Anschlagstufe von Bass-Packs (Format 2): liegen
// die Töne auf der Grenze zweier Stufen, wechselt der Klang zufällig zwischen zwei Aufnahmen (Growlybass, Urteil 2026-11-16).
// Aufruf: node scripts/bass-vel.mjs <pack.json> …   (z. B. C:\dev\samples-raw\built-packs\bass-growly.json)
import { ART_CASES } from './render-step.mjs';
import { buildEvents } from '../src/core/events.js';
import { STYLE_PRESETS, styleChordColor } from '../src/core/tags.js';
import { progressionFor } from '../src/core/progressions.js';
import { colorProgression } from '../src/core/harmony.js';
import { setAllVoices } from '../src/core/voices.js';
import { readFileSync } from 'node:fs';
const vels = [];
for (const [style, bpm, own = {}] of ART_CASES) {
  const p = STYLE_PRESETS.find((s) => s.id === style), key = { root: 'A', mode: 'minor' }, seed = 17;
  const track = { key, bpm, seed, variety: true, length: 16, tags: { ...structuredClone(p.tags), ...own.tags }, voices: { ...setAllVoices(null, 'sample'), ...own.voices },
    bars: colorProgression((own.chords?.map(([root, quality]) => ({ root, quality })) ?? progressionFor(key, seed)).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key), ...own.track };
  for (const e of buildEvents(track)) if (e.layer === 'bass' && e.type === 'note') vels.push({ style, v: Math.round(Math.min(1, Math.max(0, e.vel)) * 127), art: e.art });
}
for (const id of process.argv.slice(2)) {
  const zones = JSON.parse(readFileSync(id, 'utf8')).zones.filter((z) => !z.trigger && !z.art);
  const layers = [...new Set(zones.map((z) => `${z.velLo}-${z.velHi}`))];
  const count = Object.fromEntries(layers.map((l) => [l, 0]));
  for (const { v, art } of vels) if (art !== 'staccato') { const l = layers.find((x) => { const [lo, hi] = x.split('-').map(Number); return v >= lo && v <= hi; }); count[l]++; }
  console.log(id, JSON.stringify(count));
}
const st = vels.filter((x) => x.art === 'staccato').length;
console.log(`Bass-Töne ${vels.length}, davon staccato ${st}; Anschlag Median ${vels.map((x) => x.v).sort((a, b) => a - b)[vels.length >> 1]}`);
