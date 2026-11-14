// Artikulations-Schicht (Phase 3; Regeln: SPIELREGELN.md, Bauplan: SPEC_PHASE3.md): eigener Schritt auf dem fertigen Ereignisstrom, nach der
// Songform und vor dem Mikrotiming. Reine Logik, per Seed reproduzierbar. Der Schritt setzt Felder am Ereignis (art, artSemi, artTime, ring,
// strumUp), ändert Längen und Lautstärken und fügt Noten ein. Wie eine Artikulation klingt, entscheidet die Stimme (sampler.js: eigene
// Sample-Gruppe des Packs, sonst gerechnet, sonst normal). Alle Zahlen sind Startwerte aus den Regeln, nicht gehört.
// Feinwerte: on (0 = Schicht aus, Strom unverändert; Standard, bis der Nutzer geurteilt hat), bass und chords (Faktor auf die
// Wahrscheinlichkeiten der Schicht, 0 = Schicht ohne Artikulationen). Dazu das Track-Feld `ornaments` (Regler "Verzierungen", 0..1, fehlend 0,5):
// Faktor 2 · ornaments auf jede Wahrscheinlichkeit unter 0,8, höchstens 0,9; 0 = alles aus.
import { r6 } from './timeline.js';
import { byTime } from './event-helpers.js';
import { grooveIdFor } from './grooves.js';
import { phrasesOf } from './form-arrange.js';
import { densityAt } from './form-types.js';

export const ART_DEFAULTS = Object.freeze({ on: 0, bass: 1, chords: 1 });

