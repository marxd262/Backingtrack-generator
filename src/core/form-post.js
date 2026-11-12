// Songform: Nachbearbeitung der fertigen Ereignisse (Pausen, Wirbel, Stopps, Crash, Pegel). Reine Logik: neues Array, Eingabe bleibt unverändert,
// Marker und Akkorde bleiben unberührt. Alle Zahlen dieser Datei sind Startwerte (niemand kann hören); die Reihenfolge steht in der Spec.
import { levelAt, FEEL_DEFAULTS } from './form-types.js';
import { byTime, roundVel } from './event-helpers.js';
import { r6 } from './timeline.js';

/** Wahrscheinlichkeit einer Pause je Teil-Typ (mal Regler `pauses`). Der Bass pausiert nie: nur im Break dürfte er, und dort ist der Faktor 0. */
const PAUSE_FACTOR = { verse: 0.6, chorus: 0.25, intro: 0.5, outro: 0.5, build: 0, break: 0 };
const PAUSE_LAYERS = ['chords', 'pad', 'lead', 'percussion', 'drums'];
const KEEP = new Set(['kick', 'hat', 'openHat']); // das Schlagzeug pausiert nie ganz
const STOP_TWO_BEATS = 0.6; // ab diesem Regler zwei Schläge Stille
const CROSS = 0.01; // Ereignisse so kurz vor dem Stopp gehören zum Stopp (Jitter, Swing)
const ROLL = { from: 0.45, to: 0.95 };
const CRASH_FLOOR = 10 ** (-3 / 20); // der Crash wird nie leiser als -3 dB (die Samples sind ohnehin leise)

const isSound = (e) => e.type === 'note' || e.type === 'hit';
const removable = (e, layer) => e.layer === layer && isSound(e) && (layer !== 'drums' || !KEEP.has(e.name));

/**
 * @param {object[]} events sortierter Ereignisstrom von buildEvents
 * @param {object} track geprüfter Track mit gültiger Form
 * @param {object[]} bars barTimeline(track)
 * @param {object[]} sections buildFormArrangement(track).sections
 * @param {{ next(): number, pick(a: any[]): any }} rng master.fork('form')
 */
export function postProcess(events, track, bars, sections, rng) {
  const pauses = Number.isFinite(track.form.feel?.pauses) ? track.form.feel.pauses : FEEL_DEFAULTS.pauses;
  const transitionAfter = (sec) => sections[sec.index + 1]?.resolved.transition;
  let out = events;

  // (1) Pausen: je 4. Takt eines Teils fällt eine Schicht für diesen Takt aus
  const paused = new Map();
  for (const sec of sections) {
    for (let i = 3; i < sec.bars; i += 4) {
      if (i === sec.bars - 1 && (sec.fillAtEnd || transitionAfter(sec) === 'stop')) continue; // Fill- und Stopp-Takt bleiben voll (vor der Ziehung: der Strom bleibt stabil)
      if (rng.next() >= pauses * (PAUSE_FACTOR[sec.kind] ?? 0)) continue;
      const bar = sec.start + i;
      const candidates = PAUSE_LAYERS.filter((l) => out.some((e) => e.bar === bar && removable(e, l)));
      if (candidates.length) paused.set(bar, rng.pick(candidates));
    }
  }
  if (paused.size) out = out.filter((e) => !(paused.has(e.bar) && removable(e, paused.get(e.bar))));

  for (const sec of sections) {
    const lastBar = sec.start + sec.bars - 1;
    const b = bars[lastBar];
    const transition = transitionAfter(sec);

    // (2) Wirbel: ab der Taktmitte Snare in Achteln, dann Sechzehnteln, crescendo; die Kicks des Takts bleiben
    if (transition === 'roll' && track.layers.drums && sec.layers.drums) {
      const half = b.beats / 2;
      const unit = b.sub === 4 ? 2 : 1; // Schritte je Achtel (im Triolen-Raster ist der Schritt das Achtel)
      const mid = b.steps / 2;
      const steps = [];
      for (let s = mid; s < mid + (b.steps - mid) / 2; s += unit) steps.push(s);
      for (let s = mid + (b.steps - mid) / 2; s < b.steps; s += unit / 2) steps.push(s);
      out = out.filter((e) => !(e.bar === lastBar && e.type === 'hit' && e.layer === 'drums' && e.beat >= half && e.name !== 'kick'));
      steps.forEach((s, k) => out.push({
        t: r6(Math.min(b.start + s * b.stepSec, b.end - 0.001)), bar: lastBar, beat: s / b.sub, type: 'hit', layer: 'drums', name: 'snare',
        vel: roundVel(ROLL.from + ((ROLL.to - ROLL.from) * k) / (steps.length - 1)),
      }));
    }

    // (3) Stopp: ab dem letzten Schlag (ab den letzten zwei bei hohem Regler) bleibt der Takt still; Noten davor werden gekürzt
    const gap = Math.min(pauses >= STOP_TWO_BEATS ? 2 : 1, b.beats - 1);
    if (transition === 'stop' && gap > 0) {
      const from = b.end - (gap * 60) / track.bpm;
      out = out.flatMap((e) => {
        if (e.bar !== lastBar || !isSound(e)) return [e];
        if (e.beat >= b.beats - gap || e.t >= from - CROSS) return [];
        return e.type === 'note' && e.t + e.dur > from ? [{ ...e, dur: r6(from - e.t) }] : [e];
      });
    }
  }

  // (4) Crash: zur Eins jedes Teils mit crash, nie im allerersten Takt
  if (track.layers.drums) {
    out = [...out, ...sections.filter((s) => s.resolved.crash && s.start > 0)
      .map((s) => ({ t: r6(bars[s.start].start), bar: s.start, beat: 0, type: 'hit', layer: 'drums', name: 'crash', vel: 0.9 }))];
  }

  // (5) Pegel: Takt für Takt mal 10^(dB/20), nie über 1 (der Pegel ist höchstens 0 dB); der Crash höchstens um 3 dB gedämpft
  const gain = new Map();
  for (const sec of sections) for (let i = 0; i < sec.bars; i++) gain.set(sec.start + i, 10 ** (Math.min(0, levelAt(sec.resolved, i)) / 20));
  return out.map((e) => (isSound(e) ? { ...e, vel: roundVel(e.vel * (e.name === 'crash' ? Math.max(gain.get(e.bar), CRASH_FLOOR) : gain.get(e.bar))) } : e)).sort(byTime);
}
