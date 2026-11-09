// Instrumente (Synthese) hinter der Instrument-Schnittstelle. Klangerzeuger aus backing-demo.html übernommen,
// Rauschen aus dem Seed statt Math.random, damit Renders reproduzierbar sind. AudioContext nur von außen.
import { createRng } from '../core/rng.js';
import { DEFAULT_TIMBRE, completeTimbre } from '../core/timbre.js';
import { bassParams, drumParams, chordParams, padParams, masterParams } from './voice-params.js';
import { sliderGain } from './mix.js';
import { createGuitarFx } from './guitar-fx.js';
import { fxChainParams } from './fx-params.js';

// Schichtpegel und Summe, aus Messungen mit tests/e2e/levels.spec.js angeglichen (Messwerte dort im Kommentar)
const TRIM = { drums: 0.65, bass: 0.24, chords: 1, pad: 0.8 };
const MASTER = 0.6;
const TOMS = { tomHigh: 200, tomMid: 150, tomLow: 110 };

const LEVEL_TC = 0.02; // Zeitkonstante der Pegelrampe (s), gegen Knacken

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function noiseBuffer(ctx, rng, seconds, channels = 1, decay = 0) {
  const length = Math.ceil(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(channels, length, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < length; i++) d[i] = (rng.next() * 2 - 1) * Math.exp((-decay * i) / ctx.sampleRate);
  }
  return buf;
}

const adsr = (g, t, a, peak, hold, rel) => {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
};

function osc(ctx, type, freq, detune, dest, t, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(dest);
  o.start(t);
  o.stop(end);
  return o;
}

// Schlagzeugstimmen; p aus drumParams (beim neutralen Klang die bisherigen Konstanten). Toms folgen dem Klangmodell nicht.
function drumVoices(ctx, noise, p) {
  const kick = (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(p.kickStart, t); o.frequency.exponentialRampToValueAtTime(p.kickEnd, t + p.kickDrop);
    a.gain.setValueAtTime(v * p.kickPeak, t); a.gain.exponentialRampToValueAtTime(0.001, t + p.kickDecay);
    o.connect(a).connect(out); o.start(t); o.stop(t + p.kickDecay + 0.05);
    if (p.kickClick > 0) { // kurzer Anschlagklick aus Rauschen, nur wenn der Kick es verlangt
      const n = ctx.createBufferSource(); n.buffer = noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
      const c = ctx.createGain(); adsr(c, t, 0.001, v * p.kickClick, 0, 0.012);
      n.connect(lp).connect(c).connect(out); n.start(t); n.stop(t + 0.05);
    }
  };
  const snare = (out, t, v) => {
    const n = ctx.createBufferSource(); n.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.snareFreq; bp.Q.value = p.snareQ;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * p.snareNoise, 0.02, p.snareDecay);
    n.connect(bp).connect(a).connect(out); n.start(t); n.stop(t + p.snareDecay + 0.09);
    if (p.snareClick > 0) { // heller Anschlagklick, nur wenn die Snare es verlangt
      const c = ctx.createBufferSource(); c.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
      const g = ctx.createGain(); adsr(g, t, 0.001, v * p.snareClick, 0, 0.025);
      c.connect(hp).connect(g).connect(out); c.start(t); c.stop(t + 0.05);
    }
    const b = ctx.createGain(); adsr(b, t, 0.001, v * p.snareTone, 0.01, 0.1);
    osc(ctx, 'triangle', 185, 0, b, t, t + 0.15); b.connect(out);
  };
  const hat = (open) => (out, t, v) => {
    const hold = open ? 0.06 : 0.01, decay = open ? p.hatOpenDecay : p.hatClosedDecay;
    const n = ctx.createBufferSource(); n.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.hatFreq;
    const a = ctx.createGain(); adsr(a, t, 0.001, v * p.hatPeak, hold, decay);
    n.connect(hp).connect(a).connect(out); n.start(t); n.stop(t + Math.max(0.35, hold + decay + 0.05));
  };
  const tom = (f) => (out, t, v) => {
    const o = ctx.createOscillator(), a = ctx.createGain();
    o.frequency.setValueAtTime(f * 1.35, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    a.gain.setValueAtTime(v * 0.7, t); a.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(a).connect(out); o.start(t); o.stop(t + 0.42);
  };
  const voices = { kick, snare, hat: hat(false), openHat: hat(true) };
  for (const [name, f] of Object.entries(TOMS)) voices[name] = tom(f);
  return voices;
}

function gain(ctx, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  g.connect(dest);
  return g;
}

