// Stimmen-Register: Konsistenz über alle Einträge (neue Stimmen werden automatisch erfasst), Auflösung und Validierung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICES, VOICE_LAYERS, DEFAULT_VOICE, isVoice, voicesFor, completeVoices, resolveVoices, usesTimbreField } from '../../src/core/voices.js';
import { DEFAULT_TIMBRE } from '../../src/core/timbre.js';
import { validateTrack } from '../../src/index.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object' || v === null || deepFrozen(v));
const KINDS = ['synth', 'model', 'sample'];
const entries = () => VOICE_LAYERS.flatMap((layer) => Object.entries(VOICES[layer]).map(([id, v]) => [layer, id, v]));
const paths = new Set(Object.entries(DEFAULT_TIMBRE).flatMap(([group, fields]) => Object.keys(fields).map((f) => `${group}.${f}`)));

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (voices) => ({ key: { root: 'A', mode: 'minor' }, bpm: 100, bars, length: 8, tags: {}, seed: 1, ...(voices === undefined ? {} : { voices }) });

test('Register: nur Bass, Akkorde und Pad; jede Stimme hat Art, Varianten und Reglerliste; tief eingefroren', () => {
  assert.deepEqual(VOICE_LAYERS, ['bass', 'chords', 'pad']);
  assert.deepEqual(Object.keys(VOICES), VOICE_LAYERS);
  assert.ok(deepFrozen(VOICES) && deepFrozen(DEFAULT_VOICE));
  for (const [layer, id, v] of entries()) {
    const label = `${layer}/${id}`;
    assert.ok(KINDS.includes(v.kind), `${label}: Art`);
    assert.ok(Array.isArray(v.variants) && v.variants.length >= 1 && new Set(v.variants).size === v.variants.length, `${label}: Varianten`);
    assert.ok(v.variants.every((x) => typeof x === 'string' && x), `${label}: Variantennamen`);
    assert.ok(v.uses.every((p) => paths.has(p)), `${label}: uses ${v.uses}`);
    assert.ok(!v.uses.some((p) => /\.(fuzz|overdrive|distortion)$/.test(p)), `${label}: Verzerrer gelten immer, nicht in uses`);
  }
});

test('Standard je Instrument ist synth/classic und steht im Register als erste Variante', () => {
  assert.deepEqual(DEFAULT_VOICE, { id: 'synth', variant: 'classic' });
  for (const layer of VOICE_LAYERS) {
    assert.ok(isVoice(layer, 'synth', 'classic'), layer);
    assert.equal(VOICES[layer].synth.variants[0], 'classic', layer);
    assert.equal(voicesFor(layer)[0], 'synth', layer);
  }
});

test('Phase A: Saitenmodell für Bass und Akkorde, E-Piano für Akkorde', () => {
  assert.equal(VOICES.bass.string.kind, 'model');
  assert.equal(VOICES.bass.string.variants[0], 'finger');
  assert.equal(VOICES.chords.string.variants[0], 'electric');
  assert.equal(VOICES.chords.epiano.kind, 'synth');
  assert.equal(VOICES.chords.epiano.variants[0], 'rhodes');
});

test('isVoice und voicesFor: bekannte und unbekannte Eingaben', () => {
  assert.ok(isVoice('bass', 'string') && isVoice('bass', 'string', 'finger'));
  assert.ok(!isVoice('bass', 'string', 'nope') && !isVoice('bass', 'nope') && !isVoice('drums', 'synth') && !isVoice('x', 'y'));
  assert.ok(!isVoice('bass', 5) && !isVoice(undefined, undefined) && !isVoice('bass', 'synth', 5));
  assert.deepEqual(voicesFor('pad'), Object.keys(VOICES.pad));
  assert.deepEqual(voicesFor('drums'), []);
});

test('completeVoices: ungültig oder fehlend ergibt den Standard, gültige Stimme ohne Variante die erste Variante, Eingabe bleibt unverändert', () => {
  const standard = { bass: DEFAULT_VOICE, chords: DEFAULT_VOICE, pad: DEFAULT_VOICE };
  for (const input of [undefined, null, [], 'x', 3, {}, { drums: { id: 'synth' } }, { bass: null }, { bass: 7 }, { bass: { id: 'nope' } }]) {
    assert.deepEqual(completeVoices(input), standard, JSON.stringify(input));
  }
  assert.deepEqual(completeVoices({ bass: 'string' }).bass, { id: 'string', variant: 'finger' });
  assert.deepEqual(completeVoices({ bass: { id: 'string' } }).bass, { id: 'string', variant: 'finger' });
  assert.deepEqual(completeVoices({ chords: { id: 'string', variant: 'nope' } }).chords, { id: 'string', variant: 'electric' });
  assert.deepEqual(completeVoices({ chords: { variant: 'rhodes' } }).chords, DEFAULT_VOICE, 'Variante ohne Stimme: Standard');
  const input = Object.freeze({ bass: Object.freeze({ id: 'string', variant: 'finger' }) });
  assert.deepEqual(completeVoices(input).bass, { id: 'string', variant: 'finger' });
  assert.notEqual(completeVoices(input), completeVoices(input), 'neue Kopie');
  assert.deepEqual(resolveVoices({ voices: { pad: { id: 'synth' } } }), standard);
  assert.deepEqual(resolveVoices(null), standard);
});

