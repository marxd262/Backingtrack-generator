// Saitenmodell als reine Funktion (kein Browser, kein Math.random): jeder Ton wird vorab als Puffer berechnet.
//
// Modale Berechnung statt Karplus-Strong-Rückkopplung: Die Saite schwingt als Summe ihrer Obertöne, jeder ein abklingender Sinus mit eigener
// Frequenz und eigener Abklingzeit. Das hat drei Gründe. (1) Web Audio kann Rückkopplungsschleifen nicht unter 128 Abtastwerten Verzögerung
// (Grenze etwa 345 Hz). (2) Eine Schleife mit Tiefpass müsste bei tiefen Tönen so eng werden (Grenzfrequenz um 100 Hz), dass ihre
// frequenzabhängige Verzögerung die Obertöne verstimmt (gemessen: 6,5 Cent am tiefsten Ton, die Obertöne deutlich mehr). (3) Hier sind
// Stimmung und Abklingen je Oberton exakt steuerbar.
//
// Anfangsauslenkung einer gezupften Saite: Obertöne fallen mit h^-slope (Plektrum hart: flach, Finger weich: steil), die Zupfposition ist der
// Faktor sin(pi h pluckPos), die Tonabnehmer-Position der Faktor sin(pi h pickupPos). Dazu ein kurzer Rauschanteil für das Anschlaggeräusch.
// Am Ausgang liegen ein Tiefpass und zwei feste Korpus-Resonanzen; nach dem Notenende dämpft ein schneller Abfall (die Hand).
import { createRng } from '../core/rng.js';

/** Standardwerte; die Stimmen (voices/string.js) überschreiben sie je Variante. Bereiche stehen in RANGES. */
export const STRING_DEFAULTS = Object.freeze({
  pluckPos: 0.2, // Zupfposition als Anteil der Saitenlänge (0 = keine Wirkung)
  brightness: 0.6, // wie lange die oberen Obertöne klingen (der 6. Oberton erreicht -60 dB nach 0,04 s bis 1 s)
  decay: 1.5, // Abklingzeit des Grundtons auf -60 dB in s
  excite: 0.6, // Helligkeit der Anregung (Plektrum hell, Finger dunkel): Neigung der Anfangs-Obertöne und Rauschanteil
  stiffness: 0.1, // Inharmonizität (obere Obertöne klingen etwas zu hoch, wie bei dicken Saiten)
  pickupPos: 0.15, // Tonabnehmer-Position als Anteil der Saitenlänge (0 = keine Wirkung)
  pickupLp: 5000, // Tiefpass hinter dem Tonabnehmer in Hz
  body: 0.3, // Pegel der Korpus-Resonanzen
});
const RANGES = {
  pluckPos: [0, 0.5], brightness: [0, 1], decay: [0.05, 10], excite: [0, 1], stiffness: [0, 1], pickupPos: [0, 0.5], pickupLp: [200, 20000], body: [0, 1],
};
const RELEASE_TC = 0.02; // Abfall nach dem Notenende (s)
const MAX_PARTIALS = 64;
const REF_PARTIAL = 6; // Oberton, dessen Abklingzeit `brightness` festlegt
const TARGET_RMS = 0.3; // Pegel der Summe vor Tiefpass und Korpus
const BODY = [{ hz: 95, q: 3, gain: 0.5 }, { hz: 210, q: 4, gain: 0.4 }];

const clean = (params) => {
  const out = {};
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = params?.[key];
    out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : STRING_DEFAULTS[key];
  }
  return out;
};

/**
 * Rendert eine Saitennote als Float32Array (ein Kanal, `seconds` lang).
 * midi: Tonhöhe; dur: Notenlänge in s (danach dämpft die Hand); vel: Anschlagstärke 0..1; seed: Rauschen des Anschlags; params: siehe STRING_DEFAULTS.
 */
