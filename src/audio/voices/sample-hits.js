// Schlag-Stimme aus einem Sample-Pack (Schlagzeug-Kits, Percussion): Schläge nach Namen, je Name eine Taste des GM-Schlagzeugs. Die Zone
// der Taste klingt wie in der SoundFont: meist ist die Taste ihr Grundton (nur die Feinstimmung wirkt); teilen sich Tasten ein Sample mit
// anderem Grundton (Toms im Kit Electronic), verschiebt die Taste die Tonhöhe. Das Sample läuft bis zu seinem Ende aus. Bis das Pack
// geladen ist (und wenn das Laden scheitert) spielt der Synth des Instruments (deps.classic), damit nichts aussetzt. Feinwerte: level; Klang v2,
// Schritt 5 (alle 0 = aus): humanCents und humanDb (Zufallsabweichung je Schlag in Tonhöhe und Pegel), layerSpread (der Anschlag für die Wahl der
// Zone streut um diesen Betrag, so wechseln benachbarte Anschlagstufen ab: Pseudo-Round-Robin), choke (die geschlossene Hi-Hat würgt die offene ab).
import { playNote } from './sampler.js';
import { pickZone, playbackRate, dbToGain } from './sample-zones.js';
import { watchPack } from './sample.js';

// Name -> GM-Taste (Kit Rimshot: Snare auf 37, Seitenschlag; siehe index.js)
export const HIT_KEYS = Object.freeze({
  drums: Object.freeze({ kick: 36, snare: 38, hat: 42, openHat: 46, tomHigh: 50, tomMid: 47, tomLow: 43, crash: 49 }),
  percussion: Object.freeze({ shaker: 82, tambourine: 54, congaHigh: 63, congaLow: 64, bongoHigh: 60, bongoLow: 61, claves: 75, cowbell: 56 }),
});

const CHOKE_TC = 0.012; // Zeitkonstante des Abwürgens (s): nach etwa 50 ms ist die offene Hi-Hat weg

/** deps wie bei sampleVoice: { tuned, classic, setStatus, track, rng }. Unbekannte Namen und Nicht-Schläge bleiben stumm. */
export function sampleHitVoice(packId, keyMap, ctx, { tuned, classic, setStatus, track, rng }) {
  const current = watchPack(packId, ctx, { setStatus, track });
  let openHat = null; // Hüllkurve der zuletzt gespielten offenen Hi-Hat
  return (out, t, e) => {
    if (e.type !== 'hit') return;
    const pack = current();
    if (!pack) { classic(out, t, e); return; }
    if (!Object.hasOwn(keyMap, e.name)) return;
    let cents = 0, gain = tuned('level'), pickVel = e.vel;
    if (Number.isFinite(tuned('humanDb'))) { // immer alle drei ziehen, auch bei 0, damit die Folge gleich bleibt
      const pitch = rng.next(), loud = rng.next(), layer = rng.next();
      cents = (2 * pitch - 1) * tuned('humanCents');
      gain *= dbToGain((2 * loud - 1) * tuned('humanDb'));
      pickVel = Math.min(1, Math.max(0, e.vel + (2 * layer - 1) * tuned('layerSpread')));
    }
    const key = keyMap[e.name], zone = pickZone(pack.meta.zones, key, pickVel);
    if (!zone) return;
    const sample = pack.meta.samples[zone.sample];
    // Einmal-Sample: die Note dauert so lange wie das Sample (in seiner Abspielgeschwindigkeit), das Ausklingen danach hört man nicht mehr
    const env = playNote(ctx, out, t, { pack, zone, midi: key, dur: sample.frames / sample.rate / playbackRate(zone, key), vel: e.vel, gain, cents });
    if (tuned('choke') >= 0.5 && (e.name === 'hat' || e.name === 'openHat')) {
      if (e.name === 'hat' && openHat) { openHat.gain.cancelScheduledValues(t); openHat.gain.setTargetAtTime(0, t, CHOKE_TC); }
      openHat = e.name === 'openHat' ? env : null;
    }
  };
}
