// Alle Grooves im Generator: jedes Ereignis im Takt und auf dem Raster, gültige Töne, Fills, Takte mit anderer Schlagzahl, Auswahl des Grooves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROOVES, METERS, DEFAULT_GROOVE, grooveFor, groovesFor } from '../../src/core/grooves.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { buildEvents, chordTimeline } from '../../src/index.js';
import { validateTrack } from '../../src/core/track.js';

const IDS = Object.keys(GROOVES);
const COMPLEXITIES = [0, 0.25, 0.5, 0.75, 1];
const KEYS = [{ root: 'A', mode: 'minor' }, { root: 'C', mode: 'major' }];
const JITTER_MAX = 0.02; // Vertrag: Timing-Abweichung höchstens 0,02 s
const meterOf = (key) => key.split('/').map(Number);
// Akkorde, die zur Tonart passen: A-Moll Am Dm E, C-Dur C F G
const CHORDS_IN = (key) => (key.mode === 'minor' ? [['A', 'min'], ['D', 'min'], ['E', 'maj']] : [['C', 'maj'], ['F', 'maj'], ['G', 'maj']]);
const barsFor = (meter, beats = METERS[meter].beats, count = 3, key = KEYS[0]) => CHORDS_IN(key).slice(0, count).map(([root, quality]) => ({ chord: { root, quality }, beats }));
const track = (id, over = {}) => {
  const g = GROOVES[id];
  return {
    key: KEYS[0], bpm: 100, seed: 1, length: 3, meter: meterOf(g.meter), groove: id, bars: barsFor(g.meter, METERS[g.meter].beats, 3, over.key ?? KEYS[0]),
    tags: { development: ['fullFromStart'] }, ...over,
  };
};

test('Standard-Groove je Taktart: jede Taktart hat einen, er gehört zur Taktart', () => {
  for (const key of Object.keys(METERS)) {
    const id = DEFAULT_GROOVE[key];
    assert.ok(id && Object.hasOwn(GROOVES, id), `${key}: Standard`);
    assert.equal(GROOVES[id].meter, key);
    assert.ok(groovesFor(key).length >= 1);
    assert.equal(grooveFor({ meter: meterOf(key) }), GROOVES[id], key);
  }
  assert.ok(IDS.length >= 8);
});

test('grooveFor: ein Groove einer anderen Taktart und ein unbekannter ergeben den Standard der Taktart', () => {
  assert.equal(grooveFor({ meter: [3, 4], groove: 'straight' }), GROOVES[DEFAULT_GROOVE['3/4']]);
  assert.equal(grooveFor({ meter: [4, 4], groove: 'waltz' }), GROOVES.straight);
  assert.equal(grooveFor({ meter: [4, 4], groove: 'nope' }), GROOVES.straight);
  assert.equal(grooveFor({ meter: [6, 8], groove: 'rock68' }), GROOVES.rock68);
});

test('validateTrack: badGroove für Unbekanntes, ein Groove einer anderen Taktart ist gültig', () => {
  const codes = (groove) => validateTrack({ ...track('straight'), groove });
  for (const [bad, shown] of [['nope', 'nope'], [5, 5], [{}, 'object'], [[], 'object']]) {
    assert.deepEqual(codes(bad), [{ code: 'badGroove', params: { groove: shown } }], JSON.stringify(bad));
  }
  for (const ok of ['straight', 'waltz', 'shuffle', undefined, null]) assert.deepEqual(codes(ok), [], String(ok));
});

