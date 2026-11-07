// Offline-Render mit Pegelmessung (läuft im Browser). Misst den linken Kanal wie __render in backing-demo.html.
import { buildEvents } from '../core/events.js';
import { createInstruments } from './synth.js';

const SAMPLE_RATE = 44100;
const OFFSET = 0.1; // erste Ereignisse bei 0,1 s
const TAIL = 1; // Ausklang nach dem letzten Ereignis
const LAYERS = ['drums', 'bass', 'chords', 'pad'];

async function measure(events, bpm, seconds, solo) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * (OFFSET + seconds + TAIL)), SAMPLE_RATE);
  const { output, layers } = createInstruments(ctx, { bpm });
  output.connect(ctx.destination);
  if (solo) for (const name of LAYERS) layers[name].setMuted(name !== solo);
  for (const e of events) if (e.t < seconds && e.layer) layers[e.layer].trigger(e, OFFSET + e.t);
  const d = (await ctx.startRendering()).getChannelData(0);
  let peak = 0, sum = 0;
  for (const v of d) {
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / d.length) };
}

/** Rendert die ersten `seconds` Sekunden: Summe und jede Schicht allein (andere stumm geschaltet). */
export async function renderOffline(trackInput, seconds) {
  const events = buildEvents(trackInput);
  const { bpm } = trackInput;
  const perLayer = {};
  for (const name of LAYERS) perLayer[name] = await measure(events, bpm, seconds, name);
  return { ...(await measure(events, bpm, seconds)), perLayer };
}
