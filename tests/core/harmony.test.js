// Akkordfarbe: schreibt die Arten aller Akkorde einer Folge um (Dreiklänge, Septakkorde, Erweiterungen, Powerchords).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHORD_COLORS, colorChord, colorProgression } from '../../src/core/harmony.js';
import { progressionFor } from '../../src/core/progressions.js';
import { validateTrack } from '../../src/core/track.js';
import { chordName } from '../../src/core/chords.js';
import { MODE_NAMES } from '../../src/core/music.js';

const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const aMinor = { root: 'A', mode: 'minor' };
const parse = (text) => text.split(' ').map((n) => {
  const [, root, symbol] = /^([A-G][#b]?)(.*)$/.exec(n);
  const quality = { '': 'maj', m: 'min', dim: 'dim', m7: 'min7', 7: 'dom7', maj7: 'maj7', m7b5: 'm7b5', dim7: 'dim7', 9: 'dom9', m9: 'min9', add9: 'add9', 5: 'power', sus4: 'sus4' }[symbol];
  return { chord: { root, quality }, beats: 4 };
});
const names = (bars) => bars.map((b) => chordName(b.chord)).join(' ');

test('CHORD_COLORS: die vier Farben in fester Reihenfolge', () => {
  assert.deepEqual([...CHORD_COLORS], ['triads', 'sevenths', 'extended', 'power']);
});

test('A-Moll: Septakkorde, Erweiterungen, Powerchords und zurück zu Dreiklängen', () => {
  const triads = parse('Am Am Dm E');
  assert.equal(names(colorProgression(triads, 'sevenths', aMinor)), 'Am7 Am7 Dm7 E7');
  assert.equal(names(colorProgression(triads, 'extended', aMinor)), 'Am9 Am9 Dm9 E9');
  assert.equal(names(colorProgression(triads, 'power', aMinor)), 'A5 A5 D5 E5');
  assert.equal(names(colorProgression(colorProgression(triads, 'sevenths', aMinor), 'triads', aMinor)), 'Am Am Dm E');
  assert.equal(names(colorProgression(colorProgression(triads, 'extended', aMinor), 'triads', aMinor)), 'Am Am Dm E');
});

test('C-Dur und A-Dorisch: Dominante je Modus (Dur V, Dorisch IV)', () => {
  const c = { root: 'C', mode: 'major' };
  assert.equal(names(colorProgression(parse('C F G Am'), 'sevenths', c)), 'Cmaj7 Fmaj7 G7 Am7');
  const dorian = { root: 'A', mode: 'dorian' };
  const steps = parse('Am Bm C D Em F#dim G');
  assert.equal(names(colorProgression(steps, 'sevenths', dorian)), 'Am7 Bm7 Cmaj7 D7 Em7 F#m7b5 Gmaj7');
  assert.equal(names(colorProgression(steps, 'extended', dorian)), 'Am9 Bm9 Cadd9 D9 Em9 F#dim7 Gadd9');
});

test('Stufenzuordnung: sus und power folgen der diatonischen Stufe, Dominanten-Septakkorde behalten die Dur-Stufe', () => {
  const one = (text, color) => names(colorProgression(parse(text), color, aMinor));
  assert.equal(one('Esus4', 'sevenths'), 'Em7');
  assert.equal(one('E7', 'sevenths'), 'E7');
  assert.equal(one('E7', 'triads'), 'E');
  assert.equal(one('E5', 'triads'), 'Em', 'Information über den früheren Zustand geht bewusst verloren');
  assert.equal(one('Bdim', 'extended'), 'Bdim7');
});

test('unbekannte Farbe, unbekannte Art und fremder Grundton bleiben unverändert; die Eingabe wird nicht verändert', () => {
  const bars = parse('Am Dm E');
  const copy = structuredClone(bars);
  assert.deepEqual(colorProgression(bars, 'nope', aMinor), bars);
  assert.deepEqual(colorProgression(bars, '__proto__', aMinor), bars);
  assert.deepEqual(bars, copy);
  assert.deepEqual(colorChord({ root: 'A', quality: 'nope' }, 'sevenths', aMinor), { root: 'A', quality: 'nope' });
  assert.deepEqual(colorChord({ root: 'C#', quality: 'maj' }, 'sevenths', aMinor), { root: 'C#', quality: 'maj' });
  assert.deepEqual(colorChord({ root: 'H', quality: 'maj' }, 'sevenths', aMinor), { root: 'H', quality: 'maj' }, 'ungültiger Name wirft nicht');
  assert.notEqual(colorChord(bars[0].chord, 'triads', aMinor), bars[0].chord, 'neues Objekt');
});

test('alle Farben auf alle erzeugten Folgen aller Tonarten und Modi: gültige Tracks, beats bleiben, Wiederholung ändert nichts', () => {
  for (const color of CHORD_COLORS) {
    for (const root of ROOTS) {
      for (const mode of MODE_NAMES) {
        const key = { root, mode };
        for (let seed = 0; seed < 40; seed++) {
          const bars = progressionFor(key, seed).map((chord, i) => ({ chord, beats: 4 - (i % 2) }));
          const colored = colorProgression(bars, color, key);
          assert.deepEqual(validateTrack({ key, bpm: 100, length: 8, bars: colored }), [], `${color} ${root} ${mode} seed ${seed}`);
          assert.deepEqual(colored.map((b) => b.beats), bars.map((b) => b.beats));
          assert.deepEqual(colorProgression(colored, color, key), colored, 'idempotent');
          if (color === 'sevenths' || color === 'extended') assert.deepEqual(colorProgression(colored, 'triads', key), bars, `${color} zurück`);
        }
      }
    }
  }
});
