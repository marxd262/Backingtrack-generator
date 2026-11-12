// Stimmen-Register und Klangerzeugung gehören zusammen: jeder Eintrag hat eine Umsetzung, jede Feinwert-Tabelle einen Eintrag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOICES, VOICE_LAYERS, isVoice } from '../../src/core/voices.js';
import { DRUM_NAMES, PERCUSSION_NAMES } from '../../src/core/events.js';
import { hasVoice, createVoice, packIdFor, hitKeysFor } from '../../src/audio/voices/index.js';
import { HIT_KEYS } from '../../src/audio/voices/sample-hits.js';
import { TUNABLES, tunedValue } from '../../src/audio/voices/tunables.js';
import { PACKS as SCRIPT_PACKS } from '../../scripts/extract-samples.mjs';

test('jeder Eintrag des Registers (Instrument, Stimme, Variante) hat eine Umsetzung', () => {
  for (const layer of VOICE_LAYERS) {
    for (const [id, voice] of Object.entries(VOICES[layer])) {
      for (const variant of voice.variants) assert.ok(hasVoice(layer, id, variant), `${layer}/${id}/${variant}`);
    }
  }
  assert.ok(!hasVoice('bass', 'nope', 'x') && !hasVoice('drums', 'nope', 'classic'));
  assert.ok(hasVoice('drums', 'synth', 'classic'));
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

// Task 10: Sample-Varianten für Bass, Akkorde, Lead, Schlagzeug und Percussion
const NEW_SAMPLES = [['bass', 'upright'], ['chords', 'organ'], ['chords', 'muted'], ['chords', 'jazz'], ['chords', 'funk'], ['chords', 'steel'], ['chords', 'nylon'], ['chords', 'twelve'], ['lead', 'flute'], ['lead', 'sax'], ['lead', 'synth'],
  ...['standard', 'brushes', 'rimshot', 'jazz', 'electronic', '808'].map((v) => ['drums', v]), ['percussion', 'studio']];

test('neue Sample-Varianten: im Register, mit Umsetzung, gültig für isVoice', () => {
  for (const [layer, variant] of NEW_SAMPLES) {
    assert.ok(VOICES[layer].sample?.variants.includes(variant), `${layer}/sample/${variant}: Register`);
    assert.ok(hasVoice(layer, 'sample', variant), `${layer}/sample/${variant}: Umsetzung`);
    assert.ok(isVoice(layer, 'sample', variant), `${layer}/sample/${variant}: isVoice`);
  }
});

test('jede Sample-Stimme hat einen gemessenen Pegel (level) und ein vorhandenes Pack; Rimshot nutzt das Standard-Kit', () => {
  for (const layer of VOICE_LAYERS) {
    for (const variant of VOICES[layer].sample?.variants ?? []) {
      const key = `${layer}/sample/${variant}`;
      assert.ok(TUNABLES[key]?.level, `${key}: level`);
      assert.ok(Object.hasOwn(SCRIPT_PACKS, packIdFor(layer, variant)), `${key}: Pack ${packIdFor(layer, variant)}`);
    }
  }
  assert.equal(packIdFor('drums', 'rimshot'), 'drums-standard');
  assert.equal(packIdFor('drums', '808'), 'drums-808');
  for (const key of ['bass/sample/upright', 'chords/sample/muted']) assert.ok(TUNABLES[key].decay, `${key}: decay`);
});

// Stufe 1 der natürlicheren Gitarren: Anschlagkurve, Helligkeit nach Anschlag, ohne Endschleife, kleine Zufallsabweichung
const GUITARS = ['guitar', 'muted', 'jazz', 'funk', 'steel', 'nylon', 'twelve', 'freepats', 'freepatsjazz'];

test('Freepats-Gitarren (Stufe 2): im Register, mit Umsetzung, Pack aus der FSBS-Quelle, level, decay und strum', () => {
  for (const [variant, source] of [['freepats', 'fsbs-clean'], ['freepatsjazz', 'fsbs-jazz']]) {
    assert.ok(isVoice('chords', 'sample', variant) && hasVoice('chords', 'sample', variant), variant);
    assert.equal(packIdFor('chords', variant), `chords-${variant}`);
    assert.equal(SCRIPT_PACKS[`chords-${variant}`]?.source, source, variant);
    const t = TUNABLES[`chords/sample/${variant}`];
    for (const name of ['level', 'decay', 'strum']) assert.ok(t?.[name], `${variant}.${name}`);
    assert.equal(t.strum.value, TUNABLES['chords/sample/guitar'].strum.value, `${variant}.strum`);
  }
});
const REALISM = { velExp: [0.5, 3, 1.6], softHz: [800, 20000, 3500], oneShot: [0, 1, 1], humanCents: [0, 10, 2.5], humanDb: [0, 3, 0.8] };

test('Gitarren-Samples: die fünf Feinwerte der Natürlichkeit mit ihren Standardwerten; andere Sample-Stimmen haben sie nicht', () => {
  for (const variant of GUITARS) {
    const table = TUNABLES[`chords/sample/${variant}`];
    for (const [name, [min, max, value]] of Object.entries(REALISM)) {
      assert.deepEqual([table[name]?.min, table[name]?.max, table[name]?.value], [min, max, value], `${variant}.${name}`);
    }
  }
  for (const layer of VOICE_LAYERS) {
    for (const variant of VOICES[layer].sample?.variants ?? []) {
      if (layer === 'chords' && GUITARS.includes(variant)) continue;
      for (const name of Object.keys(REALISM)) assert.ok(!TUNABLES[`${layer}/sample/${variant}`]?.[name], `${layer}/sample/${variant}.${name}`);
    }
  }
});

test('Clean Guitar: milderer Entzerrer (Standardwerte); die anderen Gitarren ohne Entzerrer', () => {
  const t = TUNABLES['chords/sample/guitar'];
  assert.deepEqual([t.lowDb.value, t.midDb.value, t.midHz.value, t.highDb.value, t.highHz.value], [5, -6, 2400, -4, 2600]);
  for (const variant of GUITARS.slice(1)) assert.ok(!TUNABLES[`chords/sample/${variant}`].midDb, variant);
});

test('Tastenbelegung der Schläge: jeder Name hat eine Taste, jede Taste eine Zone in jedem Kit', () => {
  assert.deepEqual(Object.keys(HIT_KEYS.drums).sort(), [...DRUM_NAMES].sort());
  assert.deepEqual(Object.keys(HIT_KEYS.percussion).sort(), [...PERCUSSION_NAMES].sort());
  for (const [layer, variant] of NEW_SAMPLES.filter(([l]) => l === 'drums' || l === 'percussion')) {
    const id = packIdFor(layer, variant);
    const { zones } = JSON.parse(readFileSync(new URL(`../../src/assets/samples/${id}.json`, import.meta.url), 'utf8'));
    for (const [name, key] of Object.entries(hitKeysFor(layer, variant))) {
      assert.ok(zones.some((z) => z.keyLo <= key && key <= z.keyHi), `${layer}/${variant} ${name}: Taste ${key} in ${id}`);
    }
  }
  assert.equal(hitKeysFor('drums', 'rimshot').snare, 37);
  assert.equal(hitKeysFor('drums', 'standard').snare, 38);
});

test('Sample-Kits vor dem Laden: der Rückfall ist der Synth des Instruments (Schläge klingen), Status loading', () => {
  const deep = () => new Proxy(function () {}, { get: () => deep(), set: () => true, apply: () => deep() });
  for (const [layer, variant, name] of [['drums', '808', 'snare'], ['percussion', 'studio', 'claves']]) {
    const calls = [], status = [];
    const ctx = new Proxy({}, { get: (_, k) => () => { calls.push(k); return deep(); } });
    const play = createVoice(layer, { id: 'sample', variant }, ctx, {
      params: new Proxy({}, { get: () => 0.1 }), getTimbre: () => ({}), rng: {}, getTuning: () => ({}), setStatus: (s) => status.push(s), track: (p) => p.catch(() => {}), noise: {},
    });
    play({}, 0, { type: 'hit', name, vel: 0.5 });
    assert.ok(calls.length > 0, `${layer}: Synth-Rückfall spielt`);
    assert.equal(status[0], 'loading', layer);
  }
});

test('lead hat eine Umsetzung für synth/classic', () => {
  assert.ok(hasVoice('lead', 'synth', 'classic'));
});

test('percussion hat eine echte Umsetzung für synth/classic (nicht mehr die stumme)', () => {
  assert.ok(hasVoice('percussion', 'synth', 'classic'));
  // die stumme Platzhalterstimme hätte keinen Aufruf von ctx; die echte baut für einen Schlag Knoten
  const calls = [];
  // beliebig tief verschachtelte Attrappe: jeder Aufruf und jede Eigenschaft liefert wieder eine Attrappe
  const deep = () => new Proxy(function () {}, { get: () => deep(), set: () => true, apply: () => deep() });
  const ctx = new Proxy({}, { get: (_, k) => () => { calls.push(k); return deep(); } });
  const play = createVoice('percussion', { id: 'synth', variant: 'classic' }, ctx, { params: {}, getTimbre: () => ({}), rng: {}, getTuning: () => ({}), setStatus() {}, track() {}, noise: {} });
  play({}, 0, { type: 'hit', name: 'claves', vel: 0.5 });
  assert.ok(calls.length > 0);
});