// Bass: zwei leicht verstimmte Sägezähne (oder Dreiecke) mit Tiefpass-Zupfhüllkurve, Sinus als Fundament,
// Verzerrer (Fuzz, Overdrive, Distortion) liegen hinter den Stimmen auf der ganzen Schicht (guitar-fx.js). p aus bassParams.
function bassNote(ctx, out, t, e, p) {
  const f = hz(e.midi), end = t + e.dur + 0.1;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = p.q;
  lp.frequency.setValueAtTime(p.lpStart, t); lp.frequency.exponentialRampToValueAtTime(p.lpEnd, t + p.lpTime);
  const hold = Math.max(p.holdMin, e.dur - p.holdCut);
  const a = ctx.createGain(); adsr(a, t, p.attack, e.vel * p.peak, hold, p.release);
  // zupfend: Abklingen während der Haltezeit; sustain 1 = flach wie bisher, dann ohne zusätzlichen Knoten
  if (p.sustain < 1) {
    const decay = gain(ctx, 1, out);
    decay.gain.setValueAtTime(1, t + p.attack);
    decay.gain.exponentialRampToValueAtTime(p.sustain, t + p.attack + hold);
    a.connect(decay);
  } else a.connect(out);
  for (const [type, mix] of [['sawtooth', p.sawMix], ['triangle', p.triMix]]) {
    if (mix === 0) continue;
    const bus = gain(ctx, mix, lp);
    for (const det of [-p.sawDetune, p.sawDetune]) osc(ctx, type, f, det, bus, t, end);
  }
  osc(ctx, 'sine', f, 0, gain(ctx, p.sineGain, a), t, end);
  lp.connect(a);
}

// Akkorde: kurzer Zupf/Stab je Ton (der Strom enthält Stabs oder Arpeggio-Töne). p aus chordParams (beim neutralen Klang die
// bisherigen Konstanten); Chorus-Oszillatoren und Tremolo-LFO nur, wenn der Klang sie verlangt.
function chordNote(ctx, out, t, e, p) {
  const f = hz(e.midi), hold = Math.max(0.01, e.dur * 0.5 * p.holdScale);
  const end = t + Math.max(e.dur + 0.3, p.attack + hold + p.release + 0.05);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(p.lpStart, t); lp.frequency.exponentialRampToValueAtTime(p.lpEnd, t + p.lpTime);
  const a = ctx.createGain(); adsr(a, t, p.attack, e.vel * p.peak, hold, p.release);
  osc(ctx, 'sawtooth', f, 0, lp, t, end);
  osc(ctx, 'square', f, 7, lp, t, end);
  if (p.chorusMix > 0) {
    for (const side of [-1, 1]) { // je ein verstimmter Sägezahn links und rechts; Breite und Chorus-Klang kommen aus Verstimmung (+/- Cent) und Panning, der um einige ms spätere Start staffelt nur den Einsatz (kein Delay-Knoten)
      const pan = ctx.createStereoPanner(); pan.pan.value = 0.6 * side; pan.connect(lp);
      osc(ctx, 'sawtooth', f, side * p.chorusDetune, gain(ctx, p.chorusMix, pan), t + (side < 0 ? 0.011 : 0.017), end);
    }
  }
  lp.connect(a);
  if (p.tremDepth > 0) {
    const trem = gain(ctx, p.tremBase, out);
    osc(ctx, 'sine', p.tremRate, 0, gain(ctx, p.tremDepth / 2, trem.gain), t, end);
    a.connect(trem);
  } else a.connect(out);
}

// Pad: langsamer Einsatz, verstimmte Sägezähne durch Tiefpass mit langsamem LFO, optional mehr Oszillatoren und Oktav-Anteile
function padNote(ctx, out, t, e, p) {
  // Einsatz länger als holdAttack: die Haltezeit schrumpft um das Mehr, damit der Akkord wie beim neutralen Klang kurz vor dem
  // Taktstrich ausklingt; passt der Einsatz nicht in die Note, wird er gekürzt (nie unter holdAttack, neutral also unverändert)
  const attack = Math.min(p.attack, Math.max(p.holdAttack, e.dur - p.holdCut - p.holdMin + p.holdAttack));
  const f = hz(e.midi), hold = Math.max(p.holdMin, e.dur - p.holdCut - Math.max(0, attack - p.holdAttack));
  const end = t + Math.max(e.dur + 1, attack + hold + p.release + 0.1);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = p.q; lp.frequency.value = p.cutoff;
  osc(ctx, 'sine', p.lfoSpeed, 0, gain(ctx, p.lfoDepth, lp.frequency), t, end);
  const a = ctx.createGain(); adsr(a, t, attack, e.vel * p.peak, hold, p.release);
  for (const det of [-p.spread, 0, p.spread]) osc(ctx, 'sawtooth', f, det, lp, t, end);
  if (p.extraMix > 0) {
    const bus = gain(ctx, p.extraMix, lp);
    for (const det of [-p.spread / 2, p.spread / 2]) osc(ctx, 'sawtooth', f, det, bus, t, end);
  }
  if (p.shimmerMix > 0) { // Oktav-Anteile (2f, 4f) am Tiefpass vorbei, leicht verstimmt gegeneinander
    for (const [mult, level, det] of [[2, 0.8, -4], [2, 0.8, 4], [4, 0.4, 0]]) osc(ctx, 'sine', f * mult, det, gain(ctx, p.shimmerMix * level, a), t, end);
  }
  lp.connect(a).connect(out);
}

