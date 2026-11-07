import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordTimeline } from '../../src/core/timeline.js';
import { buildEvents } from '../../src/core/events.js';

const Am = { root: 'A', quality: 'min' };
const Dm = { root: 'D', quality: 'min' };
const key = { root: 'A', mode: 'minor' };
const bar = (chord, beats = 4) => ({ chord, beats });

const TRACKS = {
  '4/4 bei 100 bpm': { key, bpm: 100, bars: [bar(Am), bar(Dm)] },
  'bpm 40': { key, bpm: 40, bars: [bar(Am), bar(Dm)] },
  'bpm 240': { key, bpm: 240, bars: [bar(Am), bar(Dm)] },
  'Takt mit 3 Schlägen': { key, bpm: 100, bars: [bar(Am, 3), bar(Dm, 4), bar(Am, 5)] },
  'Verlauf mit 1 Akkord': { key, bpm: 100, bars: [bar(Am)] },
  'length 1': { key, bpm: 100, length: 1, bars: [bar(Am), bar(Dm)] },
  'length 24': { key, bpm: 100, length: 24, bars: [bar(Am, 3), bar(Dm)] },
};

for (const [name, track] of Object.entries(TRACKS)) {
  test(`chordTimeline stimmt mit den chord-Ereignissen überein: ${name}`, () => {
    const timeline = chordTimeline(track);
    const chords = buildEvents(track).filter((e) => e.type === 'chord');
    assert.equal(timeline.length, track.length ?? 24);
    assert.deepEqual(timeline.map(({ time, bar: b, chord }) => ({ time, bar: b, chord })), chords.map((e) => ({ time: e.t, bar: e.bar, chord: e.chord })));
  });
}

test('chordTimeline: Dauer je Takt und Akkorde im Kreis', () => {
  const tl = chordTimeline(TRACKS['Takt mit 3 Schlägen']);
  assert.deepEqual(tl.slice(0, 4).map((e) => e.durationSec), [1.8, 2.4, 3, 1.8]);
  assert.deepEqual(tl.slice(0, 4).map((e) => e.chord), [Am, Dm, Am, Am]);
});

test('chordTimeline wirft bei ungültigem Track mit errors', () => {
  assert.throws(() => chordTimeline({ key, bpm: 5, bars: [bar(Am)] }), (err) => err.errors.some((e) => e.code === 'badBpm'));
});
