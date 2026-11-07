import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressionFor, PROGRESSION_TEMPLATES } from '../../src/core/progressions.js';
import { allowedChords, diatonicChords, MODE_NAMES } from '../../src/core/music.js';

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const name = (c) => c.root + SYMBOLS[c.quality];
const aMinor = { root: 'A', mode: 'minor' };

test('je Modus vier Vorlagen mit je vier Stufen', () => {
  assert.deepEqual(Object.keys(PROGRESSION_TEMPLATES).sort(), [...MODE_NAMES].sort());
  for (const mode of MODE_NAMES) {
    assert.equal(PROGRESSION_TEMPLATES[mode].length, 4, mode);
    for (const tpl of PROGRESSION_TEMPLATES[mode]) assert.equal(tpl.degrees.length, 4, tpl.name);
  }
});

test('alle Akkorde gehören zur Tonart, für alle 12 Grundtöne, alle Modi und viele Seeds', () => {
  for (const root of ROOTS) {
    for (const mode of MODE_NAMES) {
      const key = { root, mode };
      const allowed = allowedChords(key).map(name);
      for (let seed = 0; seed < 200; seed++) {
        const prog = progressionFor(key, seed);
        assert.equal(prog.length, 4);
        for (const c of prog) assert.ok(allowed.includes(name(c)), `${root} ${mode} seed ${seed}: ${name(c)}`);
      }
    }
  }
});

test('Dur-Folgen bleiben diatonisch', () => {
  const key = { root: 'G', mode: 'major' };
  const diatonic = diatonicChords(key).map(name);
  for (let seed = 0; seed < 100; seed++) for (const c of progressionFor(key, seed)) assert.ok(diatonic.includes(name(c)));
});

test('deterministisch je Seed', () => {
  for (let seed = 0; seed < 50; seed++) assert.deepEqual(progressionFor(aMinor, seed), progressionFor(aMinor, seed));
});

test('mindestens 3 verschiedene Folgen über 50 Seeds in A-Moll', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 50; seed++) seen.add(progressionFor(aMinor, seed).map(name).join(' '));
  assert.ok(seen.size >= 3, [...seen].join(' | '));
});

test('A-Moll mit erster Vorlage: Am Am Dm E; alle Vorlagen ergeben die erwarteten Folgen', () => {
  const found = new Set();
  let first = null;
  for (let seed = 1; seed <= 200; seed++) {
    const p = progressionFor(aMinor, seed).map(name).join(' ');
    found.add(p);
    if (first === null && p === 'Am Am Dm E') first = seed;
  }
  assert.ok(first !== null, 'kein Seed wählt die erste Vorlage');
  assert.deepEqual([...found].sort(), ['Am Am Dm E', 'Am Dm Am E', 'Am F C G', 'Am G F G']);
  const major = new Set();
  for (let seed = 1; seed <= 200; seed++) major.add(progressionFor({ root: 'C', mode: 'major' }, seed).map(name).join(' '));
  assert.deepEqual([...major].sort(), ['C Am F G', 'C C F G', 'C F G F', 'C G Am F']);
});

test('Dorisch: deterministisch, Folgen i-IV-i-VII, i-IV-VII-IV, i-VII-IV-i, i-i-IV-i', () => {
  const aDorian = { root: 'A', mode: 'dorian' };
  for (let seed = 0; seed < 50; seed++) assert.deepEqual(progressionFor(aDorian, seed), progressionFor(aDorian, seed));
  const found = new Set();
  for (let seed = 1; seed <= 200; seed++) found.add(progressionFor(aDorian, seed).map(name).join(' '));
  assert.ok(found.size >= 3, [...found].join(' | '));
  assert.deepEqual([...found].sort(), ['Am Am D Am', 'Am D Am G', 'Am D G D', 'Am G D Am']);
});

test('Rückgabe ist eine Kopie, Änderungen wirken nicht zurück', () => {
  const p = progressionFor(aMinor, 3);
  p[0].root = 'X';
  assert.notEqual(progressionFor(aMinor, 3)[0].root, 'X');
});