export function renderString({ midi, seconds, dur, vel = 0.8, sampleRate = 44100, seed = 1, params } = {}) {
  if (!Number.isFinite(midi) || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`renderString: midi, seconds and sampleRate must be finite and positive, got ${midi}, ${seconds}, ${sampleRate}`);
  }
  const p = clean(params);
  const v = Number.isFinite(vel) ? Math.min(1, Math.max(0, vel)) : 0.8;
  const length = Math.ceil(seconds * sampleRate);
  const noteEnd = Math.round((Number.isFinite(dur) ? dur : seconds) * sampleRate);
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const excite = Math.min(1, p.excite * (0.55 + 0.9 * v));
  const slope = 2.4 - 1.6 * excite;
  const stiff = p.stiffness * p.stiffness * 4e-4;
  const t6 = Math.min(p.decay, 0.04 * 25 ** p.brightness);
  const rate0 = 1 / p.decay, rateRef = 1 / t6;
  // nach noteEnd dämpft die Hand: danach muss nichts mehr berechnet werden (der Abfall liegt dann unter 1e-5)
  const stop = Math.min(length, noteEnd + Math.ceil(11.6 * RELEASE_TC * sampleRate));

  // Obertöne: Frequenz, Anfangsamplitude (Neigung, Zupf- und Tonabnehmer-Position), Abklingzeit
  const partials = [];
  let power = 0;
  for (let h = 1; h <= MAX_PARTIALS; h++) {
    const freq = h * f0 * Math.sqrt(1 + stiff * h * h);
    if (freq >= 0.45 * sampleRate) break;
    let amp = h ** -slope;
    if (p.pluckPos > 0) amp *= Math.sin(Math.PI * h * p.pluckPos);
    if (p.pickupPos > 0) amp *= Math.sin(Math.PI * h * p.pickupPos);
    if (Math.abs(amp) < 1e-4) continue;
    const rate = rate0 + (rateRef - rate0) * ((h - 1) / (REF_PARTIAL - 1)) ** 1.5; // 1 / T60 (Abklingrate), wächst mit der Obertonzahl
    partials.push({ freq, amp, rate });
    power += (amp * amp) / 2;
  }
  const scale = power > 0 ? TARGET_RMS / Math.sqrt(power) : 0;

  const string = new Float64Array(length);
  for (const { freq, amp, rate } of partials) {
    const w = (2 * Math.PI * freq) / sampleRate;
    const r = Math.exp((-6.9078 * rate) / sampleRate); // Dämpfung je Abtastwert: -60 dB nach 1 / rate Sekunden
    const c = r * Math.cos(w), s = r * Math.sin(w);
    const a = amp * scale;
    // Abklingen unter 1e-4: weiter zu rechnen lohnt nicht
    const last = Math.min(stop, Math.ceil((9.21 / (6.9078 * rate)) * sampleRate));
    let re = 1, im = 0; // (r e^{jw})^i: im = r^i sin(w i)
    for (let i = 0; i < last; i++) {
      string[i] += a * im;
      const nr = re * c - im * s;
      im = re * s + im * c;
      re = nr;
    }
  }
  // Anschlaggeräusch: kurzer, tiefpassgefilterter Rauschstoß (Plektrum und Finger), lauter bei härterem Anschlag
  const rng = createRng(seed);
  const noiseAmp = TARGET_RMS * (0.1 + 0.5 * excite);
  const burst = Math.min(stop, Math.ceil(0.08 * sampleRate));
  let low = 0;
  for (let i = 0; i < burst; i++) {
    low = 0.45 * (rng.next() * 2 - 1) + 0.55 * low;
    string[i] += noiseAmp * low * Math.exp(-i / (0.012 * sampleRate));
  }

  // Ausgang: Tiefpass hinter dem Tonabnehmer, Korpus; dazu Anschlagstärke und Dämpfung nach dem Notenende
  const pa = Math.exp((-2 * Math.PI * p.pickupLp) / sampleRate);
  const bodyFilters = BODY.map(({ hz, q, gain }) => {
    const wb = (2 * Math.PI * hz) / sampleRate, alpha = Math.sin(wb) / (2 * q), b0 = alpha, a0 = 1 + alpha;
    return { b0: b0 / a0, a1: (-2 * Math.cos(wb)) / a0, a2: (1 - alpha) / a0, gain, x1: 0, x2: 0, y1: 0, y2: 0 };
  });
  const out = new Float32Array(length);
  const level = 0.3 + 0.7 * v;
  let plp = 0;
  for (let i = 0; i < stop; i++) {
    const x = string[i];
    plp = (1 - pa) * x + pa * plp;
    let sum = plp;
    if (p.body > 0) {
      for (const f of bodyFilters) {
        const yb = f.b0 * (x - f.x2) - f.a1 * f.y1 - f.a2 * f.y2;
        f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = yb;
        sum += p.body * f.gain * yb;
      }
    }
    const release = i > noteEnd ? Math.exp(-(i - noteEnd) / (RELEASE_TC * sampleRate)) : 1;
    out[i] = sum * level * release;
  }
  return out;
}
