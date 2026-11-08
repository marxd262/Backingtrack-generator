// Reichere Varianten: der Track-Schalter `variety` lässt den Seed mehr verändern (Streuung der Schlagwort-Werte, mehr Muster,
// leichter Klang-Drift). Ohne den Schalter bleibt alles bitgleich wie vorher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, DRUM_NAMES } from '../../src/core/events.js';
import { STYLE_PRESETS, driftParams, resolveTags } from '../../src/core/tags.js';
import { DEFAULT_TIMBRE, resolveTimbre, resolveTrackTimbre } from '../../src/core/timbre.js';
import { createRng } from '../../src/core/rng.js';

const bar = (root, quality) => ({ chord: { root, quality }, beats: 4 });
const BARS = [bar('A', 'min'), bar('A', 'min'), bar('D', 'min'), bar('E', 'maj')];
const track = (id, over = {}) => {
  const p = STYLE_PRESETS.find((s) => s.id === id);
  return { key: { root: 'A', mode: 'minor' }, bpm: p.bpm, bars: BARS, tags: p.tags, seed: 1, length: 24, ...over };
};
const IDS = STYLE_PRESETS.map((p) => p.id);
const SEEDS = Array.from({ length: 120 }, (_, i) => i * 83 + 1);
const sounding = (events) => events.filter((e) => e.type === 'hit' || e.type === 'note');
// Muster-Identität ohne Zeit und Lautstärke
const signature = (events) => sounding(events).map((e) => `${e.layer}:${e.bar}:${e.name ?? e.midi}`).join('|');

test('ohne variety (fehlend oder false) ist der Strom bitgleich wie bisher', () => {
  for (const id of IDS) {
    const plain = buildEvents(track(id));
    assert.deepEqual(buildEvents(track(id, { variety: false })), plain);
    assert.deepEqual(buildEvents(track(id, { variety: undefined })), plain);
  }
});

test('mit variety: deterministisch, und der Strom unterscheidet sich vom Strom ohne', () => {
  for (const id of IDS) {
    const a = buildEvents(track(id, { variety: true }));
    assert.deepEqual(buildEvents(track(id, { variety: true })), a);
    assert.notEqual(signature(a), signature(buildEvents(track(id))), id);
  }
});

test('mit variety sind mehr verschiedene Muster über die Varianten zu hören als ohne', () => {
  for (const id of IDS) {
    const distinct = (variety) => new Set(SEEDS.map((seed) => signature(buildEvents(track(id, { seed, variety }))))).size;
    assert.ok(distinct(true) >= distinct(false), `${id}: ${distinct(true)} gegen ${distinct(false)}`);
  }
  // beim Funk-Stil mit allen Schichten ab Takt 1 gibt es klar mehr Spielarten des Basses
  const bassKinds = (variety) => new Set(SEEDS.map((seed) => buildEvents(track('funk', { seed, variety, tags: { ...track('funk').tags, development: ['fullFromStart'] } }))
    .filter((e) => e.layer === 'bass' && e.bar === 1).map((e) => `${e.beat}:${e.midi}`).join(','))).size;
  assert.ok(bassKinds(true) > bassKinds(false), `${bassKinds(true)} gegen ${bassKinds(false)}`);
});

test('mit variety bleiben alle Ereignisse gültig (Zeiten, Namen, Tonhöhen, Reihenfolge) über viele Varianten und Stile', () => {
  for (const id of IDS) {
    for (const seed of SEEDS) {
      const events = buildEvents(track(id, { seed, variety: true, tags: { ...track(id).tags, development: ['fullFromStart'] } }));
      let last = -Infinity;
      for (const e of events) {
        assert.ok(Number.isFinite(e.t) && e.t >= last, `${id} ${seed}: Reihenfolge ${e.t}`);
        last = e.t;
        if (e.type === 'hit') assert.ok(DRUM_NAMES.includes(e.name), `${id} ${seed}: ${e.name}`);
        if (e.type === 'note') assert.ok(Number.isInteger(e.midi) && e.midi >= 28 && e.midi <= 96, `${id} ${seed}: ${e.midi}`);
        if (e.layer === 'bass') assert.ok(e.midi >= 28 && e.midi <= 52, `${id} ${seed}: Bass ${e.midi}`);
        if (e.type === 'hit' || e.type === 'note') assert.ok(e.vel > 0 && e.vel <= 1, `${id} ${seed}: vel ${e.vel}`);
      }
      assert.equal(events.filter((e) => e.type === 'chord').length, 24, `${id} ${seed}`);
    }
  }
});

