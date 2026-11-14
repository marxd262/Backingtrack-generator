// Tonewheel-Orgel (chords/organ/<preset>, versteckt): je Ton EIN Oszillator auf der Sub-Oktave (16'-Lage) mit einer PeriodicWave, deren Teiltöne
// die neun Zugriegel sind. Die Orgel reagiert nicht auf die Anschlagstärke. Alle Zahlen sind Startwerte, nicht gehört. Feinwerte: tunables.js.
// Kette (fest je Stimme, entsteht beim ersten Ton): Töne -> level -> out.
// Bekannte Grenze: Quint- und Terz-Zugriegel sind hier reine Obertöne; am Original sind es temperierte Räder (2 bzw. 14 Cent daneben).
import { hz } from '../nodes.js';
import { DRAWBARS } from './tunables.js';

const HARMONIC = [1, 3, 2, 4, 6, 8, 10, 12, 16]; // Teilton je Zugriegel über der Sub-Oktave (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1')
const SEMIS = [-12, 7, 0, 12, 19, 24, 28, 31, 36]; // Lage des Tonrads je Zugriegel in Halbtönen über der Taste
const WHEEL_LO = 36, WHEEL_HI = 114; // Räder, die die Manuale nutzen: C2 (Rad 13; die zwölf darunter gehören dem Pedal) bis F#8 (Rad 91)
// Zahnradpaare des Generators je Tonklasse ab C (treibend / getrieben, Motor 20 Umdrehungen je s, tiefstes Rad 2 Zähne): die Räder treffen die
// gleichstufige Stimmung nur fast. Abweichung in Cent, unter 0,8
const GEARS = [[85, 104], [71, 82], [67, 73], [105, 108], [103, 100], [84, 77], [74, 64], [98, 80], [96, 74], [88, 64], [67, 46], [108, 70]];
export const WHEEL_CENTS = GEARS.map(([a, b], pc) => 1200 * Math.log2((40 * a) / b / hz(24 + pc)));

const NOTE = 0.2; // Pegel eines Tons vor der Kette (die Welle hat rms 0,71)
const ATTACK = 0.004, RELEASE = 0.012; // Tastenkontakt: kurz, aber ohne Knacken
const PHASE = 2.399963; // Goldener Winkel: feste, verteilte Phasen der Teiltöne (Tonräder laufen nicht phasengleich; hält die Spitzen klein)

/**
 * Teilton-Gewichte (Index = Teilton über der Sub-Oktave, 0 bis 16) für Taste `midi` und die neun Zugriegelstellungen (0 bis 8, je Stufe 3 dB).
 * Foldback: liegt das Rad eines Zugriegels außerhalb des Generators, spielt das Rad eine Oktave tiefer (oben) bzw. höher (unten, 16' der
 * tiefsten Oktave); zwei Zugriegel auf demselben Rad addieren sich. Auf rms 1 der Summe normiert: der Mischpegel hängt nicht vom Preset ab.
 */
export function tonewheelPartials(midi, drawbars) {
  const out = new Float32Array(17);
  drawbars.forEach((n, i) => {
    if (!(n > 0)) return;
    let wheel = midi + SEMIS[i];
    while (wheel < WHEEL_LO) wheel += 12;
    while (wheel > WHEEL_HI) wheel -= 12;
    const h = HARMONIC[i] * 2 ** ((wheel - midi - SEMIS[i]) / 12);
    if (Number.isInteger(h)) out[h] += 10 ** ((-3 * (8 - n)) / 20); // kein ganzer Teilton: nur weit über dem Manual (ab MIDI 99)
  });
  const norm = Math.hypot(...out) || 1;
  return out.map((a) => a / norm);
}

export function organVoice(layer, ctx, { tuned }) {
  const waves = new Map(); // Taste und Zugriegel -> PeriodicWave
  const waveFor = (midi, bars) => {
    const key = `${midi}:${bars.join('')}`;
    if (!waves.has(key)) {
      const real = new Float32Array(17), imag = new Float32Array(17);
      tonewheelPartials(midi, bars).forEach((a, h) => { real[h] = a * Math.cos(h * PHASE); imag[h] = a * Math.sin(h * PHASE); });
      waves.set(key, ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
    }
    return waves.get(key);
  };
  let chain = null;
  const build = (out) => {
    const level = ctx.createGain();
    level.connect(out);
    return { out, input: level, level, applied: new Map() };
  };
  // Feinwerte der Kette: nur setzen, wenn sich der Wert geändert hat (sonst wüchse die Automationsliste mit jedem Ton)
  const set = (param, value, t) => { if (chain.applied.get(param) !== value) { chain.applied.set(param, value); param.setValueAtTime(value, t); } };

  return (out, t, e) => {
    if (e.type !== 'note') return;
    if (chain?.out !== out) chain = build(out);
    set(chain.level.gain, tuned('level'), t);
    const end = t + Math.max(0.03, e.dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(NOTE, t + ATTACK);
    amp.gain.setValueAtTime(NOTE, end);
    amp.gain.linearRampToValueAtTime(0, end + RELEASE);
    const o = ctx.createOscillator();
    o.setPeriodicWave(waveFor(e.midi, DRAWBARS.map(tuned)));
    o.frequency.value = hz(e.midi) / 2;
    o.detune.value = WHEEL_CENTS[((e.midi % 12) + 12) % 12];
    o.connect(amp).connect(chain.input);
    o.start(t);
    o.stop(end + RELEASE + 0.01);
  };
}
