// Sample-Packs (src/assets/samples): Dateien, Zonen, Sample-Verweise, Schleifen, Tastenabdeckung, Größe und Lizenzvermerk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKS as SCRIPT_PACKS, SOURCES, buildPack } from '../../scripts/extract-samples.mjs';
import { readSoundFont } from '../../scripts/soundfont.mjs';

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
const DRUM_KEYS = [35, 36, 37, 38, 41, 42, 43, 44, 46, 47, 49, 50]; // 49 = Crash (Schlag crash)
const DRUMS = {
  'drums-standard': [0, DRUM_KEYS], 'drums-brushes': [40, DRUM_KEYS], 'drums-jazz': [32, DRUM_KEYS], 'drums-electronic': [24, DRUM_KEYS], 'drums-808': [25, DRUM_KEYS],
  'percussion-studio': [0, [54, 56, 60, 61, 63, 64, 75, 82]],
};
// Packs aus den Freepats-FSBS-Gitarren (.sf2, CC0): Pack-ID -> [Quelle, GM-Programm, das die Stimme vertritt, niedrigste und höchste Taste der
// Quelle (13 Samples, Tasten 35 bis 86)]
const FREEPATS = {
  'chords-freepats': ['fsbs-clean', 27, 35, 86],
  'chords-freepatsjazz': ['fsbs-jazz', 26, 35, 86],
};
const ALL = [...Object.keys(PACKS), ...Object.keys(DRUMS), ...Object.keys(FREEPATS)];
const NEW = ALL.filter((id) => !['bass-finger', 'bass-pick', 'chords-guitar', 'chords-epiano', 'pad-strings', 'pad-warm'].includes(id));
const load = (id) => ({ meta: JSON.parse(readFileSync(new URL(`${id}.json`, DIR), 'utf8')), size: statSync(new URL(`${id}.pcm`, DIR)).size });

test('PACKS im Skript und die erwarteten Packs sind dieselben', () => {
  assert.deepEqual(Object.keys(SCRIPT_PACKS).sort(), ALL.slice().sort());
  for (const [id, [, gm, , , bank = 0]] of Object.entries(PACKS)) assert.equal(SCRIPT_PACKS[id].bank, bank, id), assert.equal(SCRIPT_PACKS[id].program, gm, id);
  for (const [id, [gm, keys]] of Object.entries(DRUMS)) assert.deepEqual([SCRIPT_PACKS[id].bank, SCRIPT_PACKS[id].program, SCRIPT_PACKS[id].keys], [128, gm, keys], id);
  for (const [id, spec] of Object.entries(SCRIPT_PACKS)) assert.equal(spec.source ?? 'msg', FREEPATS[id]?.[0] ?? 'msg', `${id}: Quelle`);
  for (const [id, [, gm]] of Object.entries(FREEPATS)) assert.equal(SCRIPT_PACKS[id].gm, gm, id);
});

test('jedes Pack hat .json und .pcm, die ID stimmt, Quelle und GM-Programm sind angegeben', () => {
  const gms = { ...Object.fromEntries(Object.entries(PACKS).map(([id, v]) => [id, v[1]])), ...Object.fromEntries(Object.entries(DRUMS).map(([id, v]) => [id, v[0]])), ...Object.fromEntries(Object.entries(FREEPATS).map(([id, v]) => [id, v[1]])) };
  for (const id of ALL) {
    const gm = gms[id];
    assert.ok(existsSync(new URL(`${id}.json`, DIR)) && existsSync(new URL(`${id}.pcm`, DIR)), id);
    const { meta } = load(id);
    assert.equal(meta.id, id);
    assert.equal(meta.source, SOURCES[FREEPATS[id]?.[0] ?? 'msg'], id);
    assert.equal(meta.gm, gm, `${id}: GM-Programm`);
  }
});

