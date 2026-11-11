// Instrumente (Synthese) hinter der Instrument-Schnittstelle. Klangerzeuger aus backing-demo.html übernommen,
// Rauschen aus dem Seed statt Math.random, damit Renders reproduzierbar sind. AudioContext nur von außen.
import { createRng } from '../core/rng.js';
import { DEFAULT_TIMBRE, completeTimbre } from '../core/timbre.js';
import { bassParams, drumParams, chordParams, padParams, masterParams } from './voice-params.js';
import { sliderGain } from './mix.js';
import { createGuitarFx } from './guitar-fx.js';
import { fxChainParams } from './fx-params.js';
import { noiseBuffer, gain } from './nodes.js';
import { createVoice } from './voices/index.js';
import { completeVoices, VOICE_LAYERS } from '../core/voices.js';
import { LAYERS, LAYER_IDS } from '../core/layers.js';

// Schichtpegel und Summe, aus Messungen mit tests/e2e/levels.spec.js angeglichen (Messwerte dort im Kommentar)
// trim: Pegel der Schicht; room: Teil der Summe in den Hall; echo: Echo (punktierte Achtel)
// lead: gemessen mit tests/e2e/levels.spec.js (Job melody); percussion: ebenda (Job mixed), rms etwa ein Drittel des Schlagzeugs
export const LAYER_AUDIO = Object.freeze(Object.fromEntries(Object.entries({
  drums: { trim: 0.65, room: true },
  bass: { trim: 0.24 },
  chords: { trim: 1, echo: true },
  pad: { trim: 0.8, echo: true },
  lead: { trim: 0.5, echo: true },
  percussion: { trim: 0.33, room: true },
}).map(([k, v]) => [k, Object.freeze(v)])));
const MASTER = 0.6;

const LEVEL_TC = 0.02; // Zeitkonstante der Pegelrampe (s), gegen Knacken

/**
 * Baut die Instrumente und die Summenkette (Trims, Master, Echo auf Akkorde, Pad und Lead, Hall, Begrenzer).
 * `output` verbindet der Aufrufer mit ctx.destination. `trigger(event, when)` mit when in ctx-Zeit.
 * `timbre` (Klangmodell, siehe core/timbre.js) wird mit DEFAULT_TIMBRE aufgefüllt; ungültig zählt wie fehlend.
 * setTimbre(timbre) stellt den Klang live um: neue Töne klingen sofort neu (die Stimmen lesen ihre Parameter beim Anschlag),
 * die festen Knoten (Hall, Echo, Helligkeit, Raum-Sendeweg, Summenpegel) folgen über Rampen; schon laufende Töne bleiben.
 * `levels` (je Schicht aus LAYER_IDS, je 0..1) und `master` (0..1) sind Reglerstellungen des Mischpults (mix.js), Standard 1;
 * setLevel/setMaster ändern sie live. Der Gesamtpegel liegt hinter dem Begrenzer und ändert dessen Verhalten nicht.
 */
