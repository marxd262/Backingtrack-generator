// Vorher/Nachher-Vergleich der Sample-Gitarren als WAV (Entwicklerwerkzeug, niemand kann hier hören: der Nutzer vergleicht die Dateien).
// Je Gitarre der gleiche 8-Takt-Akkordlauf (A-Moll, Am Am Dm E, 100 bpm, nur Akkorde, ohne Echo, Hall und Begrenzer): erst gehaltene
// Akkorde (complexity 0), nach einer Sekunde Pause derselbe Lauf mit complexity 1. "vorher" = alte Werte über Feinwert-Überschreibungen,
// "nachher" = die ausgelieferten Standardwerte. Ausgabe: <ordner>/<stimme>-vorher.wav und -nachher.wav, 16 Bit, mono, 44,1 kHz.
// Aufruf: node scripts/render-ab.mjs [ausgabeordner]   (Standard: .superpowers/audio-ab)
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GUITARS = ['guitar', 'muted', 'jazz', 'funk', 'steel', 'nylon', 'twelve'];
// level vor der Neumessung (tunables.js bis e93653a)
const OLD_LEVEL = { guitar: 1.7, muted: 1.2, jazz: 4.25, funk: 0.9, steel: 5, nylon: 1.85, twelve: 6.5 };

/** Feinwert-Überschreibungen, die den Klang vor Stufe 1 wiederherstellen (alte Anschlagkurve, keine Helligkeit, Schleife, kein Zufall, alter Entzerrer und Pegel). */
export const legacyTuning = (variant) => ({
  [`chords/sample/${variant}`]: {
    velExp: 1, softHz: 20000, oneShot: 0, humanCents: 0, humanDb: 0, level: OLD_LEVEL[variant],
    ...(variant === 'guitar' ? { lowDb: 9, midDb: -12, highDb: -10 } : {}),
  },
});

const RATE = 44100;
const wav = (int16) => {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + int16.length * 2, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(int16.length * 2, 40);
  return Buffer.concat([head, Buffer.from(Int16Array.from(int16).buffer)]);
};

async function main() {
  const { chromium } = await import('@playwright/test');
  const { start } = await import('./serve.js');
  const outDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../.superpowers/audio-ab', import.meta.url)));
  await mkdir(outDir, { recursive: true });
  let server, browser; // beide im try: scheitert der Start des Browsers, wird der Server trotzdem geschlossen
  try {
    server = await start(0);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
    await page.waitForFunction(() => typeof window.__render === 'function');
    for (const variant of GUITARS) {
      for (const [label, tuning] of [['vorher', legacyTuning(variant)], ['nachher', {}]]) {
        const r = await page.evaluate(async ([v, tune]) => {
          const { buildEvents } = await import('/core/events.js');
          const { resolveTrackTimbre } = await import('/core/timbre.js');
          const { createInstruments } = await import('/audio/synth.js');
          const { spectralCentroid } = await import('/audio/spectrum.js');
          const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
          const parts = [];
          for (const complexity of [0, 1]) {
            const track = { key: { root: 'A', mode: 'minor' }, bpm: 100, bars, layers: { chords: true }, seed: 1, length: 8, complexity, tags: { development: ['fullFromStart'] } };
            const events = buildEvents(track);
            const seconds = 8 * 4 * 0.6 + 2; // 8 Takte und Ausklang
            const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
            const timbre = resolveTrackTimbre(track);
            const inst = createInstruments(ctx, { bpm: 100, limiter: false, timbre: { ...timbre, master: { ...timbre.master, echo: 0, reverb: 0 } }, voices: { chords: { id: 'sample', variant: v } }, tuning: tune });
            await inst.whenReady();
            inst.output.connect(ctx.destination);
            for (const e of events) if (e.layer === 'chords') inst.layers.chords.trigger(e, 0.1 + e.t);
            parts.push((await ctx.startRendering()).getChannelData(0), new Float32Array(44100));
          }
          const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
          let at = 0;
          for (const p of parts) { all.set(p, at); at += p.length; }
          let peak = 0, sum = 0;
          for (const x of all) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
          const int16 = Array.from(all, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
          return { int16, peak, rms: Math.sqrt(sum / all.length), centroid: spectralCentroid(all, 44100), seconds: all.length / 44100 };
        }, [variant, tuning]);
        const file = join(outDir, `${variant}-${label}.wav`);
        await writeFile(file, wav(r.int16));
        console.log(`${file}  ${r.seconds.toFixed(1)} s  peak ${r.peak.toFixed(3)}${r.peak > 1 ? ' (begrenzt)' : ''}  rms ${r.rms.toFixed(4)}  Schwerpunkt ${Math.round(r.centroid)} Hz`);
      }
    }
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  } finally {
    await browser?.close();
    server?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
