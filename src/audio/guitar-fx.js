// Verzerrerkette einer Schicht (Bass, Akkorde oder Pad) als feste Knotenkette hinter den Stimmen: Overdrive -> Distortion -> Fuzz -> Box.
// Verzerrt wird die Summe aller klingenden Töne (nicht jeder Ton für sich): Akkordtöne mischen sich in der Kappung, und der Pegel der
// Hüllkurve steuert die Kappung, so wie die Gitarre den Verstärker. Die Kette entsteht erst beim ersten Regler über 0; davor geht das
// Signal unverändert durch einen Verstärkungsknoten mit 1. Werte und Vorbilder: fx-params.js.
import { LAYER_FX } from './fx-params.js';

const POINTS = 16385; // fein genug für die steilen Kappungen; einmal berechnet und von allen Schichten geteilt
const curveOf = (shape) => Float32Array.from({ length: POINTS }, (_, i) => shape((2 * i) / (POINTS - 1) - 1));
// Alle Kennlinien liegen im Eingangsbereich -1..1 des WaveShapers und sind bei 0 genau 0 (Stille bleibt Stille, kein Gleichanteil).
const CURVES = {
  // Overdrive: weich und symmetrisch wie Dioden in der Rückkopplung des Tube Screamer
  soft: () => curveOf((x) => Math.tanh(2.5 * x)),
  // Distortion: harter Knick wie RAT-Dioden gegen Masse, Knie bei 0.1; die Potenz 6 hält den Übergang ohne Sprung
  hard: () => curveOf((x) => { const z = x / 0.1; return z / (1 + Math.abs(z) ** 6) ** (1 / 6); }),
  // Fuzz, erste Stufe: Transistor wie im Fuzz Face. Die Quadrat-Beimischung hebt die positive Seite an (gerade Obertöne, Oktavklang),
  // und leise Töne verschwinden ins Sputtern; der Gleichanteil fällt im Hochpass dahinter weg
  fuzz: () => curveOf((x) => { const f = Math.tanh(6 * x); return (f + 0.3 * f * f) / 1.3; }),
  // Fuzz, zweite Stufe: weiche Dioden wie beim Big Muff
  muff: () => curveOf((x) => Math.tanh(3 * x)),
};
const memo = {};
const curve = (name) => (memo[name] ??= CURVES[name]());

const FUZZ_BIAS = 0.04; // Eingangspegel der Stimmen nach ref ist 0.15; 0.04 verschiebt die Nulldurchgänge um etwa ein Viertel
const START_DELAY = 0.15; // s, siehe set
const TC = 0.02; // Zeitkonstante der Reglerrampen (s), gegen Knacken

/**
 * Kette für `layer` ('bass' | 'chords' | 'pad'), Ausgang an `destination`. Die Stimmen verbinden sich mit `input`.
 * set(params, { immediate }) setzt die Werte aus fxChainParams; Rampen statt Sprüngen, es sei denn immediate.
 */
