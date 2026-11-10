// Saitenstimmen: E-Bass (finger) und E-Gitarre (electric) aus dem Saitenmodell (string-model.js). Jeder Ton wird vorab als Puffer
// berechnet und als AudioBufferSourceNode gespielt. Die Klangregler des Instruments deuten sich so (rohe Werte 0..1, Mitte 0.5 = Standard):
//   Bass:    cutoff -> Helligkeit der Schleife, pluck -> kürzeres Abklingen, roundness -> dunklerer Anschlag, sub -> mehr Korpus, weniger Höhen
//   Akkorde: brightness -> Helligkeit der Schleife, length -> Abklingzeit
// Feinwerte (Zupfposition, Tonabnehmer ...) stehen in tunables.js. Rauschen kommt aus deps.rng, damit ein Render reproduzierbar bleibt.
import { renderString } from '../string-model.js';

const MAX_DUR = 3.5; // s, längere Töne werden gekürzt (Puffergröße, Rechenzeit)
const CACHE_SAMPLES = 16e6; // höchstens so viele Abtastwerte im Zwischenspeicher (64 MB), dann fliegt der älteste Puffer raus
const ROUND_ROBIN = 3; // gleiche Note mehrmals nacheinander klingt je Anschlag leicht anders (andere Rauschstöße)
const VEL_STEPS = 8;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const PARAM_NAMES = ['pluckPos', 'brightness', 'decay', 'excite', 'stiffness', 'pickupPos', 'pickupLp', 'body'];

export function stringVoice(layer, ctx, { getTimbre, rng, tuned }) {
  const cache = new Map();
  const turns = new Map(); // Reihum-Zähler je Ton und Anschlagstufe (begrenzt: höchstens 128 Töne mal 9 Stufen)
  let cached = 0; // Abtastwerte im Zwischenspeicher
  let lastT = -Infinity, strumIndex = 0;

  // Reglerwerte der Stimme für den aktuellen Anschlag: Feinwerte plus Deutung der Klangregler
  function paramsNow() {
    const timbre = getTimbre();
    const p = {};
    for (const name of PARAM_NAMES) p[name] = tuned(name);
    if (layer === 'bass') {
      p.brightness = clamp(p.brightness + (timbre.cutoff - 0.5) * 0.8 - 0.3 * timbre.sub, 0, 1);
      p.decay *= 2 ** ((0.5 - timbre.pluck) * 2);
      p.excite *= 1 - 0.6 * timbre.roundness;
      p.body = clamp(p.body + 0.5 * timbre.sub, 0, 1);
    } else {
      p.brightness = clamp(p.brightness + (timbre.brightness - 0.5) * 0.8, 0, 1);
      p.decay *= 3 ** ((timbre.length - 0.5) * 2);
    }
    return p;
  }

  return (out, t, e) => {
    if (e.type !== 'note') return;
    const p = paramsNow();
    const level = tuned('level');
    const dur = Math.round(Math.min(MAX_DUR, Math.max(0.05, e.dur)) * 20) / 20; // auf 50 ms gerundet: der Puffer wird mit genau diesem Wert gerechnet
    const seconds = dur + 0.3;
    const velStep = Math.round(clamp(e.vel, 0, 1) * VEL_STEPS);
    const turnKey = `${e.midi}|${velStep}`;
    const turn = turns.get(turnKey) ?? 0;
    turns.set(turnKey, (turn + 1) % ROUND_ROBIN);
    const id = `${turnKey}|${dur}|${ctx.sampleRate}|${PARAM_NAMES.map((n) => p[n].toFixed(4)).join(',')}|${turn}`;
    let buffer = cache.get(id);
    if (!buffer) {
      const data = renderString({ midi: e.midi, seconds, dur, vel: velStep / VEL_STEPS, sampleRate: ctx.sampleRate, seed: Math.floor(rng.next() * 2 ** 31), params: p });
      buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      cached += data.length;
      cache.set(id, buffer);
      for (const [oldId, old] of cache) {
        if (cached <= CACHE_SAMPLES || oldId === id) break;
        cache.delete(oldId);
        cached -= old.length;
      }
    }
    // Akkorde: Töne mit gleichem Anschlagzeitpunkt (Liedzeit e.t, nicht die von der Planer-Verzögerung begrenzte ctx-Zeit) werden leicht
    // gestaffelt (Strum), in der Reihenfolge der Ereignisse
    let when = t;
    if (layer === 'chords') {
      const song = Number.isFinite(e.t) ? e.t : t;
      strumIndex = Math.abs(song - lastT) < 0.001 ? strumIndex + 1 : 0;
      lastT = song;
      when = t + strumIndex * tuned('strum');
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(out);
    src.start(when);
  };
}