test('validateTrack: badVoice für Unbrauchbares, nichts für Gültiges, Fehlendes und null', () => {
  const codes = (voices) => validateTrack(track(voices)).filter((e) => e.code === 'badVoice');
  for (const bad of [{ drums: { id: 'synth' } }, { bass: { id: 'nope' } }, { bass: { id: 'string', variant: 'nope' } }, { bass: 'nope' }, { bass: 5 }, 'x', [], 3, { bass: { variant: 'nope' } }]) {
    assert.equal(codes(bad).length >= 1, true, JSON.stringify(bad));
  }
  assert.deepEqual(codes({ bass: { id: 'nope' } }), [{ code: 'badVoice', params: { layer: 'bass', voice: 'nope' } }]);
  assert.deepEqual(codes({ bass: { id: 'string', variant: 'nope' } }), [{ code: 'badVoice', params: { layer: 'bass', voice: 'string/nope' } }]);
  assert.deepEqual(codes({ drums: { id: 'synth' } })[0].params.layer, 'drums');
  for (const ok of [undefined, null, {}, { bass: null }, { bass: { id: 'string' } }, { bass: { id: 'string', variant: 'finger' } }, { chords: { id: 'epiano', variant: 'rhodes' } }, { pad: {} }]) {
    assert.deepEqual(codes(ok), [], JSON.stringify(ok));
  }
});

test('Namen: Gruppen, jede Stimme und jede Variante in beiden Sprachen, dazu die Fehlermeldung', () => {
  for (const [lang, texts] of [['de', de], ['en', en]]) {
    assert.ok(texts['err.badVoice'].includes('{voice}') && texts['err.badVoice'].includes('{layer}'), `${lang}: err.badVoice`);
    for (const kind of KINDS) assert.ok(texts[`voice.kind.${kind}`], `${lang}: voice.kind.${kind}`);
    for (const [layer, id, v] of entries()) {
      assert.ok(texts[`voice.${layer}.${id}`], `${lang}: voice.${layer}.${id}`);
      for (const variant of v.variants) assert.ok(texts[`variant.${layer}.${id}.${variant}`], `${lang}: variant.${layer}.${id}.${variant}`);
    }
  }
});

test('Schlüssel der Objekt-Prototypen (__proto__, constructor, toString, length) als Instrument, Stimme oder Variante: kein Fehler, nichts verändert', () => {
  const evil = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'length'];
  for (const name of evil) {
    for (const voices of [JSON.parse(`{ "${name}": { "id": "string" } }`), { bass: { id: name } }, { bass: { id: 'string', variant: name } }, { [name]: name }]) {
      assert.doesNotThrow(() => completeVoices(voices), name);
      const done = completeVoices(voices);
      for (const layer of VOICE_LAYERS) assert.ok(isVoice(layer, done[layer].id, done[layer].variant), `${name}: ${layer}`);
      assert.doesNotThrow(() => validateTrack(track(voices)), name);
      assert.ok(validateTrack(track(voices)).some((e) => e.code === 'badVoice'), `${name} meldet badVoice`);
    }
  }
  assert.ok(!isVoice('bass', '__proto__') && !isVoice('__proto__', 'synth') && !isVoice('bass', 'synth', 'constructor'));
  assert.ok(!('polluted' in {}), 'Object.prototype unverändert');
});

test('usesTimbreField: Verzerrer und alles außerhalb von Bass, Akkorden und Pad gelten immer; sonst die Liste der gewählten Stimme', () => {
  for (const voices of [undefined, { bass: 'string', chords: 'sample', pad: 'sample' }]) {
    for (const path of ['bass.fuzz', 'chords.overdrive', 'pad.distortion', 'drums.kickPunch', 'master.echo']) assert.equal(usesTimbreField(voices, path), true, `${JSON.stringify(voices)} ${path}`);
  }
  // Standard: der klassische Synth benutzt alle Regler seines Instruments
  for (const [layer, fields] of Object.entries(DEFAULT_TIMBRE)) {
    if (!VOICE_LAYERS.includes(layer)) continue;
    for (const field of Object.keys(fields)) assert.equal(usesTimbreField(undefined, `${layer}.${field}`), true, `${layer}.${field}`);
  }
  assert.equal(usesTimbreField({ chords: 'string' }, 'chords.chorus'), false);
  assert.equal(usesTimbreField({ chords: 'string' }, 'chords.brightness'), true);
  assert.equal(usesTimbreField({ bass: { id: 'sample', variant: 'pick' } }, 'bass.resonance'), false);
  assert.equal(usesTimbreField({ bass: { id: 'sample', variant: 'pick' } }, 'bass.cutoff'), true);
  assert.equal(usesTimbreField({ pad: 'sample' }, 'pad.shimmer'), false);
  // ungültige Wahl gilt wie der Standard; Unbekanntes meldet true (nie ein Regler wegen eines Tippfehlers sperren)
  assert.equal(usesTimbreField({ chords: 'nope' }, 'chords.chorus'), true);
  assert.equal(usesTimbreField(undefined, 'nope.field'), true);
  assert.equal(usesTimbreField(undefined, 'chords'), true);
});

test('hidden: nur ein Wahrheitswert, der Standard ist sichtbar, jedes Instrument hat sichtbare Stimmen; versteckte bleiben gültig', () => {
  for (const [layer, id, v] of entries()) assert.ok(v.hidden === undefined || typeof v.hidden === 'boolean', `${layer}/${id}`);
  for (const layer of VOICE_LAYERS) {
    assert.ok(!VOICES[layer][DEFAULT_VOICE.id].hidden, `${layer}: Standard sichtbar`);
    assert.ok(Object.values(VOICES[layer]).some((v) => v.kind === 'sample' && !v.hidden), `${layer}: sichtbare Sample-Stimme`);
  }
  // die Saitenmodelle stehen nicht in der Auswahl, sind aber weiter gültig (Track-Feld, setVoices, Hörprobe)
  assert.equal(VOICES.bass.string.hidden, true);
  assert.equal(VOICES.chords.string.hidden, true);
  assert.deepEqual(validateTrack(track({ bass: { id: 'string' }, chords: { id: 'string' } })).filter((e) => e.code === 'badVoice'), []);
});
