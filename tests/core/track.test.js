import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack, validateTrack, VALIDATION_CODES, MAX_LENGTH, MAX_BEATS } from '../../src/core/track.js';

const bar = (root, quality = 'maj', beats = 4) => ({ chord: { root, quality }, beats });
const am = (root, quality) => bar(root, quality);
const good = () => ({
  key: { root: 'A', mode: 'minor' }, bpm: 90, meter: [4, 4], tags: {}, length: 24, seed: 1,
  layers: { drums: true, bass: true, chords: true, pad: true },
  bars: [am('A', 'min'), am('A', 'min'), am('D', 'min'), am('E', 'maj')],
});
const codes = (t) => validateTrack(t).map((e) => e.code);

test('normalizeTrack setzt Standardwerte', () => {
  const t = normalizeTrack({ key: { root: 'A', mode: 'minor' }, bpm: 90, bars: [] });
  assert.deepEqual(t.meter, [4, 4]);
  assert.equal(t.length, 24);
  assert.deepEqual(t.layers, { drums: true, bass: true, chords: true, pad: true });
  assert.deepEqual(t.tags, {});
  assert.equal(t.seed, 1);
});

test('normalizeTrack behält Angaben und Progression, verändert die Eingabe nicht', () => {
  const input = { key: { root: 'A', mode: 'minor' }, bpm: 80, length: 8, seed: 7,
    layers: { drums: false }, bars: [am('A', 'min')] };
  const frozen = structuredClone(input);
  const t = normalizeTrack(input);
  assert.deepEqual(input, frozen);
  assert.equal(t.length, 8);
  assert.equal(t.seed, 7);
  assert.deepEqual(t.layers, { drums: false, bass: true, chords: true, pad: true });
  assert.deepEqual(t.bars, input.bars);
  t.layers.bass = false;
  t.bars[0].beats = 9;
  assert.deepEqual(input, frozen);
});

test('validateTrack: gültiger Track meldet nichts (Am Am Dm E)', () => {
  assert.deepEqual(validateTrack(good()), []);
});

test('validateTrack: emptyBars', () => {
  assert.deepEqual(codes({ ...good(), bars: [] }), ['emptyBars']);
});

test('validateTrack: chordNotInKey mit params.chord', () => {
  const errs = validateTrack({ ...good(), bars: [am('C#', 'maj')] });
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, 'chordNotInKey');
  assert.equal(errs[0].params.chord, 'C#');
});

test('validateTrack: Akkorde werden nach Tonhöhe verglichen (Bb = A#)', () => {
  const t = { ...good(), key: { root: 'D', mode: 'minor' }, bars: [am('A#', 'maj'), am('Bb', 'maj')] };
  assert.deepEqual(validateTrack(t), []);
});

test('validateTrack: Akkordsymbole in params.chord', () => {
  const errs = validateTrack({ ...good(), bars: [am('C#', 'min'), am('C#', 'dim')] });
  assert.deepEqual(errs.map((e) => e.params.chord), ['C#m', 'C#dim']);
});

test('validateTrack: badBpm', () => {
  assert.deepEqual(codes({ ...good(), bpm: 0 }), ['badBpm']);
  assert.deepEqual(codes({ ...good(), bpm: NaN }), ['badBpm']);
});

test('validateTrack: bpm nur im Bereich 20 bis 400', () => {
  for (const bpm of [19, 401, Infinity, -Infinity]) {
    assert.deepEqual(codes({ ...good(), bpm }), ['badBpm'], String(bpm));
  }
  for (const bpm of [20, 400]) assert.deepEqual(codes({ ...good(), bpm }), [], String(bpm));
});

test('validateTrack: unknownQuality (ohne zusätzliches chordNotInKey)', () => {
  const errs = validateTrack({ ...good(), bars: [am('A', 'xyz')] });
  assert.deepEqual(errs.map((e) => e.code), ['unknownQuality']);
  assert.equal(errs[0].params.chord, 'Axyz');
});

test('validateTrack: badBeats', () => {
  for (const beats of [0, -1, 2.5, '4', undefined]) {
    assert.deepEqual(codes({ ...good(), bars: [{ chord: { root: 'A', quality: 'min' }, beats }] }), ['badBeats'], String(beats));
  }
});

test('validateTrack: badLength', () => {
  for (const length of [0, -4, 1.5, '24', undefined]) {
    assert.deepEqual(codes({ ...good(), length }), ['badLength'], String(length));
  }
});

