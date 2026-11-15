// Baut die Test-Packs im Format 2 (tests/e2e/sample-v2.spec.js) mit dem echten Importer aus einer erfundenen Library: Sinustöne, deren
// Frequenz verrät, welches Sample klang. Dazu je Pack Stichproben, die ffmpeg aus der FLAC-Datei dekodiert (Vergleich mit den Browsern).
// Aufruf (braucht ffmpeg): node tests/e2e/fixtures/make-sample-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSfzPack } from '../../../scripts/import-sfz.mjs';

const RATE = 44100, OUT = fileURLToPath(new URL('./samples/', import.meta.url));
const lib = mkdtempSync(join(tmpdir(), 'sfz-fixture-'));

/** 16-Bit-Mono-WAV mit einem Sinus (Frequenz Hz, Dauer s, Pegel). */
function sine(name, hz, seconds, level = 0.5) {
  const n = Math.round(seconds * RATE), data = Buffer.alloc(44 + 2 * n);
  data.write('RIFF', 0); data.writeUInt32LE(36 + 2 * n, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(2 * RATE, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(level * 32767 * Math.sin((2 * Math.PI * hz * i) / RATE)), 44 + 2 * i);
  mkdirSync(join(lib, name, '..'), { recursive: true });
  writeFileSync(join(lib, name), data);
}

try {
  writeFileSync(join(lib, 'LICENSE'), 'Testdaten, keine Lizenz nötig.\n');
  // Töne: zwei Anschlagstufen mit je zwei Round-Robins, ein Release-Sample, eine Staccato-Gruppe
  for (const hz of [300, 400, 500, 600]) sine(`n${hz}.wav`, hz, 0.6);
  sine('r800.wav', 800, 0.2); sine('staccato/s1000.wav', 1000, 0.3);
  writeFileSync(join(lib, 'notes.sfz'), [
    '<group> lokey=58 hikey=62 pitch_keycenter=60 lovel=0 hivel=63 <region> sample=n300.wav seq_position=1 <region> sample=n400.wav seq_position=2',
    '<group> lokey=58 hikey=62 pitch_keycenter=60 lovel=64 hivel=127 <region> sample=n500.wav seq_position=1 <region> sample=n600.wav seq_position=2',
    '<group> lokey=58 hikey=62 pitch_keycenter=60 trigger=release rt_decay=6 <region> sample=r800.wav',
    '<group> lokey=58 hikey=62 pitch_keycenter=60 <region> sample=staccato/s1000.wav',
  ].join('\n'));
  // Schläge: Direkt hart links, Raum hart rechts; die geschlossene Hi-Hat würgt die offene ab (zwei Round-Robins)
  for (const [name, hz, s] of [['hat-close', 2000, 0.3], ['hat-room', 2500, 0.3], ['open1-close', 1000, 1.2], ['open1-room', 1200, 1.2], ['open2-close', 1100, 1.2], ['open2-room', 1300, 1.2]]) sine(`${name}.wav`, hz, s);
  writeFileSync(join(lib, 'hits.sfz'), [
    '<group> key=42 group=1 <region> sample=hat-close.wav pan=-100 <region> sample=hat-room.wav pan=100',
    '<group> key=46 group=2 off_by=1 off_time=0.03 <region> sample=open1-close.wav pan=-100 seq_position=1 <region> sample=open1-room.wav pan=100 seq_position=1',
    '<region> sample=open2-close.wav pan=-100 seq_position=2 <region> sample=open2-room.wav pan=100 seq_position=2',
  ].join('\n'));

  const common = { title: 'Test', author: 'Test', license: 'CC0-1.0', licenseUrl: '-', url: '-', licenseFile: 'LICENSE' };
  mkdirSync(OUT, { recursive: true });
  buildSfzPack(lib, 'test-notes', OUT, { ...common, sfz: 'notes.sfz', channels: 1, keys: [50, 70], select: { default: [2, 2] }, seconds: 1, releases: 1, art: [[/staccato[\\/]/, 'staccato']] });
  buildSfzPack(lib, 'test-hits', OUT, { ...common, sfz: 'hits.sfz', channels: 2, hits: { hat: 42, openHat: 46 }, room: /-room\.wav$/, select: { default: [1, 2] }, seconds: { default: 1.2 } });

  // Stichproben aus der Dekodierung durch ffmpeg: [Sample, Frame, Kanal, 16-Bit-Wert]
  for (const id of ['test-notes', 'test-hits']) {
    const meta = JSON.parse(readFileSync(join(OUT, `${id}.json`), 'utf8'));
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(OUT, meta.file), '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2), spots = [];
    meta.samples.forEach((s, k) => { for (const f of [0, 1, 2, 37, 1000, s.frames - 1]) for (let c = 0; c < meta.channels; c++) spots.push([k, f, c, pcm[(s.offset + f) * meta.channels + c]]); });
    writeFileSync(join(OUT, `${id}.expect.json`), `${JSON.stringify(spots)}\n`);
  }
} finally {
  rmSync(lib, { recursive: true });
}
