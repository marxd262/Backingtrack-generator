// Akkord-Register (src/core/chords.js) und die tonartabhängigen Helfer in music.js. Die Registertests laufen über alle Arten,
// damit eine neu ergänzte Akkordart automatisch erfasst wird.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHORDS, CHORD_GROUPS, BASES, isChordQuality, chordName, chordShort, qualitiesFor } from '../../src/core/chords.js';
import { CHORD_QUALITIES, chordTones, stepBase, dominantRoot, chordOptions, diatonicChords, allowedChords } from '../../src/core/music.js';

const IDS = Object.keys(CHORDS);
const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object' || v === null || deepFrozen(v));
const aMinor = { root: 'A', mode: 'minor' };

// Die Tests unten schreiben keine Anzahl und keine vollständige Liste fest, damit eine ergänzte Akkordart (ein Registereintrag plus
// ihre Namen) keine Testanpassung braucht. Die heutigen Arten stehen in KNOWN, was sie erwarten, bleibt aber Teil des Vertrags.
const KNOWN = {
  maj: 'C', min: 'Cm', dim: 'Cdim', aug: 'Caug', sus2: 'Csus2', sus4: 'Csus4', power: 'C5', dom7: 'C7', maj7: 'Cmaj7', min7: 'Cm7',
  m7b5: 'Cm7b5', dim7: 'Cdim7', maj6: 'C6', min6: 'Cm6', add9: 'Cadd9', dom9: 'C9', min9: 'Cm9',
};
// actual enthält alle erwarteten Arten in dieser Reihenfolge (weitere Arten dazwischen sind erlaubt)
const inOrder = (actual, expected) => assert.deepEqual(actual.filter((q) => expected.includes(q)), expected);

test('Register: die heutigen 17 Arten sind da, die drei Dreiklänge zuerst, nach Gruppen geordnet, tief eingefroren', () => {
  inOrder(IDS, Object.keys(KNOWN));
  assert.deepEqual(IDS.slice(0, 3), ['maj', 'min', 'dim']);
  const groupIndex = IDS.map((id) => CHORD_GROUPS.indexOf(CHORDS[id].group));
  assert.deepEqual(groupIndex, [...groupIndex].sort((a, b) => a - b), 'triad, dann seventh, dann extended');
  assert.ok(deepFrozen(CHORDS));
  assert.deepEqual([...CHORD_GROUPS], ['triad', 'seventh', 'extended']);
  assert.deepEqual([...BASES], ['maj', 'min', 'dim']);
});

test('Register: jede Art ist in sich stimmig', () => {
  const symbols = new Set();
  for (const id of IDS) {
    const c = CHORDS[id];
    assert.equal(c.intervals[0], 0, `${id}: beginnt bei 0`);
    for (let i = 1; i < c.intervals.length; i++) assert.ok(c.intervals[i] > c.intervals[i - 1], `${id}: aufsteigend und eindeutig`);
    assert.ok(c.intervals.includes(c.fifth), `${id}: Quinte ist ein Intervall`);
    if (c.seventh !== undefined) assert.ok(c.intervals.includes(c.seventh), `${id}: Septime ist ein Intervall`);
    assert.ok(c.base === null || BASES.includes(c.base), `${id}: base`);
    assert.ok(Array.isArray(c.on) && c.on.length > 0 && c.on.every((b) => BASES.includes(b)), `${id}: on`);
    if (c.base !== null) assert.ok(c.on.includes(c.base), `${id}: on enthält base`);
    assert.ok(CHORD_GROUPS.includes(c.group), `${id}: group`);
    assert.equal(typeof c.symbol, 'string', `${id}: symbol`);
    assert.ok(!symbols.has(c.symbol), `${id}: Symbol "${c.symbol}" doppelt`);
    symbols.add(c.symbol);
  }
});

test('CHORD_QUALITIES: alte Dreiklänge unverändert, alle Arten aus dem Register abgeleitet', () => {
  assert.deepEqual({ maj: CHORD_QUALITIES.maj, min: CHORD_QUALITIES.min, dim: CHORD_QUALITIES.dim }, { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6] });
  for (const id of IDS) assert.deepEqual(CHORD_QUALITIES[id], CHORDS[id].intervals, id);
});

test('chordName und chordShort: die Namen der heutigen Arten und die Regel für alle', () => {
  for (const [quality, name] of Object.entries(KNOWN)) assert.equal(chordName({ root: 'C', quality }), name, quality);
  for (const quality of IDS) assert.equal(chordName({ root: 'C', quality }), `C${CHORDS[quality].symbol}`, quality);
  assert.equal(chordShort({ root: 'B', quality: 'dim' }), 'B°');
  for (const id of IDS.filter((q) => q !== 'dim')) assert.equal(chordShort({ root: 'A', quality: id }), chordName({ root: 'A', quality: id }), id);
});

test('isChordQuality kennt genau die Registerarten (auch keine Prototyp-Namen)', () => {
  for (const id of IDS) assert.equal(isChordQuality(id), true, id);
  for (const bad of ['', 'major', 'toString', '__proto__', 'constructor', null, undefined, 5, {}]) assert.equal(isChordQuality(bad), false, String(bad));
});

