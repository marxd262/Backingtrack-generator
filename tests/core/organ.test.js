// Tonewheel-Orgel: Teilton-Gewichte aus den Zugriegeln (Foldback, Normierung), Verstimmung der Räder, Register und Feinwerte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonewheelPartials, WHEEL_CENTS } from '../../src/audio/voices/organ.js';
import { TUNABLES, DRAWBARS } from '../../src/audio/voices/tunables.js';
import { VOICES } from '../../src/core/voices.js';

const bars = (text) => [...text].map(Number);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('Zugriegel -> Teiltöne der Sub-Oktave 1, 3, 2, 4, 6, 8, 10, 12, 16; je Stufe 3 dB; Summe auf rms 1 normiert', () => {
  const full = tonewheelPartials(60, bars('888888888'));
  for (const h of [1, 2, 3, 4, 6, 8, 10, 12, 16]) assert.ok(near(full[h], 1 / 3), `Teilton ${h}`);
  for (const h of [0, 5, 7, 9, 11, 13, 14, 15]) assert.equal(full[h], 0, `Teilton ${h}`);
  const jazz = tonewheelPartials(60, bars('888000000'));
  assert.deepEqual([...jazz].flatMap((a, h) => (a ? [h] : [])), [1, 2, 3]);
  const ballad = tonewheelPartials(60, bars('838000000'));
  assert.ok(near(20 * Math.log10(ballad[3] / ballad[1]), -15), '5⅓\' auf 3 liegt 15 dB unter 16\' auf 8');
  for (const p of [full, jazz, ballad]) assert.ok(near(Math.hypot(...p), 1), 'rms 1');
  assert.ok(near(Math.hypot(...tonewheelPartials(60, bars('000000000'))), 0), 'alle Zugriegel zu: Stille');
});

test('Foldback: oben spielt das Rad eine Oktave tiefer (ab Taste 79 der 1\'), unten das 16\' der tiefsten Oktave eine Oktave höher', () => {
  const one = bars('000000008'), sub = bars('800000000');
  assert.ok(near(tonewheelPartials(78, one)[16], 1), 'Taste 78: 1\' liegt noch auf Rad 91');
  assert.ok(near(tonewheelPartials(79, one)[8], 1) && tonewheelPartials(79, one)[16] === 0, 'Taste 79: 1\' klingt wie 2\'');
  assert.ok(near(tonewheelPartials(85, bars('000000080'))[6], 1), 'Taste 85: 1⅓\' klingt wie 2⅔\'');
  assert.ok(near(tonewheelPartials(48, sub)[1], 1), 'Taste 48: 16\' echt');
  assert.ok(near(tonewheelPartials(47, sub)[2], 1), 'Taste 47: 16\' klingt wie 8\'');
  // zwei Zugriegel auf demselben Rad addieren sich: Taste 79 mit 2' und 1' ist ein einziger Teilton
  assert.deepEqual([...tonewheelPartials(79, bars('000008008'))].flatMap((a, h) => (a ? [h] : [])), [8]);
});

test('Räder: je Tonklasse unter 0,8 Cent neben der gleichstufigen Stimmung, A stimmt genau', () => {
  assert.equal(WHEEL_CENTS.length, 12);
  for (const [pc, c] of WHEEL_CENTS.entries()) assert.ok(Math.abs(c) < 0.8, `Tonklasse ${pc}: ${c}`);
  assert.ok(near(WHEEL_CENTS[9], 0));
  assert.ok(WHEEL_CENTS.some((c) => Math.abs(c) > 0.3), 'die Verstimmung ist nicht null');
});

test('Register und Feinwerte: versteckt, vier Presets mit den neun Zugriegeln als Startwert', () => {
  assert.equal(VOICES.chords.organ.hidden, true);
  const presets = { jazz: '888000000', rock: '888800000', gospel: '888888888', ballad: '838000000' };
  assert.deepEqual(VOICES.chords.organ.variants, Object.keys(presets));
  for (const [variant, text] of Object.entries(presets)) {
    assert.equal(DRAWBARS.map((name) => TUNABLES[`chords/organ/${variant}`][name].value).join(''), text, variant);
  }
});
