// Vibrato und Chorus der Schichten: die reine Rechnung der Kettenwerte (audio/mod-fx.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOD, modParams } from '../../src/audio/mod-fx.js';
import { DEFAULT_TIMBRE } from '../../src/core/timbre.js';
import { LAYERS } from '../../src/core/layers.js';
import { usesTimbreField } from '../../src/core/voices.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('modParams: beide Regler 0 (oder ungültig) ist inaktiv; je Regler über 0 aktiv', () => {
  for (const given of [undefined, {}, { vibrato: 0, chorus: 0 }, { vibrato: NaN, chorus: 'x' }, { vibrato: -1 }]) assert.equal(modParams(given).active, false);
  assert.equal(modParams({ vibrato: 0.1 }).active, true);
  assert.equal(modParams({ chorus: 0.1 }).active, true);
  assert.equal(modParams({ chorus: 0.1 }).vibrato.on, false);
});

test('modParams: der Hub des Vibratos in Cent folgt dem Regler, das Tempo des LFO dem Songtempo (4 bis 5,5 Hz)', () => {
  for (const [bpm, hz] of [[40, 4], [60, 4], [100, 5], [120, 5.5], [200, 5.5], [NaN, 5]]) assert.ok(near(modParams({ vibrato: 1 }, bpm).vibrato.hz, hz), `${bpm} bpm`);
  for (const bpm of [60, 100, 160]) {
    for (const v of [0.25, 0.5, 1]) {
      const { hz, depth } = modParams({ vibrato: v }, bpm).vibrato;
      // größter Tonhöhenfaktor der bewegten Verzögerung: 1 + depth * 2π hz
      assert.ok(near(1200 * Math.log2(1 + depth * 2 * Math.PI * hz), MOD.vibCents * v, 1e-6), `${bpm} bpm, Regler ${v}`);
      assert.ok(depth < MOD.vibBase, 'der Hub bleibt unter der Grundverzögerung');
    }
  }
});

test('modParams: der Chorus mischt bis chorusLevel zu, der Ausgleich hält die Leistung von Original und zwei Kopien bei 1', () => {
  assert.equal(modParams({ chorus: 0 }).chorus.norm, 1);
  for (const c of [0.25, 0.5, 1]) {
    const { wet, norm } = modParams({ chorus: c }).chorus;
    assert.ok(near(wet, MOD.chorusLevel * c));
    assert.ok(near(norm ** 2 * (1 + 2 * wet ** 2), 1));
  }
});

test('Klangmodell: jede Schicht mit Effektkette hat die Regler vibrato und chorus, Standard 0, bei jeder Stimme bedienbar', () => {
  for (const [layer, { fx }] of Object.entries(LAYERS)) {
    if (!fx) { assert.ok(!('vibrato' in (DEFAULT_TIMBRE[layer] ?? {})), layer); continue; }
    assert.equal(DEFAULT_TIMBRE[layer].vibrato, 0, layer);
    assert.equal(DEFAULT_TIMBRE[layer].chorus, 0, layer);
  }
  for (const voice of [{ id: 'sample', variant: 'guitar' }, { id: 'epiano', variant: 'rhodes' }, { id: 'organ', variant: 'jazz' }, { id: 'synth', variant: 'classic' }]) {
    for (const field of ['chords.vibrato', 'chords.chorus']) assert.equal(usesTimbreField({ chords: voice }, field), true, `${voice.id} ${field}`);
  }
});
