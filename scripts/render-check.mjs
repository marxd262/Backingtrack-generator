// Klangvergleich A = develop, B = dieser Branch: rendert denselben Track offline (Standardstimmen = Samples, alle Schichten, Songform,
// Begrenzer wie in der App) in beiden Ständen und vergleicht die Abtastwerte beider Kanäle. B wird zweimal gerendert: ohne Angabe und
// mit den Pan-Werten, die die App jetzt übergibt (Standard). Der Offline-Render ist nicht bitgenau wiederholbar (zwei Läufe von A weichen
// um etwa 1e-5 ab, gemessen 2026-11-15), darum gilt: gleich viele Ereignisse und Abweichung höchstens 2e-4 (-74 dB), also in der Streuung zweier Läufe.
// Aufruf: node scripts/render-check.mjs <ordner des develop-Arbeitsbaums>   (vorher: git worktree add --detach ../bt-develop develop)
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function renderInPage(mode) {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const { rollForm } = await import('/core/form-roll.js');
  const out = {};
  for (const [style, key] of [['funk', { root: 'A', mode: 'minor' }], ['psych', { root: 'D', mode: 'minor' }], ['country', { root: 'G', mode: 'major' }]]) {
    const seed = 17, OFFSET = 0.1, RATE = 44100, bars = 16;
    const p = STYLE_PRESETS.find((s) => s.id === style);
    const track = {
      key, bpm: p.bpm, seed, variety: true, length: bars, tags: structuredClone(p.tags),
      bars: colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key),
      layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
      jobs: { lead: 'melody', percussion: 'mixed' },
    };
    track.form = rollForm({ template: 'auto', style, targetBars: 24, seed, tags: track.tags });
    const events = buildEvents(track);
    const total = events.filter((e) => e.type === 'chord').at(-1).t + (track.bars[0].beats * 60) / track.bpm;
    const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
    const options = { bpm: track.bpm, limiter: true, timbre: resolveTrackTimbre(track), voices: resolveVoices(track) };
    if (mode === 'pans') options.pans = (await import('/ui/mix-state.js')).DEFAULT_PAN;
    const inst = createInstruments(ctx, options);
    await inst.whenReady();
    inst.output.connect(ctx.destination);
    for (const e of events) if (e.layer) inst.layers[e.layer].trigger(e, OFFSET + e.t);
    const buffer = await ctx.startRendering();
    // beide Kanäle als Bytes -> base64 (Vergleich außerhalb)
    const bytes = new Uint8Array(buffer.length * 8);
    bytes.set(new Uint8Array(buffer.getChannelData(0).buffer.slice(0)), 0);
    bytes.set(new Uint8Array(buffer.getChannelData(1).buffer.slice(0)), buffer.length * 4);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out[style] = { b64: btoa(s), events: events.length, status: inst.voiceStatus() };
  }
  return out;
}

const servers = [];
async function serve(root) {
  const { start } = await import(pathToFileURL(resolve(root, 'scripts/serve.js')).href);
  const server = await start(0);
  servers.push(server);
  return `http://localhost:${server.address().port}/ui/render-harness.html`;
}
const browser = await chromium.launch();
async function render(url, mode) {
  const page = await browser.newPage();
  await page.goto(url);
  const result = await page.evaluate(renderInPage, mode);
  await page.close();
  return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { ...v, data: new Float32Array(Uint8Array.from(Buffer.from(v.b64, 'base64')).buffer) }]));
}
const a = await serve(process.argv[2]);
const b = await serve('.');
const runs = { 'A develop': await render(a), 'A develop (2. Lauf)': await render(a), 'B Branch': await render(b), 'B Branch mit Pan der App': await render(b, 'pans') };
const ref = runs['A develop'];
let bad = false;
for (const [name, run] of Object.entries(runs)) {
  for (const [style, r] of Object.entries(run)) {
    const x = ref[style].data;
    let max = 0;
    for (let i = 0; i < Math.max(x.length, r.data.length); i++) max = Math.max(max, Math.abs((x[i] ?? 0) - (r.data[i] ?? 0)));
    const ready = Object.values(r.status).every((s) => s === 'ready');
    if (max > 2e-4 || r.events !== ref[style].events || !ready) bad = true;
    console.log(`${name.padEnd(26)} ${style.padEnd(8)} Ereignisse ${r.events}  Abtastwerte ${r.data.length}  größte Abweichung zu A ${max.toExponential(1)} (${max ? (20 * Math.log10(max)).toFixed(0) : '-inf'} dB)  Packs ${ready ? 'bereit' : JSON.stringify(r.status)}`);
  }
}
console.log(bad ? 'UNTERSCHIED' : 'GLEICH (innerhalb der Streuung zweier Läufe)');
await browser.close();
for (const s of servers) s.close();
process.exit(bad ? 1 : 0);