test('validateTrack: length über MAX_LENGTH ist badLength', () => {
  assert.equal(MAX_LENGTH, 512);
  assert.deepEqual(codes({ ...good(), length: MAX_LENGTH }), []);
  for (const length of [MAX_LENGTH + 1, 1e9, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(codes({ ...good(), length }), ['badLength'], String(length));
  }
});

test('validateTrack: sammelt mehrere Meldungen und wirft nicht', () => {
  assert.deepEqual(codes({ ...good(), bpm: 0, length: 0, bars: [] }), ['badBpm', 'badLength', 'emptyBars']);
});

test('validateTrack: unbekannter Akkord-Grundton ergibt chordNotInKey, ohne zu werfen', () => {
  const errs = validateTrack({ ...good(), bars: [am('H', 'min')] });
  assert.deepEqual(errs, [{ code: 'chordNotInKey', params: { bar: 1, chord: 'Hm' } }]);
});

test('VALIDATION_CODES listet alle dreizehn Codes', () => {
  assert.deepEqual([...VALIDATION_CODES].sort(),
    ['badBar', 'badBeats', 'badBpm', 'badComplexity', 'badGroove', 'badKey', 'badLength', 'badMeter', 'badTags', 'badVoice', 'chordNotInKey', 'emptyBars', 'unknownQuality'].sort());
  assert.equal(VALIDATION_CODES.length, 13);
});

test('validateTrack: beats höchstens MAX_BEATS (16)', () => {
  assert.equal(MAX_BEATS, 16);
  for (const beats of [1, 3, 16]) assert.deepEqual(codes({ ...good(), bars: [bar('A', 'min', beats)] }), [], String(beats));
  for (const beats of [17, 1e4, 1e5]) {
    assert.deepEqual(validateTrack({ ...good(), bars: [bar('A', 'min', beats)] }), [{ code: 'badBeats', params: { bar: 1, beats } }]);
  }
});

test('validateTrack: badTags mit Kategorie und Schlagwort, soweit bekannt', () => {
  const tagErrors = (tags) => validateTrack({ ...good(), tags });
  for (const tags of ['driving', 5, true, [], [['driving']]]) assert.deepEqual(tagErrors(tags), [{ code: 'badTags', params: {} }], JSON.stringify(tags));
  assert.deepEqual(tagErrors({ nope: ['driving'] }), [{ code: 'badTags', params: { category: 'nope' } }]);
  assert.deepEqual(tagErrors({ drums: 'driving' }), [{ code: 'badTags', params: { category: 'drums' } }]);
  assert.deepEqual(tagErrors({ drums: null }), [{ code: 'badTags', params: { category: 'drums' } }]);
  assert.deepEqual(tagErrors({ drums: ['driving', 'nope'] }), [{ code: 'badTags', params: { category: 'drums', tag: 'nope' } }]);
  assert.deepEqual(tagErrors({ bass: ['driving'] }), [{ code: 'badTags', params: { category: 'bass', tag: 'driving' } }]);
  assert.deepEqual(tagErrors({ drums: [5, null] }).map((e) => e.params.tag), [5, 'null']);
  // Prototyp-Schlüssel als eigene Eigenschaften (so liefert sie JSON.parse)
  const proto = JSON.parse('{"__proto__": ["driving"], "constructor": ["driving"], "toString": []}');
  assert.deepEqual(tagErrors(proto).map((e) => e.params.category), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(tagErrors({ drums: ['toString'] }), [{ code: 'badTags', params: { category: 'drums', tag: 'toString' } }]);
});

test('validateTrack: gültige oder fehlende Schlagworte melden nichts', () => {
  for (const tags of [undefined, null, {}, { drums: [] }, { drums: ['driving', 'dry'], mood: [] }]) {
    assert.deepEqual(validateTrack({ ...good(), tags }), [], JSON.stringify(tags));
  }
});

test('validateTrack: kaputte Takte ergeben badBar statt Wurf', () => {
  const broken = [null, 'x', 5, [], {}, { beats: 4 }, { chord: null, beats: 4 }, { chord: 'Am', beats: 4 },
    { chord: { quality: 'min' }, beats: 4 }, { chord: { root: 9, quality: 'min' }, beats: 4 }];
  for (const b of broken) {
    assert.deepEqual(validateTrack({ ...good(), bars: [b] }), [{ code: 'badBar', params: { bar: 1 } }], JSON.stringify(b));
  }
  const errs = validateTrack({ ...good(), bars: [am('A', 'min'), null, am('D', 'min')] });
  assert.deepEqual(errs, [{ code: 'badBar', params: { bar: 2 } }]);
});

test('validateTrack: fehlende oder kaputte Tonart ergibt badKey und keine Akkordprüfung', () => {
  const noKey = good();
  delete noKey.key;
  const keys = [undefined, null, 'A', 5, [], {}, { root: 'A' }, { mode: 'minor' }, { root: 'H', mode: 'minor' },
    { root: ['A'], mode: 'minor' }, { root: 'A', mode: 'lydian' }, { root: 'A', mode: 'toString' }];
  for (const key of keys) {
    assert.deepEqual(codes({ ...good(), key, bars: [am('C#', 'maj')] }), ['badKey'], JSON.stringify(key));
  }
  assert.deepEqual(codes(noKey), ['badKey']);
});

test('validateTrack: dorische Tonart mit dorischen Akkorden ist gültig, Moll-Dominante nicht', () => {
  const dorian = { ...good(), key: { root: 'A', mode: 'dorian' }, bars: [am('A', 'min'), am('D', 'maj'), am('G', 'maj'), am('B', 'min')] };
  assert.deepEqual(validateTrack(dorian), []);
  assert.deepEqual(codes({ ...dorian, bars: [am('E', 'maj')] }), ['chordNotInKey']);
  assert.deepEqual(codes({ ...dorian, bars: [am('F', 'maj')] }), ['chordNotInKey']);
});

test('validateTrack: geerbte Eigenschaften zählen nicht als Akkordart', () => {
  const errs = validateTrack({ ...good(), bars: [am('A', 'toString'), { chord: { root: 'A' }, beats: 4 }] });
  assert.deepEqual(errs.map((e) => e.code), ['unknownQuality', 'unknownQuality']);
});

test('validateTrack: wirft nie, auch bei null, undefined und Unsinn', () => {
  for (const t of [null, undefined, 'x', 5, [], {}]) {
    assert.deepEqual(codes(t).sort(), ['badBpm', 'badKey', 'badLength', 'emptyBars'], String(t));
  }
  for (const bars of [undefined, null, 'Am', {}, { length: 1 }]) {
    assert.deepEqual(codes({ ...good(), bars }), ['emptyBars'], String(bars));
  }
  assert.doesNotThrow(() => validateTrack({ ...good(), bpm: Object.create(null), bars: [{ chord: { root: 'A', quality: Object.create(null) }, beats: Object.create(null) }] }));
});

test('normalizeTrack: null und undefined ergeben Standardwerte', () => {
  for (const input of [null, undefined]) {
    const t = normalizeTrack(input);
    assert.deepEqual(t.meter, [4, 4]);
    assert.equal(t.length, 24);
    assert.equal(t.seed, 1);
  }
});

const cMajor = { key: { root: 'C', mode: 'major' }, bars: [] };
const withBars = (base, ...chords) => ({ ...good(), ...base, bars: chords.map(([r, q]) => bar(r, q)) });

test('validateTrack: neue Akkordarten sind auf ihren Stufen gültig', () => {
  assert.deepEqual(codes(withBars({}, ['A', 'min7'], ['E', 'dom7'], ['B', 'm7b5'], ['D', 'sus4'], ['C', 'power'], ['C', 'add9'], ['F', 'maj7'], ['G', 'dom9'])), []);
  assert.deepEqual(codes(withBars(cMajor, ['G', 'dom7'], ['E', 'min7'], ['B', 'm7b5'], ['C', 'maj7'], ['A', 'min7'], ['B', 'dim7'], ['D', 'min9'])), []);
  assert.deepEqual(codes(withBars({}, ['E', 'min'], ['E', 'maj'], ['E', 'sus2'], ['E', 'aug'])), [], 'E ist in A-Moll Moll-Stufe und Dur-Dominante');
});

test('validateTrack: neue Akkordart auf der falschen Stufe ergibt chordNotInKey mit dem Namen', () => {
  for (const [root, quality, name] of [['B', 'maj7', 'Bmaj7'], ['D', 'dom7', 'D7'], ['C', 'min7', 'Cm7'], ['A', 'dom9', 'A9']]) {
    assert.deepEqual(validateTrack(withBars(cMajor, [root, quality])), [{ code: 'chordNotInKey', params: { bar: 1, chord: name } }], name);
  }
});

test('validateTrack: A# und Bb sind dieselbe Stufe, auch bei neuen Arten', () => {
  const f = { key: { root: 'F', mode: 'major' } };
  assert.deepEqual(codes(withBars(f, ['Bb', 'dom7'])), []);
  assert.deepEqual(codes(withBars(f, ['A#', 'dom7'])), []);
  assert.deepEqual(codes(withBars(f, ['A#', 'min7'])), ['chordNotInKey']);
});

test('validateTrack: unbekannte Art meldet nur unknownQuality, auch bei Prototyp-Namen', () => {
  for (const quality of ['dom11', 'toString', '__proto__', 'constructor', 5, null]) {
    assert.deepEqual(codes(withBars({}, ['A', quality])), ['unknownQuality'], String(quality));
  }
});
