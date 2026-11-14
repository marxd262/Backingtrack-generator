// A/B-Hörproben der Tonewheel-Orgel (chords/organ/<preset>) als Stereo-WAV; Ablauf, Messwerte und Hörseite kommen aus render-step.mjs.
// Fälle: Blues-Shuffle 90 (Preset jazz), Rock 120 mit Strophe und Refrain (rock), Ballade 70 (ballad). Band: Schlagzeug, Bass, Orgel, Percussion;
// ohne Pad, weil eine Streicherfläche in derselben Lage die Orgel verdeckt. Eine Seite ist { voice, tuning, solo }: voice ersetzt die Orgel
// (A in Schritt o1: das Orgel-Sample), tuning sind Feinwerte der Orgel-Variante des Falls, solo rendert nur die Akkord-Schicht.
// Aufruf: node scripts/render-organ.mjs <schritt> [sample|synth] [ausgabeordner]   (Schritte: o1, o2, level; Standard: sample, .superpowers/audio-ab)
// Der Server läuft auf einem freien Port (start(0)), nicht auf 4173: das Skript stört keinen zweiten Arbeitsordner.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ART_CASES, main } from './render-step.mjs';

const pick = (style, preset) => { const [, bpm, own] = ART_CASES.find(([s]) => s === style); return [style, bpm, { ...own, preset }]; };
// die Ballade ohne die Zusätze aus ART_CASES (Arpeggio und Stahlsaiten-Gitarre waren für die Gitarren-Regeln gedacht)
export const CASES = [pick('blues', 'jazz'), pick('rock', 'rock'), ['dreamy', 70, { preset: 'ballad' }]];
const SAMPLE = { id: 'sample', variant: 'organ' };

// Feinwerte, die alles nach dem Grundklang abschalten; only(...) lässt die genannten Schritte auf ihrem Standard
const OFF = { click: 0, perc: 0, leslie: 0, drive: 0, swell: 0 };
const only = (...on) => Object.fromEntries(Object.entries(OFF).filter(([name]) => !on.includes(name)));

export const STEPS = {
  // Schritt 1, Grundklang: A = Orgel-Sample (chords/sample/organ), B = Tonewheel-Synth
  o1: { name: 'tonewheel', a: { voice: SAMPLE }, b: { tuning: only() } },
  // Schritt 2, Key-Click und Percussion: A = ohne, B = mit (Percussion hat nur das Preset jazz an, also der Blues)
  o2: { name: 'click', a: { tuning: only() }, b: { tuning: only('click', 'perc') } },
  // Pegelmessung, keine Hörprobe: Akkord-Schicht allein; die Zeile "RMS A … B …" (dB, vor der Summe) ergibt level = 10 ** ((A - B) / 20)
  level: { name: 'level', cases: [...CASES, pick('rock', 'gospel')], a: { voice: SAMPLE, solo: true }, b: { solo: true, tuning: { ...only(), level: 1 } } },
};

/** Läuft im Browser (wird serialisiert: keine Werte von außerhalb): rendert einen Fall, liefert L/R als base64 (Float32) und Zählungen der Akkord-Schicht. */
async function renderOrgan([style, bpm, kind, side, limiter, extra]) {
  const { buildEvents } = await import('/core/events.js');
  const { resolveTrackTimbre } = await import('/core/timbre.js');
  const { resolveVoices, setAllVoices } = await import('/core/voices.js');
  const { createInstruments } = await import('/audio/synth.js');
  const { STYLE_PRESETS, styleChordColor } = await import('/core/tags.js');
  const { progressionFor } = await import('/core/progressions.js');
  const { colorProgression } = await import('/core/harmony.js');
  const { barTimeline, checkedTrack } = await import('/core/timeline.js');
  const seed = 17, OFFSET = 0.1, RATE = 44100;
  const p = STYLE_PRESETS.find((s) => s.id === style);
  const key = { root: 'A', mode: 'minor' };
  const track = {
    key, bpm, seed, variety: true, length: 8, tags: { ...structuredClone(p.tags), development: ['fullFromStart'], ...extra.tags },
    bars: colorProgression((extra.chords?.map(([root, quality]) => ({ root, quality })) ?? progressionFor(key, seed)).map((chord) => ({ chord, beats: 4 })), styleChordColor(p, seed, true), key),
    layers: { drums: !side.solo, bass: !side.solo, chords: true, pad: false, lead: false, percussion: !side.solo },
    jobs: { percussion: 'mixed' },
    voices: { ...setAllVoices(null, kind), ...extra.voices, chords: side.voice ?? { id: 'organ', variant: extra.preset } },
    ...extra.track,
  };
  const events = buildEvents(track);
  const total = barTimeline(checkedTrack(track)).at(-1).end;
  const arts = {}; // Zählung für die Ausgabe: Töne der Akkord-Schicht, davon mit Artikulation und mit schnellem Leslie
  for (const e of events) {
    if (e.layer !== 'chords' || e.type !== 'note') continue;
    for (const k of ['Töne', e.art, e.leslie && 'leslie schnell']) if (k) arts[k] = (arts[k] ?? 0) + 1;
  }
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * (OFFSET + total + 2)), RATE);
  const tuning = { [`chords/organ/${extra.preset}`]: side.tuning ?? {} };
  const { output, layers, whenReady } = createInstruments(ctx, { bpm, limiter, timbre: resolveTrackTimbre(track), voices: resolveVoices(track), tuning });
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(STEPS, renderOrgan, (step) => step.cases ?? CASES);
