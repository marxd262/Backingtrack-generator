// Offline-Render mit Pegelmessung (läuft im Browser). Misst den linken Kanal wie __render in backing-demo.html.
import { buildEvents } from '../core/events.js';
import { resolveTimbre } from '../core/timbre.js';
import { createInstruments } from './synth.js';
import { spectralCentroid } from './spectrum.js';

const SAMPLE_RATE = 44100;
const OFFSET = 0.1; // erste Ereignisse bei 0,1 s
const TAIL = 1; // Ausklang nach dem letzten Ereignis
const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const FIRST = Math.round(SAMPLE_RATE * OFFSET); // Abtastwert des ersten Ereignisses

// Rendert die ersten `seconds` Sekunden eines Tracks (Klang aus seinen Schlagworten), linker Kanal.
// solo: nur diese Schicht hörbar, die anderen stumm geschaltet.
async function renderLeft(trackInput, seconds, solo, limiter) {
  const events = buildEvents(trackInput); // prüft den Track samt Schlagworten
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * (OFFSET + seconds + TAIL)), SAMPLE_RATE);
  const { output, layers } = createInstruments(ctx, { bpm: trackInput.bpm, limiter, timbre: resolveTimbre(trackInput.tags) });
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
 * `limiter: false` misst die Mischung vor dem Begrenzer.
 */
export async function renderOffline(trackInput, seconds, { limiter = true } = {}) {
  const perLayer = {};
  for (const name of LAYERS) perLayer[name] = levels(await renderLeft(trackInput, seconds, name, limiter));
  return { ...levels(await renderLeft(trackInput, seconds, undefined, limiter)), perLayer };
}

/**
 * Vergleicht zwei Tracks bei gleicher Länge: mit `layer` nur diese Schicht, sonst die Summe.
 * diff = rms(a - b) / rms(a) ab dem ersten Ereignis (a ist der Bezug, 0 bei Stille von a); rms und Schwerpunkte ebenfalls ab dort.
 */
export async function compareRenders(trackA, trackB, seconds, { layer, limiter = true } = {}) {
  if (layer !== undefined && !LAYERS.includes(layer)) throw new RangeError(`Unknown layer: ${JSON.stringify(layer)}`);
  const a = (await renderLeft(trackA, seconds, layer, limiter)).subarray(FIRST);
  const b = (await renderLeft(trackB, seconds, layer, limiter)).subarray(FIRST);
  const rmsA = rms(a);
  return {
    diff: rmsA > 0 ? rms(a.map((v, i) => v - b[i])) / rmsA : 0,
    rmsA,
    rmsB: rms(b),
    centroidA: spectralCentroid(a, SAMPLE_RATE),
    centroidB: spectralCentroid(b, SAMPLE_RATE),
  };
}
