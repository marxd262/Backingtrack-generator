// Offline-Render mit Pegelmessung (läuft im Browser). Misst den linken Kanal wie __render in backing-demo.html.
import { buildEvents } from '../core/events.js';
import { resolveTrackTimbre } from '../core/timbre.js';
import { resolveVoices } from '../core/voices.js';
import { LAYER_IDS } from '../core/layers.js';
import { createInstruments } from './synth.js';
import { spectralCentroid } from './spectrum.js';

const SAMPLE_RATE = 44100;
const OFFSET = 0.1; // erste Ereignisse bei 0,1 s
const TAIL = 1; // Ausklang nach dem letzten Ereignis
const LAYERS = LAYER_IDS;
/** Schichten mit Tönen (renderNote); Schlagzeug und Percussion spielen Schläge. */
export const NOTE_LAYERS = LAYERS.filter((l) => l !== 'drums' && l !== 'percussion');
const FIRST = Math.round(SAMPLE_RATE * OFFSET); // Abtastwert des ersten Ereignisses

// Rendert die ersten `seconds` Sekunden eines Tracks (Klang aus seinen Schlagworten), linker Kanal.
// solo: nur diese Schicht hörbar, die anderen stumm geschaltet. mix: { levels, master } wie bei play (Reglerstellungen 0..1).
async function renderLeft(trackInput, seconds, solo, limiter, mix) {
  const events = buildEvents(trackInput); // prüft den Track samt Schlagworten
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * (OFFSET + seconds + TAIL)), SAMPLE_RATE);
  const { output, layers, whenReady } = createInstruments(ctx, { bpm: trackInput.bpm, limiter, timbre: resolveTrackTimbre(trackInput), voices: resolveVoices(trackInput), ...mix });
  await whenReady(); // Sample-Stimmen: erst laden, sonst klänge der Rückfall-Synth
  output.connect(ctx.destination);
  if (solo) for (const name of LAYERS) layers[name].setMuted(name !== solo);
  for (const e of events) if (e.t < seconds && e.layer) layers[e.layer].trigger(e, OFFSET + e.t);
  return (await ctx.startRendering()).getChannelData(0);
}

const rms = (d) => {
  let sum = 0;
  for (const v of d) sum += v * v;
  return d.length ? Math.sqrt(sum / d.length) : 0;
};

// peak und rms über den ganzen Puffer (wie bisher), Schwerpunkt ab dem ersten Ereignis
function levels(d) {
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  return { peak, rms: rms(d), centroid: spectralCentroid(d.subarray(FIRST), SAMPLE_RATE) };
}

/**
 * Rendert die ersten `seconds` Sekunden: Summe und jede Schicht allein (andere stumm geschaltet).
 * `limiter: false` misst die Mischung vor dem Begrenzer. `levels` und `master` setzen das Mischpult (siehe play), `tuning` die Feinwerte der Stimmen.
 */
export async function renderOffline(trackInput, seconds, { limiter = true, levels: layerLevels, master, tuning } = {}) {
  const mix = { levels: layerLevels, master, tuning };
  const perLayer = {};
  for (const name of LAYERS) perLayer[name] = levels(await renderLeft(trackInput, seconds, name, limiter, mix));
  return { ...levels(await renderLeft(trackInput, seconds, undefined, limiter, mix)), perLayer };
}

/**
 * Vergleicht zwei Tracks bei gleicher Länge: mit `layer` nur diese Schicht, sonst die Summe.
 * `levels`, `master` und `tuning` gelten für beide Seiten. diff = rms(a - b) / rms(a) ab dem ersten Ereignis (a ist der Bezug, 0 bei Stille von a); rms und Schwerpunkte ebenfalls ab dort.
 */
export async function compareRenders(trackA, trackB, seconds, { layer, limiter = true, levels: layerLevels, master, tuning } = {}) {
  if (layer !== undefined && !LAYERS.includes(layer)) throw new RangeError(`Unknown layer: ${JSON.stringify(layer)}`);
  const mix = { levels: layerLevels, master, tuning };
  const a = (await renderLeft(trackA, seconds, layer, limiter, mix)).subarray(FIRST);
  const b = (await renderLeft(trackB, seconds, layer, limiter, mix)).subarray(FIRST);
  const rmsA = rms(a);
  return {
    diff: rmsA > 0 ? rms(a.map((v, i) => v - b[i])) / rmsA : 0,
    rmsA,
    rmsB: rms(b),
    centroidA: spectralCentroid(a, SAMPLE_RATE),
    centroidB: spectralCentroid(b, SAMPLE_RATE),
  };
}

/**
 * Rendert eine einzelne Note eines Instruments (linker Kanal, nur diese Schicht hörbar, ohne Begrenzer) für Analyse und Tests.
 * Schlagzeug und Percussion spielen Schläge statt Töne und sind hier nicht erlaubt (RangeError).
 * `voices` (wie track.voices), `tuning` (Feinwerte der Stimmen) und `timbre` (Klangregler) sind optional; fehlend gilt der Standard,
 * nur Echo und Hall stehen auf 0.
 * Die Note beginnt bei 0,05 s, `seconds` ist die Länge des Ergebnisses ab 0.
 */
export async function renderNote(layer, { midi, dur = 0.6, vel = 0.8, seconds = 1.5, voices, tuning, timbre, sampleRate = SAMPLE_RATE } = {}) {
  if (!NOTE_LAYERS.includes(layer)) throw new RangeError(`Unknown layer: ${JSON.stringify(layer)}`);
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * seconds), sampleRate);
  // ohne Echo und Hall, damit die Aufnahme nur die Note enthält (Analyse); ein übergebenes timbre kann sie wieder einschalten
  const sound = { ...timbre, master: { echo: 0, reverb: 0, ...timbre?.master } };
  const { output, layers, whenReady } = createInstruments(ctx, { limiter: false, timbre: sound, voices, tuning });
  await whenReady();
  output.connect(ctx.destination);
  for (const name of LAYERS) layers[name].setMuted(name !== layer);
  layers[layer].trigger({ type: 'note', layer, midi, dur, vel }, 0.05);
  return (await ctx.startRendering()).getChannelData(0);
}
