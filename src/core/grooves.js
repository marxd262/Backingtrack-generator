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

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Komplexität (0 bis 1, fehlend oder null = 0,5) verschiebt die Muster-Parameter, die die Stufen der Grooves wählen: drive und
 * bassMovement um (c - 0,5), syncopation um 0,6 * (c - 0,5), jeweils auf [0,1] begrenzt. Bei 0,5 bleibt alles gleich. Neue Kopie.
 */
export function applyComplexity(params, complexity) {
  const shift = (complexity ?? 0.5) - 0.5;
  return {
    ...params,
    drive: clamp01(params.drive + shift),
    bassMovement: clamp01(params.bassMovement + shift),
    syncopation: clamp01(params.syncopation + shift * 0.6),
  };
}

/** Schritte eines Musterzyklus im Raster der Taktart des Grooves (4/4: 16). */
export const grooveCycle = (groove) => METERS[groove.meter].beats * METERS[groove.meter].sub;

/** Stufe eines Parameters (0 bis Zahl der Schwellen): so viele Schwellen, wie der Wert erreicht. */
export const levelOf = (value, thresholds) => thresholds.filter((t) => value >= t).length;

// gemeinsame Bausteine der Grooves: Arpeggio-Folgen (über [Grundton, Terz, Quinte, Oktave]) und Fills je Länge (fillBeats * Schritte je Schlag)
const ARPS = [[0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 1, 3, 0, 2, 1, 3], [3, 2, 1, 0, 1, 2, 3, 2]];
const EXTRA_ARPS = [[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 0, 2, 0, 3, 2, 1]];
const FILLS_3 = [['snare', 'tomMid', 'tomLow'], ['tomHigh', 'tomMid', 'tomLow'], ['snare', null, 'tomLow']];
const EXTRA_FILLS_3 = [['snare', 'snare', 'tomLow'], [null, 'tomMid', 'tomLow']];
const FILLS_4 = [['snare', 'tomHigh', 'tomMid', 'tomLow'], ['snare', 'snare', 'tomMid', 'tomLow'], ['tomHigh', null, 'snare', 'tomLow']];
const EXTRA_FILLS_4 = [['snare', 'snare', 'tomHigh', 'tomLow'], [null, 'snare', 'tomMid', 'tomLow']];
const FILLS_6 = [
  ['snare', 'snare', 'snare', 'tomHigh', 'tomMid', 'tomLow'], ['snare', null, 'snare', 'tomHigh', 'tomMid', 'tomLow'], ['tomHigh', null, 'tomHigh', 'tomMid', 'snare', 'tomLow'],
];
const EXTRA_FILLS_6 = [['snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'], [null, 'snare', null, 'tomHigh', 'tomMid', 'tomLow']];
const FILLS_8 = [
  ['snare', 'snare', 'snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
  ['snare', null, 'snare', 'snare', 'tomHigh', 'tomMid', 'tomMid', 'tomLow'],
  ['tomHigh', null, 'tomHigh', 'tomMid', 'snare', 'tomMid', 'tomLow', 'tomLow'],
];
const EXTRA_FILLS_8 = [
  ['snare', 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomMid', 'tomLow', 'tomLow'],
  [null, 'snare', null, 'snare', 'tomHigh', 'tomHigh', 'tomMid', 'tomLow'],
];

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

  // Latin (4/4): Bossa-/Clave-Charakter, Rimshot auf den Clave-Schlägen, viele Synkopen in den höheren Stufen
  latin: {
    meter: '4/4',
    fillBeats: 2,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0, 10], [0, 6, 10]], snare: [12], ghosts: [], hat: [0.4, 0, 0.3, 0] },
        { kicks: [[0, 6, 8], [0, 6, 10, 14]], snare: [3, 6, 12], ghosts: [10], hat: [0.45, 0, 0.35, 0] },
        { kicks: [[0, 3, 6, 10], [0, 6, 8, 11], [0, 3, 8, 14]], snare: [3, 6, 10, 12, 15], ghosts: [2, 14], hat: [0.5, 0.2, 0.4, 0.2] },
      ],
      extraKicks: [[[0, 6], [0, 8, 14]], [[0, 6, 12], [0, 3, 10]], [[0, 6, 10, 14], [0, 3, 6, 12]]],
      offbeatKicks: [2, 6, 10, 14],
      openHatStep: 14,
      fills: FILLS_8,
      extraFills: EXTRA_FILLS_8,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 12], [12, '5', 4]], [[0, 'r', 8], [8, '5', 8]]],
        [[[0, 'r', 6], [6, '5', 2], [8, 'r', 4], [12, 'o', 2], [14, 'ap', 2]], [[0, 'r', 4], [6, '5', 2], [8, 'r', 4], [14, 'ap', 2]]],
        [[[0, 'r', 3], [3, 'r', 3], [6, '5', 2], [8, 'r', 3], [11, '5', 1], [12, 'o', 2], [14, 'b7', 1], [15, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 16]]],
        [[[0, 'r', 2], [2, '5', 2], [6, 'r', 2], [8, 'o', 4], [14, 'ap', 2]]],
        [[[0, 'r', 2], [3, '5', 2], [6, 'r', 2], [8, '5', 2], [11, 'r', 2], [14, 'o', 1], [15, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 6, 12], [3, 6, 12], [0, 6, 10]], extraStabs: [[3, 10], [0, 6, 10, 14]], offbeatStabs: [2, 6, 10, 14], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 2 },
  },

  // Walzer (3/4): Kick auf 1, Snare/Rimshot auf 2 und 3, Bass Grundton auf 1 und Quinte auf 2 und 3, Akkorde auf 2 und 3 ("oom-pah-pah")
  waltz: {
    meter: '3/4',
    fillBeats: 1,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0], [0, 8]], snare: [4, 8], ghosts: [], hat: [0.4, 0, 0, 0] },
        { kicks: [[0], [0, 10]], snare: [4, 8], ghosts: [11], hat: [0.5, 0, 0.3, 0] },
        { kicks: [[0, 6], [0, 10], [0, 7]], snare: [4, 8], ghosts: [3, 7, 11], hat: [0.55, 0.2, 0.4, 0.2] },
      ],
      extraKicks: [[[0, 6]], [[0, 9]], [[0, 3, 10]]],
      offbeatKicks: [6, 10],
      openHatStep: 10,
      fills: FILLS_4,
      extraFills: EXTRA_FILLS_4,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 12]], [[0, 'r', 4], [4, '5', 4], [8, '5', 4]]],
        [[[0, 'r', 4], [4, '5', 2], [8, '5', 2], [10, 'o', 1], [11, 'ap', 1]], [[0, 'r', 3], [4, '5', 4], [8, 'r', 2], [10, '5', 2]]],
        [[[0, 'r', 2], [2, 'r', 1], [4, '5', 2], [6, 'o', 1], [8, 'r', 2], [10, 'b7', 1], [11, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 8], [8, '5', 4]]],
        [[[0, 'r', 2], [4, '5', 2], [8, '5', 2], [11, 'ap', 1]]],
        [[[0, 'r', 2], [3, 'o', 1], [4, '5', 2], [8, 'r', 2], [10, '5', 1], [11, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[4, 8], [4, 8, 10], [4, 7, 8]], extraStabs: [[4, 10], [0, 4, 8]], offbeatStabs: [6, 10], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 2 },
  },

  // Rock-Walzer (3/4): Kick auf 1, kräftige Snare auf 3, treibende Achtel
  waltzRock: {
    meter: '3/4',
    fillBeats: 1,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0], [0, 6]], snare: [8], ghosts: [], hat: [0.4, 0, 0.3, 0] },
        { kicks: [[0, 6], [0, 6, 10]], snare: [8], ghosts: [11], hat: [0.5, 0, 0.4, 0] },
        { kicks: [[0, 3, 6], [0, 6, 10], [0, 4, 6]], snare: [8], ghosts: [3, 7, 11], hat: [0.6, 0.25, 0.45, 0.25] },
      ],
      extraKicks: [[[0, 10]], [[0, 3, 6]], [[0, 4, 6, 10]]],
      offbeatKicks: [3, 6, 7, 10],
      openHatStep: 10,
      fills: FILLS_4,
      extraFills: EXTRA_FILLS_4,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 12]], [[0, 'r', 8], [8, '5', 4]]],
        [[[0, 'r', 4], [4, 'r', 2], [6, '5', 2], [8, 'r', 2], [10, 'o', 1], [11, 'ap', 1]], [[0, 'r', 6], [6, '5', 2], [8, 'r', 3], [11, 'ap', 1]]],
        [[[0, 'r', 2], [2, 'r', 1], [3, 'o', 1], [4, 'r', 2], [6, '5', 1], [8, 'r', 2], [10, 'b7', 1], [11, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 4], [4, '5', 4], [8, 'r', 4]]],
        [[[0, 'r', 2], [2, '5', 2], [6, 'r', 2], [8, '5', 2], [11, 'ap', 1]]],
        [[[0, 'r', 2], [3, 'r', 1], [4, '5', 2], [6, 'o', 2], [8, 'r', 2], [11, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 6], [0, 8], [0, 4, 8]], extraStabs: [[6, 10], [0, 10]], offbeatStabs: [3, 6, 7, 10], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 2 },
  },

  // Ballade (6/8): zwei Pulse je Takt, Herzschlag-Kick auf 1 und dem vierten Achtel, Snare auf dem vierten Achtel, Arpeggio in Achteln
  ballad68: {
    meter: '6/8',
    fillBeats: 1,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0], [0, 3]], snare: [3], ghosts: [], hat: [0.4, 0, 0] },
        { kicks: [[0, 3], [0, 4]], snare: [3], ghosts: [5], hat: [0.45, 0, 0.3] },
        { kicks: [[0, 2, 3], [0, 3, 5], [0, 4]], snare: [3], ghosts: [1, 5], hat: [0.5, 0.25, 0.4] },
      ],
      extraKicks: [[[0, 4]], [[0, 2, 3]], [[0, 3, 4]]],
      offbeatKicks: [2, 4, 5],
      openHatStep: 5,
      fills: FILLS_3,
      extraFills: EXTRA_FILLS_3,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 6]], [[0, 'r', 3], [3, '5', 3]]],
        [[[0, 'r', 2], [2, '5', 1], [3, 'r', 2], [5, 'ap', 1]], [[0, 'r', 3], [3, '5', 2], [5, 'ap', 1]]],
        [[[0, 'r', 1], [1, '5', 1], [2, 'o', 1], [3, 'r', 1], [4, '5', 1], [5, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 4], [4, '5', 2]]],
        [[[0, 'r', 2], [3, '5', 1], [4, 'o', 1], [5, 'ap', 1]]],
        [[[0, 'r', 1], [2, '5', 1], [3, 'r', 1], [4, 'b7', 1], [5, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 3], [0, 4], [0, 2, 3]], extraStabs: [[3], [0, 5]], offbeatStabs: [2, 4, 5], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 1 },
  },

  // Rock in 6/8: Kick auf 1, Snare auf dem vierten Achtel, Achtel-Hi-Hat, Fills mit Toms
  rock68: {
    meter: '6/8',
    fillBeats: 1,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0], [0, 4]], snare: [3], ghosts: [], hat: [0.45, 0, 0.3] },
        { kicks: [[0, 2], [0, 4], [0, 2, 4]], snare: [3], ghosts: [5], hat: [0.5, 0.25, 0.35] },
        { kicks: [[0, 1, 4], [0, 2, 4], [0, 2, 3, 5]], snare: [3], ghosts: [1, 5], hat: [0.6, 0.3, 0.45] },
      ],
      extraKicks: [[[0, 3]], [[0, 4, 5]], [[0, 1, 2, 4]]],
      offbeatKicks: [1, 2, 4, 5],
      openHatStep: 5,
      fills: FILLS_3,
      extraFills: EXTRA_FILLS_3,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 6]], [[0, 'r', 3], [3, 'r', 3]]],
        [[[0, 'r', 2], [2, 'r', 1], [3, '5', 2], [5, 'ap', 1]], [[0, 'r', 1], [1, 'r', 2], [3, 'r', 2], [5, 'ap', 1]]],
        [[[0, 'r', 1], [1, 'r', 1], [2, '5', 1], [3, 'r', 1], [4, 'o', 1], [5, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 4], [4, 'o', 2]]],
        [[[0, 'r', 2], [3, '5', 2], [5, 'ap', 1]]],
        [[[0, 'r', 1], [2, 'r', 1], [3, '5', 1], [4, 'b7', 1], [5, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 3], [0], [0, 2, 4]], extraStabs: [[3, 5], [0, 4]], offbeatStabs: [1, 2, 4, 5], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 1 },
  },

  // Shuffle (12/8): vier Pulse je Takt in Achteltriolen, Kick auf 1 und 3, Snare auf 2 und 4, Hi-Hat "lang-kurz", laufender Bass
  shuffle: {
    meter: '12/8',
    fillBeats: 2,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0, 6], [0, 6, 8]], snare: [3, 9], ghosts: [], hat: [0.5, 0, 0.35] },
        { kicks: [[0, 6], [0, 6, 10], [0, 5, 6]], snare: [3, 9], ghosts: [11], hat: [0.55, 0, 0.4] },
        { kicks: [[0, 2, 6], [0, 6, 8], [0, 5, 6, 10]], snare: [3, 9], ghosts: [2, 8, 11], hat: [0.6, 0.2, 0.45] },
      ],
      extraKicks: [[[0, 6, 9]], [[0, 2, 6]], [[0, 6, 7, 10]]],
      offbeatKicks: [2, 5, 8, 11],
      openHatStep: 11,
      fills: FILLS_6,
      extraFills: EXTRA_FILLS_6,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 6], [6, '5', 6]], [[0, 'r', 12]]],
        [[[0, 'r', 3], [3, '5', 3], [6, 'r', 3], [9, 'o', 2], [11, 'ap', 1]], [[0, 'r', 3], [3, 'r', 3], [6, '5', 3], [9, 'b7', 2], [11, 'ap', 1]]],
        [[[0, 'r', 2], [2, 'r', 1], [3, '5', 2], [5, '5', 1], [6, 'o', 2], [8, 'b7', 1], [9, '5', 2], [11, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 9], [9, '5', 3]]],
        [[[0, 'r', 3], [3, 'o', 3], [6, '5', 3], [9, 'b7', 2], [11, 'ap', 1]]],
        [[[0, 'r', 2], [3, '5', 2], [6, 'r', 2], [8, 'o', 1], [9, 'b7', 2], [11, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 3, 6, 9], [3, 9], [0, 6]], extraStabs: [[2, 8], [0, 3, 9]], offbeatStabs: [2, 5, 8, 11], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 1 },
  },

  // Langsamer Blues (12/8): Kick auf 1, Snare auf 2 und 4 mit Triolen-Geisternoten, vollere Hi-Hat, Arpeggio eine Note je Puls
  slowBlues: {
    meter: '12/8',
    fillBeats: 2,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0], [0, 6]], snare: [3, 9], ghosts: [], hat: [0.4, 0, 0.3] },
        { kicks: [[0, 6], [0, 5, 6]], snare: [3, 9], ghosts: [2, 8], hat: [0.5, 0.25, 0.4] },
        { kicks: [[0, 2, 6], [0, 6, 8]], snare: [3, 9], ghosts: [1, 2, 5, 8, 11], hat: [0.55, 0.3, 0.45] },
      ],
      extraKicks: [[[0, 9]], [[0, 6, 10]], [[0, 2, 5, 6]]],
      offbeatKicks: [2, 5, 8, 11],
      openHatStep: 11,
      fills: FILLS_6,
      extraFills: EXTRA_FILLS_6,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 12]], [[0, 'r', 6], [6, '5', 6]]],
        [[[0, 'r', 4], [4, '5', 2], [6, 'r', 4], [10, 'b7', 1], [11, 'ap', 1]], [[0, 'r', 6], [6, '5', 3], [9, 'b7', 2], [11, 'ap', 1]]],
        [[[0, 'r', 3], [3, 'o', 2], [5, '5', 1], [6, 'r', 3], [9, 'b7', 1], [10, '5', 1], [11, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 8], [8, '5', 4]]],
        [[[0, 'r', 3], [3, '5', 3], [6, 'r', 2], [8, 'o', 2], [10, 'b7', 1], [11, 'ap', 1]]],
        [[[0, 'r', 2], [2, '5', 1], [3, 'o', 2], [6, 'r', 2], [8, '5', 1], [9, 'b7', 2], [11, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 6], [3, 9], [0, 3, 6, 9]], extraStabs: [[0, 9], [3, 6]], offbeatStabs: [2, 5, 8, 11], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 3 },
  },

  // Fünfviertel (5/4) in 3+2: Kick auf 1 und 4, Snare auf 3 und 5, der Bass folgt der Gruppierung
  fiveFour: {
    meter: '5/4',
    fillBeats: 2,
    drums: {
      thresholds: [0.35, 0.7],
      tiers: [
        { kicks: [[0, 12], [0, 12, 14]], snare: [8, 16], ghosts: [], hat: [0.4, 0, 0.3, 0] },
        { kicks: [[0, 6, 12], [0, 12, 18]], snare: [8, 16], ghosts: [10, 14], hat: [0.5, 0, 0.3, 0] },
        { kicks: [[0, 3, 12], [0, 6, 12, 15], [0, 10, 12]], snare: [8, 16], ghosts: [7, 11, 19], hat: [0.6, 0.25, 0.45, 0.25] },
      ],
      extraKicks: [[[0, 10]], [[0, 6, 12, 18]], [[0, 3, 10, 12]]],
      offbeatKicks: [6, 10, 14, 18],
      openHatStep: 18,
      fills: FILLS_8,
      extraFills: EXTRA_FILLS_8,
    },
    bass: {
      thresholds: [0.35, 0.7],
      tiers: [
        [[[0, 'r', 12], [12, '5', 8]], [[0, 'r', 20]]],
        [[[0, 'r', 6], [6, '5', 2], [8, 'r', 4], [12, 'r', 4], [16, '5', 2], [18, 'ap', 2]], [[0, 'r', 8], [8, '5', 4], [12, 'r', 4], [16, 'o', 2], [18, 'ap', 2]]],
        [[[0, 'r', 3], [3, 'r', 3], [6, '5', 2], [8, 'r', 2], [10, 'b7', 2], [12, 'r', 3], [15, '5', 1], [16, 'o', 2], [19, 'ap', 1]]],
      ],
      extra: [
        [[[0, 'r', 8], [8, '5', 4], [12, 'r', 8]]],
        [[[0, 'r', 4], [4, '5', 2], [8, 'r', 4], [12, 'b7', 4], [16, '5', 2], [18, 'ap', 2]]],
        [[[0, 'r', 2], [3, '5', 2], [8, 'r', 2], [10, '5', 2], [12, 'o', 3], [16, '5', 2], [19, 'ap', 1]]],
      ],
    },
    chords: { stabs: [[0, 12], [8, 16], [0, 8, 12]], extraStabs: [[0, 10], [8, 12, 16]], offbeatStabs: [6, 10, 14, 18], arps: ARPS, extraArps: EXTRA_ARPS, arpStep: 2 },
  },
});

// Standard-Groove je Taktart
export const DEFAULT_GROOVE = deepFreeze({ '4/4': 'straight', '3/4': 'waltz', '6/8': 'ballad68', '12/8': 'shuffle', '5/4': 'fiveFour' });

/** IDs der Grooves einer Taktart ('4/4') in Registerreihenfolge. */
export const groovesFor = (key) => Object.keys(GROOVES).filter((id) => GROOVES[id].meter === key);

/** Groove eines Tracks: `track.groove`, wenn er zur Taktart des Tracks gehört, sonst der Standard der Taktart. */
export function grooveFor(track) {
  const key = meterKey(track?.meter) || '4/4';
  const chosen = typeof track?.groove === 'string' && Object.hasOwn(GROOVES, track.groove) ? GROOVES[track.groove] : null;
  if (chosen && chosen.meter === key) return chosen;
  return GROOVES[DEFAULT_GROOVE[key] ?? 'straight'];
}
