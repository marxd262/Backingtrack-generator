// Vertrag mit Interactive Scales: Track im alten Format, Seed-Regel, Ebenen, Fehler, Presets und Schlagworte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, chordTimeline, validateTrack, TAG_CATEGORIES, STYLE_PRESETS } from '../../src/index.js';

const bar = (root, quality, beats = 4) => ({ chord: { root, quality }, beats });
// Format von Interactive Scales heute: keine tags, seed, layers, length
const legacy = () => ({
  id: 'x', title: 'y', key: { root: 'A', mode: 'minor' }, bpm: 90,
  bars: [bar('A', 'min'), bar('D', 'min'), bar('E', 'min'), bar('A', 'min')],
});
const drumHits = (track) => buildEvents(track).filter((e) => e.type === 'hit').map((e) => [e.bar, e.beat, e.name]);

test('Track im alten Format wird akzeptiert und ergibt gültige Ereignisse', () => {
  const events = buildEvents(legacy());
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(Number.isFinite(e.t) && e.t >= 0, 't');
    assert.ok(Number.isInteger(e.bar) && e.bar >= 0 && e.bar < 24, 'bar');
    assert.ok(['chord', 'marker', 'hit', 'note'].includes(e.type), e.type);
  }
  assert.deepEqual(events.map((e) => e.t), [...events.map((e) => e.t)].sort((a, b) => a - b));
  assert.equal(events.filter((e) => e.type === 'chord').length, 24);
});

test('chordTimeline für das alte Format: Takte 0..23, Dauer aus bpm, erster Akkord bei 0', () => {
  const tl = chordTimeline(legacy());
  assert.deepEqual(tl.map((e) => e.bar), Array.from({ length: 24 }, (_, i) => i));
  assert.equal(tl[0].time, 0);
  assert.deepEqual(tl[0].chord, { root: 'A', quality: 'min' });
  assert.ok(tl.every((e) => e.durationSec === 2.666667));
  assert.equal(tl[1].time, 2.666667);
});

test('Tempo-Überschreibung (?bpm=): bpm im Track ersetzen skaliert die Zeiten mit 90/120', () => {
  const slow = chordTimeline(legacy());
  const fast = chordTimeline({ ...legacy(), bpm: 120 });
  slow.forEach((e, i) => {
    assert.ok(Math.abs(fast[i].time - (e.time * 90) / 120) < 2e-6, `bar ${i}`);
    assert.deepEqual(fast[i].chord, e.chord);
  });
});

test('Seed-Regel: ohne Seed gilt Seed 1, mit Seed ist die Ausgabe wiederholbar', () => {
  assert.deepEqual(buildEvents(legacy()), buildEvents(legacy()));
  assert.deepEqual(buildEvents(legacy()), buildEvents({ ...legacy(), seed: 1 }));
  assert.deepEqual(buildEvents({ ...legacy(), seed: 7 }), buildEvents({ ...legacy(), seed: 7 }));
  assert.notDeepEqual(drumHits({ ...legacy(), seed: 7 }), drumHits({ ...legacy(), seed: 8 }));
});

test('ausgeschaltete Ebenen liefern nur chord- und marker-Ereignisse', () => {
  const layers = { drums: false, bass: false, chords: false, pad: false };
  const types = new Set(buildEvents({ ...legacy(), layers }).map((e) => e.type));
  assert.deepEqual([...types].sort(), ['chord', 'marker']);
});

test('ungültiger Track wirft mit errors (chordNotInKey, badBpm)', () => {
  const bad = { ...legacy(), bpm: 5, bars: [bar('F#', 'maj')] };
  for (const fn of [buildEvents, chordTimeline]) {
    assert.throws(() => fn(bad), (err) => {
      const codes = err.errors.map((e) => e.code);
      return codes.includes('chordNotInKey') && codes.includes('badBpm');
    });
  }
});

test('jedes Stil-Preset und jedes Schlagwort passt in einen gültigen Track', () => {
  for (const preset of STYLE_PRESETS) {
    assert.deepEqual(validateTrack({ ...legacy(), length: 24, tags: preset.tags, bpm: preset.bpm }), [], preset.id);
    assert.ok(buildEvents({ ...legacy(), tags: preset.tags, bpm: preset.bpm }).length > 0, preset.id);
  }
  const all = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.tags]));
  assert.ok(buildEvents({ ...legacy(), tags: all }).length > 0);
  for (const c of TAG_CATEGORIES) for (const tag of c.tags) assert.ok(buildEvents({ ...legacy(), tags: { [c.id]: [tag] } }).length > 0, tag);
});
