// Instrumente (Synthese) hinter der Instrument-Schnittstelle. Klangerzeuger aus backing-demo.html übernommen,
// Rauschen aus dem Seed statt Math.random, damit Renders reproduzierbar sind. AudioContext nur von außen.
import { createRng } from '../core/rng.js';
import { DEFAULT_TIMBRE, completeTimbre } from '../core/timbre.js';
import { bassParams, drumParams } from './voice-params.js';

// Schichtpegel und Summe, aus Messungen mit tests/e2e/levels.spec.js angeglichen (Messwerte dort im Kommentar)
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

// Schlagzeugstimmen; p aus drumParams (beim neutralen Klang die bisherigen Konstanten). Toms folgen dem Klangmodell nicht.
function drumVoices(ctx, noise, p) {
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
  const voices = { kick, snare, hat: hat(false), openHat: hat(true) };
  for (const [name, f] of Object.entries(TOMS)) voices[name] = tom(f);
  return voices;
}

function gain(ctx, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

// Tanh-Kennlinie für den Bass-Verzerrer, Eingang -FUZZ_HEAD..FUZZ_HEAD. k = drive - 1: bei k -> 0 die Identität,
// der Klang geht also stetig aus dem unverzerrten hervor. Ungerade Länge: 0 trifft genau einen Stützpunkt (Stille bleibt 0).
const FUZZ_HEAD = 4;
function fuzzCurve(drive) {
  const k = drive - 1, n = 4097;
  return Float32Array.from({ length: n }, (_, i) => (FUZZ_HEAD * Math.tanh(k * ((2 * i) / (n - 1) - 1))) / Math.tanh(k));
}

// Bass: zwei leicht verstimmte Sägezähne (oder Dreiecke) mit Tiefpass-Zupfhüllkurve, Sinus als Fundament,
// optional Verzerrer nach dem Filter. p aus bassParams, curve aus fuzzCurve (null ohne Verzerrer).
function bassNote(ctx, out, t, e, p, curve) {
  const f = hz(e.midi), end = t + e.dur + 0.1;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = p.q;
  lp.frequency.setValueAtTime(p.lpStart, t); lp.frequency.exponentialRampToValueAtTime(p.lpEnd, t + p.lpTime);
  const hold = Math.max(p.holdMin, e.dur - p.holdCut);
  const a = ctx.createGain(); adsr(a, t, p.attack, e.vel * p.peak, hold, p.release);
  // zupfend: Abklingen während der Haltezeit; sustain 1 = flach wie bisher, dann ohne zusätzlichen Knoten
  if (p.sustain < 1) {
    const decay = gain(ctx, 1, out);
    decay.gain.setValueAtTime(1, t + p.attack);
    decay.gain.exponentialRampToValueAtTime(p.sustain, t + p.attack + hold);
    a.connect(decay);
  } else a.connect(out);
  for (const [type, mix] of [['sawtooth', p.sawMix], ['triangle', p.triMix]]) {
    if (mix === 0) continue;
    const bus = gain(ctx, mix, lp);
    for (const det of [-p.sawDetune, p.sawDetune]) osc(ctx, type, f, det, bus, t, end);
  }
  let body = a;
  if (curve) {
    const shaper = ctx.createWaveShaper(); shaper.curve = curve;
    body = gain(ctx, 1 / FUZZ_HEAD, shaper);
    shaper.connect(a);
  }
  osc(ctx, 'sine', f, 0, gain(ctx, p.sineGain, body), t, end);
  lp.connect(body);
}

// Akkorde: kurzer Zupf/Stab je Ton (der Strom enthält Stabs oder Arpeggio-Töne)
function chordNote(ctx, out, t, e, timbre) {
  const f = hz(e.midi), end = t + e.dur + 0.3;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3600, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.25);
  const a = ctx.createGain(); adsr(a, t, 0.003, e.vel * 0.16, Math.max(0.01, e.dur * 0.5), 0.2);
  osc(ctx, 'sawtooth', f, 0, lp, t, end);
  osc(ctx, 'square', f, 7, lp, t, end);
  lp.connect(a).connect(out);
}

