// Griffbrett-Logik: Tonrollen je Bund, Stufenbezeichnung, hörbar nächster Akkord. Reine Logik, kein DOM.
import { isValidKey, noteToPc, scalePcs, chordMidi, noteName } from './music.js';

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // MIDI, hohe e-Saite zuerst
export const FRETS = 15;

const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const mod12 = (n) => ((n % 12) + 12) % 12;

export function degreeLabel(key, pc) {
  return DEGREES[mod12(pc - noteToPc(key.root))];
}

// Tonhöhenklassen der Akkordtöne; kein oder ungültiger Akkord ergibt keine
function chordPcs(chord) {
  try {
    return chord ? chordMidi(chord, 3).map((m) => m % 12) : [];
  } catch {
    return [];
  }
}

export function fretboardNotes({ key, scale, current, next, tuning = STANDARD_TUNING, frets = FRETS }) {
  if (!isValidKey(key)) return [];
  let scaleSet;
  try {
    scaleSet = new Set(scalePcs(key, scale));
  } catch {
    return [];
  }
  const cur = chordPcs(current);
  const nxt = chordPcs(next);
  const curRoot = cur[0]; // Grundton ist der erste Akkordton
  const notes = [];
  tuning.forEach((open, string) => {
    for (let fret = 0; fret <= frets; fret++) {
      const pc = mod12(open + fret);
      const inScale = scaleSet.has(pc);
      const isCur = cur.includes(pc);
      const isNext = nxt.includes(pc);
      if (!inScale && !isCur && !isNext) continue;
      notes.push({ string, fret, pc, name: noteName(key, pc), degree: degreeLabel(key, pc), scale: inScale, current: isCur, next: isNext, root: isCur && pc === curRoot });
    }
  });
  return notes;
}

const sameChord = (a, b) => noteToPc(a.root) === noteToPc(b.root) && a.quality === b.quality;

// Erster vom jetzigen Takt verschiedene Akkord, zyklisch über die Tracklänge (Sprung zu Takt 0 inklusive)
export function nextDistinctChord(bars, length, barIndex) {
  if (!Array.isArray(bars) || bars.length === 0 || !Number.isInteger(length) || length < 1) return null;
  const start = Number.isInteger(barIndex) && barIndex > 0 ? barIndex % length : 0;
  try {
    const chordAt = (i) => bars[i % bars.length].chord;
    const cur = chordAt(start);
    for (let step = 1; step < length; step++) {
      const c = chordAt((start + step) % length);
      if (!sameChord(cur, c)) return c;
    }
  } catch {
    // ungültige Takteinträge: kein Ergebnis statt Ausnahme
  }
  return null;
}
