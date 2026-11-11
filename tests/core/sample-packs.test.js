// Sample-Packs (src/assets/samples): Dateien, Zonen, Sample-Verweise, Schleifen, Tastenabdeckung, Größe und Lizenzvermerk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { PACKS as SCRIPT_PACKS } from '../../scripts/extract-samples.mjs';

const DIR = new URL('../../src/assets/samples/', import.meta.url);
// Pack-ID -> [Instrument, GM-Programm, niedrigste und höchste Taste, die abgedeckt sein muss, Bank (Standard 0)]
const PACKS = {
  'bass-finger': ['bass', 33, 28, 52],
  'bass-pick': ['bass', 34, 28, 52],
  'chords-guitar': ['chords', 27, 24, 100],
  'chords-epiano': ['chords', 4, 24, 100],
  'pad-strings': ['pad', 48, 24, 100],
  'pad-warm': ['pad', 89, 24, 100],
  'bass-upright': ['bass', 32, 28, 52],
  'chords-organ': ['chords', 16, 24, 100],
  'chords-muted': ['chords', 28, 40, 90],
  'chords-jazz': ['chords', 26, 40, 90],
  'chords-funk': ['chords', 28, 40, 90, 8],
  'chords-steel': ['chords', 25, 40, 90],
  'chords-nylon': ['chords', 24, 40, 90],
  'chords-twelve': ['chords', 25, 40, 90, 8],
  'lead-flute': ['lead', 73, 60, 90],
  'lead-sax': ['lead', 65, 55, 85],
  'lead-synth': ['lead', 81, 55, 90],
};
// Schlagzeug- und Percussion-Packs: GM-Programm in Bank 128 und die Tasten, für die je eine Zone da sein muss
const DRUM_KEYS = [35, 36, 37, 38, 41, 42, 43, 44, 46, 47, 50];
const DRUMS = {
  'drums-standard': [0, DRUM_KEYS], 'drums-brushes': [40, DRUM_KEYS], 'drums-jazz': [32, DRUM_KEYS], 'drums-electronic': [24, DRUM_KEYS], 'drums-808': [25, DRUM_KEYS],
  'percussion-studio': [0, [54, 56, 60, 61, 63, 64, 75, 82]],
};
const ALL = [...Object.keys(PACKS), ...Object.keys(DRUMS)];
const NEW = ALL.filter((id) => !['bass-finger', 'bass-pick', 'chords-guitar', 'chords-epiano', 'pad-strings', 'pad-warm'].includes(id));
const load = (id) => ({ meta: JSON.parse(readFileSync(new URL(`${id}.json`, DIR), 'utf8')), size: statSync(new URL(`${id}.pcm`, DIR)).size });

test('PACKS im Skript und die erwarteten Packs sind dieselben', () => {
  assert.deepEqual(Object.keys(SCRIPT_PACKS).sort(), ALL.slice().sort());
  for (const [id, [, gm, , , bank = 0]] of Object.entries(PACKS)) assert.equal(SCRIPT_PACKS[id].bank, bank, id), assert.equal(SCRIPT_PACKS[id].program, gm, id);
  for (const [id, [gm, keys]] of Object.entries(DRUMS)) assert.deepEqual([SCRIPT_PACKS[id].bank, SCRIPT_PACKS[id].program, SCRIPT_PACKS[id].keys], [128, gm, keys], id);
});

test('jedes Pack hat .json und .pcm, die ID stimmt, Quelle und GM-Programm sind angegeben', () => {
  const gms = { ...Object.fromEntries(Object.entries(PACKS).map(([id, v]) => [id, v[1]])), ...Object.fromEntries(Object.entries(DRUMS).map(([id, v]) => [id, v[0]])) };
  for (const id of ALL) {
    const gm = gms[id];
    assert.ok(existsSync(new URL(`${id}.json`, DIR)) && existsSync(new URL(`${id}.pcm`, DIR)), id);
    const { meta } = load(id);
    assert.equal(meta.id, id);
    assert.equal(meta.source, 'MuseScore_General');
    assert.equal(meta.gm, gm, `${id}: GM-Programm`);
  }
});

