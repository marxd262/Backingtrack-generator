// Stimmparameter aus dem Klangmodell (core/timbre.js). Reine Rechnung ohne Audio-Objekte, damit in Node testbar.
// Beim neutralen Klangmodell ergeben sich exakt die bisherigen Konstanten der Stimmen.

// Stetig und monoton: x = 0 -> lo, 0.5 -> mid, 1 -> hi, dazwischen exponentiell (mid exakt bei 0.5)
const span = (x, lo, mid, hi) => (x < 0.5 ? mid * (lo / mid) ** (1 - 2 * x) : mid * (hi / mid) ** (2 * x - 1));

/** Bass: Timbre['bass'] (Felder 0..1) -> Parameter für bassNote in synth.js (neues Objekt je Aufruf). */
export function bassParams({ sub, fuzz, pluck, cutoff, resonance, roundness }) {
  // Grenzfrequenz: cutoff 0.35x..3x, sub senkt sie bis auf die Hälfte
  const tone = span(cutoff, 0.35, 1, 3) * (1 - 0.5 * sub);
  // sub nimmt den Obertonanteil zurück zugunsten des Sinus-Fundaments
  const harmonics = 1 - 0.6 * sub;
  return {
    sawDetune: 6, // Cent, je ein Oszillator bei -/+
    q: span(resonance, 1, 4, 14),
    lpStart: 2200 * tone * span(pluck, 0.5, 1, 2), // zupfender: tieferer Filterabfall
    lpEnd: 320 * tone,
    lpTime: span(pluck, 0.5, 0.15, 0.03) * span(resonance, 0.7, 1, 2.5), // zupfender: schneller; resonanter: langsamer
    sawMix: harmonics * (1 - roundness), // roundness blendet Sägezahn in Dreieck über
    triMix: harmonics * roundness,
    sineGain: (1 + 2 * sub) * span(resonance, 1.3, 1, 0.4), // resonanter: weniger Fundament, die Filterspitze tritt hervor
    drive: 1 + 19 * fuzz, // 1 = ohne Verzerrer
    peak: 0.5 / (1 + 1.2 * Math.tanh(6 * fuzz)), // Hüllkurvenspitze je Anschlagstärke; der Verzerrer hebt den Pegel schon bei wenig fuzz
    sustain: pluck > 0.5 ? 0.2 ** (2 * pluck - 1) : 1, // Pegel am Ende der Haltezeit relativ zur Spitze; zupfender klingt ab
    attack: 0.004,
    release: 0.05,
    holdMin: 0.03, // Haltezeit max(holdMin, dur - holdCut)
    holdCut: 0.06,
  };
}
