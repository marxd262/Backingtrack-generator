// Taktarten, Raster und Groove-Register. Ein Groove ist ein Datensatz (Taktart, Muster je Instrument in Stufen von einfach bis
// komplex); die Erzeugung in events.js liest ihn und kennt keine feste Taktlänge. Neuer Groove = ein Eintrag in GROOVES plus sein Name
// `groove.<id>` in src/i18n/de.js und en.js (tests/core/grooves.test.js prüft die Vollständigkeit). Reine Logik ohne Audio und DOM.

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v);
  return Object.freeze(o);
};

// Taktarten: beats = Schläge (Puls) je Takt, sub = Schritte je Schlag. Einfache Taktarten rastern in Sechzehnteln (sub 4), 6/8 und 12/8
// zählen punktierte Viertel als Schlag und rastern in Achteltriolen (sub 3). `bpm` zählt diese Schläge.
export const METERS = deepFreeze({
  '4/4': { beats: 4, sub: 4 },
  '3/4': { beats: 3, sub: 4 },
  '6/8': { beats: 2, sub: 3 },
  '12/8': { beats: 4, sub: 3 },
  '5/4': { beats: 5, sub: 4 },
});

/** `[6, 8]` ergibt '6/8'; alles, was kein Paar aus zwei ganzen Zahlen ist, ergibt ''. */
export const meterKey = (meter) =>
  Array.isArray(meter) && meter.length === 2 && meter.every(Number.isInteger) ? `${meter[0]}/${meter[1]}` : '';

/** Unterstützte Taktart (Schlüssel in METERS). */
export const isMeter = (meter) => Object.hasOwn(METERS, meterKey(meter));

/** Schläge und Schritte je Schlag; für Unbekanntes das Raster von 4/4 (geprüfte Tracks haben immer eine bekannte Taktart). */
export const meterGrid = (meter) => (isMeter(meter) ? METERS[meterKey(meter)] : METERS['4/4']);

/** Schritte eines Musterzyklus im Raster der Taktart des Grooves (4/4: 16). */
export const grooveCycle = (groove) => METERS[groove.meter].beats * METERS[groove.meter].sub;

/** Stufe eines Parameters (0 bis Zahl der Schwellen): so viele Schwellen, wie der Wert erreicht. */
export const levelOf = (value, thresholds) => thresholds.filter((t) => value >= t).length;

