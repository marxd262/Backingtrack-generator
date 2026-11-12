// Gemeinsame Bausteine der Spieler (events.js, lead.js, percussion.js): Zeit eines Rasterschritts, Lautstärke, Note. Reine Logik ohne Audio.
import { r6 } from './timeline.js';

const JITTER = 0.007; // typische Timing-Abweichung in s, Vertrag erlaubt höchstens 0.02
const END_GAP = 0.001; // Abstand zum Taktende, damit auch gerundete Zeiten im Takt bleiben

const r3 = (x) => Math.round(x * 1e3) / 1e3;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Zeit eines Rasterschritts mit Swing und Jitter, bleibt in [Taktstart, Taktende). Zieht genau eine Zufallszahl. */
export function at(b, step, rng, swing) {
  const shift = b.sub === 4 && step % 2 ? (swing * b.stepSec) / 3 : 0; // swing 1 = Triolen-Gefühl; im Triolen-Raster trägt das Raster es selbst
  const t = b.start + step * b.stepSec + shift + (rng.next() * 2 - 1) * JITTER;
  return r6(clamp(t, b.start, b.end - END_GAP));
}

/** Lautstärke auf [0.05, 1] geklemmt, auf drei Stellen gerundet. */
export const roundVel = (x) => r3(clamp(x, 0.05, 1));

/** Lautstärke um ±6 % gestreut, in [0.05, 1]. Zieht genau eine Zufallszahl. */
export const humanVel = (base, rng) => roundVel(base * (0.94 + rng.next() * 0.12));

/** Noten-Ereignis; die Dauer endet spätestens am Taktende. */
export const note = (b, layer, step, t, midi, vel, dur) =>
  ({ t, bar: b.index, beat: step / b.sub, type: 'note', layer, midi, vel, dur: r6(Math.min(dur, b.end - t)) });

const RANK = { chord: 0, marker: 1 };
/** Sortierung des Ereignisstroms: nach t, bei Gleichstand chord, marker, Rest. */
export const byTime = (x, y) => x.t - y.t || (RANK[x.type] ?? 2) - (RANK[y.type] ?? 2);
