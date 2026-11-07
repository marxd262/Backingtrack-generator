import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fretboardNotes, nextDistinctChord, degreeLabel, STANDARD_TUNING, FRETS } from '../../src/core/fretboard.js';
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

test('Konstanten: Standardstimmung und 15 Bünde', () => {
  assert.deepEqual(STANDARD_TUNING, [64, 59, 55, 50, 45, 40]);
  assert.equal(FRETS, 15);
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
  for (const open of STANDARD_TUNING) for (let f = 0; f <= 15; f++) if (pcs.has((open + f) % 12)) expected++;
  assert.equal(notes.length, expected);
  const order = notes.map((n) => n.string * 100 + n.fret);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('fretboardNotes: ohne Akkorde nur Leitertöne, frets begrenzt die Bünde', () => {
  const notes = fretboardNotes({ ...base, current: null, next: null, frets: 12 });
  assert.ok(notes.length > 0);
  assert.ok(notes.every((n) => n.scale && !n.current && !n.next && !n.root && n.fret <= 12));
  assert.ok(notes.some((n) => n.fret === 12));
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
