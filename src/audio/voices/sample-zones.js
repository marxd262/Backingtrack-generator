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

/** Faktor einer Zone aus ihrer Dämpfung: negative Dämpfung (einige Schlagzeug-Kits der SoundFont) zählt wie 0 dB, wie bei FluidSynth (SF2: 0 bis 144 dB). */
export const zoneGain = (attenuationDb) => dbToGain(Math.max(0, attenuationDb));

/** Pegelfaktor nach Anschlag: clamp(vel, 1/127, 1) ** exponent (1 = linear wie bisher, 2 = SoundFont-Standard); ungültig zählt wie kräftig. */
export const velocityGain = (vel01, exponent) => (Number.isFinite(vel01) ? clamp(vel01, 1 / 127, 1) : 1) ** exponent;

/**
 * Tiefpass-Frequenz nach Anschlag: bei 1 aus (20000), logarithmisch fallend bis `softHz` bei 0,2 (darunter bleibt es dort), bei 0,5 etwa die
 * geometrische Mitte von softHz und 20000. softHz >= 20000 (oder ungültig) heißt aus; ungültiger Anschlag zählt wie kräftig.
 */
export function velocityBrightnessHz(vel01, softHz) {
  if (!(softHz < 20000)) return 20000;
  const v = Number.isFinite(vel01) ? clamp(vel01, 0.2, 1) : 1;
  return 20000 * (softHz / 20000) ** (((1 - v) / 0.8) ** 1.5); // Exponent 1,5: bei 0,5 ist der Anteil 0,49, also fast die Mitte
}

/** Tiefpass-Frequenz für den Helligkeitsregler: ab 0.5 durchsichtig (20 kHz), darunter exponentiell bis 400 Hz bei 0. */
export function brightnessHz(value01) {
  const v = Number.isFinite(value01) ? clamp(value01, 0, 1) : 0.5;
  return v >= 0.5 ? 20000 : 20000 * (400 / 20000) ** ((0.5 - v) * 2);
}