/**
 * Baut die Instrumente und die Summenkette (Trims, Master, Echo auf Akkorde/Pad, Hall, Begrenzer).
 * `output` verbindet der Aufrufer mit ctx.destination. `trigger(event, when)` mit when in ctx-Zeit.
 * `timbre` (Klangmodell, siehe core/timbre.js) wird mit DEFAULT_TIMBRE aufgefüllt; ungültig zählt wie fehlend.
 * setTimbre(timbre) stellt den Klang live um: neue Töne klingen sofort neu (die Stimmen lesen ihre Parameter beim Anschlag),
 * die festen Knoten (Hall, Echo, Helligkeit, Raum-Sendeweg, Summenpegel) folgen über Rampen; schon laufende Töne bleiben.
 * `levels` ({drums, bass, chords, pad}, je 0..1) und `master` (0..1) sind Reglerstellungen des Mischpults (mix.js), Standard 1;
 * setLevel/setMaster ändern sie live. Der Gesamtpegel liegt hinter dem Begrenzer und ändert dessen Verhalten nicht.
 */
export function createInstruments(ctx, { bpm = 100, limiter: useLimiter = true, timbre = DEFAULT_TIMBRE, levels = {}, master: masterLevel = 1 } = {}) {
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

  for (const name of Object.keys(levels)) if (!Object.hasOwn(TRIM, name)) throw new Error(`Unknown layer: ${name}`);

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

  // Echo (punktierte Achtel) nur für Akkorde und Pad, nach der Stummschaltung abgegriffen; 3 s reichen bis 20 bpm
  const echoTime = (b) => (60 / b) * 0.75;
  const delay = ctx.createDelay(3); delay.delayTime.value = echoTime(bpm);
  const fb = ctx.createGain(); fb.gain.value = mix.echoFeedback;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = mix.echoTone;
  const echoWet = ctx.createGain(); echoWet.gain.value = mix.echoWet;
  delay.connect(tone).connect(fb).connect(delay);
  tone.connect(echoWet).connect(master);

  const drums = drumVoices(ctx, noise, drum);
  const roomSend = gain(ctx, drum.roomSend, reverb); // Raum-Sendeweg der Schlagzeugsumme in den Hall, immer vorhanden (0 = aus)
  const play = {
    drums: (out, t, e) => e.type === 'hit' && drums[e.name]?.(out, t, e.vel),
    bass: (out, t, e) => e.type === 'note' && bassNote(ctx, out, t, e, bass),
    chords: (out, t, e) => e.type === 'note' && chordNote(ctx, out, t, e, chord),
    pad: (out, t, e) => e.type === 'note' && padNote(ctx, out, t, e, pad),
  };

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
    const trim = ctx.createGain(); trim.gain.value = TRIM[name];
    mute.connect(level).connect(trim).connect(master);
    // room: Teil der Schlagzeugsumme in den Hall, hinter mute und trim abgegriffen (Stummschalten schaltet den Sendeweg mit stumm)
    if (name === 'drums') trim.connect(roomSend);
    if (name === 'chords' || name === 'pad') trim.connect(delay);
    // Bass, Akkorde und Pad laufen durch ihre Verzerrerkette (Regler auf 0: unveränderter Durchgang); das Schlagzeug hat keine
    const fx = name === 'drums' ? null : (guitarFx[name] = createGuitarFx(ctx, name, mute));
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
    // Echo folgt einem Live-Tempowechsel; weich nachgeführt (Zeitkonstante 50 ms) statt springend
    setTempo(newBpm) {
      delay.delayTime.setTargetAtTime(echoTime(newBpm), ctx.currentTime, 0.05);
    },
  };
}
