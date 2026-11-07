// Golden-Test: fester Seed ergibt einen festen Ereignisstrom. Jede unbeabsichtigte Änderung am Generator fällt hier auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildEvents, STYLE_PRESETS } from '../../src/index.js';

const bar = (root, quality) => ({ chord: { root, quality }, beats: 4 });
const preset = (id) => {
  const p = STYLE_PRESETS.find((s) => s.id === id);
  return { key: { root: 'A', mode: 'minor' }, bpm: p.bpm, bars: [bar('A', 'min'), bar('A', 'min'), bar('D', 'min'), bar('E', 'maj')], tags: p.tags, seed: 1, length: 24 };
};
// Format von Interactive Scales heute (wie in contract.test.js)
const legacy = { id: 'x', title: 'y', key: { root: 'A', mode: 'minor' }, bpm: 90, bars: [bar('A', 'min'), bar('D', 'min'), bar('E', 'min'), bar('A', 'min')] };

// Erzeugt 2026-11-07 nach der Fix-Welle (langsamer Aufbau: Bass und Schlagzeug zuerst)
const GOLDEN = {
  funk: { count: 1023, sha256: '5241492ce67ef82432375d135002a1084491a40dbe3caf8c05e7683cde6fce18' },
  psych: { count: 909, sha256: '944acbbb64fbb3f2c785f9b1ab989c73a2acb19cfda4029bee0c129e86ecd2da' },
  dreamy: { count: 578, sha256: 'c44e2bf2f38003c74082b2c156e62cc8381a7e778be10d38ae4a81396ea8242c' },
  legacy: { count: 805, sha256: 'ca38d8bdc92a8372f65bc869b7f97de46e3cb894ca2e707ee8d50a5480c4f7a9' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

const HINT = 'Der Ereignisstrom für einen festen Seed hat sich geändert. War das eine gewollte Änderung am Generator, '
  + 'die Werte in GOLDEN (tests/core/golden.test.js) neu erzeugen und die drei Stile auf /ui/render-harness.html neu anhören. '
  + 'Sonst ist es eine Regression: Interactive-Scales-Übungen mit festem Seed klingen dann anders.';

for (const [id, track] of Object.entries(tracks)) {
  test(`Golden: ${id}`, () => {
    const events = buildEvents(track);
    const sha256 = createHash('sha256').update(JSON.stringify(events)).digest('hex');
    assert.deepEqual({ count: events.length, sha256 }, GOLDEN[id], `${id}: ${HINT}`);
  });
}
