// Tonewheel-Orgel (chords/organ/<preset>, versteckt): je Ton EIN Oszillator auf der Sub-Oktave (16'-Lage) mit einer PeriodicWave, deren Teiltöne
// die neun Zugriegel sind. Die Orgel reagiert nicht auf die Anschlagstärke. Alle Zahlen sind Startwerte, nicht gehört. Feinwerte: tunables.js.
// Kette (fest je Stimme, entsteht beim ersten Ton): Töne, Key-Click und Percussion -> pre -> Schweller -> Vorstufe -> Leslie (organ-leslie.js)
// -> level -> out.
// Key-Click (click, clickOff): kurzer Rauschstoß bei Note-On und leiser bei Note-Off, Pegel und Ausschnitt des Rauschens je Klick aus dem Seed.
// Percussion (perc, percHarm, percDecay): Sinus auf dem 2. oder 3. Teilton der 8'-Lage durch EINE gemeinsame Hüllkurve, single-trigger wie am Original.
// Leslie (leslie: 0 aus, 1 folgt dem Feld `leslie` der Töne aus core/organ.js, 2 immer langsam, 3 immer schnell).
// Schweller (swell: 0 aus, 1 = folgt dem Feld `swell` der Töne voll): Pedalstellung in dB aus der Songform (core/organ.js); ein Ton mit
// art 'swell' zieht das Pedal über artTime auf, sonst gleitet es über die Länge des Tons (höchstens GLIDE).
// Vorstufe (drive: 0 aus): weiche, leicht unsymmetrische Röhren-Kennlinie auf der Summe aller Töne, hinter dem Schweller wie am Original
// (mehr Pedal = mehr Zerre). Der Pegel bleibt bei einem typischen Akkord etwa gleich (DRIVE_REF).
// Bekannte Grenze: Quint- und Terz-Zugriegel sind hier reine Obertöne; am Original sind es temperierte Räder (2 bzw. 14 Cent daneben).
import { hz } from '../nodes.js';
import { DRAWBARS } from './tunables.js';
import { createLeslie, leslieFast } from './organ-leslie.js';

const HARMONIC = [1, 3, 2, 4, 6, 8, 10, 12, 16]; // Teilton je Zugriegel über der Sub-Oktave (16', 5⅓', 8', 4', 2⅔', 2', 1⅗', 1⅓', 1')
const SEMIS = [-12, 7, 0, 12, 19, 24, 28, 31, 36]; // Lage des Tonrads je Zugriegel in Halbtönen über der Taste
const WHEEL_LO = 36, WHEEL_HI = 114; // Räder, die die Manuale nutzen: C2 (Rad 13; die zwölf darunter gehören dem Pedal) bis F#8 (Rad 91)
// Zahnradpaare des Generators je Tonklasse ab C (treibend / getrieben, Motor 20 Umdrehungen je s, tiefstes Rad 2 Zähne): die Räder treffen die
// gleichstufige Stimmung nur fast. Abweichung in Cent, unter 0,8
const GEARS = [[85, 104], [71, 82], [67, 73], [105, 108], [103, 100], [84, 77], [74, 64], [98, 80], [96, 74], [88, 64], [67, 46], [108, 70]];
export const WHEEL_CENTS = GEARS.map(([a, b], pc) => 1200 * Math.log2((40 * a) / b / hz(24 + pc)));

const NOTE = 0.2; // Pegel eines Tons vor der Kette (die Welle hat rms 0,71)
const ATTACK = 0.004, RELEASE = 0.012; // Tastenkontakt: kurz, aber ohne Knacken
const CLICK_HP = 1000; // Hochpass des Key-Clicks (Hz): breitbandig, ohne Rumpeln
const CLICK_TC = 0.002; // Abklingen des Klicks (Zeitkonstante, s)
const HELD_EPS = 0.005; // so kurz vor dem Ende der letzten Taste gilt die Tastatur schon als frei (Mikrotiming verschiebt um Millisekunden)
const TAIL = 10; // so lange nach dem letzten Ton laufen die LFOs des Leslie weiter (s); danach baut der nächste Ton die Kette neu
const GLIDE = 1; // längste Zeit, in der das Schweller-Pedal ohne swell-Ereignis seine neue Stellung erreicht (s)
const DRIVE_MAX = 6; // Verstärkung vor der Kennlinie bei drive 1 (ein Akkord aus drei Tönen hat davor etwa rms 0,25, Spitzen bis 0,9)
const DRIVE_REF = 0.4; // Pegel, der mit und ohne Vorstufe gleich laut bleibt; so gewählt, dass der rms der Akkord-Schicht in den drei Hörproben-Fällen etwa bleibt
const RANGE = 4, BIAS = 0.2; // Kennlinie tanh(RANGE * x + BIAS) - tanh(BIAS) über den Eingangsbereich -1..1 des WaveShapers; BIAS macht sie unsymmetrisch (gerade Obertöne)
const TUBE = Float32Array.from({ length: 4097 }, (_, i) => Math.tanh(RANGE * (i / 2048 - 1) + BIAS) - Math.tanh(BIAS));
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

