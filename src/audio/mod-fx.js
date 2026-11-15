// Vibrato und Chorus einer Schicht (Bass, Akkorde, Pad, Lead) als Knotenkette hinter der Verzerrerkette: wirkt auf jede Stimme.
// Vibrato: die Schicht läuft durch eine kurze Verzögerung, deren Zeit ein LFO bewegt; die Tonhöhe schwankt um ±Cent, das Tempo des LFO
// folgt dem Songtempo wie das Vibrato der Lead-Regeln. Chorus: zwei verzögerte Kopien mit langsam bewegter Zeit, links und rechts gelegt,
// zum Original gemischt. Die Kette entsteht erst beim ersten Regler über 0; davor (und bei 0) geht das Signal unverändert durch einen
// Verstärkungsknoten mit 1. dispose() hält die LFOs an. Alle Zahlen in MOD sind Startwerte, nicht gehört.

export const MOD = Object.freeze({
  vibCents: 40, // Tonhöhenhub des Vibratos bei Regler 1 (±Cent)
  vibBase: 0.004, // Grundverzögerung des Vibratos (s); größer als der größte Hub der Verzögerung (0,93 ms)
  chorusBase: 0.018, chorusDepth: 0.003, // Verzögerung der Chorus-Kopien und ihr Hub (s)
  chorusHz: Object.freeze([0.6, 0.8]), // Tempo je Kopie (Hz): verschieden, damit sich das Muster nicht wiederholt
  chorusPan: 0.7, // Lage der Kopien (links, rechts)
  chorusLevel: 0.7, // Pegel einer Kopie bei Regler 1
});
const TC = 0.02; // Zeitkonstante der Reglerrampen (s), gegen Knacken
const num = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Kettenwerte aus { vibrato, chorus } (je 0..1; fehlend oder ungültig zählt 0) und dem Tempo. Reine Rechnung ohne Audio-Objekte.
 *  - vibrato: on, hz (4 Hz bei 60 bpm bis 5,5 Hz ab 120 bpm), depth = Hub der Verzögerung in s. Eine Verzögerung
 *    base + depth * sin(2π hz t) ändert die Tonhöhe um den Faktor 1 - depth * 2π hz * cos(…): depth folgt aus dem Hub in Cent.
 *  - chorus: wet = Pegel je Kopie, norm = Ausgleich, damit die Summe aus Original und zwei Kopien gleich laut bleibt
 *  - active: irgendein Regler über 0
 */
export function modParams({ vibrato, chorus } = {}, bpm = 100) {
  const v = num(vibrato), wet = MOD.chorusLevel * num(chorus);
  const hz = Math.min(5.5, Math.max(4, 4 + ((Number.isFinite(bpm) ? bpm : 100) - 60) / 40));
  return {
    active: v > 0 || wet > 0,
    vibrato: { on: v > 0, hz, depth: (2 ** ((MOD.vibCents * v) / 1200) - 1) / (2 * Math.PI * hz) },
    chorus: { wet, norm: 1 / Math.sqrt(1 + 2 * wet * wet) },
  };
}

/** Kette mit Ausgang an `destination`; die Schicht verbindet sich mit `input`. set(params, { immediate }) setzt die Werte aus modParams. */
export function createModFx(ctx, destination) {
  const input = ctx.createGain(), dry = ctx.createGain();
  input.connect(dry).connect(destination);
  const sources = []; // laufende LFOs, dispose hält sie an
  let chain = null, disposed = false;

  const build = (p) => {
    const gain = (value) => { const g = ctx.createGain(); g.gain.value = value; return g; };
    // Konstruktor statt ctx.createDelay(): die Live-Tests greifen das Echo der Summe an createDelay ab (genau eine Verzögerung je Satz)
    const delayOf = (seconds) => { const d = new DelayNode(ctx, { maxDelayTime: 0.05 }); d.delayTime.value = seconds; return d; };
    const lfo = (to) => { const o = ctx.createOscillator(); o.connect(to); o.start(); sources.push(o); return o; };
    // Vibrato: entweder gerade durch oder ganz durch die bewegte Verzögerung (kein Mischen: das gäbe einen Kammfilter)
    const straight = gain(1), vibWet = gain(0), vibDepth = gain(0), post = gain(1), vib = delayOf(MOD.vibBase);
    input.connect(straight).connect(post);
    input.connect(vib).connect(vibWet).connect(post);
    const vibLfo = lfo(vibDepth);
    // gleich mit dem richtigen Tempo starten: eine Rampe vom Standard des Oszillators (440 Hz) her verschöbe die Phase gegenüber einer
    // Kette, die von Anfang an lief (Browser-Test "setTimbre zwischen Extremen")
    vibLfo.frequency.value = p.vibrato.hz;
    vibDepth.connect(vib.delayTime);
    // Chorus: Original plus zwei Kopien; out gleicht den Pegel aus und blendet die Kette ein
    const wet = gain(0), out = gain(0);
    post.connect(out);
    wet.connect(out);
    out.connect(destination);
    MOD.chorusHz.forEach((hz, i) => {
      const copy = delayOf(MOD.chorusBase), depth = gain(MOD.chorusDepth), pan = ctx.createStereoPanner();
      pan.pan.value = (i ? 1 : -1) * MOD.chorusPan;
      lfo(depth).frequency.value = hz;
      depth.connect(copy.delayTime);
      post.connect(copy).connect(pan).connect(wet);
    });
    chain = { straight, vibWet, vibDepth, vibLfo, wet, out };
  };

  return {
    input,
    set(p, { immediate = false } = {}) {
      if (disposed) return;
      if (!chain) {
        if (!p.active) return;
        build(p);
      }
      const now = ctx.currentTime;
      const to = (param, value) => {
        if (immediate) { param.value = value; return; }
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.setTargetAtTime(value, now, TC);
        param.setValueAtTime(value, now + 10 * TC); // setTargetAtTime nähert sich nur an
      };
      to(dry.gain, p.active ? 0 : 1);
      to(chain.out.gain, p.active ? p.chorus.norm : 0);
      to(chain.straight.gain, p.vibrato.on ? 0 : 1);
      to(chain.vibWet.gain, p.vibrato.on ? 1 : 0);
      to(chain.vibDepth.gain, p.vibrato.depth);
      to(chain.vibLfo.frequency, p.vibrato.hz);
      to(chain.wet.gain, p.chorus.wet);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) source.stop();
      input.disconnect();
    },
  };
}
