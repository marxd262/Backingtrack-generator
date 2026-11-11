// Mischpult-Pegel: Reglerstellung 0..1 -> Verstärkung. Quadrat als Wahrnehmungskurve; 1 ergibt exakt 1 (Klang unverändert),
// nur Abschwächung, nie Anhebung. Ungültig wirft RangeError wie setTempo.
import { LAYER_IDS } from '../core/layers.js';

export const MIX_NAMES = [...LAYER_IDS, 'master'];

export function sliderGain(v) {
  if (!(typeof v === 'number' && v >= 0 && v <= 1)) throw new RangeError(`level must be a number in [0, 1], got ${v}`);
  return v * v;
}
