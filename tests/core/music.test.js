import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHORD_QUALITIES, MODE_NAMES, isNoteName, isValidKey, noteToPc, chordMidi, scalePcs, diatonicChords, allowedChords } from '../../src/core/music.js';

const aMinor = { root: 'A', mode: 'minor' };
const name = (c) => `${c.root}:${c.quality}`;

test('CHORD_QUALITIES enthält maj, min, dim', () => {
  assert.deepEqual(CHORD_QUALITIES, { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6] });
});

test('noteToPc kennt Kreuze und Bs', () => {
  assert.equal(noteToPc('A'), 9);
  assert.equal(noteToPc('F#'), 6);
  assert.equal(noteToPc('Bb'), 10);
});

test('noteToPc wirft bei unbekanntem Namen mit dem Namen in der Meldung', () => {
  assert.throws(() => noteToPc('H'), /H/);
  assert.throws(() => noteToPc('xyz'), /xyz/);
});

test('chordMidi: Am in Oktave 3', () => {
  assert.deepEqual(chordMidi({ root: 'A', quality: 'min' }, 3), [57, 60, 64]);
});

test('scalePcs: A-Moll-Pentatonik', () => {
  assert.deepEqual(scalePcs(aMinor, 'minorPentatonic'), [9, 0, 2, 4, 7]);
});

test('scalePcs: weitere Skalen', () => {
  assert.deepEqual(scalePcs({ root: 'C', mode: 'major' }, 'majorPentatonic'), [0, 2, 4, 7, 9]);
  assert.deepEqual(scalePcs(aMinor, 'blues'), [9, 0, 2, 3, 4, 7]);
  assert.deepEqual(scalePcs({ root: 'D', mode: 'minor' }, 'dorian'), [2, 4, 5, 7, 9, 11, 0]);
});

test('diatonicChords für A-Moll', () => {
  assert.deepEqual(diatonicChords(aMinor).map(name),
    ['A:min', 'B:dim', 'C:maj', 'D:min', 'E:min', 'F:maj', 'G:maj']);
});

test('diatonicChords für C-Dur', () => {
  assert.deepEqual(diatonicChords({ root: 'C', mode: 'major' }).map(name),
    ['C:maj', 'D:min', 'E:min', 'F:maj', 'G:maj', 'A:min', 'B:dim']);
});

test('allowedChords: Moll bekommt zusätzlich die Dur-Dominante', () => {
  const chords = allowedChords(aMinor).map(name);
  assert.equal(chords.length, 8);
  assert.ok(chords.includes('E:maj'));
  assert.ok(!chords.includes('C#:maj'));
});

test('allowedChords: Dur bleibt diatonisch', () => {
  assert.equal(allowedChords({ root: 'C', mode: 'major' }).length, 7);
});

const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const names = (key) => allowedChords(key).map((c) => c.root + SYMBOLS[c.quality]);

test('Schreibweise folgt der Vorzeichnung: Moll über die parallele Dur-Tonart', () => {
  assert.deepEqual(names({ root: 'C', mode: 'minor' }), ['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb', 'G']);
  assert.deepEqual(names({ root: 'D', mode: 'minor' }), ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C', 'A']);
  assert.deepEqual(names({ root: 'G', mode: 'minor' }), ['Gm', 'Adim', 'Bb', 'Cm', 'Dm', 'Eb', 'F', 'D']);
  assert.deepEqual(names({ root: 'A', mode: 'minor' }), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G', 'E']);
  assert.deepEqual(names({ root: 'E', mode: 'minor' }), ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D', 'B']);
  assert.deepEqual(names({ root: 'F', mode: 'major' }), ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim']);
  assert.deepEqual(names({ root: 'D', mode: 'major' }), ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim']);
});

test('Dorisch: eigener Modus mit eigenen Akkorden, Schreibweise über die Dur-Tonart zwei Halbtöne tiefer', () => {
  assert.ok(MODE_NAMES.includes('dorian'));
  assert.ok(isValidKey({ root: 'A', mode: 'dorian' }));
  assert.deepEqual(names({ root: 'A', mode: 'dorian' }), ['Am', 'Bm', 'C', 'D', 'Em', 'F#dim', 'G']);
  assert.deepEqual(names({ root: 'D', mode: 'dorian' }), ['Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
  assert.deepEqual(names({ root: 'G', mode: 'dorian' }), ['Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim', 'F']);
  assert.deepEqual(names({ root: 'C', mode: 'dorian' }), ['Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim', 'Bb']);
  // Akkordtöne liegen in der dorischen Skala
  const pcs = scalePcs({ root: 'A', mode: 'dorian' }, 'dorian');
  for (const c of allowedChords({ root: 'A', mode: 'dorian' })) {
    for (const m of chordMidi(c, 3)) assert.ok(pcs.includes(m % 12), `${c.root}${c.quality}`);
  }
});

test('Grundton mit Vorzeichen behält seine Schreibweise', () => {
  assert.equal(diatonicChords({ root: 'Eb', mode: 'minor' })[0].root, 'Eb');
  assert.equal(diatonicChords({ root: 'Bb', mode: 'major' })[3].root, 'Eb');
  assert.equal(diatonicChords({ root: 'F#', mode: 'minor' })[0].root, 'F#');
  assert.equal(diatonicChords({ root: 'C#', mode: 'major' })[0].root, 'C#');
  assert.equal(diatonicChords({ root: 'Db', mode: 'major' })[0].root, 'Db');
});

test('alle Grundtöne und Modi: gültige Tonnamen, kein Akkordname doppelt', () => {
  const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'C#', 'D#', 'G#', 'A#', 'Gb'];
  for (const root of ROOTS) {
    for (const mode of MODE_NAMES) {
      const chords = allowedChords({ root, mode });
      for (const c of chords) assert.ok(isNoteName(c.root), `${root} ${mode}: ${c.root}`);
      const list = names({ root, mode });
      assert.equal(new Set(list).size, list.length, `${root} ${mode}: ${list}`);
    }
  }
});
