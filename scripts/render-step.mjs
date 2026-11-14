// A/B-Hörprobe je Schritt von "Klang v2" als Stereo-WAV (Entwicklerwerkzeug, niemand kann hier hören: der Nutzer vergleicht die Dateien).
// Je Schritt ein Paar: A = Änderung aus (Feinwerte aus STEPS[n].a), B = Standard von heute (oder STEPS[n].b, wenn die Änderung nicht Standard wurde). Gleicher Seed, gleiche Takte, drei Testfälle
// hintereinander (Rock 120, Funk 100, Psych 90; je 8 Takte, alle Schichten außer Lead, fullFromStart), dazwischen 1 s Stille.
// Die lautere Datei wird auf das RMS der leiseren abgesenkt, damit nicht "lauter" mit "besser" verwechselt wird (Faktor steht in der Ausgabe).
// Ausgabe: <ordner>/step<n>-<thema>-A.wav und -B.wav (16 Bit, stereo, 44,1 kHz), je Fall Messwerte und step<n>-<thema>.html zum Anhören
// (Doppelklick; beide Dateien laufen synchron, Leertaste schaltet um).
// Schritte der Artikulations-Schicht (Phase 3, ab 10) rendern die Fälle aus ART_CASES (Funk, Rock mit Strophe und Refrain, Blues-Shuffle, Ballade).
// Aufruf: node scripts/render-step.mjs <n> [sample|synth] [ausgabeordner]   (Standard: sample, .superpowers/audio-ab)
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Je Schritt: Thema (Dateiname) und die Feinwerte, die die Änderung abschalten (A). Ein neuer Schritt trägt sich hier ein. */
export const STEPS = {
  // Phase 3, Priorität A: 10 = Bass (staccato, legato, dead, slideIn, approach) gegen die Schicht aus; 11 = Rhythmusgitarre dazu, gegen nur Bass
  10: { name: 'bass', cases: 'art', a: { 'mix/art': { on: 0 } }, b: { 'mix/art': { on: 1, chords: 0 } } },
  11: { name: 'guitar', cases: 'art', a: { 'mix/art': { on: 1, chords: 0 } }, b: { 'mix/art': { on: 1 } } },
  // Artikulationen (Vorbereitung Phase 3): keine Regeln, nur eine feste Demo-Verteilung in renderInPage; der Schlüssel 'demo/art' ist kein Feinwert,
  // er lässt in beiden Renders eine Gitarre (FreePats) die Lead-Linie statt der Akkorde spielen und schaltet in B die Artikulationen ein
  7: { name: 'art', a: { 'demo/art': { on: 0 } }, b: { 'demo/art': { on: 1 } } },
  // Frage des Nutzers: braucht der Bend einen mitlaufenden EQ? Beide Seiten mit Artikulationen und über Verzerrer und Box (drive), B dazu mit bendTone (dB je Halbton)
  // Urteil des Nutzers: dem Bend fehlt Sustain. B: zusätzliches Abklingen der Gitarre fast aus (decay 10) und Distortion dazu (verdichtet, hält den Ton)
  9: {
    name: 'sustain', a: { 'demo/art': { on: 1, drive: 0.5, bendTone: 3 } },
    b: { 'demo/art': { on: 1, drive: 0.5, distortion: 0.5, bendTone: 3 }, 'chords/sample/freepats': { decay: 10 } },
  },
  8: { name: 'bendeq', a: { 'demo/art': { on: 1, drive: 0.5, bendTone: 3 } }, b: { 'demo/art': { on: 1, drive: 0.5, bendTone: 9 } } }, // 3 war dem Nutzer zu schwach
  1: { name: 'bus', a: { 'mix/bus': { on: 0 } }, b: { 'mix/bus': { on: 1 } } }, // Urteil: A (alter Begrenzer) bleibt Standard
  6: { name: 'strum', a: { 'chords/sample/guitar': { strumUp: 0, strumTilt: 0 } } },
  5: {
    name: 'human',
    a: {
      'drums/sample/standard': { humanCents: 0, humanDb: 0, layerSpread: 0, choke: 0 },
      'percussion/sample/studio': { humanCents: 0, humanDb: 0, layerSpread: 0 },
      'bass/sample/finger': { velExp: 1, softHz: 20000, humanCents: 0, humanDb: 0 },
    },
  },
  4: { name: 'groove', a: { 'mix/timing': { amount: 0, tight: 1 } } },
  3: { name: 'room', a: { 'mix/room': { wet: 0 } } },
  2: { name: 'pan', a: { 'mix/pan': { chords: 0, pad: 0, percussion: 0, kit: 0 } } },
};
export const CASES = [['rock', 120], ['funk', 100], ['psych', 90]];
// Testfälle aus SPIELREGELN.md, auf die App abgebildet (SPEC_PHASE3 Abschnitt 8): [Stil, BPM, Zusätze]. Zusätze: track (Felder über den Standard),
// tags (über die des Stils), voices (über "All samples"), chords (Akkordfolge statt der gewürfelten). Blues: Moll-Blues über 12 Takte im 12/8-Shuffle;
// Rock mit Pick-Bass (Vorschlag aus Frage 16); Ballade mit Arpeggio auf der Stahlsaiten-Gitarre, damit die Gitarren-Regeln greifen
const BLUES_12 = ['A', 'A', 'A', 'A', 'D', 'D', 'A', 'A', 'E', 'D', 'A', 'E'].map((root) => [root, root === 'E' ? 'maj' : 'min']);
export const ART_CASES = [
  ['funk', 100, {}],
  ['rock', 120, { track: { form: { sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4 }] } }, voices: { bass: { id: 'sample', variant: 'pick' } } }],
  ['blues', 90, { track: { meter: [12, 8], groove: 'shuffle', length: 12 }, chords: BLUES_12 }],
  ['dreamy', 70, { tags: { synths: ['arpeggio', 'widePad', 'warm'] }, voices: { chords: { id: 'sample', variant: 'steel' } } }],
];

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
async function renderInPage([style, bpm, kind, tuning, limiter, extra]) {
  extra ??= {}; // die alten Schritte haben keine Zusätze
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices, setAllVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const { barTimeline, checkedTrack } = await import('/core/timeline.js');
  const seed = 17, OFFSET = 0.1, RATE = 44100, BARS = 8; // die Funktion wird serialisiert: keine Werte von außerhalb
  const p = STYLE_PRESETS.find((s) => s.id === style);
  const key = { root: 'A', mode: 'minor' };
  const track = {
    key, bpm, seed, variety: true, length: BARS, tags: { ...structuredClone(p.tags), development: ['fullFromStart'], ...extra.tags },
    bars: colorProgression((extra.chords?.map(([root, quality]) => ({ root, quality })) ?? progressionFor(key, seed)).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key),
    layers: { drums: true, bass: true, chords: true, pad: true, lead: false, percussion: true },
    jobs: { percussion: 'mixed' },
    voices: { ...setAllVoices(null, kind), ...extra.voices },
    ...extra.track,
  };
  const demo = tuning['demo/art'];
  if (demo) { track.layers.lead = true; track.jobs.lead = 'melody'; track.voices.chords = { id: 'sample', variant: 'freepats' }; }
  const events = buildEvents(track, { timing: tuning['mix/timing'], ornaments: tuning['mix/art'] });
  if (demo) { // die Lead-Linie spielt eine Gitarre (Bends sind eine Gitarren-Technik): Lead-Noten auf die Akkord-Schicht legen, die Akkorde selbst entfallen
    for (let i = events.length - 1; i >= 0; i--) if (events[i].layer === 'chords') events.splice(i, 1);
    for (const e of events) if (e.layer === 'lead') e.layer = 'chords';
  }
  if (demo?.on) {
    // Demo, keine Spielregel: Bass kurze Noten dead, kleiner Schritt aufwärts hammer, sonst jede vierte Note slide; Lead lange Noten abwechselnd bend und vibrato, sonst jede dritte slide
    for (const layer of ['bass', 'chords']) {
      const notes = events.filter((e) => e.layer === layer && e.type === 'note');
      notes.forEach((e, i) => {
        const step = i ? e.midi - notes[i - 1].midi : 0;
        if (layer === 'bass') e.art = e.dur < 0.13 ? 'dead' : step === 1 || step === 2 ? 'hammer' : i % 4 === 3 ? 'slideIn' : undefined;
        else { e.art = e.dur >= 0.45 ? (i % 2 ? 'bend' : 'vibrato') : i % 3 === 2 ? 'slideIn' : undefined; e.artTone = demo.bendTone; }
      });
    }
  }
  const total = barTimeline(checkedTrack(track)).at(-1).end;
  const arts = {}; // Zählung für die Ausgabe: wie oft welche Artikulation je Schicht vorkommt (Akkordtöne einzeln)
  for (const e of events) if (e.art || e.ring) { const k = `${e.layer} ${e.art ?? 'ring'}`; arts[k] = (arts[k] ?? 0) + 1; }
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
  const { output, layers, whenReady } = createInstruments(ctx, { bpm, limiter, timbre: demo?.drive ? { ...resolveTrackTimbre(track), chords: { ...resolveTrackTimbre(track).chords, overdrive: demo.drive, distortion: demo.distortion ?? 0 } } : resolveTrackTimbre(track), voices: resolveVoices(track), tuning });
  await whenReady();
  output.connect(ctx.destination);
  for (const e of events) if (e.layer && e.t < total) layers[e.layer].trigger(e, OFFSET + e.t);
  const buf = await ctx.startRendering();
  return { arts, chans: [0, 1].map((c) => {
    const bytes = new Uint8Array(buf.getChannelData(c).buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }) };
}

/** Hörseite zum Paar: beide Dateien laufen synchron, nur eine ist hörbar; Leertaste schaltet ohne Unterbrechung um. */
const abPage = (base, starts) => {
  const jumps = starts.map(([label, at]) => `<button onclick="seek(${at.toFixed(1)})">${label}</button>`).join(' ');
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
    const cases = step.cases === 'art' ? ART_CASES : CASES;
    for (const [style, bpm, extra] of cases) {
      const pres = [];
      for (const tuning of [step.a, step.b ?? {}]) pres.push((await page.evaluate(renderInPage, [style, bpm, kind, tuning, false, extra])).chans.map(decode));
      // was die Änderung hinzufügt oder wegnimmt: RMS von (B - A) gegen A, vor der Summenkette (dort ist die Mischung linear)
      let diff = 0, ref = 0;
      for (let i = 0; i < pres[0][0].length; i++) for (const c of [0, 1]) { diff += (pres[1][c][i] - pres[0][c][i]) ** 2; ref += pres[0][c][i] ** 2; }
      console.log(`${style} ${bpm} (${kind})  vor der Summe (B): ${fmt(measure(pres[1]))}  Unterschied B-A ${(10 * Math.log10(diff / ref + 1e-12)).toFixed(1)} dB`);
      for (const [label, tuning] of [['A', step.a], ['B', step.b ?? {}]]) {
        const { chans: raw, arts } = await page.evaluate(renderInPage, [style, bpm, kind, tuning, true, extra]), chans = raw.map(decode);
        sides[label].push(chans);
        console.log(`  ${label}: ${fmt(measure(chans))}${Object.keys(arts).length ? `  Artikulationen: ${Object.entries(arts).sort().map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`);
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
    let at = 0; // Sprungmarken der Hörseite: Beginn jedes Falls in der zusammengesetzten Datei
    const starts = cases.map(([style, bpm], k) => { const mark = [`${style} ${bpm}`, at]; at += sides.A[k][0].length / RATE + 1; return mark; });
    await writeFile(html, abPage(`step${n}-${step.name}`, starts));
    console.log(`Anhören: ${html}`);
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  } finally {
    await browser?.close();
    server?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
