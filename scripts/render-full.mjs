// Gesamt-Hörtest von "Klang v2" (Entwicklerwerkzeug, niemand kann hier hören: der Nutzer vergleicht die Dateien).
// Je Fall aus ART_CASES ein ganzer Song mit gewürfelter Songform (Vorlage "Auto" des Stils, Ziel 24 oder 32 Takte), alle Schichten außer Lead, alle Stimmen Samples
// (erste Variante, dazu die Stimmen des Falls), Seed 17, mit Begrenzer wie in der App. A = Stand vor Phase 3 aus einem zweiten Arbeitsbaum (git worktree auf
// d06d42c, dem Elternteil von a245e31), B = dieser Arbeitsbaum. Je Fall wird die lautere Seite auf das RMS der leiseren abgesenkt.
// Ausgabe: <ordner>/full-A.wav und full-B.wav (alle Fälle hintereinander, 1 s Stille dazwischen), full.html (Sprungmarke je Teil), dazu je Fall Lautheit vorher und
// nachher, Pegel je Teil und die Takte mit den meisten Artikulationen in B.
// Vorher: git worktree add --detach <basisordner> d06d42c
// Aufruf: node scripts/render-full.mjs <basisordner> [ausgabeordner] [--pack alt=neu,…] [--solo schicht] [--name datei]   (Standard: .superpowers/audio-ab)
//   --pack lenkt auf Seite B Packs um (setPackOverrides, z. B. drums-standard=drums-muldjord: ein neues Pack vor seiner Stimme hören),
//   --solo lässt nur eine Schicht klingen (die Ereignisse bleiben die des ganzen Songs), --name ersetzt "full" in den Dateinamen.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ART_CASES, wav, abPage, decode, measure } from './render-step.mjs';

const RATE = 44100;
const TARGET = { funk: 32, rock: 32, country: 32, blues: 24, dreamy: 24, reggae: 24 };

