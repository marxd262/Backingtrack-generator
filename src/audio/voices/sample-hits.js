// Schlag-Stimme aus einem Sample-Pack (Schlagzeug-Kits, Percussion): Schläge nach Namen, je Name eine Taste des GM-Schlagzeugs. Die Zone
// der Taste klingt wie in der SoundFont: meist ist die Taste ihr Grundton (nur die Feinstimmung wirkt); teilen sich Tasten ein Sample mit
// anderem Grundton (Toms im Kit Electronic), verschiebt die Taste die Tonhöhe. Das Sample läuft bis zu seinem Ende aus. Bis das Pack
// geladen ist (und wenn das Laden scheitert) spielt der Synth des Instruments (deps.classic), damit nichts aussetzt. Feinwert: level.
import { playNote } from './sampler.js';
import { pickZone, playbackRate } from './sample-zones.js';
import { watchPack } from './sample.js';

// Name -> GM-Taste (Kit Rimshot: Snare auf 37, Seitenschlag; siehe index.js)
export const HIT_KEYS = Object.freeze({
  drums: Object.freeze({ kick: 36, snare: 38, hat: 42, openHat: 46, tomHigh: 50, tomMid: 47, tomLow: 43, crash: 49 }),
  percussion: Object.freeze({ shaker: 82, tambourine: 54, congaHigh: 63, congaLow: 64, bongoHigh: 60, bongoLow: 61, claves: 75, cowbell: 56 }),
});

/** deps wie bei sampleVoice: { tuned, classic, setStatus, track }. Unbekannte Namen und Nicht-Schläge bleiben stumm. */
export function sampleHitVoice(packId, keyMap, ctx, { tuned, classic, setStatus, track }) {
  const current = watchPack(packId, ctx, { setStatus, track });
  return (out, t, e) => {
    if (e.type !== 'hit') return;
    const pack = current();
    if (!pack) { classic(out, t, e); return; }
    if (!Object.hasOwn(keyMap, e.name)) return;
    const key = keyMap[e.name], zone = pickZone(pack.meta.zones, key, e.vel);
    if (!zone) return;
    const sample = pack.meta.samples[zone.sample];
    // Einmal-Sample: die Note dauert so lange wie das Sample (in seiner Abspielgeschwindigkeit), das Ausklingen danach hört man nicht mehr
    playNote(ctx, out, t, { pack, zone, midi: key, dur: sample.frames / sample.rate / playbackRate(zone, key), vel: e.vel, gain: tuned('level') });
  };
}
