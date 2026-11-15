import { test } from 'node:test';
import assert from 'node:assert/strict';
import { organTuning, presetDrive, DEFAULT_ORGAN, LESLIE_MODES } from '../../src/ui/organ-tuning.js';
import { TUNABLES, tunedValue } from '../../src/audio/voices/tunables.js';
import { VOICES } from '../../src/core/voices.js';

const KEYS = VOICES.chords.organ.variants.map((v) => `chords/organ/${v}`);

test('Orgel-Einstellungen: im Standard entstehen keine Feinwerte (die Presets gelten unverändert), ungültige Eingaben zählen wie der Standard', () => {
  assert.deepEqual(organTuning(DEFAULT_ORGAN), {});
  for (const bad of [null, undefined, {}, { leslie: 'x' }, { leslie: 'auto', drive: 2 }, { drive: 'laut' }]) assert.deepEqual(organTuning(bad), {}, JSON.stringify(bad));
  assert.deepEqual([...LESLIE_MODES], ['off', 'slow', 'auto', 'fast']);
});

test('Orgel-Einstellungen: Leslie und Zerre gelten für jedes Preset und landen als gültige Feinwerte bei der Stimme', () => {
  // Wähler -> Feinwert leslie: 0 aus, 2 immer langsam, 3 immer schnell (1 = automatisch ist der Standard und wird nicht gesetzt)
  for (const [mode, code] of [['off', 0], ['slow', 2], ['fast', 3]]) {
    const tuning = organTuning({ leslie: mode, drive: null });
    assert.deepEqual(Object.keys(tuning), KEYS);
    for (const key of KEYS) {
      assert.deepEqual(tuning[key], { leslie: code });
      assert.equal(tunedValue(key, 'leslie', tuning), code);
      assert.equal(tunedValue(key, 'drive', tuning), TUNABLES[key].drive.value, 'die Zerre des Presets bleibt');
    }
  }
  const tuning = organTuning({ leslie: 'auto', drive: 0.8 });
  for (const key of KEYS) {
    assert.equal(tunedValue(key, 'drive', tuning), 0.8);
    assert.equal(tunedValue(key, 'leslie', tuning), 1);
  }
  assert.equal(tunedValue('chords/organ/jazz', 'drive', organTuning({ leslie: 'fast', drive: 0 })), 0);
});

test('presetDrive: die Zerre, die ein Preset mitbringt (Rock stärker als Jazz); Unbekanntes ergibt 0', () => {
  assert.equal(presetDrive('jazz'), TUNABLES['chords/organ/jazz'].drive.value);
  assert.ok(presetDrive('rock') > presetDrive('jazz'));
  assert.equal(presetDrive('gibtsnicht'), 0);
});