// Kleinste SF2 von Hand: ein Preset -> ein Instrument -> ein Sample (Tasten 40 bis 80, Schleife an). Das Sample liegt hinter 10 anderen
// Abtastwerten im smpl-Chunk, damit Anfang und Schleifenpunkte (in der SF2 ab dem Chunk-Anfang gezählt) umgerechnet werden müssen.
function tinySf2({ pcm, lead = 10, loopStart, loopEnd, rate = 22050, root = 64 }) {
  const chunk = (id, body) => Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from(new Uint32Array([body.length]).buffer), body, Buffer.alloc(body.length & 1)]);
  const list = (type, ...parts) => chunk('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...parts]));
  const rec = (size, fill) => { const b = Buffer.alloc(size); fill(b); return b; };
  const gen = (oper, amount) => rec(4, (b) => { b.writeUInt16LE(oper, 0); b.writeInt16LE(amount, 2); });
  const smpl = Buffer.concat([Buffer.alloc(2 * lead), Buffer.from(pcm.buffer), Buffer.alloc(2 * 46)]); // SF2: 46 Nullwerte nach jedem Sample
  const pdta = list('pdta',
    chunk('phdr', Buffer.concat([rec(38, (b) => b.write('Test', 0, 'latin1')), rec(38, (b) => { b.write('EOP', 0, 'latin1'); b.writeUInt16LE(1, 24); })])),
    chunk('pbag', Buffer.concat([rec(4, () => {}), rec(4, (b) => b.writeUInt16LE(1, 0))])),
    chunk('pgen', Buffer.concat([gen(41, 0), rec(4, () => {})])),
    chunk('inst', Buffer.concat([rec(22, (b) => b.write('Inst', 0, 'latin1')), rec(22, (b) => { b.write('EOI', 0, 'latin1'); b.writeUInt16LE(1, 20); })])),
    chunk('ibag', Buffer.concat([rec(4, () => {}), rec(4, (b) => b.writeUInt16LE(3, 0))])),
    chunk('igen', Buffer.concat([rec(4, (b) => { b.writeUInt16LE(43, 0); b.writeUInt8(40, 2); b.writeUInt8(80, 3); }), gen(54, 1), gen(53, 0), rec(4, () => {})])),
    chunk('shdr', Buffer.concat([rec(46, (b) => {
      b.write('S', 0, 'latin1');
      [lead, lead + pcm.length, lead + loopStart, lead + loopEnd, rate].forEach((v, i) => b.writeUInt32LE(v, 20 + 4 * i));
      b.writeUInt8(root, 40); b.writeUInt16LE(1, 44); // mono
    }), rec(46, (b) => b.write('EOS', 0, 'latin1'))])));
  const body = Buffer.concat([Buffer.from('sfbk', 'latin1'), list('INFO', chunk('ifil', Buffer.from([2, 0, 1, 0]))), list('sdta', chunk('smpl', smpl)), pdta]);
  return chunk('RIFF', body);
}

