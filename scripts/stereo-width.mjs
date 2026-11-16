// Seite/Mitte und L/R-Balance von 16-Bit-Stereo-WAVs (render-full-Ausgabe). Aufruf: node scripts/stereo-width.mjs <datei.wav> …
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f), d = new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) / 2);
  let m = 0, s = 0, l = 0, r = 0;
  for (let i = 0; i < d.length; i += 2) { const L = d[i], R = d[i + 1]; m += ((L + R) / 2) ** 2; s += ((L - R) / 2) ** 2; l += L * L; r += R * R; }
  console.log(f.split(/[\/]/).pop(), 'Seite/Mitte', (10 * Math.log10(s / m)).toFixed(1), 'dB, L/R', (10 * Math.log10(l / r)).toFixed(1), 'dB');
}
