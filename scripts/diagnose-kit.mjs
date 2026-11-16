// Warum klingt ein neues Kit anders als das MuseScore-Kit (gebaut für Muldjord, Urteil 2026-11-15: allein A besser, im Mix geht B unter)? Messungen ohne Gehör:
// 1. aus den angeglichenen WAVs von render-full.mjs --solo drums (<name>-A.wav, <name>-B.wav): Bänder, Crest-Faktor, Kurzzeit-Spitzen
// 2. je Schlag im Browser: Pegel bei vel 1 und Dynamik (vel 0,2 … 1 relativ zu 1), MuseScore-Kit (Pack drums-standard) gegen das Pack, beide mit level 1, ohne Zufall
// 3. aus dem Pack: Raum gegen Direkt je Schlag
// Aufruf (im Repo-Ordner, braucht ffmpeg): node scripts/diagnose-kit.mjs <wav-ordner>/<name> <pack-id>   z. B. .superpowers/audio-ab/muldjord-solo drums-muldjord
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stft } from '../src/audio/analysis.js';
import { start } from './serve.js';
import { chromium } from '@playwright/test';

const [prefix, packId] = process.argv.slice(2);
if (!prefix || !packId) { console.error('Aufruf: node scripts/diagnose-kit.mjs <wav-ordner>/<name> <pack-id>'); process.exit(2); }
const wav = (f) => { const b = readFileSync(f), d = new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) / 2); const L = new Float32Array(d.length / 2), R = new Float32Array(d.length / 2); for (let i = 0; i < L.length; i++) { L[i] = d[2 * i] / 32768; R[i] = d[2 * i + 1] / 32768; } return [L, R]; };
const BANDS = [[20, 100], [100, 300], [300, 1000], [1000, 4000], [4000, 10000], [10000, 20000]];
console.log('1. Schlagzeug allein (angeglichen), Anteil je Band in dB gegen die Summe, Crest, Kurzzeit-Spitze (10 ms) über RMS');
for (const side of ['A', 'B']) {
  const [L, R] = wav(`${prefix}-${side}.wav`), mono = L.map((x, i) => (x + R[i]) / 2).subarray(0, 44100 * 120);
  const { freqs } = stft(mono.subarray(0, 4096), 44100, { size: 4096, hop: 4096 });
  // Leistung je Band über viele Fenster (lineare Beträge aus dB zurückgerechnet ist ungenau; hier direkt: Summe der Quadrate je Bin)
  const power = new Float64Array(freqs.length);
  const s = stft(mono, 44100, { size: 4096, hop: 4096 });
  for (const frame of s.db) frame.forEach((db, k) => { power[k] += 10 ** (db / 10); });
  const total = power.reduce((a, b) => a + b, 0);
  const bands = BANDS.map(([lo, hi]) => { let p = 0; freqs.forEach((f, k) => { if (f >= lo && f < hi) p += power[k]; }); return (10 * Math.log10(p / total)).toFixed(1); });
  let sum = 0, peak = 0; for (const x of mono) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
  const rms = Math.sqrt(sum / mono.length), win = 441, short = [];
  for (let i = 0; i + win < mono.length; i += win) { let e = 0; for (let j = i; j < i + win; j++) e += mono[j] * mono[j]; short.push(Math.sqrt(e / win)); }
  short.sort((a, b) => a - b);
  console.log(`  ${side}: Bänder ${BANDS.map(([lo, hi], i) => `${lo}-${hi} ${bands[i]}`).join(' | ')}; Crest ${(20 * Math.log10(peak / rms)).toFixed(1)} dB; 99%-Spitze ${(20 * Math.log10(short[Math.floor(short.length * 0.99)] / rms)).toFixed(1)} dB über RMS`);
}

console.log('2. je Schlag (level 1, ohne Zufall): Spitze bei vel 1 in dBFS, dann vel 0,2 / 0,4 / 0,6 / 0,8 gegen vel 1 in dB');
const server = await start(0), browser = await chromium.launch(), page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
const rows = await page.evaluate(async (packId) => {
  const { sampleHitVoice, HIT_KEYS } = await import('/audio/voices/sample-hits.js');
  const { loadPack } = await import('/audio/voices/sampler.js');
  const out = {};
  for (const id of ['drums-standard', packId]) {
    await loadPack(id);
    for (const name of ['kick', 'snare', 'hat', 'openHat', 'tomMid', 'crash', 'sideStick']) {
      const levels = [];
      for (const vel of [1, 0.2, 0.4, 0.6, 0.8]) {
        const ctx = new OfflineAudioContext(2, 44100, 44100);
        let seed = 3;
        const voice = sampleHitVoice(id, HIT_KEYS.drums, ctx, { tuned: (n) => ({ level: 1, choke: 1, roomMic: 1 })[n] ?? NaN, classic() {}, setStatus() {}, track() {}, rng: { next: () => (seed = (seed * 16807) % 2147483647) / 2147483647 } });
        voice(ctx.destination, 0.01, { type: 'hit', name, vel });
        const b = await ctx.startRendering();
        let p = 0; for (const c of [0, 1]) for (const x of b.getChannelData(c)) p = Math.max(p, Math.abs(x));
        levels.push(20 * Math.log10(p));
      }
      (out[name] ??= {})[id] = levels;
    }
  }
  return out;
}, packId);
for (const [name, r] of Object.entries(rows)) console.log(`  ${name.padEnd(9)} ${Object.entries(r).map(([id, [top, ...rest]]) => `${id.replace('drums-', '')} ${top.toFixed(1)} dBFS, ${rest.map((x) => (x - top).toFixed(1)).join(' / ')}`).join('   ')}`);
await browser.close(); server.close();

console.log(`3. ${packId}: Raum gegen Direkt (Energie), Mittel je Schlag`);
const meta = JSON.parse(readFileSync(`src/assets/samples/${packId}.json`, 'utf8'));
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `src/assets/samples/${meta.file}`, '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const energy = (k) => { const s = meta.samples[k]; let e = 0; for (let i = s.offset * 2; i < (s.offset + s.frames) * 2; i++) e += (pcm[i] / 32768) ** 2; return e; };
for (const [name, key] of Object.entries(meta.keys)) {
  const zs = meta.zones.filter((z) => z.keyLo === key && Number.isInteger(z.room));
  const ratio = zs.reduce((a, z) => a + 10 * Math.log10(energy(z.room) / energy(z.sample)), 0) / zs.length;
  console.log(`  ${name.padEnd(9)} Raum ${ratio >= 0 ? '+' : ''}${ratio.toFixed(1)} dB gegen Direkt`);
}