/** Läuft im Browser beider Stände: nur Schnittstellen, die es vor Phase 3 schon gab. Liefert L/R (base64), Teile und Artikulationen je Takt. */
async function renderInPage([style, bpm, own, target, { packs, solo } = {}]) {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices, setAllVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const { barTimeline, checkedTrack } = await import('/core/timeline.js');
  const { rollForm } = await import('/core/form-roll.js');
  const seed = 17, OFFSET = 0.1, RATE = 44100; // die Funktion wird serialisiert: keine Werte von außerhalb
  const p = STYLE_PRESETS.find((s) => s.id === style);
  const key = { root: 'A', mode: 'minor' };
  const track = {
    key, bpm, seed, variety: true, tags: { ...structuredClone(p.tags), ...own.tags },
    bars: colorProgression((own.chords?.map(([root, quality]) => ({ root, quality })) ?? progressionFor(key, seed)).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key),
    layers: { drums: true, bass: true, chords: true, pad: true, lead: false, percussion: true },
    jobs: { percussion: 'mixed' },
    voices: { ...setAllVoices(null, 'sample'), ...own.voices },
    ...own.track,
  };
  delete track.length; // die Form bestimmt die Länge
  track.form = rollForm({ template: 'auto', style, targetBars: target, seed, tags: track.tags });
  const events = buildEvents(track);
  const total = barTimeline(checkedTrack(track)).at(-1).end;
  const parts = events.filter((e) => e.type === 'marker' && e.name === 'section').map((e) => ({ kind: e.kind, bar: e.bar, t: e.t }));
  const arts = {}; // je Takt: Zahl der Ereignisse mit Artikulation und ihre Arten
  for (const e of events) if (e.art || e.ring) { const b = (arts[e.bar] ??= { t: events.find((c) => c.type === 'chord' && c.bar === e.bar).t, n: 0, kinds: {} }); b.n++; const k = `${e.layer} ${e.art ?? 'ring'}`; b.kinds[k] = (b.kinds[k] ?? 0) + 1; }
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
  if (packs) (await import('/audio/voices/pack-id.js')).setPackOverrides(packs);
  const { output, layers, whenReady, voiceStatus } = createInstruments(ctx, { bpm, limiter: true, timbre: resolveTrackTimbre(track), voices: resolveVoices(track) });
  await whenReady();
  output.connect(ctx.destination);
  for (const e of events) if (e.layer && e.t < total && (!solo || e.layer === solo)) layers[e.layer].trigger(e, OFFSET + e.t);
  const buf = await ctx.startRendering();
  return { parts, arts, total, offset: OFFSET, status: voiceStatus(), chans: [0, 1].map((c) => {
    const bytes = new Uint8Array(buf.getChannelData(c).buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }) };
}

/** RMS (dB) eines Ausschnitts beider Kanäle, Zeiten in Sekunden. */
const rmsDb = ([l, r], from, to) => {
  const a = Math.max(0, Math.round(from * RATE)), b = Math.min(l.length, Math.round(to * RATE));
  let s = 0;
  for (let i = a; i < b; i++) s += l[i] * l[i] + r[i] * r[i];
  return 10 * Math.log10(s / Math.max(1, 2 * (b - a)) + 1e-18);
};
export const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Rendert alle Fälle eines Stands; der Server liefert den src-Ordner des Stands. */
async function renderTree(chromium, tree, options) {
  const { start } = await import(pathToFileURL(join(tree, 'scripts/serve.js')).href);
  let server, browser;
  try {
    server = await start(0);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    await page.goto(`http://localhost:${server.address().port}/ui/render-harness.html`);
    const out = [];
    for (const [style, bpm, own] of ART_CASES) {
      const r = await page.evaluate(renderInPage, [style, bpm, own ?? {}, TARGET[style], options]);
      out.push({ ...r, chans: r.chans.map(decode) });
    }
    if (errors.length) throw new Error(`${tree}: ${errors.join('\n')}`);
    return out;
  } finally {
    await browser?.close();
    server?.close();
  }
}

async function main() {
  const { values: flags, positionals: [baseArg, outArg] } = parseArgs({ allowPositionals: true, options: { pack: { type: 'string' }, solo: { type: 'string' }, name: { type: 'string', default: 'full' } } });
  const base = baseArg && resolve(baseArg);
  if (!base) throw new Error('Aufruf: node scripts/render-full.mjs <basisordner> [ausgabeordner] [--pack alt=neu,…] [--solo schicht] [--name datei]; vorher: git worktree add --detach <basisordner> d06d42c');
  await access(join(base, 'scripts/serve.js'));
  const outDir = resolve(outArg ?? fileURLToPath(new URL('../.superpowers/audio-ab', import.meta.url)));
  await mkdir(outDir, { recursive: true });
  const { chromium } = await import('@playwright/test');
  const packs = flags.pack && Object.fromEntries(flags.pack.split(',').map((pair) => pair.split('=')));
  const sides = { A: await renderTree(chromium, base, { solo: flags.solo }), B: await renderTree(chromium, fileURLToPath(new URL('..', import.meta.url)), { solo: flags.solo, packs }) };
  const name = flags.name;
  for (const [side, cases] of Object.entries(sides)) for (const c of cases) if (Object.values(c.status).some((s) => s === 'error' || s === 'loading')) throw new Error(`${side}: Pack nicht bereit (Synth statt Sample): ${JSON.stringify(c.status)}`);

  const pieces = { A: [], B: [] }, marks = [];
  let at = 0;
  ART_CASES.forEach(([style, bpm], k) => {
    const a = sides.A[k], b = sides.B[k];
    const rms = { A: measure(a.chans).linRms, B: measure(b.chans).linRms }, quiet = Math.min(rms.A, rms.B);
    const len = Math.max(a.chans[0].length, b.chans[0].length);
    for (const [label, side] of [['A', a], ['B', b]]) {
      const scale = quiet / rms[label];
      pieces[label].push(side.chans.map((ch) => { const o = new Float32Array(len + RATE); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * scale; return o; }));
    }
    const db = (x) => 20 * Math.log10(x);
    console.log(`\n${style} ${bpm}: ${b.parts.length} Teile, ${b.total.toFixed(1)} s, ab ${clock(at)}`);
    console.log(`  Lautheit vorher (RMS): A ${db(rms.A).toFixed(1)} dB, B ${db(rms.B).toFixed(1)} dB; nachher beide ${db(quiet).toFixed(1)} dB (${rms.A > rms.B ? 'A' : 'B'} um ${Math.abs(db(rms.A / rms.B)).toFixed(1)} dB abgesenkt)`);
    if (a.parts.map((p) => `${p.kind}${p.bar}`).join() !== b.parts.map((p) => `${p.kind}${p.bar}`).join()) console.log('  ACHTUNG: A und B haben verschiedene Formen');
    b.parts.forEach((p, i) => {
      const to = b.parts[i + 1]?.t ?? b.total;
      const level = (s) => rmsDb(s.chans, b.offset + p.t, b.offset + to).toFixed(1);
      console.log(`  ${clock(at + b.offset + p.t)}  ${p.kind.padEnd(7)} ab Takt ${p.bar + 1}  RMS A ${level(a)}  B ${level(b)} dB (vor dem Angleich)`);
      marks.push([`${style} ${p.kind} ${p.bar + 1}`, at + b.offset + p.t]);
    });
    const dense = Object.entries(b.arts).sort(([, x], [, y]) => y.n - x.n).slice(0, 3);
    console.log(`  dichteste Takte (B): ${dense.map(([bar, d]) => `Takt ${+bar + 1} bei ${clock(at + b.offset + d.t)}: ${d.n} (${Object.entries(d.kinds).sort(([, x], [, y]) => y - x).map(([kk, v]) => `${kk} ${v}`).join(', ')})`).join('; ')}`);
    at += (len + RATE) / RATE;
  });

  for (const label of ['A', 'B']) {
    const total = pieces[label].reduce((n, p) => n + p[0].length, 0), int16 = new Int16Array(total * 2);
    let i = 0, clipped = 0;
    for (const [l, r] of pieces[label]) for (let j = 0; j < l.length; j++, i++) for (const [c, x] of [[0, l[j]], [1, r[j]]]) {
      if (Math.abs(x) > 1) clipped++;
      int16[2 * i + c] = Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    }
    const file = join(outDir, `${name}-${label}.wav`);
    await writeFile(file, wav(Buffer.from(int16.buffer)));
    console.log(`${file}  ${(total / RATE).toFixed(1)} s  übersteuerte Werte ${clipped}`);
  }
  await writeFile(join(outDir, `${name}.html`), abPage(name, marks));
  console.log(`Anhören: ${join(outDir, `${name}.html`)}`);
  console.log(`Sprungmarken für den Hörführer:\n${JSON.stringify(marks.map(([label, t]) => [clock(t), label]))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
