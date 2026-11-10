// Saitenmodell (erweitertes Karplus-Strong als reine Funktion): Stimmgenauigkeit, Determinismus und Wirkung der Parameter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderString, STRING_DEFAULTS } from '../../src/audio/string-model.js';
import { spectralCentroid } from '../../src/audio/spectrum.js';
import { pitchCents as measuredCents } from '../../src/audio/analysis.js';

const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const rms = (d, from = 0, to = d.length) => { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const render = (over = {}, params = {}) => renderString({ midi: 57, seconds: 1.5, dur: 1.2, vel: 0.8, sampleRate: 44100, seed: 1, ...over, params: { ...STRING_DEFAULTS, ...params } });

const pitchCents = (d, sampleRate, midi) => measuredCents(d, sampleRate, midi);

test('Stimmgenauigkeit: Grundton innerhalb von 0,5 Cent für jede MIDI-Zahl von 24 bis 100 bei 44100 und 48000 Hz (gemessen höchstens 0,1)', () => {
  for (const sampleRate of [44100, 48000]) {
    for (let midi = 24; midi <= 100; midi++) {
      const cents = pitchCents(render({ midi, sampleRate, seconds: 0.6, dur: 0.6 }), sampleRate, midi);
      assert.ok(Math.abs(cents) <= 0.5, `${sampleRate} Hz, MIDI ${midi}: ${cents.toFixed(2)} Cent`);
    }
  }
});

test('Ausgabe: richtige Länge, endlich, hörbar, begrenzt', () => {
  for (const midi of [24, 40, 57, 76, 100]) {
    const d = render({ midi, seconds: 1.0 });
    assert.ok(d instanceof Float32Array && d.length === 44100, `MIDI ${midi}: Länge ${d.length}`);
    assert.ok(d.every(Number.isFinite), `MIDI ${midi}: endlich`);
    assert.ok(rms(d, 0, 22050) > 1e-3, `MIDI ${midi}: hörbar`);
    assert.ok(d.every((v) => Math.abs(v) <= 1.5), `MIDI ${midi}: begrenzt`);
  }
});

test('Determinismus: gleiche Eingabe bitgleich; anderer Seed ändert den Anschlag, nicht den Grundton', () => {
  const a = render({ seed: 3 }), b = render({ seed: 3 }), c = render({ seed: 4 });
  assert.ok(a.every((v, i) => v === b[i]));
  assert.ok(a.some((v, i) => v !== c[i]));
  assert.ok(Math.abs(pitchCents(c, 44100, 57)) <= 0.5);
});

test('Anschlagstärke: härter ist heller und lauter', () => {
  const soft = render({ vel: 0.2 }), hard = render({ vel: 1 });
  assert.ok(spectralCentroid(hard.subarray(0, 8820), 44100) > spectralCentroid(soft.subarray(0, 8820), 44100));
  assert.ok(rms(hard, 0, 8820) > rms(soft, 0, 8820));
});

test('Helligkeit und Abklingzeit: heller hat höheren Schwerpunkt, längeres Abklingen mehr Pegel am Ende', () => {
  const dull = render({}, { brightness: 0.1 }), bright = render({}, { brightness: 0.9 });
  assert.ok(spectralCentroid(bright.subarray(2205, 22050), 44100) > spectralCentroid(dull.subarray(2205, 22050), 44100));
  const short = render({ dur: 1.5 }, { decay: 0.4 }), long = render({ dur: 1.5 }, { decay: 3 });
  assert.ok(rms(long, 44100, 60000) > 3 * rms(short, 44100, 60000));
});

test('Notenende: nach dur + 0,15 s unter 10 % des Pegels bei dur', () => {
  const d = render({ midi: 45, dur: 0.5, seconds: 1.2 }, { decay: 4 });
  const atEnd = rms(d, Math.round(0.45 * 44100), Math.round(0.5 * 44100));
  const later = rms(d, Math.round(0.65 * 44100), Math.round(0.7 * 44100));
  assert.ok(later < 0.1 * atEnd, `${later} gegen ${atEnd}`);
});

test('Zupf- und Tonabnehmer-Position ändern das Spektrum', () => {
  const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length) / rms(a); };
  assert.ok(diff(render({}, { pluckPos: 0.1 }), render({}, { pluckPos: 0.5 })) > 0.05);
  assert.ok(diff(render({}, { pickupPos: 0.08 }), render({}, { pickupPos: 0.3 })) > 0.05);
});

test('Extremwerte der Parameter und lange Töne bleiben endlich und begrenzt', () => {
  const extremes = [
    { pluckPos: 0, brightness: 0, decay: 0.05, excite: 0, stiffness: 0, pickupPos: 0, pickupLp: 200, body: 0 },
    { pluckPos: 0.5, brightness: 1, decay: 10, excite: 1, stiffness: 1, pickupPos: 0.5, pickupLp: 20000, body: 1 },
  ];
  for (const params of extremes) {
    for (const midi of [24, 57, 100]) {
      const d = render({ midi, seconds: 4, dur: 4, vel: 1 }, params);
      assert.ok(d.every((v) => Number.isFinite(v) && Math.abs(v) <= 2.5), `MIDI ${midi} ${JSON.stringify(params)}`);
    }
  }
});

test('Unbrauchbare Eingaben: fehlende oder ungültige Parameter zählen als Standard, nie NaN', () => {
  const standard = render();
  for (const params of [undefined, null, {}, { brightness: NaN }, { decay: 'x' }]) {
    const d = renderString({ midi: 57, seconds: 1.5, dur: 1.2, vel: 0.8, sampleRate: 44100, seed: 1, params });
    assert.ok(d.every(Number.isFinite), JSON.stringify(params));
    if (params === undefined || params === null || Object.keys(params).length === 0) assert.ok(d.every((v, i) => v === standard[i]));
  }
});
