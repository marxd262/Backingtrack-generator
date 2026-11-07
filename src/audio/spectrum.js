// Spektralschwerpunkt für Messungen (reine Funktion, keine Browser-Objekte).

const MAX_WINDOW = 2 ** 16;

// Radix-2-FFT an Ort und Stelle (Länge Zweierpotenz)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = (-2 * Math.PI) / size;
    for (let k = 0; k < half; k++) {
      const wr = Math.cos(step * k), wi = Math.sin(step * k);
      for (let s = k; s < n; s += size) {
        const t = s + half;
        const xr = re[t] * wr - im[t] * wi, xi = re[t] * wi + im[t] * wr;
        re[t] = re[s] - xr; im[t] = im[s] - xi;
        re[s] += xr; im[s] += xi;
      }
    }
  }
}

/**
 * Betragsgewichtete mittlere Frequenz in Hz (Bins 1..N/2) über das größte Zweierpotenzfenster ab Anfang
 * (höchstens 2^16 Abtastwerte), Hann-gefenstert. 0 bei Stille oder weniger als 2 Abtastwerten.
 */
export function spectralCentroid(samples, sampleRate) {
  if (samples.length < 2) return 0;
  let n = 2;
  while (n * 2 <= Math.min(samples.length, MAX_WINDOW)) n *= 2;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  let weighted = 0, total = 0;
  for (let k = 1; k <= n / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    weighted += m * k;
    total += m;
  }
  return total > 0 ? (weighted / total) * (sampleRate / n) : 0;
}
