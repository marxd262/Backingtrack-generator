// Artikulations-Schicht (Phase 3; Regeln: SPIELREGELN.md, Bauplan: SPEC_PHASE3.md): eigener Schritt auf dem fertigen Ereignisstrom, nach der
// Songform und vor dem Mikrotiming. Reine Logik, per Seed reproduzierbar. Der Schritt setzt Felder am Ereignis (art, artSemi, artTime, ring,
// strumUp), ändert Längen und Lautstärken und fügt Noten ein. Wie eine Artikulation klingt, entscheidet die Stimme (sampler.js: eigene
// Sample-Gruppe des Packs, sonst gerechnet, sonst normal). Alle Zahlen sind Startwerte aus den Regeln, nicht gehört.
// Feinwerte: on (0 = Schicht aus, Strom unverändert; Standard, bis der Nutzer geurteilt hat), bass und chords (Faktor auf die
// Wahrscheinlichkeiten der Schicht, 0 = Schicht ohne Artikulationen). Dazu das Track-Feld `ornaments` (Regler "Verzierungen", 0..1, fehlend 0,5):
// Faktor 2 · ornaments auf jede Wahrscheinlichkeit unter 0,8, höchstens 0,9; 0 = alles aus.
import { r6 } from './timeline.js';
import { byTime, roundVel } from './event-helpers.js';
import { diatonicChords, noteToPc } from './music.js';
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
 * Verzierungs-Plan (Regel 4): Zufallszahl 0..1 für die Entscheidung `name`, fest je Teil-Typ, Phrase im Teil und Takt der Phrase (c aus
 * barContexts). Die Wiederholung eines Teils bekommt so denselben Plan; ab der zweiten Runde wird jede Entscheidung mit 0,3 neu gezogen.
 */
