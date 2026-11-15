// Feste Plätze im Knopfraster der Instrument-Module (3 Spalten × 4 Zeilen, je [Zeile, Spalte] ab 1): in jedem Modul dieselbe Ordnung, damit
// man einen Knopf überall an derselben Stelle findet. Zeilen 1 und 2: die eigenen Klangknöpfe des Instruments (bei Lead und Percussion
// steht dort die Aufgabe), Zeile 3: die Verzerrer, Zeile 4: Vibrato, Chorus und unten rechts Zurücksetzen. Das Schlagzeug hat keine
// Verzerrerkette: je Zeile eine Trommel (Kick, Snare, Hi-Hat), unten links der Raum. Reine Daten, ohne DOM (Test: tests/core/knob-slots.test.js).
const FX = { fuzz: [3, 1], overdrive: [3, 2], distortion: [3, 3], vibrato: [4, 1], chorus: [4, 2] };

export const KNOB_SLOTS = Object.freeze({
  drums: { kickPunch: [1, 1], kickLength: [1, 2], snareTone: [2, 1], snareSnap: [2, 2], hatBright: [3, 1], hatLength: [3, 2], room: [4, 1] },
  bass: { sub: [1, 1], pluck: [1, 2], roundness: [1, 3], cutoff: [2, 1], resonance: [2, 2], ...FX },
  chords: { brightness: [1, 1], length: [1, 2], tremolo: [1, 3], ...FX },
  pad: { attack: [1, 1], cutoff: [1, 2], thickness: [1, 3], lfoSpeed: [2, 1], lfoDepth: [2, 2], shimmer: [2, 3], ...FX },
  lead: { ...FX },
});

export const RESET_SLOT = Object.freeze([4, 3]); // Zurücksetzen: in jedem Modul unten rechts
export const SLOT_ROWS = 4;
export const SLOT_COLS = 3;
