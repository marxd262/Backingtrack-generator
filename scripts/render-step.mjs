// A/B-Hörprobe je Schritt von "Klang v2" als Stereo-WAV (Entwicklerwerkzeug, niemand kann hier hören: der Nutzer vergleicht die Dateien).
// Je Schritt ein Paar: A = Änderung aus (Feinwerte aus STEPS[n].a), B = Standard von heute (oder STEPS[n].b, wenn die Änderung nicht Standard wurde). Gleicher Seed, gleiche Takte, drei Testfälle
// hintereinander (Rock 120, Funk 100, Psych 90; je 8 Takte, alle Schichten außer Lead, fullFromStart), dazwischen 1 s Stille.
// Die lautere Datei wird auf das RMS der leiseren abgesenkt, damit nicht "lauter" mit "besser" verwechselt wird (Faktor steht in der Ausgabe).
// Ausgabe: <ordner>/step<n>-<thema>-A.wav und -B.wav (16 Bit, stereo, 44,1 kHz), je Fall Messwerte und step<n>-<thema>.html zum Anhören
// (Doppelklick; beide Dateien laufen synchron, Leertaste schaltet um).
// Aufruf: node scripts/render-step.mjs <n> [sample|synth] [ausgabeordner]   (Standard: sample, .superpowers/audio-ab)
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Je Schritt: Thema (Dateiname) und die Feinwerte, die die Änderung abschalten (A). Ein neuer Schritt trägt sich hier ein. */
export const STEPS = {
  1: { name: 'bus', a: { 'mix/bus': { on: 0 } }, b: { 'mix/bus': { on: 1 } } }, // Urteil: A (alter Begrenzer) bleibt Standard
  5: {
    name: 'human', a: {},
    b: {
      'drums/sample/standard': { humanCents: 6, humanDb: 0.7, layerSpread: 0.08, choke: 1 },
      'percussion/sample/studio': { humanCents: 6, humanDb: 0.7 },
      'bass/sample/finger': { velExp: 1.3, softHz: 2500, humanCents: 1.5, humanDb: 0.6 },
    },
  },
  4: { name: 'groove', a: { 'mix/timing': { amount: 0, tight: 1 } } },
  3: { name: 'room', a: { 'mix/room': { wet: 0 } } },
  2: { name: 'pan', a: { 'mix/pan': { chords: 0, pad: 0, percussion: 0, kit: 0 } } },
};
export const CASES = [['rock', 120], ['funk', 100], ['psych', 90]];

const RATE = 44100;
const wav = (bytes) => {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + bytes.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([head, bytes]);
};