export function planRoll(rng, c, name) {
  const key = `${c.kind}:${c.phrase}:${c.inPhrase}:${name}`;
  return rng.fork(c.rep > 0 && rng.fork(`${key}:v${c.rep}`).next() < 0.3 ? `${key}:r${c.rep}` : key).next();
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
    roll: (c, layer, name, slot = 0) => planRoll(rng, c, `${layer}:${name}:${slot}`),
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

// Werte je Stil-Profil (Wahrscheinlichkeiten vor Regler, Tempo und Feinwert; fehlt ein Eintrag, greift die Regel nicht).
// Bass: hold = Grundhaltung der Notenlänge, dead, slideIn, approach (chromatic: Halbton statt Tonleiterton, nur im Blues erlaubt)
const PROFILES = {
  shuffle: { bass: { hold: 'legato', approach: 0.4, slideIn: 0.25, chromatic: true } },
  slowBlues: { bass: { hold: 'legato', slideIn: 0.3, chromatic: true } },
  rock: { bass: { slideIn: 0.15, dead: 0.05 } },
  funk: { bass: { hold: 'staccato', dead: 0.35, slideIn: 0.15 } },
  ballad: { bass: { hold: 'legato', slideIn: 0.1 } },
  reggae: { bass: { hold: 'legato', slideIn: 0.15 } },
  latin: { bass: { hold: 'legato' } },
  country: { bass: { approach: 0.4, slideIn: 0.1 } },
};

/** Regeln je Schicht: (Ereignisse, env) => void; sie ändern die Ereignisse und hängen neue an. */
const RULES = {
  // E-Bass, Priorität A (SPEC_PHASE3 5.1), in der Reihenfolge Notenwahl (approach, dead), Länge (staccato, legato), Verzierung (slideIn).
  // Einstimmigkeit: Noten, in die eine neue oder vorgezogene Note fällt, kürzt das Mikrotiming danach.
  bass(out, { track, bars, ctx, profile, tempo, p, roll, slotTime }) {
    const variant = track.voices?.bass?.variant, P = PROFILES[profile].bass;
    if (variant === 'upright') return; // der Kontrabass hat eigene Regeln (Priorität B und C)
    const notes = () => out.filter((e) => e.layer === 'bass' && e.type === 'note').sort(byTime);
    const stepOf = (e) => Math.round(e.beat * bars[e.bar].sub);
    const add = (b, s, fields) => out.push({ t: slotTime(b, s), bar: b.index, beat: s / b.sub, type: 'note', layer: 'bass', ...fields });
    const playing = new Set(notes().map((n) => n.bar)); // Takte, in denen der Bass spielt

    // approach: vor einem Akkordwechsel auf dem letzten Achtel ein Ton einen Schritt unter (60 %) oder über der ersten Note des neuen Takts;
    // ersetzt, was dort liegt. Tonleiterton, im Blues der Halbton
    if (P.approach) {
      const scale = new Set(diatonicChords(track.key).map((c) => noteToPc(c.root)));
      const first = new Map(notes().filter((n) => stepOf(n) === 0).map((n) => [n.bar, n]));
      for (const b of bars) {
        const c = ctx[b.index], target = first.get(b.index + 1), s = b.steps - (b.sub === 4 ? 2 : 1);
        if (!c.nextChange || c.stop || !target || !playing.has(b.index) || !(roll(c, 'bass', 'approach') < p(P.approach, 'bass'))) continue;
        const dir = roll(c, 'bass', 'approachDir') < 0.6 ? -1 : 1;
        let midi = target.midi + dir;
        if (!P.chromatic) while (!scale.has(((midi % 12) + 12) % 12)) midi += dir;
        for (let i = out.length - 1; i >= 0; i--) if (out[i].layer === 'bass' && out[i].type === 'note' && out[i].bar === b.index && stepOf(out[i]) >= s) out.splice(i, 1);
        add(b, s, { midi, vel: target.vel, dur: r6(b.end - slotTime(b, s)), art: 'approach' });
      }
    }

    // dead: auf einem freien schwachen 16tel (e oder a) direkt vor einer Note eine Dead Note auf deren Ton
    if (P.dead) {
      const list = notes();
      list.forEach((n, i) => {
        const b = bars[n.bar], s = stepOf(n), prev = list[i - 1];
        if (b.sub !== 4 || s % 2 || n.art) return; // nur vor Zählzeit oder "+": der Platz davor ist ein e oder a
        const at = s > 0 ? b : bars[n.bar - 1], slot = s > 0 ? s - 1 : (at?.steps ?? 0) - 1;
        if (!at || at.sub !== 4 || !playing.has(at.index) || (at !== b && ctx[at.index].stop)) return;
        const c = ctx[at.index];
        if ((prev && prev.bar === at.index && stepOf(prev) >= slot) || !(roll(c, 'bass', 'dead', slot) < p(P.dead, 'bass'))) return; // dort spielt der Bass schon
        add(at, slot, { midi: n.midi, vel: roundVel(0.3 + 0.2 * roll(c, 'bass', 'deadVel', slot)), dur: r6(0.03 + 0.03 * roll(c, 'bass', 'deadDur', slot)), art: 'dead' });
      });
    }

    const list = notes();
    list.forEach((n, i) => {
      if (n.art === 'dead') return;
      const b = bars[n.bar], c = ctx[n.bar], next = list[i + 1];
      // Länge: Grundhaltung des Profils (Rock nur mit Pick kurz); die letzte Note vor einem Stopp ist immer kurz
      const hold = c.stop && next?.bar !== n.bar ? 'staccato' : P.hold ?? (profile === 'rock' && variant === 'pick' ? 'staccato' : null);
      // shortcut: 30–60 % der Notenlänge (die Spec sagt "des Rasterschritts", das wäre bei Vierteln nur ein Tick), je Takt des Plans gezogen; nach dem Hörtest festlegen
      if (hold === 'staccato') { n.dur = r6(Math.max(0.03, n.dur * (0.3 + 0.3 * roll(c, 'bass', 'staccato')))); n.art ??= 'staccato'; }
      if (hold === 'legato') { n.dur = r6(Math.max(n.dur, Math.min(next?.t ?? Infinity, b.end) - n.t)); n.art ??= 'legato'; }
      // slideIn: auf der Eins bei Akkordwechsel, Phrasen- oder Teilbeginn von unten in den Ton, nicht in die Stille eines Stopps hinein
      if (P.slideIn && stepOf(n) === 0 && n.art !== 'approach' && (c.change || c.phraseStart || c.first) && !ctx[n.bar - 1]?.stop && roll(c, 'bass', 'slideIn') < p(P.slideIn, 'bass')) {
        const r = roll(c, 'bass', 'slideSemi'); // meist 1 oder 2 Halbtöne, selten (10 %) ein langer Slide über 5 bis 7
        n.art = 'slideIn';
        n.artSemi = r < 0.1 ? -5 - Math.floor(r * 30) : r < 0.55 ? -1 : -2;
        n.artTime = r6(clamp((0.04 + 0.06 * roll(c, 'bass', 'slideTime')) * tempo, 0.04, Math.min(0.1, 15 / track.bpm))); // höchstens ein 16tel
      }
    });
  },
};
