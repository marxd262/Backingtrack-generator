import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMBRE } from '../../src/core/timbre.js';
import { bassParams, drumParams } from '../../src/audio/voice-params.js';

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

// Schlagzeug: Timbre['drums'] -> drumParams
const DRUM_INPUTS = Object.keys(DEFAULT_TIMBRE.drums);
const withDrum = (key, value) => ({ ...DEFAULT_TIMBRE.drums, [key]: value });

// Rundungsfehler der Potenzen an den Rändern (z. B. 109.99999999999999) zählen nicht
const within = (v, [lo, hi]) => Number.isFinite(v) && v >= lo * (1 - 1e-9) - 1e-12 && v <= hi * (1 + 1e-9);
const DRUM_RANGES = {
  kickStart: [110, 260],
  kickEnd: [36, 53],
  kickDrop: [0.07, 0.2],
  kickDecay: [0.15, 0.9],
  kickPeak: [0.67, 1],
  kickClick: [0, 0.5],
  snareFreq: [1020, 4800], // Tonlage 1200..3200 Hz, knackig bis x1.5
  snareQ: [0.6, 2],
  snareNoise: [0.19, 4.2], // nur am Rand der Kombination (snareSnap und snareTone je 1): x7.5 gegenüber dem Standard
  snareClick: [0, 1.6],
  snareTone: [0.12, 0.6],
  snareDecay: [0.07, 0.3],
  hatFreq: [4500, 11000],
  hatPeak: [0.14, 2.1],
  hatClosedDecay: [0.012, 0.1],
  hatOpenDecay: [0.06, 0.5],
  roomSend: [0, 7],
};

test('drumParams: neutrales Schlagzeug ergibt exakt die bisherigen Konstanten aus drumVoices', () => {
  assert.deepEqual(drumParams(DEFAULT_TIMBRE.drums), {
    kickStart: 150,
    kickEnd: 46,
    kickDrop: 0.12, // Tonhöhenabfall in s
    kickDecay: 0.4, // Pegelabfall bis 0.001 in s
    kickPeak: 0.9, // Spitze vel * 0.9
    kickClick: 0, // 0 = ohne Klick-Knoten
    snareFreq: 1900, // Bandpass
    snareQ: 0.8,
    snareNoise: 0.55, // Rauschspitze vel * 0.55
    snareClick: 0, // 0 = ohne Klick-Knoten
    snareTone: 0.3, // Dreieck 185 Hz, vel * 0.3
    snareDecay: 0.16, // Ausklang des Rauschens in s
    hatFreq: 7500, // Hochpass
    hatPeak: 0.3,
    hatClosedDecay: 0.04,
    hatOpenDecay: 0.2,
    roomSend: 0, // 0 = ohne Sendeweg
  });
});

test('drumParams: jedes Mal ein neues Objekt', () => {
  const a = drumParams(DEFAULT_TIMBRE.drums);
  assert.notEqual(a, drumParams(DEFAULT_TIMBRE.drums));
  a.kickStart = 99;
  assert.equal(drumParams(DEFAULT_TIMBRE.drums).kickStart, 150);
});

test('drumParams: jedes Feld monoton in jedem Eingang (andere neutral), endlich, im Bereich', () => {
  for (const key of DRUM_INPUTS) {
    const rows = STEPS.map((v) => drumParams(withDrum(key, v)));
    for (const field of Object.keys(DRUM_RANGES)) {
      const values = rows.map((r) => r[field]);
      const [lo, hi] = DRUM_RANGES[field];
      for (const v of values) assert.ok(within(v, [lo, hi]), `${key} -> ${field}: ${v} nicht in [${lo}, ${hi}]`);
      const steps = values.slice(1).map((v, i) => v - values[i]);
      assert.ok(steps.every((d) => d >= 0) || steps.every((d) => d <= 0), `${key} -> ${field} nicht monoton: ${values}`);
    }
  }
});

test('drumParams: beabsichtigte Richtungen (streng über die Tabelle, ab der Mitte für die Klicks, ab 0 für roomSend)', () => {
  // [Eingang, Feld, +1 steigend / -1 fallend]
  const effects = [
    ['kickPunch', 'kickStart', 1],
    ['kickLength', 'kickDecay', 1], ['kickLength', 'kickEnd', -1], ['kickLength', 'kickDrop', 1], ['kickLength', 'kickPeak', -1],
    ['snareTone', 'snareFreq', 1], ['snareTone', 'snareNoise', 1],
    ['snareSnap', 'snareFreq', 1], ['snareSnap', 'snareNoise', 1], ['snareSnap', 'snareTone', -1], ['snareSnap', 'snareDecay', -1], ['snareSnap', 'snareQ', 1],
    ['hatBright', 'hatFreq', 1], ['hatBright', 'hatPeak', 1],
    ['hatLength', 'hatClosedDecay', 1], ['hatLength', 'hatOpenDecay', 1],
  ];
  for (const [key, field, sign] of effects) {
    const values = STEPS.map((v) => drumParams(withDrum(key, v))[field]);
    for (let i = 1; i < values.length; i++) assert.ok(sign * (values[i] - values[i - 1]) > 0, `${key} -> ${field}: ${values}`);
  }
  // Klick und Raum wirken erst oberhalb ihres Standards
  assert.deepEqual([0, 0.25, 0.5].map((v) => drumParams(withDrum('kickPunch', v)).kickClick), [0, 0, 0]);
  assert.ok(drumParams(withDrum('kickPunch', 0.75)).kickClick > 0);
  assert.ok(drumParams(withDrum('kickPunch', 1)).kickClick > drumParams(withDrum('kickPunch', 0.75)).kickClick);
  assert.deepEqual([0, 0.25, 0.5].map((v) => drumParams(withDrum('snareSnap', v)).snareClick), [0, 0, 0]);
  assert.ok(drumParams(withDrum('snareSnap', 1)).snareClick > drumParams(withDrum('snareSnap', 0.75)).snareClick);
  assert.equal(drumParams(withDrum('room', 0)).roomSend, 0);
  assert.ok(drumParams(withDrum('room', 0.25)).roomSend > 0);
  assert.ok(drumParams(withDrum('room', 1)).roomSend > drumParams(withDrum('room', 0.25)).roomSend);
});

test('drumParams: Extreme (alle 0, alle 1, gemischt) endlich und im Bereich', () => {
  const zero = Object.fromEntries(DRUM_INPUTS.map((k) => [k, 0]));
  const one = Object.fromEntries(DRUM_INPUTS.map((k) => [k, 1]));
  const mixed = { kickPunch: 1, kickLength: 0, snareTone: 1, snareSnap: 0, hatBright: 1, hatLength: 0, room: 1 };
  const flipped = { kickPunch: 0, kickLength: 1, snareTone: 0, snareSnap: 1, hatBright: 0, hatLength: 1, room: 1 };
  for (const t of [zero, one, mixed, flipped]) {
    const p = drumParams(t);
    for (const [field, [lo, hi]] of Object.entries(DRUM_RANGES)) {
      assert.ok(within(p[field], [lo, hi]), `${JSON.stringify(t)} -> ${field}: ${p[field]}`);
    }
  }
});
