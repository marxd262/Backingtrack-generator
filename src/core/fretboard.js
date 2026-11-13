// Griffbrett-Logik: Tonrollen je Bund, Stufenbezeichnung, hörbar nächster Akkord. Reine Logik, kein DOM.
import { isValidKey, noteToPc, scalePcs, chordMidi, noteName } from './music.js';
import { chordIndex } from './form.js';
import { CHORDS } from './chords.js';

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]; // MIDI, hohe e-Saite zuerst
export const FRETS = 22;

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
// `form` (optional): mit Songform beginnt die Folge in jedem Teil neu
export function nextDistinctChord(bars, length, barIndex, form) {
  if (!Array.isArray(bars) || bars.length === 0 || !Number.isInteger(length) || length < 1) return null;
  const start = Number.isInteger(barIndex) && barIndex > 0 ? barIndex % length : 0;
  try {
    const chordAt = (i) => bars[chordIndex({ bars, form }, i)].chord;
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

// Rolle jedes Eintrags der Akkordfolge für die Anzeige: now = Akkord im Takt `bar` (null = Takt 0), hold = derselbe Akkord geht
// weiter, next = erster andere Akkord danach (im Kreis über die Tracklänge), später = alles übrige
export function progressionRoles(track, bar) {
  const { bars } = track;
  const from = bar ?? 0;
  const roles = bars.map(() => 'later');
  const nowIdx = chordIndex(track, from);
  roles[nowIdx] = 'now';
  const total = Math.max(track.length, 1);
  for (let step = 1; step < total; step++) {
    const i = chordIndex(track, (from + step) % total);
    if (i === nowIdx) continue; // derselbe Eintrag (z. B. einzelner Akkord): bleibt now
    if (!sameChord(bars[i].chord, bars[nowIdx].chord)) {
      if (roles[i] === 'later') roles[i] = 'next';
      break;
    }
    roles[i] = 'hold';
  }
  return roles;
}

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

// Römische Stufe des Akkordgrundtons zur Tonart: klein bei kleiner Terz (Moll, vermindert), sonst groß; b vor chromatischen Stufen
export function romanDegree(key, chord) {
  const numeral = ROMAN[mod12(noteToPc(chord.root) - noteToPc(key.root))];
  return CHORDS[chord.quality]?.intervals.includes(3) ? numeral.toLowerCase() : numeral;
}

// Ganze Schläge von der Liedzeit `songSec` (Sekunden beim Tempo track.bpm, über Durchläufe weiterzählend) bis zum Beginn des
// nächsten Takts mit anderem Akkord; aufgerundet, mindestens 1. null, wenn die Folge nur einen Akkord hat.
export function beatsUntilChange(track, songSec) {
  const { bars, length, bpm } = track;
  const dur = (i) => (bars[chordIndex(track, i)].beats * 60) / bpm;
  const loopSec = Array.from({ length }, (_, i) => dur(i)).reduce((a, b) => a + b, 0);
  const pos = ((songSec % loopSec) + loopSec) % loopSec;
  let bar = 0, start = 0;
  while (bar < length - 1 && start + dur(bar) <= pos) start += dur(bar++);
  const cur = bars[chordIndex(track, bar)].chord;
  let end = start + dur(bar);
  for (let step = 1; step < length; step++) {
    const i = (bar + step) % length;
    if (!sameChord(cur, bars[chordIndex(track, i)].chord)) return Math.max(1, Math.ceil(((end - pos) * bpm) / 60 - 1e-9));
    end += dur(i);
  }
  return null;
}
