// Leslie der Tonewheel-Orgel (organ.js): zwei Rotoren hinter einer Frequenzweiche (Horn darüber, Trommel darunter), je Rotor zwei "Mikrofone"
// (links, rechts) im Winkel micAngle. Je Mikrofon ein LFO: er moduliert die Lautstärke (der Rotor zeigt zum Mikrofon = lauter) und gegenläufig
// eine kurze Verzögerung (dann ist der Weg am kürzesten: Doppler). Beide LFOs eines Rotors bekommen dieselbe Frequenz-Automation und bleiben so
// phasenstarr. Trägheit: die Drehzahl nähert sich dem Ziel exponentiell (setTargetAtTime), beim Bremsen langsamer als beim Beschleunigen; die
// Trommel dreht gegenläufig zum Horn. Alle Zahlen sind Startwerte, nicht gehört. Feinwerte: tunables.js.
// Bekannte Grenzen: kein Gehäuseklang (Lautsprecher, Holz), die Richtwirkung des Horns hängt nicht von der Frequenz ab, keine Reflexionen.

const BASE = 0.0005; // Grundverzögerung über die Doppler-Tiefe hinaus (s): die Verzögerung bleibt immer positiv
const BUTTERWORTH_DB = -3.0103; // Q von Tief- und Hochpass zählt in der Web Audio API in dB: -3,01 dB = 0,707 (ohne Überhöhung)
const SETTLE = 3; // die Feinwerte der Trägheit sind "Zeit bis etwa 95 % der neuen Drehzahl": Zeitkonstante = Zeit / 3

/** Ob das Leslie schnell dreht. mode: 0 aus, 1 folgt dem Ereignis (Feld leslie: 1 = schnell, sonst langsam), 2 immer langsam, 3 immer schnell. */
export const leslieFast = (mode, flag) => mode === 3 || (mode === 1 && flag === 1);

/**
 * Baut das Leslie; die LFOs starten bei `t0`. tune(v, t, set) setzt die festen Feinwerte (v = Name -> Wert, set = Setzer der Stimme),
 * speed(fast, v, t) stellt die Drehzahl um (das erste Mal ohne Anlauf), keep(until) lässt die LFOs bis `until` laufen (danach halten sie an,
 * damit eine verlassene Stimme den Graphen nicht am Leben hält).
 */
export function createLeslie(ctx, t0, micAngle) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), mix = ctx.createChannelMerger(2);
  input.connect(dry).connect(output);
  mix.connect(wet).connect(output);
  const rotor = (name, type, direction) => {
    // Weiche 4. Ordnung (zwei Butterworth-Filter hintereinander): Horn und Trommel ergeben zusammen wieder einen flachen Frequenzgang
    const bands = [0, 1].map(() => { const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = BUTTERWORTH_DB; return f; });
    input.connect(bands[0]).connect(bands[1]);
    const mics = [0, 1].map((channel) => {
      const phase = (direction * (channel - 0.5) * micAngle * Math.PI) / 180;
      const lfo = ctx.createOscillator(), delay = ctx.createDelay(0.02), amp = ctx.createGain(), am = ctx.createGain(), doppler = ctx.createGain();
      // cos(wt - phase), Amplitude 1
      lfo.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, Math.cos(phase)]), new Float32Array([0, Math.sin(phase)]), { disableNormalization: true }));
      lfo.connect(am).connect(amp.gain);
      lfo.connect(doppler).connect(delay.delayTime);
      bands[1].connect(delay).connect(amp).connect(mix, 0, channel);
      lfo.start(t0);
      return { lfo, delay, am, doppler };
    });
    return { name, bands, mics, hz: undefined };
  };
  const rotors = [rotor('horn', 'highpass', 1), rotor('drum', 'lowpass', -1)];
  return {
    input,
    output,
    tune(v, t, set) {
      const on = v('leslie') > 0;
      set(dry.gain, on ? 0 : 1, t);
      set(wet.gain, on ? 1 : 0, t);
      for (const r of rotors) {
        const depth = v(`${r.name}Doppler`) / 1000;
        for (const f of r.bands) set(f.frequency, v('crossover'), t);
        for (const m of r.mics) { set(m.am.gain, v(`${r.name}Am`), t); set(m.doppler.gain, -depth, t); set(m.delay.delayTime, BASE + depth, t); }
      }
    },
    speed(fast, v, t) {
      for (const r of rotors) {
        const hz = v(r.name + (fast ? 'Fast' : 'Slow'));
        if (hz === r.hz) continue;
        for (const { lfo } of r.mics) {
          if (r.hz === undefined) lfo.frequency.setValueAtTime(hz, t);
          else lfo.frequency.setTargetAtTime(hz, t, v(r.name + (hz > r.hz ? 'Up' : 'Down')) / SETTLE);
        }
        r.hz = hz;
      }
    },
    keep(until) {
      for (const r of rotors) for (const { lfo } of r.mics) lfo.stop(until);
    },
  };
}
