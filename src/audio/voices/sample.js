// Sample-Stimme: spielt Noten aus einem Pack (sampler.js). Das Pack wird beim Anlegen der Stimme geladen; bis es bereit ist (und wenn das
// Laden scheitert) spielt der klassische Synth, damit nichts aussetzt. Klangregler des Instruments (rohe Werte 0..1, Mitte 0.5 = Standard):
//   Bass:    cutoff -> Tiefpass
//   Akkorde: brightness -> Tiefpass, length -> Zeiten der Hüllkurve
//   Pad:     cutoff -> Tiefpass, attack -> Einsatzzeit
//   Lead:    keine (nur die Verzerrer hinter der Stimme)
// Feinwerte (level; decay als zusätzliches Abklingen bei Bass (finger, pick, upright), Gitarre, E-Piano und gedämpfter Gitarre; bei der Gitarre strum und ein Entzerrer lowDb, midDb,
// midHz, highDb, highHz gegen die nasale Mitte des Presets; bei allen Gitarren velExp (Anschlagkurve), softHz (Tiefpass bei leisem Anschlag),
// oneShot (ohne Endschleife), humanCents und humanDb (Zufallsabweichung je Anschlag)): tunables.js.
import { loadPack, peekPack, playNote, buffersFor } from './sampler.js';
import { brightnessHz, velocityGain, velocityBrightnessHz, dbToGain } from './sample-zones.js';

/**
 * Lädt das Pack für eine Stimme und meldet den Zustand ('loading'|'ready'|'error') über setStatus, den Ladevorgang über track (Promise-Sammler).
 * Ergebnis: () => Pack oder null (noch nicht geladen oder gescheitert). Auch für die Schlag-Stimmen (sample-hits.js).
 */
export function watchPack(packId, ctx, { setStatus, track }) {
  let pack = peekPack(packId) ?? null;
  if (pack) {
    buffersFor(ctx, pack); // einmal je Kontext in AudioBuffer umrechnen, nicht erst bei der ersten Note im Planerlauf
    setStatus('ready');
  } else {
    setStatus('loading');
    track(loadPack(packId).then(
      (loadedPack) => { buffersFor(ctx, loadedPack); pack = loadedPack; setStatus('ready'); },
      () => { setStatus('error'); },
    ));
  }
  return () => pack;
}

/**
 * deps: { getTimbre, tuned, classic (Rückfall-Stimme), setStatus('loading'|'ready'|'error'), track (Promise-Sammler: track(promise)), rng (seedbar,
 * für die Zufallsabweichung der Gitarren) }. Der Status gehört dem Aufrufer (createInstruments); diese Stimme meldet nur.
 */
export function sampleVoice(packId, layer, ctx, { getTimbre, tuned, classic, setStatus, track, rng }) {
  const current = watchPack(packId, ctx, { setStatus, track });
  let lastSong = -Infinity, strumIndex = 0;

  return (out, t, e) => {
    if (e.type !== 'note') return;
    const pack = current();
    if (!pack) { classic(out, t, e); return; }
    const timbre = getTimbre();
    let timeScale = 1, filter = 20000, when = t;
    if (layer === 'bass') filter = brightnessHz(timbre.cutoff);
    else if (layer === 'chords') {
      filter = brightnessHz(timbre.brightness);
      timeScale = 3 ** ((timbre.length - 0.5) * 2);
      if (tuned('strum') > 0) { // Akkordtöne mit gleichem Anschlagzeitpunkt (Liedzeit) werden leicht gestaffelt, in der Reihenfolge der Ereignisse
        const song = Number.isFinite(e.t) ? e.t : t;
        strumIndex = Math.abs(song - lastSong) < 0.001 ? strumIndex + 1 : 0;
        lastSong = song;
        when = t + strumIndex * tuned('strum');
      }
    } else if (layer === 'pad') {
      filter = brightnessHz(timbre.cutoff);
      timeScale = 3 ** ((timbre.attack - 0.5) * 2);
    }
    // Entzerrer nur bei Stimmen mit entsprechenden Feinwerten (Gitarre); sonst ist tuned() NaN
    const eq = Number.isFinite(tuned('midDb')) ? { lowDb: tuned('lowDb'), midDb: tuned('midDb'), midHz: tuned('midHz'), highDb: tuned('highDb'), highHz: tuned('highHz') } : null;
    let gain = tuned('level'), cents = 0, oneShot = false;
    if (Number.isFinite(tuned('velExp'))) { // Natürlichkeit nur bei Stimmen mit diesen Feinwerten (Gitarren), sonst bleibt alles wie zuvor
      const pitch = rng.next(), loud = rng.next(); // immer beide ziehen, auch bei 0, damit die Folge gleich bleibt
      cents = (2 * pitch - 1) * tuned('humanCents');
      // playNote multipliziert linear mit dem Anschlag; hier der Rest der Kurve und die Lautstärke-Abweichung
      gain *= (velocityGain(e.vel, tuned('velExp')) / velocityGain(e.vel, 1)) * dbToGain((2 * loud - 1) * tuned('humanDb'));
      filter = Math.min(filter, velocityBrightnessHz(e.vel, tuned('softHz')));
      oneShot = tuned('oneShot') >= 0.5;
    }
    playNote(ctx, out, when, { pack, midi: e.midi, dur: e.dur, vel: e.vel, gain, timeScale, filter, naturalDecay: tuned('decay'), eq, cents, oneShot });
  };
}
