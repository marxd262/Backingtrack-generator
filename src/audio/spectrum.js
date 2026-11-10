// Spektralschwerpunkt für Messungen (reine Funktion, keine Browser-Objekte).

const WINDOW = 2 ** 15;
const HOP = 2 ** 14; // halbe Überlappung: Hann-Fenster summieren sich überall zu 1

// Radix-2-FFT an Ort und Stelle (Länge Zweierpotenz); cos/sin als Tabelle der Länge n/2
export function fft(re, im, cos, sin) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, stride = n / size;
    for (let k = 0; k < half; k++) {
      const wr = cos[k * stride], wi = sin[k * stride];
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
 * Betragsgewichtete mittlere Frequenz in Hz (Bins 1..N/2), gemittelt über die ganze Eingabe:
 * Hann-Fenster der Länge 2^15 im Abstand 2^14, das erste beginnt vor der Eingabe, damit Einsätze am Anfang und
 * Ende zählen; außerhalb gilt Stille (Nullen). Ein harter Einsatz oder Abbruch am Rand zählt damit als Knack mit
 * breitem Spektrum, wie er auch klingt. Kürzere Eingaben: ein Fenster, die größte Zweierpotenz, die hineinpasst.
 * 0 bei Stille oder weniger als 2 Abtastwerten.
 */
export function spectralCentroid(samples, sampleRate) {
  const length = samples.length;
  if (length < 2) return 0;
  let n = WINDOW, hop = HOP, first = -HOP;
  if (length < WINDOW) {
    n = 2;
    while (n * 2 <= length) n *= 2;
    hop = n; first = 0; // genau ein Fenster ab Abtastwert 0
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), hann = new Float64Array(n);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((-2 * Math.PI * k) / n);
    sin[k] = Math.sin((-2 * Math.PI * k) / n);
  }
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const re = new Float64Array(n), im = new Float64Array(n);
  let weighted = 0, total = 0;
  const last = length < WINDOW ? 0 : length - 1;
  for (let start = first; start <= last; start += hop) {
    for (let i = 0; i < n; i++) {
      const p = start + i;
      re[i] = p >= 0 && p < length ? samples[p] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    // Summe der Betragsspektren aller Fenster: Schwerpunkt der Summe = Summe der Gewichte / Summe der Beträge
    for (let k = 1; k <= n / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      weighted += m * k;
      total += m;
    }
  }
  return total > 0 ? (weighted / total) * (sampleRate / n) : 0;
}
