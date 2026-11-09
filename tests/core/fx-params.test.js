// Verzerrerkette (Overdrive, Distortion, Fuzz, Box) aus drei Reglern: reine Rechnung ohne Audio-Objekte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fxChainParams, LAYER_FX } from '../../src/audio/fx-params.js';

const STEPS = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];
const STAGES = ['od', 'dist', 'fuzz'];
const NAME = { od: 'overdrive', dist: 'distortion', fuzz: 'fuzz' };
const one = (stage, v, layer) => fxChainParams({ [NAME[stage]]: v }, layer);

test('alle Regler 0: nichts aktiv, alle Mischungen 0', () => {
  for (const input of [{}, { fuzz: 0, overdrive: 0, distortion: 0 }]) {
    const p = fxChainParams(input);
    assert.equal(p.active, false);
    assert.equal(p.cab, 0);
    for (const stage of STAGES) assert.equal(p[stage].mix, 0, stage);
  }
});

test('jeder Regler über 0 macht die Kette aktiv und schaltet nur seine Stufe ein', () => {
  for (const stage of STAGES) {
    const p = one(stage, 0.01);
    assert.equal(p.active, true, stage);
    assert.ok(p[stage].mix > 0, stage);
    for (const other of STAGES.filter((s) => s !== stage)) assert.equal(p[other].mix, 0, `${stage} -> ${other}`);
    assert.ok(p.cab > 0, `${stage}: Box`);
  }
});

test('Mischung und Verstärkung steigen mit dem Regler (Mischung erreicht 1 schon bei einem Achtel), alles endlich und positiv', () => {
  for (const stage of STAGES) {
    const rows = STEPS.map((v) => one(stage, v)[stage]);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].mix >= rows[i - 1].mix, `${stage} Mischung`);
      assert.ok(rows[i].drive > rows[i - 1].drive, `${stage} Verstärkung ${rows.map((r) => r.drive)}`);
    }
    for (const row of rows) for (const [key, v] of Object.entries(row)) assert.ok(Number.isFinite(v) && v >= 0 && (key === 'mix' || v > 0), `${stage}.${key}: ${v}`);
    assert.equal(one(stage, 0.125).cab, 1);
    assert.equal(rows.at(-1).mix, 1);
  }
});

test('Reihenfolge der Stärke: Fuzz und Distortion treiben weiter als Overdrive', () => {
  const full = fxChainParams({ fuzz: 1, overdrive: 1, distortion: 1 });
  assert.ok(full.od.drive < full.dist.drive && full.od.drive < full.fuzz.drive);
  assert.ok(full.dist.drive >= 300, 'Distortion bis 50 dB');
  assert.ok(full.od.drive >= 30 && full.od.drive <= 100, 'Overdrive bis etwa 30 dB');
});

test('Ungültige Eingaben (NaN, negativ, über 1, Text) wirken wie begrenzte Zahlen und erzeugen nie NaN', () => {
  for (const bad of [NaN, -1, 2, 'x', undefined, null, Infinity]) {
    const p = fxChainParams({ fuzz: bad, overdrive: bad, distortion: bad });
    for (const stage of STAGES) for (const v of Object.values(p[stage])) assert.ok(Number.isFinite(v), `${bad}: ${stage}`);
    assert.ok(Number.isFinite(p.cab));
  }
});

test('Schichtprofile: Bass, Akkorde und Pad haben Eingangspegel und Box, der Bass hat eine tiefere Box', () => {
  assert.deepEqual(Object.keys(LAYER_FX).sort(), ['bass', 'chords', 'pad']);
  for (const [name, l] of Object.entries(LAYER_FX)) {
    for (const key of ['ref', 'cabHp', 'cabLp', 'cabPeakHz', 'cabPeakDb', 'distHp', 'toneHz']) assert.ok(Number.isFinite(l[key]) && l[key] > 0, `${name}.${key}`);
    assert.ok(l.cabHp < l.cabLp, name);
    for (const stage of STAGES) assert.ok(l.trim[stage] > 0, `${name}.trim.${stage}`);
  }
  assert.ok(LAYER_FX.bass.cabHp < LAYER_FX.chords.cabHp && LAYER_FX.bass.cabLp < LAYER_FX.chords.cabLp);
});

test('Pegelausgleich: je Schicht und Stufe positiv und endlich; Overdrive fällt mit der Verstärkung außer beim Bass', () => {
  for (const layer of Object.keys(LAYER_FX)) {
    for (const stage of STAGES) for (const v of STEPS.slice(1)) assert.ok(one(stage, v, layer)[stage].makeup > 0, `${layer} ${stage} ${v}`);
  }
  const od = (layer) => STEPS.slice(1).map((v) => one('od', v, layer).od.makeup);
  for (const layer of ['chords', 'pad']) assert.ok(od(layer).every((m, i, a) => i === 0 || m < a[i - 1]), `${layer}: ${od(layer)}`);
  assert.ok(od('bass').every((m) => m === od('bass')[0]), 'Bass: konstant');
  assert.throws(() => fxChainParams({}, 'drums'), TypeError);
});

test('Einblenden ist stetig: unterhalb eines Achtels des Reglers liegen Mischung und Box zwischen 0 und 1', () => {
  for (const stage of STAGES) {
    const p = one(stage, 0.05);
    assert.ok(p[stage].mix > 0 && p[stage].mix < 1, `${stage}: ${p[stage].mix}`);
    assert.ok(p.cab > 0 && p.cab < 1, `${stage}: Box ${p.cab}`);
  }
});