test('Samples: Offsets und Längen liegen in der .pcm, Raten sind brauchbar, Schleifenpunkte gültig', () => {
  for (const id of ALL) {
    const { meta, size } = load(id);
    assert.ok(meta.samples.length > 0, id);
    let end = 0;
    meta.samples.forEach((s, i) => {
      const label = `${id} Sample ${i}`;
      assert.ok(Number.isInteger(s.offset) && Number.isInteger(s.frames) && s.frames > 0, label);
      assert.ok(s.offset >= end, `${label}: überlappt das vorige`);
      end = s.offset + s.frames * 2;
      assert.ok(end <= size, `${label}: über das Ende der .pcm`);
      assert.ok(s.rate >= 8000 && s.rate <= 96000, `${label}: Rate ${s.rate}`);
      assert.ok(Number.isInteger(s.loopStart) && Number.isInteger(s.loopEnd), label);
      if (s.loopEnd > 0) assert.ok(s.loopStart >= 0 && s.loopStart < s.loopEnd && s.loopEnd <= s.frames, `${label}: Schleife ${s.loopStart}..${s.loopEnd} von ${s.frames}`);
    });
    assert.equal(end, size, `${id}: .pcm hat überzählige Bytes`); // der Lader verlangt nur end <= size; gebaut wird exakt
    assert.equal(size % 2, 0, id);
  }
});

test('Zonen: gültige Bereiche, Verweise auf vorhandene Samples, endliche Zeiten und Pegel, Schleife nur mit Schleifenpunkten', () => {
  for (const id of ALL) {
    const { meta } = load(id);
    assert.ok(meta.zones.length > 0, id);
    for (const z of meta.zones) {
      const label = `${id} Zone ${z.keyLo}-${z.keyHi}/${z.velLo}-${z.velHi}`;
      assert.ok(0 <= z.keyLo && z.keyLo <= z.keyHi && z.keyHi <= 127, `${label}: Tasten`);
      assert.ok(0 <= z.velLo && z.velLo <= z.velHi && z.velHi <= 127, `${label}: Anschlag`);
      assert.ok(Number.isInteger(z.sample) && z.sample >= 0 && z.sample < meta.samples.length, `${label}: Sample ${z.sample}`);
      for (const key of ['rootKey', 'tuneCents', 'attenuationDb', 'attack', 'hold', 'decay', 'release', 'sustainDb']) assert.ok(Number.isFinite(z[key]), `${label}: ${key}`);
      for (const key of ['attack', 'hold', 'decay', 'release']) assert.ok(z[key] >= 0 && z[key] < 60, `${label}: ${key} ${z[key]}`);
      assert.ok(z.rootKey >= 0 && z.rootKey <= 127, `${label}: Grundton`);
      assert.equal(typeof z.loop, 'boolean');
      if (z.loop) assert.ok(meta.samples[z.sample].loopEnd > 0, `${label}: Schleife ohne Schleifenpunkte`);
    }
  }
});

test('Abdeckung: jede geforderte Taste hat eine Zone (je Anschlagsebene)', () => {
  for (const [id, [, , lo, hi]] of Object.entries(PACKS)) {
    const { meta } = load(id);
    for (let key = lo; key <= hi; key++) {
      for (const vel of [1, 64, 127]) {
        assert.ok(meta.zones.some((z) => z.keyLo <= key && key <= z.keyHi && z.velLo <= vel && vel <= z.velHi), `${id}: Taste ${key}, Anschlag ${vel}`);
      }
    }
  }
});

test('Schlagzeug: jede geforderte Taste hat eine Zone, und es bleibt nichts Unbenutztes im Pack', () => {
  for (const [id, [, keys]] of Object.entries(DRUMS)) {
    const { meta } = load(id);
    for (const key of keys) assert.ok(meta.zones.some((z) => z.keyLo <= key && key <= z.keyHi), `${id}: Taste ${key}`);
    for (const z of meta.zones) assert.ok(keys.some((k) => z.keyLo <= k && k <= z.keyHi), `${id}: Zone ${z.keyLo}-${z.keyHi} ohne gefragte Taste`);
    const used = new Set(meta.zones.map((z) => z.sample));
    assert.equal(used.size, meta.samples.length, `${id}: unbenutzte Samples`);
  }
});

test('Größe: jedes Pack unter 6 MB, alle zusammen unter 15 MB (alte sechs); Lizenzvermerk liegt bei', () => {
  let total = 0, added = 0;
  for (const id of ALL) {
    const { size } = load(id);
    assert.ok(size < 6 * 1048576, `${id}: ${size}`);
    if (NEW.includes(id)) added += size; else total += size;
  }
  assert.ok(total < 15 * 1048576, `zusammen ${(total / 1048576).toFixed(1)} MB`);
  console.log(`# neue Packs zusammen: ${(added / 1048576).toFixed(2)} MB`); // nur gemeldet, nicht geprüft
  const license = readFileSync(new URL('LICENSE-MuseScore_General.md', DIR), 'utf8');
  assert.ok(license.includes('must be included in any derivative work'));
  assert.ok(license.includes('Frank Wen') && license.includes('S. Christian Collins'));
});
