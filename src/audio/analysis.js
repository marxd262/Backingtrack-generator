// Analysewerkzeug für die Klangabstimmung (reine Rechnung, kein Browser): Kurzzeit-Fourier (Spektrogramm), Verlauf der Obertöne,
// Anschlagszeit und Tonhöhe. Die Spektrogramm-Seite (ui/spectrogram.html) zeichnet damit eine Stimme und optional eine Referenzaufnahme.
import { fft } from './spectrum.js';

const FLOOR_DB = -90;

/**
 * Kurzzeit-Fourier mit Hann-Fenster. db[frame][bin] in dB gegen den größten Betrag der ganzen Eingabe (0 dB), nach unten bei -90 begrenzt.
 * times: Fenstermitte in s; freqs: Mittenfrequenz je Bin (size / 2 + 1 Bins). Eingaben kürzer als ein Fenster ergeben ein nullaufgefülltes Fenster.
 */
export function stft(samples, sampleRate, { size = 2048, hop = 512 } = {}) {
  const frames = Math.max(1, Math.floor((samples.length - size) / hop) + 1);
  const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2), hann = new Float64Array(size);
  for (let k = 0; k < size / 2; k++) { cos[k] = Math.cos((-2 * Math.PI * k) / size); sin[k] = Math.sin((-2 * Math.PI * k) / size); }
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size), im = new Float64Array(size);
  const mags = [];
  let top = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) { re[i] = start + i < samples.length ? samples[start + i] * hann[i] : 0; im[i] = 0; }
    fft(re, im, cos, sin);
    const frame = new Float32Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) { frame[k] = Math.hypot(re[k], im[k]); top = Math.max(top, frame[k]); }
    mags.push(frame);
  }
  const db = mags.map((frame) => frame.map((m) => (top > 0 && m > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(m / top)) : FLOOR_DB)));
  return {
    times: mags.map((_, f) => (f * hop + size / 2) / sampleRate),
    freqs: Array.from({ length: size / 2 + 1 }, (_, k) => (k * sampleRate) / size),
    db,
  };
}

/**
 * Verlauf der ersten `count` Obertöne (k * f0) über die Zeit: je Oberton { harmonic, times, db } mit dem Pegel des stärksten Bins in
 * ±3 % um k * f0, in dB gegen den größten Wert aller Obertöne zusammen (0 dB). Fensterlänge 4096.
 */
export function harmonicTracks(samples, sampleRate, f0, count = 12, { hop = 512 } = {}) {
  const spec = stft(samples, sampleRate, { size: 4096, hop });
  const binWidth = sampleRate / 4096;
  const raw = [];
  let top = 0;
  for (let h = 1; h <= count; h++) {
    const center = h * f0;
    const lo = Math.max(1, Math.floor((center * 0.97) / binWidth)), hi = Math.min(2048, Math.ceil((center * 1.03) / binWidth));
    const levels = spec.db.map((frame) => {
      let best = FLOOR_DB;
      for (let k = lo; k <= hi; k++) best = Math.max(best, frame[k] ?? FLOOR_DB);
      return best;
    });
    raw.push(levels);
    for (const v of levels) top = Math.max(top, v);
  }
  return raw.map((levels, i) => ({ harmonic: i + 1, times: spec.times, db: levels.map((v) => Math.max(FLOOR_DB, v - top)) }));
}

/** Anschlagszeit in s: von 10 % bis 90 % der Spitze der laufenden Hüllkurve (größter Betrag bisher). 0 bei Stille. */
export function attackTime(samples, sampleRate) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return 0;
  let run = 0, t10 = -1, t90 = -1;
  for (let i = 0; i < samples.length; i++) {
    run = Math.max(run, Math.abs(samples[i]));
    if (t10 < 0 && run >= 0.1 * peak) t10 = i;
    if (run >= 0.9 * peak) { t90 = i; break; }
  }
  return t90 < 0 ? 0 : (t90 - t10) / sampleRate;
}

/**
 * Grundton gegen die MIDI-Zahl in Cent aus dem Phasenverlauf des Grundtons: Das Signal wird mit der Sollfrequenz demoduliert (Hann-Fenster
 * über mindestens 8 Perioden und 100 ms: ein kürzeres lässt den starken zweiten Oberton eines Basses in die Phase des Grundtons lecken, Schritt eine Viertel Fensterlänge); die Steigung der entfalteten Phase ist die Abweichung. Anders als
 * die Lage einer Spektrumsspitze oder einer Autokorrelation bleibt das Ergebnis unverfälscht, wenn der Ton im Fenster abklingt oder
 * seine Obertöne verschieden schnell abklingen. Fenster ab 40 ms, bis 0,5 s. 0 bei Stille oder zu kurzer Eingabe.
 */
export function pitchCents(samples, sampleRate, midi) {
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const win = Math.max(Math.ceil((8 / f0) * sampleRate), Math.floor(0.1 * sampleRate));
  const hop = Math.max(1, Math.floor(win / 4));
  const from = Math.floor(0.04 * sampleRate), to = Math.min(samples.length, from + Math.floor(0.5 * sampleRate));
  const phases = [], weights = [];
  for (let start = from; start + win <= to; start += hop) {
    let re = 0, im = 0;
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win), a = w0 * (start + i);
      re += samples[start + i] * w * Math.cos(a);
      im -= samples[start + i] * w * Math.sin(a);
    }
    phases.push(Math.atan2(im, re));
    weights.push(Math.hypot(re, im));
  }
  if (phases.length < 3 || !(Math.max(...weights) > 0)) return 0;
  let num = 0, den = 0;
  for (let k = 1; k < phases.length; k++) {
    let d = phases[k] - phases[k - 1];
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    const weight = weights[k] * weights[k - 1];
    num += weight * d;
    den += weight;
  }
  const deviation = num / den / hop; // rad je Abtastwert
  return 1200 * Math.log2(1 + deviation / w0);
}