/** Füllt die Feinwerte auf; nur endliche Zahlen >= 0 zählen. */
export function completeArt(options) {
  const out = { ...ART_DEFAULTS };
  for (const key of Object.keys(out)) if (Number.isFinite(options?.[key]) && options[key] >= 0) out[key] = options[key];
  return out;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const has = (track, group, tag) => (track.tags?.[group] ?? []).includes(tag);
const sameChord = (a, b) => a.root === b.root && a.quality === b.quality;

/** Stil-Profil der Regeln aus Groove und Schlagworten (SPEC_PHASE3, Abschnitt 6): der Track kennt seinen Stil nicht. Der erste Treffer gilt. */
export function profileOf(track) {
  const groove = grooveIdFor(track);
  if (groove === 'slowBlues') return 'slowBlues';
  if (groove === 'shuffle') return 'shuffle';
  if (groove === 'latin') return 'latin';
  if (groove === 'ballad68' || groove === 'waltz') return 'ballad';
  if (has(track, 'rhythm', 'swing')) return 'shuffle';
  if (has(track, 'rhythm', 'funky')) return 'funk';
  if (has(track, 'drums', 'halftime') && has(track, 'rhythm', 'syncopated')) return 'reggae';
  if (has(track, 'drums', 'halftime') || has(track, 'mood', 'dreamy')) return 'ballad';
  if (has(track, 'chordSound', 'ringing') && has(track, 'bassSound', 'plucky') && has(track, 'rhythm', 'straight')) return 'country';
  return 'rock';
}

/**
 * Kontext je Takt: kind (Teil-Typ, ohne Songform ''), phrase (Nummer der 4-Takt-Phrase im Teil) und inPhrase (Takt darin), rep (wie oft ein Teil
 * dieser Art schon lief), first/phraseStart (erster Takt des Teils/der Phrase), verse (Strophe im Sinn der Regeln: alles außer dem Refrain; ohne
 * Songform energy < 0,45), energy 0..1, stop (letzter Takt vor einem Stopp), change/nextChange (Akkordwechsel zu Beginn/am Ende des Takts).
 */
function barContexts(bars, sections, params) {
  const ctx = [], seen = {};
  sections.forEach((sec, k) => {
    const rep = seen[sec.kind] ?? 0;
    seen[sec.kind] = rep + 1;
    const last = sec.start + sec.bars - 1, stop = sections[k + 1]?.resolved?.transition === 'stop';
    phrasesOf(sec).forEach((ph, phrase) => {
      for (let i = ph.start; i < ph.start + ph.bars; i++) {
        const energy = sec.resolved ? clamp(0.5 + densityAt(sec.resolved, i - sec.start), 0, 1) : params.drive;
        ctx[i] = {
          kind: sec.kind ?? '', phrase, inPhrase: i - ph.start, rep, first: i === sec.start, phraseStart: i === ph.start,
          verse: sec.kind ? sec.kind !== 'chorus' : energy < 0.45, energy, stop: stop && i === last,
          change: i > 0 && !sameChord(bars[i].chord, bars[i - 1].chord), nextChange: i + 1 < bars.length && !sameChord(bars[i].next, bars[i].chord),
        };
      }
    });
  });
  return ctx;
}

/**
 * events: sortierter Strom nach der Songform; bars: barTimeline; sections: Abschnitte; params: aufgelöste Schlagworte; rng: eigener Zweig;
 * options: completeArt(). Liefert einen neuen, sortierten Strom (die Eingabe bleibt unverändert).
 */
export function articulate(events, { track, bars, sections, params, rng, options }) {
  const amount = track.ornaments ?? 0.5;
  if (!options.on || !(amount > 0)) return events;
  const tempo = clamp(110 / track.bpm, 0.5, 1.2); // Regel 7: schnell = weniger und kürzer
  const env = {
    track, bars, params, tempo, profile: profileOf(track), ctx: barContexts(bars, sections, params),
    /** Wahrscheinlichkeit einer Regel nach Regler, Tempo und Feinwert der Schicht; stilprägende Regeln (ab 0,8) werden nicht skaliert. */
    p: (base, layer) => (base >= 0.8 ? base : Math.min(0.9, base * 2 * amount * tempo * options[layer])),
    /**
     * Verzierungs-Plan (Regel 4): Zufallszahl 0..1 für eine Entscheidung, fest je Schicht, Teil-Typ, Phrase im Teil, Takt und Platz. Die
     * Wiederholung eines Teils bekommt so denselben Plan; ab der zweiten Runde wird jede Entscheidung mit 0,3 neu gezogen (70 % bleiben).
     */
    roll: (c, layer, name, slot = 0) => {
      const key = `${layer}:${c.kind}:${c.phrase}:${c.inPhrase}:${name}:${slot}`;
      return rng.fork(c.rep > 0 && rng.fork(`${key}:v${c.rep}`).next() < 0.3 ? `${key}:r${c.rep}` : key).next();
    },
    /** Zeit eines Rasterschritts mit Swing, ohne Zufall (den Rest macht das Mikrotiming). */
    slotTime: (b, s) => r6(b.start + s * b.stepSec + (b.sub === 4 && s % 2 ? (params.swing * b.stepSec) / 3 : 0)),
  };
  const out = events.map((e) => ({ ...e }));
  for (const [layer, rules] of Object.entries(RULES)) if (options[layer] > 0 && track.layers[layer]) rules(out, env);
  // Vorlauf (Regel 6, der Zielton kommt pünktlich): der Ton beginnt artTime früher, notfalls im Takt davor; im allerersten Takt entfällt der Vorlauf
  for (const e of out) {
    if (e.art !== 'slideIn' || !(e.artTime > 0)) continue;
    const t = r6(e.t - e.artTime), b = bars[t < bars[e.bar].start ? e.bar - 1 : e.bar];
    if (!b) continue;
    Object.assign(e, { t, dur: r6(e.dur + e.artTime), bar: b.index, beat: (t - b.start) / (b.stepSec * b.sub) });
  }
  return out.sort(byTime);
}

/** Regeln je Schicht: (Ereignisse, env) => void; sie ändern die Ereignisse und hängen neue an. */
const RULES = {};
