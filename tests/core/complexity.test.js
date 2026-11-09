// Komplexität: verschiebt drive, bassMovement und syncopation; 0,5 und fehlende Angabe lassen alles wie es ist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyComplexity, GROOVES, METERS } from '../../src/core/grooves.js';
import { buildEvents } from '../../src/core/events.js';
import { validateTrack } from '../../src/core/track.js';
import { STYLE_PRESETS } from '../../src/core/tags.js';

const bars = [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const track = (preset, over = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: preset.bpm, seed: 1, length: 8, bars, tags: { ...preset.tags, development: ['fullFromStart'] }, ...over,
});
const COMPLEXITIES = [0, 0.25, 0.5, 0.75, 1];
const base = { drive: 0.5, swing: 0.25, syncopation: 0.5, bassLow: 0.5, bassMovement: 0.5, arp: true, padWidth: 0.7, buildUp: 'slow' };

test('applyComplexity: 0,5 und fehlende Angabe ändern nichts, die Eingabe bleibt unverändert', () => {
  const frozen = structuredClone(base);
  for (const c of [0.5, undefined, null]) assert.deepEqual(applyComplexity(base, c), base, String(c));
  assert.notEqual(applyComplexity(base, 0.5), base, 'neue Kopie');
  applyComplexity(base, 1);
  assert.deepEqual(base, frozen);
});

test('applyComplexity: Verschiebung, Begrenzung auf [0,1], andere Felder bleiben', () => {
  const lo = applyComplexity(base, 0);
  const hi = applyComplexity(base, 1);
  assert.equal(lo.drive, 0);
  assert.equal(hi.drive, 1);
  assert.equal(lo.bassMovement, 0);
  assert.equal(hi.bassMovement, 1);
  assert.ok(Math.abs(lo.syncopation - 0.2) < 1e-12 && Math.abs(hi.syncopation - 0.8) < 1e-12);
  for (const key of ['swing', 'bassLow', 'arp', 'padWidth', 'buildUp']) assert.equal(lo[key], base[key], key);
  const edge = applyComplexity({ ...base, drive: 0.9, syncopation: 0.1, bassMovement: 0.9 }, 1);
  assert.deepEqual([edge.drive, edge.bassMovement], [1, 1]);
  assert.ok(edge.syncopation <= 1);
  assert.equal(applyComplexity({ ...base, drive: 0.1 }, 0).drive, 0);
});

test('buildEvents: complexity 0,5 und fehlende Angabe ergeben denselben Strom (alle Stile, mit und ohne variety)', () => {
  for (const p of STYLE_PRESETS) {
    for (const variety of [false, true]) {
      assert.deepEqual(buildEvents(track(p, { variety, complexity: 0.5 })), buildEvents(track(p, { variety })), `${p.id} variety=${variety}`);
      assert.deepEqual(buildEvents(track(p, { variety, complexity: null })), buildEvents(track(p, { variety })), `${p.id} null`);
    }
  }
});

test('Dichte: Schlagzeug- und Bass-Ereignisse je Takt steigen mit der Komplexität (Mittel über Seeds, kleine Zufallsabweichung erlaubt)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  for (const p of STYLE_PRESETS) {
    for (const variety of [false, true]) {
      const mean = COMPLEXITIES.map((complexity) => {
        let total = 0;
        for (const seed of SEEDS) {
          total += buildEvents(track(p, { seed, variety, complexity })).filter((e) => (e.layer === 'drums' || e.layer === 'bass') && (e.type === 'hit' || e.type === 'note')).length;
        }
        return total / (SEEDS.length * 8);
      });
      for (let i = 1; i < mean.length; i++) assert.ok(mean[i] >= mean[i - 1] * 0.97, `${p.id} variety=${variety}: ${mean.map((m) => m.toFixed(1))}`);
      assert.ok(mean[4] > mean[0] * 1.05, `${p.id} variety=${variety}: bei 1 mehr als bei 0 (${mean[4].toFixed(1)} gegen ${mean[0].toFixed(1)})`);
    }
  }
});

test('Dichte je Groove: Schlagzeug-Ereignisse je Takt steigen mit der Komplexität (alle Grooves, alle Taktarten, mit und ohne variety)', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
  const funk = STYLE_PRESETS[0];
  for (const [id, g] of Object.entries(GROOVES)) {
    const { beats } = METERS[g.meter];
    const grooveBars = ['A', 'A', 'D', 'E'].map((root, i) => ({ chord: { root, quality: i === 3 ? 'maj' : 'min' }, beats }));
    for (const variety of [false, true]) {
      const mean = COMPLEXITIES.map((complexity) => {
        let total = 0;
        for (const seed of SEEDS) {
          const t = track(funk, { seed, variety, complexity, meter: g.meter.split('/').map(Number), groove: id, bars: grooveBars });
          total += buildEvents(t).filter((e) => e.layer === 'drums' && e.type === 'hit').length;
        }
        return total / (SEEDS.length * 8);
      });
      for (let i = 1; i < mean.length; i++) assert.ok(mean[i] >= mean[i - 1] * 0.97, `${id} variety=${variety}: ${mean.map((m) => m.toFixed(1))}`);
      assert.ok(mean[4] > mean[0] * 1.05, `${id} variety=${variety}: bei 1 mehr als bei 0 (${mean[4].toFixed(1)} gegen ${mean[0].toFixed(1)})`);
    }
  }
});

test('alle Komplexitätsstufen erzeugen gültige Ereignisse', () => {
  for (const p of STYLE_PRESETS) {
    for (const complexity of COMPLEXITIES) {
      for (const variety of [false, true]) {
        let last = -Infinity;
        for (const e of buildEvents(track(p, { complexity, variety, seed: 4 }))) {
          assert.ok(Number.isFinite(e.t) && e.t >= last, `${p.id} ${complexity}: Reihenfolge`);
          last = e.t;
          if (e.type === 'hit' || e.type === 'note') assert.ok(e.vel > 0 && e.vel <= 1, `${p.id}: vel`);
          if (e.layer === 'bass') assert.ok(e.midi >= 28 && e.midi <= 52, `${p.id}: Bass ${e.midi}`);
        }
      }
    }
  }
});

test('validateTrack: badComplexity für Unbrauchbares, nichts für 0, 0,5, 1, fehlend und null', () => {
  const codes = (complexity) => validateTrack({ ...track(STYLE_PRESETS[0]), complexity });
  // der Wert steht wie bei badBpm unverändert in den Parametern (Zahl oder Text)
  for (const bad of [-0.1, 1.1, NaN, 'x', Infinity]) {
    assert.deepEqual(codes(bad), [{ code: 'badComplexity', params: { complexity: bad } }], String(bad));
  }
  for (const ok of [0, 0.5, 1, 0.123, undefined, null]) assert.deepEqual(codes(ok), [], String(ok));
});