// Aufbau eines Grooves (alle Schritte im Raster der Taktart, 0 bis Schläge * Schritte je Schlag - 1):
//   fillBeats  Länge der Fills am Abschnittsende in Schlägen (1 bis Schlagzahl)
//   drums      thresholds auf drive -> tiers { kicks (Varianten), snare, ghosts, hat (ein Wert je Schritt eines Schlags) }, extraKicks je
//              Stufe (nur mit variety), offbeatKicks, openHatStep, fills (je fillBeats * sub Einträge) und extraFills
//   bass       thresholds auf bassMovement -> tiers (je Stufe Muster [Schritt, Grad, Länge], Grad r 5 o b7 ap), extra je Stufe
//   chords     stabs, extraStabs, offbeatStabs, arps (8 Indizes 0..3), extraArps, arpStep (Schritte je Arpeggio-Ton)
export const GROOVES = deepFreeze({
  // der bisherige Generator in 4/4: Muster für 4 Schläge in Sechzehnteln
  straight: {
    meter: '4/4',
    fillBeats: 2,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0, 10], [0, 11], [0, 7, 10]], snare: [8], ghosts: [], hat: [0.3, 0, 0.2, 0] }, // Halbzeit
        { kicks: [[0, 8], [0, 8, 10], [0, 6, 8], [0, 8, 11]], snare: [4, 12], ghosts: [7, 9, 15], hat: [0.5, 0, 0.3, 0] },
        { kicks: [[0, 3, 8, 10], [0, 3, 10], [0, 3, 8, 11], [0, 6, 8, 10]], snare: [4, 12], ghosts: [7, 9, 15], hat: [0.6, 0.25, 0.45, 0.25] },
      ],
      extraKicks: [[[0, 7], [0, 10, 14]], [[0, 5, 8], [0, 8, 13]], [[0, 3, 6, 10], [0, 3, 8, 14]]],
      offbeatKicks: [3, 6, 7, 11, 14],
      openHatStep: 14,
      // Fills über 2 Zählzeiten (8 Sechzehntel), Toms absteigend; kürzere Fills nehmen das Ende
      fills: [
        ['snare', 'snare', 'snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
        ['snare', null, 'snare', 'snare', 'tomHigh', 'tomMid', 'tomMid', 'tomLow'],
        ['tomHigh', null, 'tomHigh', 'tomMid', 'snare', 'tomMid', 'tomLow', 'tomLow'],
      ],
      extraFills: [
        ['snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomMid', 'tomLow', 'tomLow'],
        [null, 'snare', null, 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
      ],
    },
    bass: {
      thresholds: [0.35, 0.7],
      // je bassMovement-Stufe als [Schritt, Grad, Länge]: r Grundton, 5 Quinte, o Oktave, b7 Septime des Akkords,
      // ap chromatischer Anlauf zum nächsten Grundton (immer am Taktende verankert)
      tiers: [
        [[[0, 'r', 16]], [[0, 'r', 8], [8, 'r', 8]], [[0, 'r', 8], [8, '5', 6], [14, 'ap', 2]]],
        [
          [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 8 === 6 ? 'o' : 'r', 2]),
          [[0, 'r', 4], [4, 'r', 2], [6, '5', 2], [8, 'r', 4], [12, 'o', 2], [14, 'ap', 2]],
          [[0, 'r', 6], [6, 'r', 2], [8, '5', 6], [14, 'ap', 2]],
        ],
        [
          [[0, 'r', 2], [3, 'r', 1], [6, 'o', 1], [8, '5', 1], [10, 'r', 2], [13, 'b7', 1], [15, 'ap', 1]],
          [[0, 'r', 2], [3, 'o', 1], [4, 'r', 1], [7, '5', 1], [8, 'r', 2], [10, 'b7', 1], [11, 'o', 1], [13, '5', 1], [15, 'ap', 1]],
          [[0, 'r', 3], [3, '5', 1], [6, 'o', 2], [8, 'r', 1], [10, 'b7', 2], [12, '5', 1], [14, 'o', 1], [15, 'ap', 1]],
        ],
      ],
      extra: [
        [[[0, 'r', 8], [8, 'r', 4], [12, '5', 4]]],
        [
          [[0, 'r', 4], [4, '5', 4], [8, 'r', 4], [12, 'o', 2], [14, 'ap', 2]],
          [[0, 'r', 2], [2, 'r', 2], [4, 'o', 2], [6, 'r', 2], [8, '5', 4], [12, 'b7', 2], [14, 'ap', 2]],
        ],
        [[[0, 'r', 2], [2, 'r', 1], [4, '5', 1], [6, 'o', 1], [8, 'r', 2], [11, 'b7', 1], [12, '5', 1], [14, 'o', 1], [15, 'ap', 1]]],
      ],
    },
    chords: {
      stabs: [[0, 8], [4, 12], [0, 6, 10], [2, 8, 14]],
      extraStabs: [[0, 10], [4, 10], [0, 4, 10]],
      offbeatStabs: [3, 6, 7, 10, 14],
      // Arpeggio-Folgen über [Grundton, Terz, Quinte, Oktave]
      arps: [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 3], [3, 2, 1, 0, 1, 2, 3, 2]],
      extraArps: [[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 0, 2, 0, 3, 2, 1]],
      arpStep: 2,
    },
  },
});

// Standard-Groove je Taktart
export const DEFAULT_GROOVE = deepFreeze({ '4/4': 'straight' });

/** IDs der Grooves einer Taktart ('4/4') in Registerreihenfolge. */
export const groovesFor = (key) => Object.keys(GROOVES).filter((id) => GROOVES[id].meter === key);

/** Groove eines Tracks: `track.groove`, wenn er zur Taktart des Tracks gehört, sonst der Standard der Taktart (vorerst `straight`). */
export function grooveFor(track) {
  const key = meterKey(track?.meter) || '4/4';
  const chosen = typeof track?.groove === 'string' && Object.hasOwn(GROOVES, track.groove) ? GROOVES[track.groove] : null;
  if (chosen && chosen.meter === key) return chosen;
  return GROOVES[DEFAULT_GROOVE[key] ?? 'straight'];
}
