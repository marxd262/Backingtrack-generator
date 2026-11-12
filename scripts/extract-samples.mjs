// Schneidet die benötigten Instrumente aus SoundFonts (.sf3 wie MuseScore_General, unkomprimierte .sf2 wie die Freepats-Gitarren) in kleine
// Packs für die Sample-Stimmen: je Pack <id>.json (Zonen) und <id>.pcm (16-Bit-Mono, die Samples hintereinander in ihrer Originalrate). Nur
// zum Bauen der Packs; die gebauten Dateien liegen im Repository, zur Laufzeit wird weder dieses Skript noch ffmpeg gebraucht.
//
// Aufruf: node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner] [--fsbs-clean <datei.sf2>] [--fsbs-jazz <datei.sf2>]
// Packs: siehe PACKS unten (Bass, Akkorde, Pads, Leads, fünf Schlagzeug-Kits, Percussion; Schlagzeug und Percussion nur mit den benutzten Tasten).
// Packs, deren Quelle nicht angegeben ist, werden übersprungen.
// Quellen: msg = https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3 (MIT, Lizenztext:
// src/assets/samples/LICENSE-MuseScore_General.md); fsbs-clean und fsbs-jazz = Freepats FSBS Electric Guitar, kleine SF2 (CC0, Adressen in
// src/assets/samples/LICENSE-Freepats-FSBS.md).
// Voraussetzung: ffmpeg im Pfad (dekodiert die Ogg-Vorbis-Samples der .sf3).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readSoundFont } from './soundfont.mjs';

/** Quelle eines Packs -> Name im Pack (meta.source). */
export const SOURCES = { msg: 'MuseScore_General', 'fsbs-clean': 'Freepats FSBS Electric Guitar Clean', 'fsbs-jazz': 'Freepats FSBS Electric Guitar Jazz' };

// Pack-ID -> Preset der SoundFont (Bank, Programm) und optional die Tasten, die behalten werden (Schlagzeug: nur die benutzten Hits), die
// Quelle (Standard msg) und das GM-Programm, das die Stimme vertritt (Standard: das Programm des Presets)
// Crash (Taste 49): die Kits liefern 8,5 s (je 0,75 MB, fünfmal); gekürzt auf CRASH_SECONDS mit weichem Ausklang (letzte CRASH_FADE Sekunden)
const CRASH_KEY = 49, CRASH_SECONDS = 2.5, CRASH_FADE = 0.8;
// Die Crash-Zonen der Kits liegen laut SoundFont bis zu 18 dB auseinander (Standard dämpft 18 dB, Brushes und Jazz -7 dB, das der Sampler
// auf 0 begrenzt). Hier steht die Dämpfung je Kit, bei der der Crash überall etwa gleich laut klingt (rms über die erste Sekunde bei vel 0.8,
// gemessen 2026-11-12 mit dem level des Kits: etwa -28,5 dB; 808 ist schon ohne Dämpfung leiser, -29,6 dB). Der Sampler kann nicht anheben.
const CRASH_ATTENUATION_DB = { 'drums-standard': 3.5, 'drums-brushes': 3.5, 'drums-jazz': 3.5, 'drums-electronic': 2.5, 'drums-808': 0 };
const DRUM_KEYS = [35, 36, 37, 38, 41, 42, 43, 44, 46, 47, 49, 50];
export const PACKS = {
  'bass-finger': { bank: 0, program: 33 }, // Fingered Bass
  'bass-pick': { bank: 0, program: 34 }, // Picked Bass
  'bass-upright': { bank: 0, program: 32 }, // Acoustic Bass
  'chords-guitar': { bank: 0, program: 27 }, // Clean Guitar
  'chords-epiano': { bank: 0, program: 4 }, // Tine Electric Piano
  'chords-organ': { bank: 0, program: 16 }, // Drawbar Organ
  'chords-muted': { bank: 0, program: 28 }, // Palm Muted Guitar
  'chords-jazz': { bank: 0, program: 26 }, // Jazz Guitar
  'chords-funk': { bank: 8, program: 28 }, // Funk Guitar
  'chords-steel': { bank: 0, program: 25 }, // Steel String Guitar
  'chords-nylon': { bank: 0, program: 24 }, // Nylon String Guitar
  'chords-twelve': { bank: 8, program: 25 }, // 12-String Guitar
  'pad-strings': { bank: 0, program: 48 }, // Strings Fast
  'pad-warm': { bank: 0, program: 89 }, // Warm Pad
  'lead-flute': { bank: 0, program: 73 }, // Flute
  'lead-sax': { bank: 0, program: 65 }, // Alto Sax
  'lead-synth': { bank: 0, program: 81 }, // Saw Lead
  'drums-standard': { bank: 128, program: 0, keys: DRUM_KEYS }, // Standard
  'drums-brushes': { bank: 128, program: 40, keys: DRUM_KEYS }, // Brush
  'drums-jazz': { bank: 128, program: 32, keys: DRUM_KEYS }, // Jazz
  'drums-electronic': { bank: 128, program: 24, keys: DRUM_KEYS }, // Electronic
  'drums-808': { bank: 128, program: 25, keys: DRUM_KEYS }, // TR-808
  'percussion-studio': { bank: 128, program: 0, keys: [54, 56, 60, 61, 63, 64, 75, 82] }, // Standard: Tamburin, Kuhglocke, Bongos, Congas, Claves
  'chords-freepats': { source: 'fsbs-clean', bank: 0, program: 0, gm: 27 }, // EGuitar Cl. Br. Sm. (einziges Preset)
  'chords-freepatsjazz': { source: 'fsbs-jazz', bank: 0, program: 0, gm: 26 }, // EGuitar Jz. Br. Sm. (einziges Preset)
};