test('jeder Groove: Ereignisse im Takt, sortiert, endlich, gültige Töne und Lautstärken, über Komplexität, variety, Seeds und Tonarten', () => {
  for (const id of IDS) {
    for (const complexity of COMPLEXITIES) {
      for (const variety of [false, true]) {
        for (const key of KEYS) {
          for (const seed of [1, 2, 3, 4, 5, 6]) {
            const t = track(id, { complexity, variety, seed, key });
            assert.deepEqual(validateTrack(t), [], `${id}: gültiger Track`);
            const timeline = barTimeline(checkedTrack(t));
            let last = -Infinity;
            const layersByBar = timeline.map(() => new Set());
            for (const e of buildEvents(t)) {
              const label = `${id} c=${complexity} v=${variety} s=${seed}`;
              assert.ok(Number.isFinite(e.t) && e.t >= last, `${label}: Reihenfolge`);
              last = e.t;
              const b = timeline[e.bar];
              assert.ok(e.t >= b.start - 1e-9 && e.t < b.end, `${label}: außerhalb des Takts ${e.bar}`);
              assert.ok(e.beat >= 0 && e.beat < METERS[GROOVES[id].meter].beats + 1e-9, `${label}: beat ${e.beat}`);
              if (e.type === 'hit' || e.type === 'note') {
                assert.ok(e.vel > 0 && e.vel <= 1, `${label}: vel ${e.vel}`);
                layersByBar[e.bar].add(e.layer);
              }
              if (e.type === 'note') {
                assert.ok(Number.isInteger(e.midi) && Number.isFinite(e.dur) && e.dur > 0, `${label}: Note`);
                assert.ok(e.layer === 'bass' ? e.midi >= 28 && e.midi <= 52 : e.midi >= 24 && e.midi <= 100, `${label}: ${e.layer} ${e.midi}`);
              }
            }
            for (const [i, layers] of layersByBar.entries()) for (const layer of ['drums', 'bass', 'chords', 'pad']) assert.ok(layers.has(layer), `${id} s=${seed}: Takt ${i} ohne ${layer}`);
          }
        }
      }
    }
  }
});

test('Raster: Schlagzeug-Ereignisse liegen auf Taktanfang + Schritt * stepSec (Jitter, Swing nur bei sub 4)', () => {
  for (const id of IDS) {
    const g = GROOVES[id];
    const { sub } = METERS[g.meter];
    for (const complexity of [0, 1]) {
      const t = track(id, { complexity, tags: { development: ['fullFromStart'], rhythm: ['swing'] } });
      const timeline = barTimeline(checkedTrack(t));
      for (const e of buildEvents(t).filter((x) => x.type === 'hit')) {
        const b = timeline[e.bar];
        const step = Math.round((e.t - b.start) / b.stepSec);
        const off = Math.abs(e.t - (b.start + step * b.stepSec));
        const allowed = JITTER_MAX + (sub === 4 ? b.stepSec / 3 : 0) + 1e-6;
        assert.ok(off <= allowed || step >= b.steps - 1, `${id}: Ereignis ${off.toFixed(4)} s neben dem Raster (Schritt ${step})`);
      }
    }
  }
});

test('Fills: Fill-Takt am Abschnittsende bleibt im Takt und behält Groove-Anteil, wenn fillBeats kleiner als die Schlagzahl ist', () => {
  for (const id of IDS) {
    const g = GROOVES[id];
    const beats = METERS[g.meter].beats;
    const t = track(id, { length: 24, bars: barsFor(g.meter, beats, 3), tags: { development: ['buildsSlowly'] }, seed: 2 });
    const timeline = barTimeline(checkedTrack(t));
    const events = buildEvents(t);
    const fillBars = events.filter((e) => e.type === 'marker' && e.name === 'fill').map((e) => e.bar);
    assert.ok(fillBars.length > 0, `${id}: es gibt einen Fill`);
    for (const bar of fillBars) {
      const hits = events.filter((e) => e.bar === bar && e.type === 'hit');
      assert.ok(hits.length > 0 && hits.every((e) => e.t < timeline[bar].end), `${id}: Fill-Takt ${bar}`);
      if (g.fillBeats < beats) assert.ok(hits.some((e) => e.beat < beats - g.fillBeats + 1e-9), `${id}: vor dem Fill spielt noch der Groove`);
    }
  }
});

test('Takte mit anderer Schlagzahl als die Taktart (1 bis 7 Schläge) erzeugen gültige Ereignisse', () => {
  for (const id of IDS) {
    for (const beats of [1, 2, 3, 5, 7]) {
      const t = track(id, { bars: barsFor(GROOVES[id].meter, beats), complexity: 1, variety: true });
      const timeline = barTimeline(checkedTrack(t));
      for (const e of buildEvents(t)) {
        assert.ok(Number.isFinite(e.t), `${id} beats=${beats}`);
        assert.ok(e.t >= timeline[e.bar].start - 1e-9 && e.t < timeline[e.bar].end, `${id} beats=${beats}: außerhalb des Takts`);
      }
    }
  }
});

test('chordTimeline und die chord-Ereignisse stimmen in Zeit und Dauer überein', () => {
  for (const id of IDS) {
    const t = track(id, { length: 6 });
    const line = chordTimeline(t);
    const chordEvents = buildEvents(t).filter((e) => e.type === 'chord');
    assert.equal(line.length, chordEvents.length);
    line.forEach((entry, i) => assert.ok(Math.abs(entry.time - chordEvents[i].t) < 1e-6, `${id}: Takt ${i}`));
  }
});
