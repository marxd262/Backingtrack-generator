import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHORD_QUALITIES, noteToPc, chordMidi, scalePcs, diatonicChords, allowedChords } from '../../src/core/music.js';

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
