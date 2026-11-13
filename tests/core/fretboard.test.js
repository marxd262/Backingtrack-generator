import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fretboardNotes, nextDistinctChord, beatsUntilChange, degreeLabel, progressionRoles, romanDegree, STANDARD_TUNING, FRETS } from '../../src/core/fretboard.js';
import { noteName } from '../../src/core/music.js';

const aMinor = { root: 'A', mode: 'minor' };
const cMajor = { root: 'C', mode: 'major' };
const Am = { root: 'A', quality: 'min' };
const Dm = { root: 'D', quality: 'min' };
const Em = { root: 'E', quality: 'min' };
const E = { root: 'E', quality: 'maj' };
const G = { root: 'G', quality: 'maj' };
const C = { root: 'C', quality: 'maj' };
const bars = (...chords) => chords.map((chord) => ({ chord, beats: 4 }));
const base = { key: aMinor, scale: 'minorPentatonic', current: Am, next: Dm };
const at = (notes, string, fret) => notes.find((n) => n.string === string && n.fret === fret);

test('Konstanten: Standardstimmung und 22 Bünde', () => {
  assert.deepEqual(STANDARD_TUNING, [64, 59, 55, 50, 45, 40]);
  assert.equal(FRETS, 22);
});

test('fretboardNotes: Rollen auf der tiefen E-Saite in A-Moll', () => {
  const notes = fretboardNotes(base);
  assert.deepEqual(at(notes, 5, 0), { string: 5, fret: 0, pc: 4, name: 'E', degree: '5', scale: true, current: true, next: false, root: false });
  assert.deepEqual(at(notes, 5, 5), { string: 5, fret: 5, pc: 9, name: 'A', degree: '1', scale: true, current: true, next: true, root: true });
  assert.deepEqual(at(notes, 5, 1), { string: 5, fret: 1, pc: 5, name: 'F', degree: 'b6', scale: false, current: false, next: true, root: false });
  const g = at(notes, 5, 3);
  assert.deepEqual([g.scale, g.current, g.next], [true, false, false]);
  assert.equal(at(notes, 5, 2), undefined);
});

