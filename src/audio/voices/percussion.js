// Klangerzeugung der Percussion (synth/classic): Schläge nach Namen (PERCUSSION_NAMES in core/events.js), Anschlagstärke e.vel skaliert den Pegel.
// Gleiche Bausteine wie das Schlagzeug (Rauschpuffer, Filter, adsr); unbekannte Namen und Nicht-Schläge bleiben stumm.
import { adsr, osc } from '../nodes.js';

/**
 * Percussion-Stimme: (out, t, e) => void. `noise` ist der gemeinsame Rauschpuffer der Instrumente (deps.noise).
 * Abklingzeiten liegen unter einer Sekunde (der Rauschpuffer ist 1 s lang).
 */
export function percussionVoice(ctx, { noise }) {
  // gefilterter Rauschstoß: type/freq/q des Filters, Anstieg a, Spitze peak, Abklingen decay
  const burst = (out, t, { type, freq, q = 1, a = 0.001, peak, decay }) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); adsr(g, t, a, peak, 0, decay);
    n.connect(f).connect(g).connect(out); n.start(t); n.stop(t + a + decay + 0.02);
  };
  // abklingender Ton, optional mit Tonhöhenfall von drop * freq auf freq in der Zeit fall (Fellanschlag)
  const tone = (out, t, { type = 'sine', freq, drop = 1, fall = 0.03, peak, decay }) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq * drop, t); o.frequency.exponentialRampToValueAtTime(freq, t + fall);
    const g = ctx.createGain(); adsr(g, t, 0.001, peak, 0, decay);
    o.connect(g).connect(out); o.start(t); o.stop(t + decay + 0.02);
  };
  // Trommel (Conga, Bongo): Körper plus kurzer Rauschklick
  const drum = (freq, type, decay) => (out, t, v) => {
    tone(out, t, { type, freq, drop: 1.15, peak: v * 0.9, decay });
    burst(out, t, { type: 'bandpass', freq: 1800, q: 0.8, peak: v * 0.35, decay: 0.012 });
  };
  // zwei oder mehr Teiltöne gleichzeitig, danach gemeinsam abgeklungen
  const partials = (out, t, { type, freqs, peak, decay, filter }) => {
    const g = ctx.createGain(); adsr(g, t, 0.001, peak, 0, decay);
    let dest = g;
    if (filter) {
      const f = ctx.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q;
      f.connect(g); dest = f;
    }
    g.connect(out);
    for (const freq of freqs) osc(ctx, type, freq, 0, dest, t, t + decay + 0.02);
  };

  const voices = {
    shaker: (out, t, v) => burst(out, t, { type: 'bandpass', freq: 7000, q: 0.7, a: 0.012, peak: v * 0.8, decay: 0.07 }),
    tambourine: (out, t, v) => {
      burst(out, t, { type: 'highpass', freq: 6000, a: 0.002, peak: v * 0.6, decay: 0.13 });
      // Schellen: drei gegeneinander verstimmte Rechtecke, oben gefiltert
      partials(out, t, { type: 'square', freqs: [5200, 6900, 8300], peak: v * 0.06, decay: 0.15, filter: { type: 'highpass', freq: 4500, q: 0.7 } });
    },
    congaHigh: drum(330, 'sine', 0.28),
    congaLow: drum(220, 'sine', 0.34),
    bongoHigh: drum(450, 'triangle', 0.18),
    bongoLow: drum(320, 'triangle', 0.22),
    // Kuhglocke: zwei verstimmte Rechtecke durch ein Bandpassfilter
    cowbell: (out, t, v) => partials(out, t, { type: 'square', freqs: [540, 800], peak: v * 0.5, decay: 0.3, filter: { type: 'bandpass', freq: 670, q: 1.2 } }),
    claves: (out, t, v) => partials(out, t, { type: 'sine', freqs: [2500, 2650], peak: v * 0.8, decay: 0.07 }),
  };

  return (out, t, e) => {
    if (e.type === 'hit' && Object.hasOwn(voices, e.name)) voices[e.name](out, t, e.vel);
  };
}
