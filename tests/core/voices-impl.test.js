// Stimmen-Register und Klangerzeugung gehören zusammen: jeder Eintrag hat eine Umsetzung, jede Feinwert-Tabelle einen Eintrag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, VOICE_LAYERS } from '../../src/core/voices.js';
import { hasVoice } from '../../src/audio/voices/index.js';
import { TUNABLES, tunedValue } from '../../src/audio/voices/tunables.js';

test('jeder Eintrag des Registers (Instrument, Stimme, Variante) hat eine Umsetzung', () => {
  for (const layer of VOICE_LAYERS) {
    for (const [id, voice] of Object.entries(VOICES[layer])) {
      for (const variant of voice.variants) assert.ok(hasVoice(layer, id, variant), `${layer}/${id}/${variant}`);
    }
  }
  assert.ok(!hasVoice('bass', 'nope', 'x') && !hasVoice('drums', 'synth', 'classic'));
});

test('Feinwert-Tabellen gehören zu Registereinträgen und sind in sich stimmig', () => {
  for (const [key, table] of Object.entries(TUNABLES)) {
    const [layer, id, variant] = key.split('/');
    assert.ok(VOICES[layer]?.[id]?.variants.includes(variant), `${key}: kein Registereintrag`);
    assert.ok(Object.keys(table).length > 0, key);
    for (const [name, s] of Object.entries(table)) {
      assert.ok([s.min, s.max, s.step, s.value].every(Number.isFinite), `${key}.${name}: Zahlen`);
      assert.ok(s.min < s.max && s.step > 0 && s.value >= s.min && s.value <= s.max, `${key}.${name}: Bereich ${JSON.stringify(s)}`);
      assert.equal(tunedValue(key, name, undefined), s.value, `${key}.${name}: Standard`);
    }
  }
});

test('tunedValue: Überschreibung begrenzt, Ungültiges zählt nicht, Unbekanntes ist NaN', () => {
  const key = 'chords/epiano/rhodes';
  const spec = TUNABLES[key].index;
  assert.equal(tunedValue(key, 'index', { [key]: { index: spec.max + 100 } }), spec.max);
  assert.equal(tunedValue(key, 'index', { [key]: { index: spec.min - 100 } }), spec.min);
  for (const bad of [null, undefined, 3, 'x', [], { [key]: null }, { [key]: { index: NaN } }, { [key]: { index: 'x' } }]) assert.equal(tunedValue(key, 'index', bad), spec.value, JSON.stringify(bad));
  assert.ok(Number.isNaN(tunedValue('nope', 'index', {})) && Number.isNaN(tunedValue(key, 'nope', {})));
});