test('fretboardNotes: Anzahl entspricht Brute-Force-Zählung, Reihenfolge Saite dann Bund', () => {
  const notes = fretboardNotes(base);
  const pcs = new Set([9, 0, 2, 4, 7, 5]);
  let expected = 0;
  for (const open of STANDARD_TUNING) for (let f = 0; f <= FRETS; f++) if (pcs.has((open + f) % 12)) expected++;
  assert.equal(notes.length, expected);
  const order = notes.map((n) => n.string * 100 + n.fret);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('fretboardNotes: ohne Akkorde nur Leitertöne, frets begrenzt die Bünde', () => {
  const notes = fretboardNotes({ ...base, current: null, next: null, frets: 12 });
  assert.ok(notes.length > 0);
  assert.ok(notes.every((n) => n.scale && !n.current && !n.next && !n.root && n.fret <= 12));
  assert.ok(notes.some((n) => n.fret === 12));
  assert.equal(Math.max(...fretboardNotes(base).map((n) => n.fret)), 22);
});

test('fretboardNotes: verändert Eingaben nicht, ungültige Eingaben ergeben []', () => {
  const input = structuredClone(base);
  const copy = structuredClone(base);
  fretboardNotes(input);
  assert.deepEqual(input, copy);
  assert.deepEqual(fretboardNotes({ ...base, scale: 'nope' }), []);
  assert.deepEqual(fretboardNotes({ ...base, key: { root: 'H', mode: 'minor' } }), []);
  assert.deepEqual(fretboardNotes({ ...base, key: null }), []);
});

test('noteName: Schreibweise nach Tonart', () => {
  assert.equal(noteName(aMinor, 10), 'A#');
  assert.equal(noteName({ root: 'C', mode: 'minor' }, 10), 'Bb');
  assert.equal(noteName({ root: 'D', mode: 'minor' }, 10), 'Bb');
  assert.equal(noteName({ root: 'E', mode: 'minor' }, 6), 'F#');
});

test('degreeLabel: Stufen relativ zum Grundton', () => {
  assert.deepEqual([9, 0, 2, 4, 7].map((pc) => degreeLabel(aMinor, pc)), ['1', 'b3', '4', '5', 'b7']);
  assert.deepEqual([4, 11, 6].map((pc) => degreeLabel(cMajor, pc)), ['3', '7', 'b5']);
  assert.equal(degreeLabel(aMinor, 21), '1');
  assert.equal(degreeLabel(aMinor, -3), '1');
});

test('nextDistinctChord: nächster anderer Akkord, mit Wiederholung der Folge', () => {
  const b = bars(Am, Am, Dm, E);
  assert.deepEqual([0, 1, 2, 3].map((i) => nextDistinctChord(b, 24, i)), [Dm, Dm, E, Am]);
  assert.deepEqual(nextDistinctChord(b, 24, 24), Dm);
  assert.deepEqual(nextDistinctChord(b, 24, -5), Dm);
});

test('nextDistinctChord: letzter Takt springt hörbar zu Takt 0', () => {
  const b = bars(Am, Dm, Em, G, C);
  assert.deepEqual(nextDistinctChord(b, 24, 23), Am);
  assert.deepEqual(nextDistinctChord(b, 24, 22), G);
});

test('nextDistinctChord: gleiche Akkorde, Bb gleich A#, ungültige Eingaben', () => {
  assert.equal(nextDistinctChord(bars(Am, Am), 8, 0), null);
  const Bb = { root: 'Bb', quality: 'maj' };
  const As = { root: 'A#', quality: 'maj' };
  assert.deepEqual(nextDistinctChord(bars(Bb, As, C), 8, 0), C);
  assert.equal(nextDistinctChord([], 8, 0), null);
  assert.equal(nextDistinctChord(bars(Am, Dm), 0, 0), null);
  assert.equal(nextDistinctChord(null, 8, 0), null);
  assert.equal(nextDistinctChord([{ beats: 4 }], 8, 0), null);
  assert.equal(nextDistinctChord(bars({ root: 'H', quality: 'maj' }, Am), 8, 0), null);
});

test('progressionRoles: jetzt, derselbe Akkord geht weiter, nächster Wechsel (im Kreis), später', () => {
  const am = { root: 'A', quality: 'min' }, dm = { root: 'D', quality: 'min' }, e = { root: 'E', quality: 'maj' };
  const track = { bars: [{ chord: am }, { chord: am }, { chord: dm }, { chord: e }], length: 16 };
  assert.deepEqual(progressionRoles(track, 0), ['now', 'hold', 'next', 'later']);
  assert.deepEqual(progressionRoles(track, 2), ['later', 'later', 'now', 'next']);
  assert.deepEqual(progressionRoles(track, 3), ['next', 'later', 'later', 'now']); // E jetzt, danach im Kreis Am
  assert.deepEqual(progressionRoles(track, null), ['now', 'hold', 'next', 'later']);
  assert.deepEqual(progressionRoles({ bars: [{ chord: am }], length: 8 }, 3), ['now']);
});

test('romanDegree: römische Stufe zur Tonart, klein bei Moll und vermindert, b vor chromatischen Stufen', () => {
  const [A, D, Eq, C, G] = ['A', 'D', 'E', 'C', 'G'].map((root) => (quality) => ({ root, quality }));
  const roman = (...chords) => chords.map((c) => romanDegree(aMinor, c));
  assert.deepEqual(roman(A('min'), A('min'), D('min'), Eq('maj')), ['i', 'i', 'iv', 'V']);
  assert.deepEqual(roman(C('maj'), G('maj'), Eq('dim'), D('sus4')), ['bIII', 'bVII', 'v', 'IV']);
  assert.equal(romanDegree(cMajor, { root: 'B', quality: 'dim' }), 'vii');
  assert.equal(romanDegree(cMajor, { root: 'Bb', quality: 'dom7' }), 'bVII');
  assert.equal(romanDegree(cMajor, { root: 'A', quality: 'min7' }), 'vi');
});

test('beatsUntilChange: ganze Schläge bis zum nächsten Takt mit anderem Akkord, aufgerundet, mindestens 1', () => {
  const track = { bpm: 60, length: 4, bars: bars(Am, Am, Dm, E) }; // 4/4 bei 60 bpm: 1 Schlag = 1 s
  assert.equal(beatsUntilChange(track, 0), 8);
  assert.equal(beatsUntilChange(track, 0.5), 8); // 7,5 aufgerundet
  assert.equal(beatsUntilChange(track, 7.2), 1); // 0,8 aufgerundet
  assert.equal(beatsUntilChange(track, 8), 4);
  assert.equal(beatsUntilChange(track, 12), 4); // E, danach im Kreis Am
  assert.equal(beatsUntilChange(track, 16 + 0.5), 8); // zweiter Durchlauf
});

test('beatsUntilChange: eine Folge mit nur einem Akkord ergibt null', () => {
  assert.equal(beatsUntilChange({ bpm: 60, length: 4, bars: bars(Am, Am) }, 3), null);
});
