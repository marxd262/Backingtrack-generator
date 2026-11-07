// Instrumente (Synthese) hinter der Instrument-Schnittstelle. Klangerzeuger aus backing-demo.html übernommen,
// Rauschen aus dem Seed statt Math.random, damit Renders reproduzierbar sind. AudioContext nur von außen.
import { createRng } from '../core/rng.js';

// Schichtpegel und Summe, aus Messungen mit tests/e2e/levels.spec.js angeglichen (siehe task-6-report.md)
const TRIM = { drums: 0.65, bass: 0.24, chords: 1, pad: 0.8 };
const MASTER = 0.6;
const REVERB_WET = 0.15;
const ECHO = { feedback: 0.38, tone: 2400, wet: 0.3 };
const TOMS = { tomHigh: 200, tomMid: 150, tomLow: 110 };

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function noiseBuffer(ctx, rng, seconds, channels = 1, decay = 0) {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < length; i++) d[i] = (rng.next() * 2 - 1) * Math.exp((-decay * i) / ctx.sampleRate);
  }
  return buf;
}

const adsr = (g, t, a, peak, hold, rel) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
};

function osc(ctx, type, freq, detune, dest, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(dest);
  o.start(t);
  o.stop(end);
  return o;
}

function drumVoices(ctx, noise) {
  const kick = (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    a.gain.setValueAtTime(v * 0.9, t); a.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(a).connect(out); o.start(t); o.stop(t + 0.45);
  };
  const snare = (out, t, v) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * 0.55, 0.02, 0.16);
    n.connect(bp).connect(a).connect(out); n.start(t); n.stop(t + 0.25);
    const b = ctx.createGain(); adsr(b, t, 0.001, v * 0.3, 0.01, 0.1);
    osc(ctx, 'triangle', 185, 0, b, t, t + 0.15); b.connect(out);
  };
  const hat = (open) => (out, t, v) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * 0.3, open ? 0.06 : 0.01, open ? 0.2 : 0.04);
    n.connect(hp).connect(a).connect(out); n.start(t); n.stop(t + 0.35);
  };
  const tom = (f) => (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(f * 1.35, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    a.gain.setValueAtTime(v * 0.7, t); a.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(a).connect(out); o.start(t); o.stop(t + 0.42);
  };
  const voices = { kick, snare, hat: hat(false), openHat: hat(true) };
  for (const [name, f] of Object.entries(TOMS)) voices[name] = tom(f);
  return voices;
}

// Bass: zwei leicht verstimmte Sägezähne mit Tiefpass-Zupfhüllkurve, Sinus als Fundament
function bassNote(ctx, out, t, e) {
  const f = hz(e.midi), end = t + e.dur + 0.1;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(320, t + 0.15);
  const a = ctx.createGain(); adsr(a, t, 0.004, e.vel * 0.5, Math.max(0.03, e.dur - 0.06), 0.05);
  osc(ctx, 'sawtooth', f, -6, lp, t, end);
  osc(ctx, 'sawtooth', f, 6, lp, t, end);
  osc(ctx, 'sine', f, 0, a, t, end);
  lp.connect(a).connect(out);
}

// Akkorde: kurzer Zupf/Stab je Ton (der Strom enthält Stabs oder Arpeggio-Töne)
function chordNote(ctx, out, t, e) {
  const f = hz(e.midi), end = t + e.dur + 0.3;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3600, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
  const a = ctx.createGain(); adsr(a, t, 0.003, e.vel * 0.16, Math.max(0.01, e.dur * 0.5), 0.2);
  osc(ctx, 'sawtooth', f, 0, lp, t, end);
  osc(ctx, 'square', f, 7, lp, t, end);
  lp.connect(a).connect(out);
}

// Pad: langsamer Einsatz, drei verstimmte Sägezähne durch Tiefpass mit langsamem LFO
function padNote(ctx, out, t, e) {
  const end = t + e.dur + 1;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8; lp.frequency.value = 1100;
  const depth = ctx.createGain(); depth.gain.value = 450;
  osc(ctx, 'sine', 0.18, 0, depth, t, end); depth.connect(lp.frequency);
  const a = ctx.createGain(); adsr(a, t, 0.45, e.vel * 0.1, Math.max(0.1, e.dur - 0.5), 0.9);
  for (const det of [-9, 0, 9]) osc(ctx, 'sawtooth', hz(e.midi), det, lp, t, end);
  lp.connect(a).connect(out);
}

/**
 * Baut die Instrumente und die Summenkette (Trims, Master, Echo auf Akkorde/Pad, Hall, Begrenzer).
 * `output` verbindet der Aufrufer mit ctx.destination. `trigger(event, when)` mit when in ctx-Zeit.
 */
export function createInstruments(ctx, { bpm = 100 } = {}) {
  const rng = createRng(1);
  const noise = noiseBuffer(ctx, rng.fork('noise'), 1);

  const master = ctx.createGain(); master.gain.value = MASTER;
  // Hall: Rauschen aus dem Seed, exponentiell abklingend (2 s), als Impulsantwort
  const reverb = ctx.createConvolver(); reverb.buffer = noiseBuffer(ctx, rng.fork('reverb'), 2, 2, 3);
  const reverbWet = ctx.createGain(); reverbWet.gain.value = REVERB_WET;
  // Begrenzer: harte Kennlinie, kurze Ansprache; Chrome hebt automatisch nach, -10 dB ergeben gemessene Spitzen um 0,70
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.001; limiter.release.value = 0.1;
  master.connect(limiter);
  master.connect(reverb).connect(reverbWet).connect(limiter);

  // Echo (punktierte Achtel) nur für Akkorde und Pad, nach der Stummschaltung abgegriffen
  const delay = ctx.createDelay(2); delay.delayTime.value = (60 / bpm) * 0.75;
  const fb = ctx.createGain(); fb.gain.value = ECHO.feedback;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = ECHO.tone;
  const echoWet = ctx.createGain(); echoWet.gain.value = ECHO.wet;
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(echoWet).connect(master);

  const drums = drumVoices(ctx, noise);
  const play = {
    drums: (out, t, e) => e.type === 'hit' && drums[e.name]?.(out, t, e.vel),
    bass: (out, t, e) => e.type === 'note' && bassNote(ctx, out, t, e),
    chords: (out, t, e) => e.type === 'note' && chordNote(ctx, out, t, e),
    pad: (out, t, e) => e.type === 'note' && padNote(ctx, out, t, e),
  };

  const layers = {};
  for (const [name, voice] of Object.entries(play)) {
    const mute = ctx.createGain();
    const trim = ctx.createGain(); trim.gain.value = TRIM[name];
    mute.connect(trim).connect(master);
    if (name === 'chords' || name === 'pad') trim.connect(delay);
    layers[name] = {
      trigger(event, when) {
        if (event.layer === name) voice(mute, when, event);
      },
      setMuted(on) {
        // kurze Rampe gegen Knacken, endet exakt auf 0 bzw. 1
        const g = mute.gain, now = ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(on ? 0 : 1, now + 0.02);
      },
    };
  }
  return { output: limiter, layers };
}
