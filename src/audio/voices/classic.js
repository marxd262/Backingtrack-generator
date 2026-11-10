// Klassischer Synth (der bisherige Klang): Bass, Akkorde und Pad aus Oszillatoren, Tiefpass und Hüllkurve. Die Noten-Graphen sind
// unverändert aus synth.js hierher gezogen; der Standardklang bleibt bitgleich.
import { hz, adsr, osc, gain } from '../nodes.js';

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

const NOTE = { bass: bassNote, chords: chordNote, pad: padNote };

/** Stimme `synth/classic`: (out, t, e) spielt eine Note mit den live aktualisierten Parametern des Instruments (deps.params). */
export function classicVoice(layer, ctx, { params }) {
  const note = NOTE[layer];
  return (out, t, e) => e.type === 'note' && note(ctx, out, t, e, params);
}
