import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMBRE } from '../../src/core/timbre.js';
import { bassParams } from '../../src/audio/voice-params.js';

const STEPS = [0, 0.25, 0.5, 0.75, 1];
const BASS_INPUTS = Object.keys(DEFAULT_TIMBRE.bass);
const withInput = (key, value) => ({ ...DEFAULT_TIMBRE.bass, [key]: value });

// Bereiche je Feld über alle Eingaben (Extreme eingeschlossen)
const RANGES = {
  sawDetune: [6, 6],
  q: [1, 14],
  lpStart: [100, 15000],
  lpEnd: [40, 1000],
  lpTime: [0.02, 1.25],
  sawMix: [0, 1],
  triMix: [0, 1],
  sineGain: [0.4, 4],
  drive: [1, 20],
  peak: [0.2, 0.5],
  sustain: [0.2, 1],
  attack: [0.004, 0.004],
  release: [0.05, 0.05],
  holdMin: [0.03, 0.03],
  holdCut: [0.06, 0.06],
};

test('bassParams: neutraler Bass ergibt exakt die bisherigen Konstanten aus bassNote', () => {
  assert.deepEqual(bassParams(DEFAULT_TIMBRE.bass), {
    sawDetune: 6, // Sägezähne bei -6 und +6 Cent
    q: 4,
    lpStart: 2200,
    lpEnd: 320,
    lpTime: 0.15,
    sawMix: 1,
    triMix: 0,
    sineGain: 1, // Sinus direkt auf die Hüllkurve
    drive: 1, // 1 = ohne Verzerrer
    peak: 0.5, // Hüllkurvenspitze vel * 0.5
    sustain: 1, // flach während der Haltezeit
    attack: 0.004,
    release: 0.05,
    holdMin: 0.03, // Haltezeit max(0.03, dur - 0.06)
    holdCut: 0.06,
  });
});

test('bassParams: jedes Mal ein neues Objekt', () => {
  const a = bassParams(DEFAULT_TIMBRE.bass);
  assert.notEqual(a, bassParams(DEFAULT_TIMBRE.bass));
  a.q = 99;
  assert.equal(bassParams(DEFAULT_TIMBRE.bass).q, 4);
});

test('bassParams: jedes Feld monoton in jedem Eingang (andere neutral), endlich, im Bereich', () => {
  for (const key of BASS_INPUTS) {
    const rows = STEPS.map((v) => bassParams(withInput(key, v)));
    for (const field of Object.keys(RANGES)) {
      const values = rows.map((r) => r[field]);
      const [lo, hi] = RANGES[field];
      for (const v of values) assert.ok(Number.isFinite(v) && v >= lo && v <= hi, `${key} -> ${field}: ${v} nicht in [${lo}, ${hi}]`);
      const steps = values.slice(1).map((v, i) => v - values[i]);
      assert.ok(steps.every((d) => d >= 0) || steps.every((d) => d <= 0), `${key} -> ${field} nicht monoton: ${values}`);
    }
  }
});

test('bassParams: beabsichtigte Richtungen (streng über die Tabelle)', () => {
  // [Eingang, Feld, +1 steigend / -1 fallend]
  const effects = [
    ['sub', 'sineGain', 1], ['sub', 'sawMix', -1], ['sub', 'lpEnd', -1], ['sub', 'lpStart', -1],
    ['fuzz', 'drive', 1], ['fuzz', 'peak', -1],
    ['pluck', 'lpTime', -1], ['pluck', 'lpStart', 1],
    ['cutoff', 'lpStart', 1], ['cutoff', 'lpEnd', 1],
    ['resonance', 'q', 1], ['resonance', 'sineGain', -1], ['resonance', 'lpTime', 1],
    ['roundness', 'triMix', 1], ['roundness', 'sawMix', -1],
  ];
  for (const [key, field, sign] of effects) {
    const values = STEPS.map((v) => bassParams(withInput(key, v))[field]);
    for (let i = 1; i < values.length; i++) assert.ok(sign * (values[i] - values[i - 1]) > 0, `${key} -> ${field}: ${values}`);
  }
  // zupfend klingt erst oberhalb der Mitte ab
  assert.deepEqual([0, 0.25, 0.5].map((v) => bassParams(withInput('pluck', v)).sustain), [1, 1, 1]);
  assert.ok(bassParams(withInput('pluck', 1)).sustain < bassParams(withInput('pluck', 0.75)).sustain);
});

test('bassParams: Extreme (alle 0, alle 1, gemischt) endlich und im Bereich', () => {
  const zero = Object.fromEntries(BASS_INPUTS.map((k) => [k, 0]));
  const one = Object.fromEntries(BASS_INPUTS.map((k) => [k, 1]));
  const mixed = { sub: 1, fuzz: 1, pluck: 0, cutoff: 0, resonance: 1, roundness: 1 };
  for (const t of [zero, one, mixed, { ...one, cutoff: 0 }, { ...zero, cutoff: 1, resonance: 1 }]) {
    const p = bassParams(t);
    for (const [field, [lo, hi]] of Object.entries(RANGES)) {
      assert.ok(Number.isFinite(p[field]) && p[field] >= lo && p[field] <= hi, `${JSON.stringify(t)} -> ${field}: ${p[field]}`);
    }
  }
});