// Pad: langsamer Einsatz, drei verstimmte Sägezähne durch Tiefpass mit langsamem LFO
function padNote(ctx, out, t, e, timbre) {
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
 * `timbre` (Klangmodell, siehe core/timbre.js) wird mit DEFAULT_TIMBRE aufgefüllt; ungültig zählt wie fehlend.
 */
export function createInstruments(ctx, { bpm = 100, limiter: useLimiter = true, timbre = DEFAULT_TIMBRE } = {}) {
  const sound = completeTimbre(timbre);
  const rng = createRng(1);
  const noise = noiseBuffer(ctx, rng.fork('noise'), 1);

  const master = ctx.createGain(); master.gain.value = MASTER;
  // Hall: Rauschen aus dem Seed, exponentiell abklingend (2 s), als Impulsantwort
  const reverb = ctx.createConvolver(); reverb.buffer = noiseBuffer(ctx, rng.fork('reverb'), 2, 2, 3);
  const reverbWet = ctx.createGain(); reverbWet.gain.value = REVERB_WET;
  // Begrenzer: harte Kennlinie, kurze Ansprache; Chrome hebt automatisch nach, -10 dB ergeben gemessene Spitzen um 0,70.
  // limiter: false (nur für Pegeltests) ersetzt ihn durch eine neutrale Summe, gemessen wird dann die Mischung davor.
  const limiter = useLimiter ? ctx.createDynamicsCompressor() : ctx.createGain();
  if (useLimiter) {
    limiter.threshold.value = -10; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.1;
  }
  master.connect(limiter);
  master.connect(reverb).connect(reverbWet).connect(limiter);

  // Echo (punktierte Achtel) nur für Akkorde und Pad, nach der Stummschaltung abgegriffen; 3 s reichen bis 20 bpm
  const echoTime = (b) => (60 / b) * 0.75;
  const delay = ctx.createDelay(3); delay.delayTime.value = echoTime(bpm);
  const fb = ctx.createGain(); fb.gain.value = ECHO.feedback;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = ECHO.tone;
  const echoWet = ctx.createGain(); echoWet.gain.value = ECHO.wet;
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(echoWet).connect(master);

  const drum = drumParams(sound.drums);
  const drums = drumVoices(ctx, noise, drum);
  const bass = bassParams(sound.bass);
  const curve = bass.drive > 1 ? fuzzCurve(bass.drive) : null; // einmal je Instrumentensatz
  const play = {
    drums: (out, t, e) => e.type === 'hit' && drums[e.name]?.(out, t, e.vel),
    bass: (out, t, e) => e.type === 'note' && bassNote(ctx, out, t, e, bass, curve),
    chords: (out, t, e) => e.type === 'note' && chordNote(ctx, out, t, e, sound.chords),
    pad: (out, t, e) => e.type === 'note' && padNote(ctx, out, t, e, sound.pad),
  };

  const layers = {};
  for (const [name, voice] of Object.entries(play)) {
    const mute = ctx.createGain();
    const trim = ctx.createGain(); trim.gain.value = TRIM[name];
    mute.connect(trim).connect(master);
    // room: Teil der Schlagzeugsumme in den Hall, hinter mute und trim abgegriffen (Stummschalten schaltet den Sendeweg mit stumm); ohne room kein Knoten
    if (name === 'drums' && drum.roomSend > 0) trim.connect(gain(ctx, drum.roomSend, reverb));
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
  return {
    output: limiter,
    layers,
    // Echo folgt einem Live-Tempowechsel; weich nachgeführt (Zeitkonstante 50 ms) statt springend
    setTempo(newBpm) {
      delay.delayTime.setTargetAtTime(echoTime(newBpm), ctx.currentTime, 0.05);
    },
  };
}