test('driftParams: bleibt in [0,1], Grenzen der Streuung, deterministisch, verändert nur die drei Werte', () => {
  for (const id of IDS) {
    const base = resolveTags(track(id).tags, createRng(1));
    const seen = new Set();
    for (const seed of SEEDS) {
      const out = driftParams(base, createRng(seed).fork('drift'));
      assert.deepEqual(driftParams(base, createRng(seed).fork('drift')), out);
      for (const key of ['syncopation', 'bassMovement']) {
        assert.ok(out[key] >= 0 && out[key] <= 1, `${id} ${key}`);
        assert.ok(Math.abs(out[key] - base[key]) <= 0.12 + 1e-9, `${id} ${key} ${out[key]} gegen ${base[key]}`);
      }
      assert.ok(out.swing >= 0 && out.swing <= 1);
      assert.ok(out.swing >= base.swing * 0.75 - 1e-9 && out.swing <= Math.min(1, base.swing * 1.25) + 1e-9, `${id} swing`);
      for (const key of ['drive', 'bassLow', 'padWidth', 'arp', 'buildUp']) assert.equal(out[key], base[key], key);
      seen.add(`${out.swing}|${out.syncopation}|${out.bassMovement}`);
    }
    assert.ok(seen.size > SEEDS.length / 2, `${id}: Streuung wirkt (${seen.size} verschiedene)`);
  }
  assert.equal(driftParams({ ...resolveTags({}, createRng(1)), swing: 0 }, createRng(5)).swing, 0, 'straight bleibt gerade');
});

test('Klang-Drift: ohne variety oder ohne Seed unverändert, mit variety klein, begrenzt und deterministisch', () => {
  const tags = track('funk').tags;
  const base = resolveTimbre(tags);
  assert.deepEqual(resolveTrackTimbre({ tags, seed: 7 }), base);
  assert.deepEqual(resolveTrackTimbre({ tags, seed: 7, variety: false }), base);
  assert.deepEqual(resolveTrackTimbre({ tags, variety: true }), base, 'ohne Seed kein Drift');
  const DRIFTED = ['drums.snareTone', 'drums.hatBright', 'bass.cutoff', 'chords.brightness', 'pad.cutoff', 'pad.lfoSpeed', 'master.echo'];
  const get = (t, path) => path.split('.').reduce((o, k) => o[k], t);
  const seen = new Set();
  for (const seed of SEEDS) {
    const t = resolveTrackTimbre({ tags, seed, variety: true });
    assert.deepEqual(resolveTrackTimbre({ tags, seed, variety: true }), t);
    for (const [group, fields] of Object.entries(DEFAULT_TIMBRE)) {
      for (const key of Object.keys(fields)) {
        const path = `${group}.${key}`;
        const v = get(t, path);
        assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), path);
        if (DRIFTED.includes(path)) assert.ok(Math.abs(v - get(base, path)) <= 0.08 + 1e-9, `${path}: ${v}`);
        else assert.equal(v, get(base, path), `${path} bleibt`);
      }
    }
    seen.add(JSON.stringify(t));
  }
  assert.ok(seen.size > SEEDS.length / 2);
});

test('Regler des Nutzers gewinnen gegen den Klang-Drift', () => {
  const tags = track('funk').tags;
  for (const seed of SEEDS.slice(0, 20)) {
    const t = resolveTrackTimbre({ tags, seed, variety: true, timbre: { master: { echo: 0.9 }, pad: { cutoff: 0.1 } } });
    assert.equal(t.master.echo, 0.9);
    assert.equal(t.pad.cutoff, 0.1);
  }
});
