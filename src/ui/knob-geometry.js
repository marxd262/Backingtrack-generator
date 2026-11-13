// Drehknopf als reine Geometrie: Zeigerwinkel und Bogen, ohne DOM (läuft auch in Node-Tests). 0 Grad = 12 Uhr, positiv = rechts herum.
const SWEEP = 135; // Anschläge bei -135 und 135 Grad

/** Zeigerwinkel in Grad für value im Bereich min..max (außerhalb begrenzt). */
export function knobAngle(value, min, max) {
  const f = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return -SWEEP + 2 * SWEEP * f;
}

/**
 * Bogen vom Ursprung bis zur Zeigerspitze, from < to. side = Seite des Zeigers vom Ursprung aus (türkis links, pink rechts);
 * bei 'start' (Ursprung am linken Anschlag) immer rechts. null ohne Bogen: 'none' oder weniger als 1 Grad Abstand.
 * @param {'center'|'start'|'none'} origin
 * @returns {{ from: number, to: number, side: 'left'|'right' } | null}
 */
export function knobArc(value, min, max, origin) {
  if (origin === 'none') return null;
  const a = knobAngle(value, min, max);
  const o = origin === 'center' ? 0 : -SWEEP;
  if (Math.abs(a - o) < 1) return null;
  return { from: Math.min(o, a), to: Math.max(o, a), side: a < o ? 'left' : 'right' };
}