/**
 * Single-Trigger der Percussion: ein Ton bei `t` (bis `end`) löst nur aus, wenn keine andere Taste mehr gehalten wird. state = { held } merkt
 * sich das späteste Tastenende. Die übrigen Töne eines gleichzeitig gegriffenen Akkords lösen nicht neu aus, klingen aber durch dieselbe Hüllkurve.
 */
export function percussionGate(state, t, end) {
  const fire = t >= state.held - HELD_EPS;
  state.held = Math.max(state.held, end);
  return fire;
}

export function organVoice(layer, ctx, { tuned, rng, noise }) {
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
  const build = (out, t) => {
    const level = ctx.createGain(), pre = ctx.createGain(), percEnv = ctx.createGain(), clicks = ctx.createBiquadFilter();
    clicks.type = 'highpass'; clicks.frequency.value = CLICK_HP;
    percEnv.gain.value = 0;
    const leslie = createLeslie(ctx, t, tuned('micAngle'));
    const swell = ctx.createGain(), clean = ctx.createGain(), driveIn = ctx.createGain(), shaper = ctx.createWaveShaper(), dc = ctx.createBiquadFilter(), driveOut = ctx.createGain();
    shaper.curve = TUBE; shaper.oversample = '2x';
    dc.type = 'highpass'; dc.frequency.value = 20; // die unsymmetrische Kennlinie erzeugt einen Gleichanteil, der mit dem Pegel wandert
    clicks.connect(pre); percEnv.connect(pre); pre.connect(swell);
    swell.connect(clean).connect(leslie.input);
    swell.connect(driveIn).connect(shaper).connect(dc).connect(driveOut).connect(leslie.input);
    leslie.output.connect(level).connect(out);
    return { out, pre, level, clicks, percEnv, leslie, swell, clean, driveIn, driveOut, pedal: undefined, held: -Infinity, dead: t, applied: new Map() };
  };
  // Feinwerte der Kette: nur setzen, wenn sich der Wert geändert hat (sonst wüchse die Automationsliste mit jedem Ton)
  const set = (param, value, t) => { if (chain.applied.get(param) !== value) { chain.applied.set(param, value); param.setValueAtTime(value, t); } };

  return (out, t, e) => {
    if (e.type !== 'note') return;
    if (chain?.out !== out || t > chain.dead) chain = build(out, t);
    set(chain.level.gain, tuned('level'), t);
    const end = t + Math.max(0.03, e.dur);
    chain.dead = Math.max(chain.dead, end + TAIL);
    chain.leslie.keep(chain.dead);
    chain.leslie.tune(tuned, t, set);
    chain.leslie.speed(leslieFast(tuned('leslie'), e.leslie), tuned, t);
    const pedal = 10 ** ((tuned('swell') * (e.swell ?? 0)) / 20);
    if (chain.pedal === undefined) chain.swell.gain.setValueAtTime(pedal, t);
    else if (pedal !== chain.pedal) chain.swell.gain.setTargetAtTime(pedal, t, (e.art === 'swell' && e.artTime > 0 ? e.artTime : Math.min(end - t, GLIDE)) / 3);
    chain.pedal = pedal;
    const gain = DRIVE_MAX * tuned('drive');
    set(chain.clean.gain, gain > 0 ? 0 : 1, t);
    set(chain.driveIn.gain, gain / RANGE, t);
    set(chain.driveOut.gain, gain > 0 ? DRIVE_REF / Math.tanh(gain * DRIVE_REF) : 0, t);
    const cents = WHEEL_CENTS[((e.midi % 12) + 12) % 12];
    // Tastenkontakt: Oszillator durch eine kurze Rampe an `dest`
    const key = (o, freq, peak, dest) => {
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + ATTACK);
      amp.gain.setValueAtTime(peak, end);
      amp.gain.linearRampToValueAtTime(0, end + RELEASE);
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(amp).connect(dest);
      o.start(t);
      o.stop(end + RELEASE + 0.01);
    };
    const wheels = ctx.createOscillator();
    wheels.setPeriodicWave(waveFor(e.midi, DRAWBARS.map(tuned)));
    key(wheels, hz(e.midi) / 2, NOTE, chain.pre);

    const click = tuned('click');
    for (const [at, amount] of [[t, click], [end, click * tuned('clickOff')]]) {
      if (!(amount > 0)) continue;
      const g = ctx.createGain(), src = ctx.createBufferSource();
      src.buffer = noise;
      g.gain.setValueAtTime(amount * (0.7 + 0.6 * rng.next()), at);
      g.gain.setTargetAtTime(0, at, CLICK_TC);
      src.connect(g).connect(chain.clicks);
      src.start(at, 0.9 * rng.next(), 0.03);
    }

    const perc = tuned('perc');
    if (perc > 0) {
      if (percussionGate(chain, t, end)) {
        chain.percEnv.gain.setValueAtTime(1, t);
        chain.percEnv.gain.setTargetAtTime(0, t, tuned('percDecay') / Math.LN10); // percDecay = Zeit bis -20 dB
      }
      key(ctx.createOscillator(), hz(e.midi) * tuned('percHarm'), NOTE * perc, chain.percEnv);
    } else chain.held = Math.max(chain.held, end);
  };
}