test('Extraktor liest unkomprimierte SF2: 16-Bit-PCM unverändert, Rate erhalten, Schleife relativ zum Sampleanfang', () => {
  const pcm = Int16Array.from({ length: 500 }, (_, i) => Math.round(10000 * Math.sin(i / 7)));
  const dir = mkdtempSync(join(tmpdir(), 'sf2-'));
  try {
    const path = join(dir, 'tiny.sf2');
    writeFileSync(path, tinySf2({ pcm, loopStart: 100, loopEnd: 400 }));
    const { meta, pcm: out } = buildPack(readSoundFont(path), 'test-tiny', { source: 'fsbs-clean', bank: 0, program: 0, gm: 27 });
    assert.deepEqual(new Int16Array(out.buffer, out.byteOffset, out.length / 2), pcm);
    assert.deepEqual(meta.samples, [{ offset: 0, frames: 500, rate: 22050, loopStart: 100, loopEnd: 400 }]);
    assert.deepEqual([meta.id, meta.source, meta.gm, meta.name], ['test-tiny', SOURCES['fsbs-clean'], 27, 'Test']);
    assert.equal(meta.zones.length, 1);
    assert.deepEqual([meta.zones[0].keyLo, meta.zones[0].keyHi, meta.zones[0].rootKey, meta.zones[0].loop, meta.zones[0].sample], [40, 80, 64, true, 0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Extraktor bricht ab, wenn eine verlangte Taste keine Zone hat (Crash 49 fehlt im Kit)', () => {
  const pcm = Int16Array.from({ length: 100 }, (_, i) => i);
  const dir = mkdtempSync(join(tmpdir(), 'sf2-'));
  try {
    const path = join(dir, 'tiny.sf2');
    writeFileSync(path, tinySf2({ pcm, loopStart: 10, loopEnd: 90 }));
    const sf = readSoundFont(path);
    assert.doesNotThrow(() => buildPack(sf, 't', { bank: 0, program: 0, keys: [40, 49] }));
    assert.throws(() => buildPack(sf, 't', { bank: 0, program: 0, keys: [40, 90] }), /90/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Referenz von vor dem Crash (Packs neu extrahiert): je Kit und bisheriger Taste die Zonen mit Frames, Rate, Schleife und SHA-1 der PCM-Bytes.
// Das Neu-Extrahieren darf die Bytes der Packs ändern (Sample-Reihenfolge), nicht den Klang der bisherigen Tasten.
test('Schlagzeug-Packs: bisherige Tasten klingen wie vor dem Crash (dekodierte Samples gleich), Taste 49 hat in jedem Kit eine Zone', () => {
  const ref = JSON.parse(readFileSync(new URL('fixtures/drum-pack-reference.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(ref).length, 5);
  for (const [id, keys] of Object.entries(ref)) {
    const meta = JSON.parse(readFileSync(new URL(`${id}.json`, DIR), 'utf8')), pcm = readFileSync(new URL(`${id}.pcm`, DIR));
    for (const [key, zones] of Object.entries(keys)) {
      const got = meta.zones.filter((z) => z.keyLo <= key && key <= z.keyHi).map(({ sample, ...zone }) => {
        const s = meta.samples[sample];
        return { ...zone, frames: s.frames, rate: s.rate, loopStart: s.loopStart, loopEnd: s.loopEnd, sha1: createHash('sha1').update(pcm.subarray(s.offset, s.offset + 2 * s.frames)).digest('hex') };
      });
      assert.deepEqual(got, zones, `${id} Taste ${key}`);
    }
    const crash = meta.zones.find((z) => z.keyLo <= 49 && 49 <= z.keyHi);
    assert.ok(crash, `${id}: Taste 49`);
    // Crash gekürzt (Größe) und mit weichem Ausklang
    const s = meta.samples[crash.sample], tail = new Int16Array(pcm.buffer.slice(pcm.byteOffset + s.offset + 2 * s.frames - 64, pcm.byteOffset + s.offset + 2 * s.frames));
    assert.equal(s.frames, 110250, `${id}: Crash auf 2,5 s gekürzt`);
    assert.deepEqual([...tail], new Array(32).fill(0), `${id}: Crash endet auf Stille`);
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
  for (const [id, [, , lo, hi]] of [...Object.entries(PACKS), ...Object.entries(FREEPATS)]) {
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

test('Freepats: keine unbenutzten Samples, Abtastrate der Quelle (44,1 kHz) erhalten', () => {
  for (const id of Object.keys(FREEPATS)) {
    const { meta } = load(id);
    assert.equal(new Set(meta.zones.map((z) => z.sample)).size, meta.samples.length, `${id}: unbenutzte Samples`);
    for (const s of meta.samples) assert.equal(s.rate, 44100, id);
  }
});

test('Größe: jedes Pack unter 6 MB (Freepats unter 12 MB), alle zusammen unter 15 MB (alte sechs); Lizenzvermerke liegen bei', () => {
  let total = 0, added = 0, all = 0;
  for (const id of ALL) {
    const { size } = load(id);
    // Freepats: 13 lange Samples (3 bis 20 s, natürliches Ausklingen) in 44,1 kHz; ausdünnen hieße kürzen oder die Rate senken, beides
    // nähme den Grund für die Quelle weg
    assert.ok(size < (FREEPATS[id] ? 12 : 6) * 1048576, `${id}: ${size}`);
    if (NEW.includes(id)) added += size; else total += size;
    all += size;
  }
  assert.ok(total < 15 * 1048576, `zusammen ${(total / 1048576).toFixed(1)} MB`);
  console.log(`# neue Packs zusammen: ${(added / 1048576).toFixed(2)} MB, alle Packs ${(all / 1048576).toFixed(2)} MB`); // nur gemeldet, nicht geprüft
  const license = readFileSync(new URL('LICENSE-MuseScore_General.md', DIR), 'utf8');
  assert.ok(license.includes('must be included in any derivative work'));
  assert.ok(license.includes('Frank Wen') && license.includes('S. Christian Collins'));
  const freepats = readFileSync(new URL('LICENSE-Freepats-FSBS.md', DIR), 'utf8');
  assert.ok(freepats.includes('CC0 1.0') && freepats.includes('https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html') && freepats.includes('2026-08-07'));
});