// Timecents in Sekunden; der Standardwert -12000 (und alles darunter) bedeutet "sofort"
const seconds = (tc) => (tc <= -11999 ? 0 : 2 ** (tc / 1200));
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

function decode(ogg) {
  return execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', 'pipe:1'], { input: ogg, maxBuffer: 256 * 1024 * 1024 });
}

export function buildPack(sf, id, { bank, program, keys, source = 'msg', gm = program }) {
  const preset = sf.presets.find((p) => p.bank === bank && p.program === program);
  if (!preset) throw new Error(`Kein Preset für Bank ${bank}, Programm ${program}`);
  // Stereo-Paare (links und rechts mit gleichem Tasten- und Anschlagbereich) liefern zwei Zonen; die Wahl nimmt immer die erste, die
  // zweite wäre nur Ballast im Download (pad-strings: halbe Größe)
  const seen = new Set();
  // keys: nur Zonen behalten, deren Tastenbereich eine der Tasten enthält; nicht benutzte Samples fallen mit weg (order kommt aus den Zonen)
  const zones = sf.resolve(preset).filter((z) => !keys || keys.some((k) => z.key[0] <= k && k <= z.key[1])).filter((z) => {
    const range = `${z.key}|${z.vel}`;
    if (seen.has(range)) return false;
    seen.add(range);
    return true;
  });
  // fehlt eine verlangte Taste (z. B. Crash 49), wäre der Schlag im Pack still stumm: lieber abbrechen
  for (const k of keys ?? []) if (!zones.some((z) => z.key[0] <= k && k <= z.key[1])) throw new Error(`Preset ${preset.name} (Bank ${bank}, Programm ${program}): keine Zone für Taste ${k}`);
  const order = [...new Set(zones.map((z) => z.sampleID))];
  const samples = [];
  const chunks = [];
  let offset = 0;
  for (const sampleId of order) {
    const head = sf.samples[sampleId];
    // .sf3: Ogg Vorbis (Anfang und Ende in Bytes, Schleifenpunkte in Abtastwerten relativ zum Sampleanfang). .sf2: 16-Bit-PCM, alle Punkte in
    // Abtastwerten ab dem Anfang des smpl-Chunks; ein 24-Bit-Zusatz (sm24) bleibt unbenutzt
    const compressed = head.type & 0x10;
    let pcm = compressed ? decode(sf.buf.subarray(sf.smplAt + head.start, sf.smplAt + head.end)) : Buffer.from(sf.buf.subarray(sf.smplAt + 2 * head.start, sf.smplAt + 2 * head.end));
    let frames = pcm.length / 2;
    // nur Samples, die allein die Crash-Taste spielen, werden gekürzt (alle anderen Tasten bleiben unberührt)
    if (keys?.includes(CRASH_KEY) && zones.filter((z) => z.sampleID === sampleId).every((z) => z.key[0] === CRASH_KEY && z.key[1] === CRASH_KEY) && frames > CRASH_SECONDS * head.sampleRate) {
      frames = Math.round(CRASH_SECONDS * head.sampleRate);
      pcm = pcm.subarray(0, 2 * frames);
      const fade = Math.round(CRASH_FADE * head.sampleRate);
      for (let i = 0; i < fade; i++) pcm.writeInt16LE(Math.round(pcm.readInt16LE(2 * (frames - fade + i)) * Math.cos((i / fade) * Math.PI / 2) ** 2), 2 * (frames - fade + i));
    }
    // ungültige Schleifen gelten als keine
    let loopStart = head.loopStart - (compressed ? 0 : head.start), loopEnd = head.loopEnd - (compressed ? 0 : head.start);
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
      attenuationDb: keys?.includes(CRASH_KEY) && z.key[0] === CRASH_KEY && z.key[1] === CRASH_KEY && id in CRASH_ATTENUATION_DB ? CRASH_ATTENUATION_DB[id] : round(z.initialAttenuation / 10, 2),
      attack: round(seconds(z.attackVolEnv), 4), hold: round(seconds(z.holdVolEnv), 4), decay: round(seconds(z.decayVolEnv), 4),
      release: round(seconds(z.releaseVolEnv), 4), sustainDb: round(z.sustainVolEnv / 10, 2),
    };
  });
  return { meta: { id, source: SOURCES[source], gm, name: preset.name, samples, zones: out }, pcm: Buffer.concat(chunks) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const usage = 'Aufruf: node scripts/extract-samples.mjs <MuseScore_General.sf3> [ausgabeordner] [--fsbs-clean <datei.sf2>] [--fsbs-jazz <datei.sf2>]';
  let args;
  try {
    args = parseArgs({ allowPositionals: true, options: { 'fsbs-clean': { type: 'string' }, 'fsbs-jazz': { type: 'string' } } });
  } catch (err) {
    console.error(`${err.message}\n${usage}`);
    process.exit(2);
  }
  const [sfPath, outArg] = args.positionals;
  if (!sfPath) {
    console.error(usage);
    process.exit(2);
  }
  const files = { ...args.values, msg: sfPath };
  const dir = outArg ?? fileURLToPath(new URL('../src/assets/samples/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const fonts = {}; // Quelle -> gelesene SoundFont (je Datei einmal)
  for (const [id, spec] of Object.entries(PACKS)) {
    const source = spec.source ?? 'msg';
    if (!files[source]) { console.log(`${id}: übersprungen (Quelle ${source} nicht angegeben)`); continue; }
    const { meta, pcm } = buildPack((fonts[source] ??= readSoundFont(files[source])), id, spec);
    writeFileSync(`${dir}/${id}.json`, `${JSON.stringify(meta)}\n`);
    writeFileSync(`${dir}/${id}.pcm`, pcm);
    console.log(`${id}: ${meta.name}, ${meta.samples.length} Samples, ${meta.zones.length} Zonen, ${(pcm.length / 1048576).toFixed(2)} MB`);
  }
}