export function createGuitarFx(ctx, layer, destination) {
  const profile = LAYER_FX[layer];
  if (!profile) throw new Error(`No guitar effects for layer: ${layer}`);
  const input = ctx.createGain();
  const dry = ctx.createGain();
  input.connect(dry).connect(destination);

  const gain = (value, to) => { const g = ctx.createGain(); g.gain.value = value; if (to) g.connect(to); return g; };
  const filter = (type, frequency, q = 0.7, gainDb = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = frequency; f.Q.value = q; f.gain.value = gainDb;
    return f;
  };
  const shaper = (name, oversample) => { const s = ctx.createWaveShaper(); s.curve = curve(name); s.oversample = oversample; return s; };
  const series = (...nodes) => nodes.reduce((a, b) => { a.connect(b); return b; });

  let chain = null; // { wetOut, stages: {od, dist, fuzz}, cabDry, cabWet }

  const build = () => {
    const wetOut = gain(0, destination);
    // Stufe: Umgehung (1 - mix) und Wet-Pfad (mix) laufen in `out` zusammen; wet(from, makeup) baut den Pfad und gibt den Verstärkungsknoten zurück
    const stage = (from, wet) => {
      const out = gain(1);
      const bypass = gain(1, out);
      from.connect(bypass);
      const wetGain = gain(0, out);
      const makeup = gain(1, wetGain);
      return { out, bypass, wet: wetGain, makeup, drive: wet(from, makeup) };
    };

    const scaled = gain(profile.ref);
    input.connect(scaled);

    // Overdrive (Tube Screamer): saubere Tiefen plus durch einen Hochpass bei 720 Hz getriebene Mitten, weiche Kappung, Tiefpass
    const od = stage(scaled, (from, makeup) => {
      const sum = gain(1);
      const drive = gain(1);
      from.connect(sum);
      series(from, filter('highpass', 720), drive, sum);
      series(sum, shaper('soft', '2x'), filter('lowpass', 3500), makeup);
      return drive;
    });

    // Distortion (RAT): Bässe vor der Kappung beschnitten, viel Verstärkung bei begrenzter Bandbreite, harte Kappung, Filter danach
    const dist = stage(od.out, (from, makeup) => {
      const drive = gain(1);
      series(from, filter('highpass', profile.distHp), drive, filter('lowpass', 6000), shaper('hard', '4x'), filter('lowpass', 4500), makeup);
      return drive;
    });

    // Fuzz: Fuzz-Face-Stufe, Hochpass gegen den Gleichanteil, Big-Muff-Stufe, dann dessen Klangregelung (Tief- plus Hochpass, Mittensenke)
    const fuzz = stage(dist.out, (from, makeup) => {
      const drive = gain(1);
      // Vorspannung vor der Verstärkung (Fuzz Face): ein fester Bruchteil des Eingangspegels verschiebt die Nulldurchgänge, egal wie
      // stark getrieben wird (Rechteck mit ungleichen Hälften: gerade Obertöne), und leise Ausklänge fallen unter sie (Sputtern)
      const bias = ctx.createConstantSource();
      bias.offset.value = 0;
      bias.offset.setTargetAtTime(FUZZ_BIAS, ctx.currentTime, 0.04); // weich einlaufen: ein Sprung schwingt lange in den Hochpässen nach
      bias.connect(drive);
      bias.start();
      const muff = series(from, drive, shaper('fuzz', '4x'), filter('highpass', 35), gain(1.5), shaper('muff', '2x'));
      series(muff, filter('lowpass', profile.toneHz), gain(0.7), makeup);
      series(muff, filter('highpass', profile.toneHz), gain(0.6), makeup);
      return drive;
    });

    // Box: Hochpass, Resonanz- oder Präsenzbuckel, zwei Tiefpässe hintereinander (steiler Abfall); cabWet blendet sie ein
    const cabOut = gain(1);
    const cabDry = gain(1, cabOut);
    fuzz.out.connect(cabDry);
    const cabWet = gain(0, cabOut);
    series(fuzz.out, filter('highpass', profile.cabHp), filter('peaking', profile.cabPeakHz, 1.2, profile.cabPeakDb),
      filter('lowpass', profile.cabLp), filter('lowpass', profile.cabLp * 1.2), cabWet);
    series(cabOut, gain(1 / profile.ref), wetOut);

    chain = { wetOut, stages: { od, dist, fuzz }, cabDry, cabWet };
  };

  return {
    input,
    set(p, { immediate = false } = {}) {
      // Erster Aufbau: Stufen sofort setzen, die Kette selbst erst nach START_DELAY einblenden. Die Vorspannung des Fuzz erzeugt beim
      // Start einen Gleichanteil-Anstieg, der in den Hochpässen nachschwingt (gemessen: bis unter 1e-5 nach 100 ms); so hört man ihn nicht.
      let delay = 0;
      if (!chain) {
        if (!p.active) return;
        build();
        immediate = true;
        delay = START_DELAY;
      }
      const now = ctx.currentTime;
      const to = (param, value, wait = 0) => {
        if (immediate && wait === 0) { param.value = value; return; }
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.setTargetAtTime(value, now + wait, TC);
        param.setValueAtTime(value, now + wait + 10 * TC); // setTargetAtTime nähert sich nur an
      };
      to(dry.gain, p.active ? 0 : 1, delay);
      to(chain.wetOut.gain, p.active ? 1 : 0, delay);
      for (const name of ['od', 'dist', 'fuzz']) {
        const s = chain.stages[name], v = p[name];
        to(s.bypass.gain, 1 - v.mix);
        to(s.wet.gain, v.mix);
        to(s.drive.gain, v.drive);
        to(s.makeup.gain, v.makeup);
      }
      to(chain.cabDry.gain, 1 - p.cab);
      to(chain.cabWet.gain, p.cab);
    },
  };
}
