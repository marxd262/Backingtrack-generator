// Schlag-Stimme aus einem Sample-Pack (Schlagzeug-Kits, Percussion): Schläge nach Namen, je Name eine Taste des GM-Schlagzeugs. Die Zone
// der Taste klingt wie in der SoundFont: meist ist die Taste ihr Grundton (nur die Feinstimmung wirkt); teilen sich Tasten ein Sample mit
// anderem Grundton (Toms im Kit Electronic), verschiebt die Taste die Tonhöhe. Das Sample läuft bis zu seinem Ende aus. Bis das Pack
// geladen ist (und wenn das Laden scheitert) spielt der Synth des Instruments (deps.classic), damit nichts aussetzt. Feinwerte: level; Klang v2,
// Schritt 5 (alle 0 = aus): humanCents und humanDb (Zufallsabweichung je Schlag in Tonhöhe und Pegel), layerSpread (der Anschlag für die Wahl der
// Zone streut um diesen Betrag, so wechseln benachbarte Anschlagstufen ab: Pseudo-Round-Robin), choke (die geschlossene Hi-Hat würgt die offene ab).
// Format-2-Packs (scripts/import-sfz.mjs) bringen das selbst mit: Tasten je Schlagname (meta.keys), echte Round-Robins (layerSpread und choke
// wirken dort nicht), Choke-Gruppen der Library (zone.group / offBy / offTime) und ein Raum-Mikrofon je Schlag (zone.room, Feinwert roomMic, fehlt = 1).
import { playNote } from './sampler.js';
import { pickZone, pickZones, roundRobin, playbackRate, dbToGain } from './sample-zones.js';
import { watchPack } from './sample.js';
import { DRUM_FALLBACK } from '../../core/event-helpers.js';

// Name -> GM-Taste (Kit Rimshot: Snare auf 37, Seitenschlag; siehe index.js)
export const HIT_KEYS = Object.freeze({
  // sideStick und hatPedal liegen in allen Kits; ride, rideBell, hatHalf und rimshot haben noch keine Taste und fallen zurück (DRUM_FALLBACK)
  drums: Object.freeze({ kick: 36, snare: 38, hat: 42, openHat: 46, tomHigh: 50, tomMid: 47, tomLow: 43, crash: 49, sideStick: 37, hatPedal: 44 }),
  percussion: Object.freeze({ shaker: 82, tambourine: 54, congaHigh: 63, congaLow: 64, bongoHigh: 60, bongoLow: 61, claves: 75, cowbell: 56 }),
});

const CHOKE_TC = 0.012; // Zeitkonstante des Abwürgens (s): nach etwa 50 ms ist die offene Hi-Hat weg

/** deps wie bei sampleVoice: { tuned, classic, setStatus, track, rng }. Unbekannte Namen und Nicht-Schläge bleiben stumm. */
export function sampleHitVoice(packId, keyMap, ctx, { tuned, classic, setStatus, track, rng }) {
  const current = watchPack(packId, ctx, { setStatus, track });
  let openHat = null; // Hüllkurve der zuletzt gespielten offenen Hi-Hat
  const lastZone = new Map(); // Round-Robin (Format 2): zuletzt gespielte Zone je Taste
  let chokeable = []; // Format 2: klingende Schläge mit offBy: { offBy, offTime, envs }
  const choke = (env, at, offTime) => { (env.gain.cancelAndHoldAtTime ?? env.gain.cancelScheduledValues).call(env.gain, at); env.gain.setTargetAtTime(0, at, offTime); };
  return (out, t, e) => {
    if (e.type !== 'hit') return;
    const pack = current();
    if (!pack) { classic(out, t, e); return; }
    const v2 = pack.meta.version === 2, keys = pack.meta.keys ?? keyMap;
    // Schlagart ohne Taste im Pack: Grundschlag; die halboffene Hi-Hat ist dann die offene, nach 0,1 s abgewürgt. art 'choke': der Schlag
    // würgt sich selbst nach artTime ab (Crash vor einem Stopp)
    let name = e.name, selfChoke = e.art === 'choke' ? e.artTime ?? 0.1 : 0;
    if (!Object.hasOwn(keys, name) && DRUM_FALLBACK[name]) { if (name === 'hatHalf') selfChoke ||= 0.1; name = DRUM_FALLBACK[name]; }
    if (!Object.hasOwn(keys, name)) return;
    let cents = 0, gain = tuned('level'), pickVel = e.vel;
    if (Number.isFinite(tuned('humanDb'))) { // immer alle drei ziehen, auch bei 0, damit die Folge gleich bleibt
      const pitch = rng.next(), loud = rng.next(), layer = rng.next();
      cents = (2 * pitch - 1) * tuned('humanCents');
      gain *= dbToGain((2 * loud - 1) * tuned('humanDb'));
      pickVel = Math.min(1, Math.max(0, e.vel + (2 * layer - 1) * tuned('layerSpread')));
    }
    const key = keys[name], zone = v2 ? roundRobin(pickZones(pack.meta.zones, key, e.vel), lastZone, key, rng) : pickZone(pack.meta.zones, key, pickVel);
    if (!zone) return;
    // Einmal-Sample: die Note dauert so lange wie das Sample (in seiner Abspielgeschwindigkeit), das Ausklingen danach hört man nicht mehr
    const hit = (z, g) => { const sample = pack.meta.samples[z.sample]; return playNote(ctx, out, t, { pack, zone: z, midi: key, dur: sample.frames / sample.rate / playbackRate(z, key), vel: e.vel, gain: g, cents }); };
    const env = hit(zone, gain);
    if (v2) {
      const roomMic = tuned('roomMic'), envs = [env];
      if (Number.isInteger(zone.room)) envs.push(hit({ ...zone, sample: zone.room }, gain * (Number.isFinite(roomMic) ? roomMic : 1)));
      if (selfChoke > 0) for (const x of envs) if (x) choke(x, t + selfChoke, CHOKE_TC);
      // off_by der Library: dieser Schlag würgt die klingenden ab, deren offBy seine Gruppe ist (Zeitkonstante ein Drittel von off_time)
      chokeable = chokeable.filter((c) => c.until > t);
      if (zone.group) for (const c of chokeable) if (c.offBy === zone.group) for (const x of c.envs) if (x) choke(x, t, c.offTime / 3);
      if (zone.offBy) chokeable.push({ offBy: zone.offBy, offTime: zone.offTime ?? 3 * CHOKE_TC, envs, until: t + 10 }); // nach 10 s ist jeder Schlag verklungen
      return;
    }
    if (selfChoke > 0 && env) { (env.gain.cancelAndHoldAtTime ?? env.gain.cancelScheduledValues).call(env.gain, t + selfChoke); env.gain.setTargetAtTime(0, t + selfChoke, CHOKE_TC); }
    const closed = name === 'hat' || e.name === 'hatPedal'; // auch die getretene Hi-Hat schließt die offene
    if (tuned('choke') >= 0.5 && (closed || name === 'openHat')) {
      if (closed && openHat) { openHat.gain.cancelScheduledValues(t); openHat.gain.setTargetAtTime(0, t, CHOKE_TC); }
      openHat = name === 'openHat' && !selfChoke ? env : null;
    }
  };
}
