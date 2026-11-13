// Mikrotiming (Klang v2, Schritt 4): macht aus dem Zufallsrauschen je Note ein Spielgefühl. Eigener Schritt auf dem fertigen Ereignisstrom, reine
// Logik, per Seed reproduzierbar. Drei Bausteine, alle in Millisekunden (positiv = später, "laid back"):
//   1. weniger Zufall je Note: der Jitter aus event-helpers.js (±7 ms) schrumpft auf den Anteil `tight` (0,3 = ±2,1 ms); das Kit flammt nicht mehr
//   2. feste Lage je Instrument und Stil (OFFSETS_MS): z. B. Backbeat-Snare hinten, im Funk die Akkorde vorn
//   3. langsamer Drift je Spieler (DRIFT_MS): zwei Sinusschwingungen (etwa 7–11 s und 2,5–4 s) mit Phasen aus dem Seed statt Zufall je Note;
//      alle Schläge des Schlagzeugs teilen einen Drift (ein Schlagzeuger), Töne mit gleicher Zeit (Akkord-Stab) bleiben zusammen
// Dazu reicht der Schritt das Feld `art` (Artikulation, kommt später) durch und reagiert darauf (ART: Dead Notes leiser und kürzer).
// Alle Werte sind nach Wissen gesetzt, nicht gehört. Feinwerte: amount (0 = aus, Strom unverändert), tight, layback, drift.
import { r6 } from './timeline.js';
import { roundVel, byTime } from './event-helpers.js';

// shortcut: amount 0 (aus), bis das Urteil nach Gehör da ist; dann auf 1 setzen
export const TIMING_DEFAULTS = Object.freeze({ amount: 0, tight: 0.3, layback: 1, drift: 1 });

// Lage in ms je Stil (Schlagwort der Gruppe rhythm: swing, funky, sonst straight). ghost = Snare mit vel < 0,3. Fehlende Namen: 0.
const OFFSETS_MS = Object.freeze({
  straight: { snare: 5, ghost: 2, hat: -1, openHat: -1, bass: 3, chords: 2 },
  funky: { snare: 3, ghost: 4, bass: 1, chords: -3, percussion: -2 },
  swing: { snare: 9, ghost: 5, hat: -2, openHat: -2, bass: -3, chords: 4 },
});
// größte Abweichung des Drifts in ms je Schicht
const DRIFT_MS = Object.freeze({ drums: 2, bass: 4, chords: 5, lead: 5, percussion: 4 });
// Reaktion auf Artikulationen: Faktor auf Lautstärke und Dauer
const ART = Object.freeze({ dead: { vel: 0.6, dur: 0.4 }, mute: { vel: 0.85, dur: 0.5 } });
const END_GAP = 0.001; // wie event-helpers.js: Abstand zum Taktende

/** Füllt die Feinwerte auf; nur endliche Zahlen >= 0 zählen. */
export function completeTiming(timing) {
  const out = { ...TIMING_DEFAULTS };
  for (const key of Object.keys(out)) if (Number.isFinite(timing?.[key]) && timing[key] >= 0) out[key] = timing[key];
  return out;
}

/** Faktor auf den Zufalls-Jitter je Note (1 = wie bisher). */
export const jitterScale = (timing) => 1 + Math.min(1, timing.amount) * (timing.tight - 1);

const styleOf = (track) => { const r = track.tags?.rhythm ?? []; return r.includes('swing') ? 'swing' : r.includes('funky') ? 'funky' : 'straight'; };

/** events: sortierter Strom; bars: Taktzeiten (barTimeline); rng: eigener Zweig. Liefert einen neuen, sortierten Strom. */
export function applyMicrotiming(events, track, bars, rng, timing) {
  const offsets = OFFSETS_MS[styleOf(track)];
  const drifts = Object.fromEntries(Object.entries(DRIFT_MS).map(([layer, ms]) => {
    const [p1, p2, f1, f2] = [7 + 4 * rng.next(), 2.5 + 1.5 * rng.next(), 2 * Math.PI * rng.next(), 2 * Math.PI * rng.next()];
    return [layer, (t) => ms * (0.6 * Math.sin((2 * Math.PI * t) / p1 + f1) + 0.4 * Math.sin((2 * Math.PI * t) / p2 + f2))];
  }));
  const out = events.map((e) => {
    let x = e;
    const art = ART[e.art];
    if (art && Number.isFinite(e.vel)) x = { ...x, vel: roundVel(e.vel * art.vel), ...(Number.isFinite(e.dur) ? { dur: r6(e.dur * art.dur) } : {}) };
    const b = bars[e.bar];
    if (!(timing.amount > 0) || !e.layer || !b || !Number.isFinite(e.beat)) return x;
    const name = e.layer === 'drums' ? (e.name === 'snare' && e.vel < 0.3 ? 'ghost' : e.name) : e.layer;
    const ms = timing.amount * (timing.layback * (offsets[name] ?? 0) + timing.drift * (drifts[e.layer]?.(e.t) ?? 0));
    const t = r6(Math.min(b.end - END_GAP, Math.max(b.start, e.t + ms / 1000)));
    return { ...x, t, ...(Number.isFinite(x.dur) ? { dur: r6(Math.min(x.dur, b.end - t)) } : {}) };
  });
  return out.sort(byTime);
}
