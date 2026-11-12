// Hörprobe der Songform als WAV (Entwicklerwerkzeug, niemand kann hier hören: der Nutzer vergleicht die Dateien).
// Je Stil (funk -> Jam, psych -> Build & Drop, country -> Pop, jeweils Vorlage "Auto" des Stils) ein Song von 96 Takten MIT Form und derselbe
// Track OHNE Form (also die bisherige 8-Takt-Schleife). Alle Schichten an (Lead: melody, Percussion: mixed), Standard-Stimmen (Synth), Regler
// der Form auf Standard, mit Begrenzer wie in der App. Ausgabe: <ordner>/form-<stil>-mit.wav und -ohne.wav, 16 Bit, mono (linker Kanal), 44,1 kHz.
// Dazu je Datei Spitzenpegel, Zahl der Abtastwerte bei Vollaussteuerung und für die Datei mit Form der Pegel (RMS in dB) je Teil.
// Aufruf: node scripts/render-form.mjs [ausgabeordner] [takte]   (Standard: .superpowers/audio-ab und 96)
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STYLES = ['funk', 'psych', 'country'];
const KEYS = { funk: { root: 'A', mode: 'minor' }, psych: { root: 'D', mode: 'minor' }, country: { root: 'G', mode: 'major' } };

const RATE = 44100;
const wav = (bytes) => {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + bytes.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([head, bytes]);
};

/** Läuft im Browser: rendert den Track (mit oder ohne Form) und liefert die Daten als base64 samt Messwerten. */
async function renderInPage([style, key, bars, withForm]) {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const { rollForm } = await import('/core/form-roll.js');
  const seed = 17, OFFSET = 0.1, RATE = 44100; // die Funktion wird serialisiert: keine Werte von außerhalb
  const p = STYLE_PRESETS.find((s) => s.id === style);
  const color = styleChordColor(p, seed, true);
  const track = {
    key, bpm: p.bpm, seed, variety: true, length: bars, tags: structuredClone(p.tags),
    bars: colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), color, key),
    layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
    jobs: { lead: 'melody', percussion: 'mixed' },
  };
  if (withForm) track.form = rollForm({ template: 'auto', style, targetBars: bars, seed, tags: track.tags });
  const events = buildEvents(track);
  const chords = events.filter((e) => e.type === 'chord');
  const total = chords.at(-1).t + (track.bars[0].beats * 60) / track.bpm;
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
  const { output, layers, whenReady } = createInstruments(ctx, { bpm: track.bpm, limiter: true, timbre: resolveTrackTimbre(track), voices: resolveVoices(track) });
  await whenReady();
  output.connect(ctx.destination);
  for (const e of events) if (e.layer) layers[e.layer].trigger(e, OFFSET + e.t);
  const data = (await ctx.startRendering()).getChannelData(0);

  let peak = 0, full = 0, sum = 0;
  const int16 = new Int16Array(data.length);
  data.forEach((x, i) => {
    peak = Math.max(peak, Math.abs(x)); sum += x * x;
    if (Math.abs(x) >= 0.999) full++;
    int16[i] = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
  });
  const db = (a, b) => {
    let s = 0;
    for (let i = Math.round((OFFSET + a) * RATE); i < Math.min(data.length, Math.round((OFFSET + b) * RATE)); i++) s += data[i] * data[i];
    return 10 * Math.log10(s / Math.max(1, Math.round((b - a) * RATE)));
  };
  const marks = events.filter((e) => e.type === 'marker' && e.name === 'section');
  const parts = marks.map((m, i) => ({ kind: m.kind, bars: track.form.sections[i].bars, from: m.bar + 1, db: db(m.t, marks[i + 1]?.t ?? total) }));
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), peak, full, seconds: total, rmsDb: 10 * Math.log10(sum / data.length), parts, template: track.form?.template, sizes: track.form?.sections.map((s) => `${s.type}${s.bars}`).join(' ') };
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const { start } = await import('./serve.js');
  const outDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../.superpowers/audio-ab', import.meta.url)));
  const bars = Number(process.argv[3] ?? 96);
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
    for (const style of STYLES) {
      for (const [label, withForm] of [['mit', true], ['ohne', false]]) {
        const r = await page.evaluate(renderInPage, [style, KEYS[style], bars, withForm]);
        const file = join(outDir, `form-${style}-${label}.wav`);
        await writeFile(file, wav(Buffer.from(r.b64, 'base64')));
        console.log(`${file}  ${r.seconds.toFixed(1)} s  peak ${r.peak.toFixed(3)}${r.peak >= 1 ? ' (VOLL)' : ''}  voll ausgesteuert ${r.full}  rms ${r.rmsDb.toFixed(1)} dB${r.template ? `  Vorlage ${r.template}: ${r.sizes}` : ''}`);
        for (const [i, part] of r.parts.entries()) console.log(`    Teil ${i + 1} ${part.kind.padEnd(6)} ${String(part.bars).padStart(2)} Takte ab ${String(part.from).padStart(2)}  ${part.db.toFixed(1)} dB`);
      }
    }
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  } finally {
    await browser?.close();
    server?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
