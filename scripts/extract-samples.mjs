// Schneidet die benötigten Instrumente aus einer SoundFont (.sf3, zum Beispiel MuseScore_General) in kleine Packs für die Sample-Stimmen:
// je Pack <id>.json (Zonen) und <id>.pcm (16-Bit-Mono, die Samples hintereinander in ihrer Originalrate). Nur zum Bauen der Packs; die
// gebauten Dateien liegen im Repository, zur Laufzeit wird weder dieses Skript noch ffmpeg gebraucht.
//
// Aufruf: node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner]
// Quelle: https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3 (MIT, Lizenztext: src/assets/samples/LICENSE-MuseScore_General.md)
// Voraussetzung: ffmpeg im Pfad (dekodiert die Ogg-Vorbis-Samples der .sf3).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSoundFont } from './soundfont.mjs';

// Pack-ID -> General-MIDI-Programm (Bank 0)
export const PACKS = {
  'bass-finger': 33, // Fingered Bass
  'bass-pick': 34, // Picked Bass
  'chords-guitar': 27, // Clean Guitar
  'chords-epiano': 4, // Tine Electric Piano
  'pad-strings': 48, // Strings Fast
  'pad-warm': 89, // Warm Pad
};

// Timecents in Sekunden; der Standardwert -12000 (und alles darunter) bedeutet "sofort"
const seconds = (tc) => (tc <= -11999 ? 0 : 2 ** (tc / 1200));
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

function decode(ogg) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', 'pipe:1'], { input: ogg, maxBuffer: 256 * 1024 * 1024 });
}

export function buildPack(sf, id, program) {
  const preset = sf.presets.find((p) => p.bank === 0 && p.program === program);
  if (!preset) throw new Error(`Kein Preset für Programm ${program}`);
  // Stereo-Paare (links und rechts mit gleichem Tasten- und Anschlagbereich) liefern zwei Zonen; die Wahl nimmt immer die erste, die
  // zweite wäre nur Ballast im Download (pad-strings: halbe Größe)
  const seen = new Set();
  const zones = sf.resolve(preset).filter((z) => {
    const range = `${z.key}|${z.vel}`;
    if (seen.has(range)) return false;
    seen.add(range);
    return true;
  });
  const order = [...new Set(zones.map((z) => z.sampleID))];
  const samples = [];
  const chunks = [];
  let offset = 0;
  for (const sampleId of order) {
    const head = sf.samples[sampleId];
    if (!(head.type & 0x10)) throw new Error(`${head.name}: unkomprimierte Samples (.sf2) werden nicht unterstützt, bitte die .sf3 verwenden`);
    const pcm = decode(sf.buf.subarray(sf.smplAt + head.start, sf.smplAt + head.end));
    const frames = pcm.length / 2;
    // Schleifenpunkte der .sf3 sind in Abtastwerten relativ zum Sampleanfang; ungültige Schleifen gelten als keine
    let loopStart = head.loopStart, loopEnd = head.loopEnd;
    if (!(loopStart >= 0 && loopStart < loopEnd && loopEnd <= frames)) loopStart = loopEnd = 0;
    samples.push({ offset, frames, rate: head.sampleRate, loopStart, loopEnd });
    chunks.push(pcm);
    offset += pcm.length;
  }
  const out = zones.map((z) => {
    const head = sf.samples[z.sampleID], index = order.indexOf(z.sampleID);
    const root = z.rootKey >= 0 ? z.rootKey : head.rootKey; // -1 oder fehlend: Grundton des Samples
    return {
      keyLo: z.key[0], keyHi: z.key[1], velLo: z.vel[0], velHi: z.vel[1], sample: index,
      rootKey: root >= 0 && root <= 127 ? root : 60,
      tuneCents: z.coarseTune * 100 + z.fineTune + head.correction,
      loop: (z.sampleModes & 1) === 1 && samples[index].loopEnd > 0,
      attenuationDb: round(z.initialAttenuation / 10, 2),
      attack: round(seconds(z.attackVolEnv), 4), hold: round(seconds(z.holdVolEnv), 4), decay: round(seconds(z.decayVolEnv), 4),
      release: round(seconds(z.releaseVolEnv), 4), sustainDb: round(z.sustainVolEnv / 10, 2),
    };
  });
  return { meta: { id, source: 'MuseScore_General', gm: program, name: preset.name, samples, zones: out }, pcm: Buffer.concat(chunks) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sfPath, outArg] = process.argv.slice(2);
  if (!sfPath) {
    console.error('Aufruf: node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner]');
    process.exit(2);
  }
  const dir = outArg ?? fileURLToPath(new URL('../src/assets/samples/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const sf = readSoundFont(sfPath);
  for (const [id, program] of Object.entries(PACKS)) {
    const { meta, pcm } = buildPack(sf, id, program);
    writeFileSync(`${dir}/${id}.json`, `${JSON.stringify(meta)}\n`);
    writeFileSync(`${dir}/${id}.pcm`, pcm);
    console.log(`${id}: ${meta.name}, ${meta.samples.length} Samples, ${meta.zones.length} Zonen, ${(pcm.length / 1048576).toFixed(2)} MB`);
  }
}