export function createInstruments(ctx, { bpm = 100, limiter: useLimiter = true, timbre = DEFAULT_TIMBRE, levels = {}, master: masterLevel = 1, voices, tuning } = {}) {
  let sound = completeTimbre(timbre);
  // Parameterobjekte bleiben dieselben, setTimbre überschreibt nur ihre Felder (die Stimmen halten sie als Referenz)
  const mix = {}, drum = {}, bass = {}, chord = {}, pad = {};
  const applyTimbre = () => {
    Object.assign(mix, masterParams(sound.master));
    Object.assign(drum, drumParams(sound.drums));
    Object.assign(bass, bassParams(sound.bass));
    Object.assign(chord, chordParams(sound.chords));
    Object.assign(pad, padParams(sound.pad));
  };
  applyTimbre();
  const rng = createRng(1);
  const noise = noiseBuffer(ctx, rng.fork('noise'), 1);

  for (const name of Object.keys(levels)) if (!Object.hasOwn(LAYER_AUDIO, name)) throw new Error(`Unknown layer: ${name}`);

  const master = ctx.createGain(); master.gain.value = MASTER * mix.level;
  // Hall: Rauschen aus dem Seed, exponentiell abklingend (2 s), als Impulsantwort
  const reverb = ctx.createConvolver(); reverb.buffer = noiseBuffer(ctx, rng.fork('reverb'), 2, 2, 3);
  const reverbWet = ctx.createGain(); reverbWet.gain.value = mix.reverbWet;
  // Begrenzer: harte Kennlinie, kurze Ansprache; Chrome hebt automatisch nach, -10 dB ergeben gemessene Spitzen um 0,70.
  // limiter: false (nur für Pegeltests) ersetzt ihn durch eine neutrale Summe, gemessen wird dann die Mischung davor.
  const limiter = useLimiter ? ctx.createDynamicsCompressor() : ctx.createGain();
  if (useLimiter) {
    limiter.threshold.value = -10; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.1;
  }
  // Helligkeit: Hochregal auf der Summe (Trockenanteil und Hall); immer vorhanden, damit setTimbre es live verstellen kann (0 dB = neutral)
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = mix.shelfFreq; shelf.gain.value = mix.shelfDb;
  shelf.connect(limiter);
  const bus = shelf;
  master.connect(bus);
  master.connect(reverb).connect(reverbWet).connect(bus);

  // Echo (punktierte Achtel) nur für Akkorde, Pad und Lead (LAYER_AUDIO.echo), nach der Stummschaltung abgegriffen; 3 s reichen bis 20 bpm
  const echoTime = (b) => (60 / b) * 0.75;
  const delay = ctx.createDelay(3); delay.delayTime.value = echoTime(bpm);
  const fb = ctx.createGain(); fb.gain.value = mix.echoFeedback;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = mix.echoTone;
  const echoWet = ctx.createGain(); echoWet.gain.value = mix.echoWet;
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(echoWet).connect(master);

  const roomSend = gain(ctx, drum.roomSend, reverb); // Raum-Sendeweg der Schlagzeugsumme in den Hall, immer vorhanden (0 = aus)
  // Wählbare Stimmen (core/voices.js): je Instrument eine Umsetzung, die setVoices austauscht; neue Töne klingen sofort in der neuen Stimme,
  // schon laufende Töne klingen in der alten aus. Feinwerte (Tuning) liest die Stimme beim Anschlag.
  const isRecord = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
  const layerParams = { drums: drum, bass, chords: chord, pad, lead: {} };
  let chosen = completeVoices(voices);
  let tuningState = isRecord(tuning) ? tuning : {};
  const impl = {}, built = {};
  // Ladezustand der Stimmen (Samples laden ihr Pack beim Anlegen): 'none' (nichts zu laden), 'loading', 'ready', 'error'. Jede gebaute
  // Stimme hat eine eigene Nummer, damit eine überholte (schon gewechselte) Stimme den Zustand der neuen nicht überschreibt.
  const status = Object.fromEntries(VOICE_LAYERS.map((l) => [l, 'none'])), generation = Object.fromEntries(VOICE_LAYERS.map((l) => [l, 0]));
  const pending = new Set();
  // nur Instrumente neu bauen, deren Stimme sich geändert hat (der Zwischenspeicher und der Strum der anderen bleiben erhalten);
  // eine Stimme im Fehlerzustand wird beim erneuten Wählen neu gebaut, das versucht das Laden noch einmal
  const buildVoices = () => {
    for (const layer of VOICE_LAYERS) {
      const same = built[layer]?.id === chosen[layer].id && built[layer]?.variant === chosen[layer].variant;
      if (same && status[layer] !== 'error') continue;
      built[layer] = chosen[layer];
      status[layer] = 'none';
      const mine = ++generation[layer];
      impl[layer] = createVoice(layer, chosen[layer], ctx, {
        params: layerParams[layer], getTimbre: () => sound[layer], rng: rng.fork(`voice-${layer}`), noise, getTuning: () => tuningState,
        setStatus: (value) => { if (generation[layer] === mine) status[layer] = value; },
        track: (promise) => {
          const settled = promise.then(() => {}, () => {}); // nie abgelehnt: whenReady wartet nur, der Fehler gehört der Stimme
          pending.add(settled);
          settled.then(() => pending.delete(settled));
        },
      });
    }
  };
  buildVoices();
  // jede Schicht spielt die Ereignisse ihrer gewählten Stimme
  const play = Object.fromEntries(LAYER_IDS.map((name) => [name, (out, t, e) => impl[name](out, t, e)]));

  // Lautstärke weich nachführen und am Ende exakt setzen (setTargetAtTime nähert sich nur an)
  const ramp = (g, value) => {
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(value, now, LEVEL_TC);
    g.setValueAtTime(value, now + 10 * LEVEL_TC);
  };
  const gainNode = (v) => { const g = ctx.createGain(); g.gain.value = sliderGain(v); return g; };
  const volume = gainNode(masterLevel); // ganz am Ausgang, hinter dem Begrenzer
  limiter.connect(volume);

  const layers = {};
  const levelGains = {};
  const guitarFx = {};
  for (const [name, voice] of Object.entries(play)) {
    const mute = ctx.createGain();
    // Schichtpegel vor dem Trim: Hall-, Raum- und Echo-Sendewege hängen hinter dem Trim und folgen ihm
    const level = levelGains[name] = gainNode(levels[name] ?? 1);
    const trim = ctx.createGain(); trim.gain.value = LAYER_AUDIO[name].trim;
    mute.connect(level).connect(trim).connect(master);
    // room: Teil der Schlagzeugsumme in den Hall, hinter mute und trim abgegriffen (Stummschalten schaltet den Sendeweg mit stumm)
    if (LAYER_AUDIO[name].room) trim.connect(roomSend);
    if (LAYER_AUDIO[name].echo) trim.connect(delay);
    // Schichten mit fx (Registry) laufen durch ihre Verzerrerkette (Regler auf 0: unveränderter Durchgang); Schlagzeug und Percussion haben keine
    const fx = LAYERS[name].fx ? (guitarFx[name] = createGuitarFx(ctx, name, mute)) : null;
    layers[name] = {
      trigger(event, when) {
        if (event.layer === name) voice(fx ? fx.input : mute, when, event);
      },
      setMuted(on) {
        // kurze Rampe gegen Knacken, endet exakt auf 0 bzw. 1
        const g = mute.gain, now = ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(on ? 0 : 1, now + 0.02);
      },
    };
  }
  // Regler der Verzerrer aus dem Klangmodell auf die Ketten übertragen (live; Rampen statt Sprünge)
  const applyFx = (options) => { for (const [name, fx] of Object.entries(guitarFx)) fx.set(fxChainParams(sound[name], name), options); };
  applyFx({ immediate: true });
  return {
    output: volume,
    layers,
    // v: Reglerstellung 0..1; ungültig wirft RangeError
    setLevel(name, v) {
      if (!Object.hasOwn(levelGains, name)) throw new Error(`Unknown layer: ${name}`);
      ramp(levelGains[name].gain, sliderGain(v));
    },
    setMaster(v) {
      ramp(volume.gain, sliderGain(v));
    },
    // timbre: wie die Option gleichen Namens (unvollständig oder ungültig wird aufgefüllt)
    // Wartet, bis alle Packs der gewählten Stimmen geladen sind (oder gescheitert; wirft nie). Bis dahin spielt der klassische Synth.
    async whenReady() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    // Ladezustand je Instrument: 'none' | 'loading' | 'ready' | 'error'
    voiceStatus: () => ({ ...status }),
    // Stimmen wechseln (wie die Option `voices`; unvollständig oder ungültig wird mit dem Standard aufgefüllt); wirkt auf neue Töne
    setVoices(next) {
      chosen = completeVoices(next);
      buildVoices();
    },
    // Feinwerte der Stimmen überschreiben ({ 'bass/string/finger': { name: Wert } }, siehe voices/tunables.js); wirkt auf neue Töne
    setTuning(next) {
      tuningState = isRecord(next) ? next : {};
    },
    setTimbre(next) {
      sound = completeTimbre(next);
      applyTimbre();
      ramp(master.gain, MASTER * mix.level);
      ramp(reverbWet.gain, mix.reverbWet);
      ramp(shelf.gain, mix.shelfDb);
      ramp(fb.gain, mix.echoFeedback);
      ramp(echoWet.gain, mix.echoWet);
      ramp(roomSend.gain, drum.roomSend);
      applyFx();
    },
    // nach dem Stopp: hält die Quellen der Verzerrerketten an (sonst hielten sie den ganzen Graphen am Leben)
    dispose() {
      for (const fx of Object.values(guitarFx)) fx.dispose();
    },
    // Echo folgt einem Live-Tempowechsel; weich nachgeführt (Zeitkonstante 50 ms) statt springend
    setTempo(newBpm) {
      delay.delayTime.setTargetAtTime(echoTime(newBpm), ctx.currentTime, 0.05);
    },
  };
}