test('chordTones: MIDI ab Oktave, auch Erweiterungen über die Oktave und Powerchord', () => {
  assert.deepEqual(chordTones({ root: 'A', quality: 'min' }, 3), [57, 60, 64]);
  assert.deepEqual(chordTones({ root: 'A', quality: 'dom7' }, 3), [57, 61, 64, 67]);
  assert.deepEqual(chordTones({ root: 'A', quality: 'add9' }, 3), [57, 61, 64, 71]);
  assert.deepEqual(chordTones({ root: 'A', quality: 'power' }, 3), [57, 64]);
  assert.deepEqual(chordTones({ root: 'C', quality: 'dom9' }, 3), [48, 52, 55, 58, 62]);
});

test('qualitiesFor liefert die Arten je Grundart in Registerreihenfolge', () => {
  inOrder(qualitiesFor('dim'), ['dim', 'power', 'm7b5', 'dim7']);
  inOrder(qualitiesFor('min'), ['min', 'sus2', 'sus4', 'power', 'min7', 'min6', 'min9']);
  inOrder(qualitiesFor('maj'), ['maj', 'aug', 'sus2', 'sus4', 'power', 'dom7', 'maj7', 'maj6', 'add9', 'dom9']);
  assert.ok(!qualitiesFor('min').includes('dom7') && !qualitiesFor('dim').includes('maj'), 'nur erlaubte Arten');
  for (const base of BASES) for (const q of qualitiesFor(base)) assert.ok(CHORDS[q].on.includes(base), `${base}: ${q}`);
  assert.deepEqual(qualitiesFor('nope'), []);
});

test('dominantRoot: Dur Stufe V, Moll die Dur-Dominante, Dorisch Stufe IV', () => {
  assert.equal(dominantRoot(aMinor), 'E');
  assert.equal(dominantRoot({ root: 'C', mode: 'major' }), 'G');
  assert.equal(dominantRoot({ root: 'A', mode: 'dorian' }), 'D');
  assert.equal(dominantRoot({ root: 'Bb', mode: 'major' }), 'F');
});

test('stepBase: eindeutige Arten bringen ihre Grundart mit, sus/power folgen der diatonischen Stufe', () => {
  assert.equal(stepBase({ root: 'E', quality: 'min7' }, aMinor), 'min');
  assert.equal(stepBase({ root: 'E', quality: 'dom7' }, aMinor), 'maj');
  assert.equal(stepBase({ root: 'E', quality: 'maj' }, aMinor), 'maj');
  assert.equal(stepBase({ root: 'E', quality: 'sus4' }, aMinor), 'min', 'diatonisch: Em, nicht die Dominante');
  assert.equal(stepBase({ root: 'D', quality: 'sus4' }, aMinor), 'min');
  assert.equal(stepBase({ root: 'B', quality: 'power' }, aMinor), 'dim');
  assert.equal(stepBase({ root: 'D', quality: 'maj' }, { root: 'A', mode: 'dorian' }), 'maj');
  assert.equal(stepBase({ root: 'A#', quality: 'power' }, { root: 'F', mode: 'major' }), 'maj', 'A# und Bb sind dieselbe Tonhöhe');
  assert.equal(stepBase({ root: 'C#', quality: 'power' }, aMinor), null, 'Grundton ohne Stufe');
  assert.equal(stepBase({ root: 'C#', quality: 'maj' }, aMinor), null, 'auch bei Arten mit einer festen Grundart');
  assert.equal(stepBase({ root: 'C#', quality: 'dom7' }, aMinor), null);
  assert.equal(stepBase({ root: 'C', quality: 'nope' }, aMinor), null);
});

test('chordOptions: A-Moll hat sieben Grundtöne, die Dominante E vereint Moll- und Dur-Arten', () => {
  const options = chordOptions(aMinor);
  assert.deepEqual(options.map((o) => o.root), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const e = options.find((o) => o.root === 'E').qualities;
  for (const q of ['min', 'min7', 'maj', 'dom7', 'dom9', 'maj7', 'sus4', 'power']) assert.ok(e.includes(q), `E: ${q}`);
  assert.deepEqual(options.find((o) => o.root === 'B').qualities, qualitiesFor('dim'));
  inOrder(options.find((o) => o.root === 'B').qualities, ['dim', 'power', 'm7b5', 'dim7']);
  assert.ok(!options.find((o) => o.root === 'A').qualities.includes('maj'), 'A ist nur die Moll-Stufe');
  assert.deepEqual(options.find((o) => o.root === 'A').qualities, qualitiesFor('min'));
});

test('chordOptions: Schreibweise der Tonart, jeder Eintrag deckt allowedChords ab, Reihenfolge der Registerarten', () => {
  assert.deepEqual(chordOptions({ root: 'F', mode: 'major' }).map((o) => o.root), ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
  assert.equal(chordOptions({ root: 'Eb', mode: 'minor' })[0].root, 'Eb');
  for (const root of ['C', 'F#', 'Bb', 'E']) {
    for (const mode of ['minor', 'major', 'dorian']) {
      const key = { root, mode };
      const options = chordOptions(key);
      for (const c of allowedChords(key)) {
        const o = options.find((x) => x.root === c.root);
        assert.ok(o && o.qualities.includes(c.quality), `${root} ${mode}: ${c.root}${c.quality}`);
      }
      for (const o of options) assert.deepEqual(o.qualities, IDS.filter((id) => o.qualities.includes(id)), 'Registerreihenfolge');
      assert.equal(options.length, diatonicChords(key).length);
    }
  }
});
