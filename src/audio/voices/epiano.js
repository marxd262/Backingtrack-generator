// E-Piano (Rhodes-artig) durch FM: ein Träger bei der Tonhöhe, ein Modulator im Frequenzverhältnis `ratio`, dessen Tiefe (Index) schnell
// abklingt; so wird der Anschlag glockig und der Ton wird weich. Dazu ein kurzer hoher Glockenanteil (die angeschlagene Zunge).
// Anschlagstärke steuert den Index (härter = heller). Klangregler: brightness skaliert den Index, length die Abklingzeit, tremolo wie bei
// den klassischen Akkorden. Feinwerte: tunables.js. Reiner Graph je Ton, alle Werte werden beim Anschlag gelesen.
import { hz, osc, gain } from '../nodes.js';

const REL = 0.18; // Ausklingen nach dem Notenende (s)

export function epianoVoice(layer, ctx, { params, getTimbre, tuned }) {
  return (out, t, e) => {
    if (e.type !== 'note') return;
    const timbre = getTimbre();
    const f = hz(e.midi);
    const dur = Math.max(0.05, e.dur);
    const bright = 2 ** ((timbre.brightness - 0.5) * 2);
    const stretch = 3 ** ((timbre.length - 0.5) * 2);
    const decay = tuned('decay') * stretch;
    const vel = Math.min(1, Math.max(0, e.vel));
    const index = tuned('index') * bright * (0.4 + 0.9 * vel);
    const end = t + dur + REL + 0.05;

    // Hüllkurve: kurzer Einsatz, exponentielles Abklingen über die Notenlänge, danach Ausklingen
    const amp = ctx.createGain();
    const peak = e.vel * params.peak * tuned('level');
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * Math.exp(-dur / decay)), t + dur);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + REL);

    // Träger, frequenzmoduliert; die Modulationstiefe (in Hz) klingt mit `indexDecay` auf ein Drittel ab
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = f;
    const depth = ctx.createGain();
    osc(ctx, 'sine', f * tuned('ratio'), 0, depth, t, end);
    depth.connect(carrier.frequency);
    depth.gain.setValueAtTime(index * f, t);
    depth.gain.exponentialRampToValueAtTime(Math.max(1e-3, index * f / 3), t + tuned('indexDecay'));
    carrier.start(t);
    carrier.stop(end);

    // Glocke: Sinus bei hohem Vielfachen, schneller Abfall
    const bellGain = gain(ctx, 0, amp);
    bellGain.gain.setValueAtTime(tuned('bell') * (0.3 + 0.7 * vel), t);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc(ctx, 'sine', Math.min(f * tuned('bellRatio'), ctx.sampleRate * 0.45), 0, bellGain, t, t + 0.15);

    carrier.connect(amp);
    // Tremolo wie bei den klassischen Akkorden (params aus chordParams), nur wenn der Klang es verlangt
    if (params.tremDepth > 0) {
      const trem = gain(ctx, params.tremBase, out);
      osc(ctx, 'sine', params.tremRate, 0, gain(ctx, params.tremDepth / 2, trem.gain), t, end);
      amp.connect(trem);
    } else amp.connect(out);
  };
}
