// Mikrotiming (Klang v2, Schritt 4): macht aus dem Zufallsrauschen je Note ein Spielgefühl. Eigener Schritt auf dem fertigen Ereignisstrom, reine
// Logik, per Seed reproduzierbar. Drei Bausteine, alle in Millisekunden (positiv = später, "laid back"):
//   1. weniger Zufall je Note: der Jitter aus event-helpers.js (±7 ms) schrumpft auf den Anteil `tight` (0,3 = ±2,1 ms); das Kit flammt nicht mehr
//   2. feste Lage je Instrument und Stil (OFFSETS_MS): z. B. Backbeat-Snare hinten, im Funk die Akkorde vorn
//   3. langsamer Drift je Spieler (DRIFT_MS): zwei Sinusschwingungen (etwa 7–11 s und 2,5–4 s) mit Phasen aus dem Seed statt Zufall je Note;
//      alle Schläge des Schlagzeugs teilen einen Drift (ein Schlagzeuger), Töne mit gleicher Zeit (Akkord-Stab) bleiben zusammen
// Das Feld `art` und die übrigen Felder der Artikulations-Schicht (articulation.js, läuft davor) werden durchgereicht.
// Die Stärke kommt aus dem Track-Feld `loose` (Regler "Lockerheit", 0..1, fehlend 0,5): timingOf. Urteil des Nutzers (2026-11-13): Stärke 1 kaum
// hörbar, 2 etwas zu viel (Instrumente lösen sich voneinander), Standard dazwischen (1,5). Die Lagen selbst sind nach Wissen gesetzt.
// Feinwerte: amount (Faktor auf Lage und Drift), tight (Rest des Zufalls je Note; amount 0 und tight 1 = Strom wie vor Klang v2), layback, drift.
import { r6 } from './timeline.js';
import { byTime } from './event-helpers.js';

export const TIMING_DEFAULTS = Object.freeze({ amount: 1.5, tight: 0.3, layback: 1, drift: 1 });

/**
 * Regler "Lockerheit" (0..1) -> Stärke und Zufall je Note: 0 = exakt auf dem Raster (amount 0, tight 0), 0,5 = Standard (1,5 und 0,3),
 * 1 = sehr locker (5 und 1: z. B. Rock-Snare 25 ms hinten, Drift bis 25 ms, Zufall ±7 ms). Der Nutzer wollte deutliche Extreme.
 */
export const timingOf = (loose) => (loose < 0.5
  ? { amount: 3 * loose, tight: 0.6 * loose }
  : { amount: 1.5 + 7 * (loose - 0.5), tight: 0.3 + 1.4 * (loose - 0.5) });

// Lage in ms je Stil (Schlagwort der Gruppe rhythm: swing, funky, sonst straight). ghost = Snare mit vel < 0,3. Fehlende Namen: 0.
const OFFSETS_MS = Object.freeze({
  straight: { snare: 5, ghost: 2, hat: -1, openHat: -1, bass: 3, chords: 2 },
  funky: { snare: 3, ghost: 4, bass: 1, chords: -3, percussion: -2 },
  swing: { snare: 9, ghost: 5, hat: -2, openHat: -2, bass: -3, chords: 4 },
});
// größte Abweichung des Drifts in ms je Schicht
const DRIFT_MS = Object.freeze({ drums: 2, bass: 4, chords: 5, lead: 5, percussion: 4 });
const END_GAP = 0.001; // wie event-helpers.js: Abstand zum Taktende

/** Füllt die Feinwerte auf; nur endliche Zahlen >= 0 zählen. */
export function completeTiming(timing) {
  const out = { ...TIMING_DEFAULTS };
  for (const key of Object.keys(out)) if (Number.isFinite(timing?.[key]) && timing[key] >= 0) out[key] = timing[key];
  return out;
}

/** Faktor auf den Zufalls-Jitter je Note (1 = wie vor Klang v2). */
export const jitterScale = (timing) => timing.tight;

// Triolen-Raster (6/8, 12/8) tragen den Swing selbst und bekommen immer die Swing-Lage, egal welches Schlagwort gesetzt ist
const styleOf = (track, bars) => { const r = track.tags?.rhythm ?? []; return bars[0]?.sub !== 4 || r.includes('swing') ? 'swing' : r.includes('funky') ? 'funky' : 'straight'; };
const MONO = ['bass', 'lead']; // einstimmige Schichten: keine Note klingt in die nächste hinein

/** events: sortierter Strom; bars: Taktzeiten (barTimeline); rng: eigener Zweig. Liefert einen neuen, sortierten Strom. */
export function applyMicrotiming(events, track, bars, rng, timing) {
  const offsets = OFFSETS_MS[styleOf(track, bars)];
  const drifts = Object.fromEntries(Object.entries(DRIFT_MS).map(([layer, ms]) => {
    const [p1, p2, f1, f2] = [7 + 4 * rng.next(), 2.5 + 1.5 * rng.next(), 2 * Math.PI * rng.next(), 2 * Math.PI * rng.next()];
    return [layer, (t) => ms * (0.6 * Math.sin((2 * Math.PI * t) / p1 + f1) + 0.4 * Math.sin((2 * Math.PI * t) / p2 + f2))];
  }));
  const out = events.map((e) => {
    const b = bars[e.bar];
    if (!(timing.amount > 0) || !e.layer || !b || !Number.isFinite(e.beat)) return e;
    const name = e.layer === 'drums' ? (e.name === 'snare' && e.vel < 0.3 ? 'ghost' : e.name) : e.layer;
    const ms = timing.amount * (timing.layback * (offsets[name] ?? 0) + timing.drift * (drifts[e.layer]?.(e.t) ?? 0));
    const t = r6(Math.min(b.end - END_GAP, Math.max(b.start, e.t + ms / 1000)));
    // das Ende der Note bleibt, wo es war (Stopps und Taktgrenzen gelten weiter); nur der Einsatz wandert
    return { ...e, t, ...(Number.isFinite(e.dur) ? { dur: r6(Math.max(END_GAP, e.t + e.dur - t)) } : {}) };
  });
  out.sort(byTime);
  for (const layer of MONO) {
    const notes = out.filter((e) => e.layer === layer && e.type === 'note');
    for (let i = 0; i + 1 < notes.length; i++) if (notes[i].t + notes[i].dur > notes[i + 1].t) notes[i].dur = r6(Math.max(0, notes[i + 1].t - notes[i].t));
  }
  return out;
}
