import { adsr, osc } from '../nodes.js';

// Klangerzeugung des Schlagzeugs (synth/classic): Schläge nach Namen. params ist drumParams (live aktualisiert, beim neutralen Klang die
// bisherigen Konstanten) und wird beim Anschlag gelesen. Toms folgen dem Klangmodell nicht.
const TOMS = { tomHigh: 200, tomMid: 150, tomLow: 110 };

export function drumKitVoice(ctx, { params: p, noise }) {
  const kick = (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(p.kickStart, t); o.frequency.exponentialRampToValueAtTime(p.kickEnd, t + p.kickDrop);
    a.gain.setValueAtTime(v * p.kickPeak, t); a.gain.exponentialRampToValueAtTime(0.001, t + p.kickDecay);
    o.connect(a).connect(out); o.start(t); o.stop(t + p.kickDecay + 0.05);
    if (p.kickClick > 0) { // kurzer Anschlagklick aus Rauschen, nur wenn der Kick es verlangt
      const n = ctx.createBufferSource(); n.buffer = noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
      const c = ctx.createGain(); adsr(c, t, 0.001, v * p.kickClick, 0, 0.012);
      n.connect(lp).connect(c).connect(out); n.start(t); n.stop(t + 0.05);
    }
  };
  const snare = (out, t, v) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.snareFreq; bp.Q.value = p.snareQ;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * p.snareNoise, 0.02, p.snareDecay);
    n.connect(bp).connect(a).connect(out); n.start(t); n.stop(t + p.snareDecay + 0.09);
    if (p.snareClick > 0) { // heller Anschlagklick, nur wenn die Snare es verlangt
      const c = ctx.createBufferSource(); c.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
      const g = ctx.createGain(); adsr(g, t, 0.001, v * p.snareClick, 0, 0.025);
      c.connect(hp).connect(g).connect(out); c.start(t); c.stop(t + 0.05);
    }
    const b = ctx.createGain(); adsr(b, t, 0.001, v * p.snareTone, 0.01, 0.1);
    osc(ctx, 'triangle', 185, 0, b, t, t + 0.15); b.connect(out);
  };
  const hat = (open) => (out, t, v) => {
    const hold = open ? 0.06 : 0.01, decay = open ? p.hatOpenDecay : p.hatClosedDecay;
    const n = ctx.createBufferSource(); n.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hatFreq;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * p.hatPeak, hold, decay);
    n.connect(hp).connect(a).connect(out); n.start(t); n.stop(t + Math.max(0.35, hold + decay + 0.05));
  };
  const tom = (f) => (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(f * 1.35, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    a.gain.setValueAtTime(v * 0.7, t); a.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(a).connect(out); o.start(t); o.stop(t + 0.42);
  };
  // Crash: helles Rauschen durch Hochpass, langes Ausklingen (~1,5 s); Spitze liegt unter dem Kick
  const crash = (out, t, v) => {
    const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true; // Puffer ist 1 s lang
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const a = ctx.createGain(); adsr(a, t, 0.002, v * 0.3, 0.05, 1.5);
    n.connect(hp).connect(a).connect(out); n.start(t); n.stop(t + 1.7);
  };
  const kit = { kick, snare, hat: hat(false), openHat: hat(true), crash };
  for (const [name, f] of Object.entries(TOMS)) kit[name] = tom(f);
  return (out, t, e) => e.type === 'hit' && kit[e.name]?.(out, t, e.vel);
}