/** Läuft im Browser: rendert einen Fall mit den Feinwerten `tuning` (limiter false: Mischung vor der Summenkette), liefert L/R als base64 (Float32). */
async function renderInPage([style, bpm, kind, tuning, limiter]) {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices, setAllVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const seed = 17, OFFSET = 0.1, RATE = 44100, BARS = 8; // die Funktion wird serialisiert: keine Werte von außerhalb
  const p = STYLE_PRESETS.find((s) => s.id === style);
  const key = { root: 'A', mode: 'minor' };
  const track = {
    key, bpm, seed, variety: true, length: BARS, tags: { ...structuredClone(p.tags), development: ['fullFromStart'] },
    bars: colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key),
    layers: { drums: true, bass: true, chords: true, pad: true, lead: false, percussion: true },
    jobs: { percussion: 'mixed' },
    voices: setAllVoices(null, kind),
  };
  const events = buildEvents(track, { timing: tuning['mix/timing'] });
  const total = (BARS * 4 * 60) / bpm;
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
  const { output, layers, whenReady } = createInstruments(ctx, { bpm, limiter, timbre: resolveTrackTimbre(track), voices: resolveVoices(track), tuning });
  await whenReady();
  output.connect(ctx.destination);
  for (const e of events) if (e.layer && e.t < total) layers[e.layer].trigger(e, OFFSET + e.t);
  const buf = await ctx.startRendering();
  return [0, 1].map((c) => {
    const bytes = new Uint8Array(buf.getChannelData(c).buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
}

/** Hörseite zum Paar: beide Dateien laufen synchron, nur eine ist hörbar; Leertaste schaltet ohne Unterbrechung um. */
const abPage = (base) => {
  let at = 0;
  const jumps = CASES.map(([style, bpm]) => { const b = `<button onclick="seek(${at.toFixed(1)})">${style} ${bpm}</button>`; at += 0.1 + (8 * 4 * 60) / bpm + 2 + 1; return b; }).join(' '); // 8 Takte wie BARS in renderInPage
  return `<!doctype html><meta charset="utf-8"><title>${base}</title>
<style>body{font:16px system-ui;max-width:640px;margin:40px auto}#now{font-size:96px;font-weight:700;margin:16px 0}button{font-size:16px;padding:8px 14px}input{width:100%}</style>
<h1>${base}</h1><div id="now">A</div>
<p><button id="play">Start / Pause</button> <button id="toggle">A / B umschalten (Leertaste)</button></p>
<p>${jumps}</p><input id="pos" type="range" min="0" max="1" step="0.001" value="0">
<audio id="a" src="${base}-A.wav" preload="auto"></audio><audio id="b" src="${base}-B.wav" preload="auto" muted></audio>
<script>
const a = document.getElementById('a'), b = document.getElementById('b'), pos = document.getElementById('pos'), now = document.getElementById('now');
const seek = (t) => { a.currentTime = b.currentTime = t; };
const toggle = () => { b.currentTime = a.currentTime; a.muted = !a.muted; b.muted = !a.muted; now.textContent = a.muted ? 'B' : 'A'; };
document.getElementById('play').onclick = () => { if (a.paused) { b.currentTime = a.currentTime; a.play(); b.play(); } else { a.pause(); b.pause(); } };
document.getElementById('toggle').onclick = toggle;
addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
a.ontimeupdate = () => { pos.value = a.currentTime / a.duration || 0; };
pos.oninput = () => seek(pos.value * a.duration);
</script>`;
};

const decode = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
/** Spitze, RMS, Crest (dB, beide Kanäle) und Seite/Mitte (dB; -inf = mono). */
export function measure([l, r]) {
  let peak = 0, sum = 0, mid = 0, side = 0;
  for (let i = 0; i < l.length; i++) {
    peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); sum += l[i] * l[i] + r[i] * r[i];
    mid += (l[i] + r[i]) ** 2; side += (l[i] - r[i]) ** 2;
  }
  const rms = Math.sqrt(sum / (2 * l.length));
  return { peak: db(peak), rms: db(rms), crest: db(peak / rms), sideMid: db(Math.sqrt(side / mid)), linRms: rms };
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const { start } = await import('./serve.js');
  const n = process.argv[2], step = STEPS[n];
  if (!step) throw new Error(`Unbekannter Schritt ${n}; bekannt: ${Object.keys(STEPS).join(', ')}`);
  const kind = process.argv[3] ?? 'sample';
  const outDir = resolve(process.argv[4] ?? fileURLToPath(new URL('../.superpowers/audio-ab', import.meta.url)));
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
    const sides = { A: [], B: [] };
    const fmt = (m) => `Spitze ${m.peak.toFixed(1)}  RMS ${m.rms.toFixed(1)}  Crest ${m.crest.toFixed(1)}  Seite/Mitte ${m.sideMid.toFixed(1)} dB`;
    for (const [style, bpm] of CASES) {
      const pres = [];
      for (const tuning of [step.a, step.b ?? {}]) pres.push((await page.evaluate(renderInPage, [style, bpm, kind, tuning, false])).map(decode));
      // was die Änderung hinzufügt oder wegnimmt: RMS von (B - A) gegen A, vor der Summenkette (dort ist die Mischung linear)
      let diff = 0, ref = 0;
      for (let i = 0; i < pres[0][0].length; i++) for (const c of [0, 1]) { diff += (pres[1][c][i] - pres[0][c][i]) ** 2; ref += pres[0][c][i] ** 2; }
      console.log(`${style} ${bpm} (${kind})  vor der Summe (B): ${fmt(measure(pres[1]))}  Unterschied B-A ${(10 * Math.log10(diff / ref + 1e-12)).toFixed(1)} dB`);
      for (const [label, tuning] of [['A', step.a], ['B', step.b ?? {}]]) {
        const chans = (await page.evaluate(renderInPage, [style, bpm, kind, tuning, true])).map(decode);
        sides[label].push(chans);
        console.log(`  ${label}: ${fmt(measure(chans))}`);
      }
    }
    // je Seite alle Fälle hintereinander (1 s Stille), dann die lautere Seite auf das RMS der leiseren absenken
    const joined = Object.fromEntries(Object.entries(sides).map(([label, cases]) => [label, [0, 1].map((c) => {
      const out = new Float32Array(cases.reduce((len, ch) => len + ch[c].length + RATE, 0));
      let at = 0;
      for (const ch of cases) { out.set(ch[c], at); at += ch[c].length + RATE; }
      return out;
    })]));
    const rms = { A: measure(joined.A).linRms, B: measure(joined.B).linRms }, quiet = Math.min(rms.A, rms.B);
    for (const label of ['A', 'B']) {
      const scale = quiet / rms[label], [l, r] = joined[label], int16 = new Int16Array(l.length * 2);
      let clipped = 0;
      for (let i = 0; i < l.length; i++) {
        for (const [c, x] of [[0, l[i] * scale], [1, r[i] * scale]]) {
          if (Math.abs(x) > 1) clipped++;
          int16[2 * i + c] = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
        }
      }
      const file = join(outDir, `step${n}-${step.name}-${label}.wav`);
      await writeFile(file, wav(Buffer.from(int16.buffer)));
      console.log(`${file}  ${(l.length / RATE).toFixed(1)} s  Pegelangleich ${db(scale).toFixed(1)} dB  übersteuerte Werte ${clipped}`);
    }
    const html = join(outDir, `step${n}-${step.name}.html`);
    await writeFile(html, abPage(`step${n}-${step.name}`));
    console.log(`Anhören: ${html}`);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  } finally {
    await browser?.close();
    server?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
