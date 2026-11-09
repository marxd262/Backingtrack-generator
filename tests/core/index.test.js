import { test } from 'node:test';
import assert from 'node:assert/strict';

// R3: Einstiegspunkt samt allen Importen lädt in reinem Node (keine Browser-Globals beim Import)
test('src/index.js lädt in Node und exportiert die Schnittstelle', async () => {
  const api = await import('../../src/index.js');
  for (const name of ['play', 'buildEvents', 'chordTimeline', 'validateTrack', 'allowedChords', 't', 'setLanguage', 'getLanguage']) assert.equal(typeof api[name], 'function', name);
  assert.ok(Array.isArray(api.VALIDATION_CODES) && api.VALIDATION_CODES.includes('badBpm'));
  assert.ok(Array.isArray(api.TAG_CATEGORIES) && api.TAG_CATEGORIES.length > 0);
  assert.ok(Array.isArray(api.STYLE_PRESETS) && api.STYLE_PRESETS.length > 0);
  for (const name of ['chordName', 'chordOptions']) assert.equal(typeof api[name], 'function', name);
  assert.equal(api.chordName({ root: 'C', quality: 'maj7' }), 'Cmaj7');
  assert.ok(api.CHORDS && Object.keys(api.CHORDS).length >= 17 && api.CHORDS.dom7.symbol === '7');
  assert.ok(api.METERS && Object.keys(api.METERS).length === 5 && api.METERS['6/8'].sub === 3);
  assert.ok(api.GROOVES && api.GROOVES.straight.meter === '4/4' && Object.keys(api.GROOVES).length >= 9);
  assert.deepEqual(api.DRUM_NAMES, ['kick', 'snare', 'hat', 'openHat', 'tomHigh', 'tomMid', 'tomLow']);
});
