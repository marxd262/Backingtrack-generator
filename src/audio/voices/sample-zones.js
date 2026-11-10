// Zonenwahl und Umrechnungen des Samplers (rein, ohne Audio-Objekte, in Node testbar).

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const distance = (x, lo, hi) => (x < lo ? lo - x : x > hi ? x - hi : 0);

/**
 * Wählt die Zone für Taste `midi` und Anschlag `vel01` (0..1, ungültig zählt als kräftig). Passende Zonen gehen vor; bei mehreren die mit dem
 * engsten Tastenbereich, bei Gleichstand die erste. Passt keine, gilt die Zone mit der nächsten Taste, dann dem nächsten Anschlagbereich.
 * Leere oder fehlende Liste: null.
 */
export function pickZone(zones, midi, vel01) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const vel = Number.isFinite(vel01) ? Math.round(clamp(vel01, 0, 1) * 127) : 127;
  let best = null, bestScore = null;
  for (const z of zones) {
    const score = [distance(midi, z.keyLo, z.keyHi), distance(vel, z.velLo, z.velHi), z.keyHi - z.keyLo];
    if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))) {
      best = z;
      bestScore = score;
    }
  }
  return best;
}

/** Abspielgeschwindigkeit, damit das Sample der Zone auf der Taste `midi` erklingt (Grundton und Feinstimmung der Zone). */
export const playbackRate = (zone, midi) => 2 ** (((midi - zone.rootKey) * 100 + zone.tuneCents) / 1200);

/** Linearer Faktor für eine Dämpfung in dB (positiv = leiser). */
export const dbToGain = (db) => 10 ** (-db / 20);

/** Tiefpass-Frequenz für den Helligkeitsregler: ab 0.5 durchsichtig (20 kHz), darunter exponentiell bis 400 Hz bei 0. */
export function brightnessHz(value01) {
  const v = Number.isFinite(value01) ? clamp(value01, 0, 1) : 0.5;
  return v >= 0.5 ? 20000 : 20000 * (400 / 20000) ** ((0.5 - v) * 2);
}
