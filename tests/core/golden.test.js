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
// neu erzeugt 2026-11-13 (Klang v2, Schritte 4 und 6: Mikrotiming ist Standard, Akkordtöne eines Stabs tragen das Feld strum; gleiche Töne, Zeiten und Notenlängen um Millisekunden anders)
const GOLDEN = {
  funk: { count: 1023, sha256: '70395b27514a1139310105babbdbb06ad02c211b3ae30ecdd96c6d83bb6edc2f' },
  psych: { count: 909, sha256: 'c24a47c1abdd027da8ccc32a560a1ad373a431de4c596be4a47ee16eb9a0899a' },
  dreamy: { count: 578, sha256: 'de7e70aea23ffc58b33b72e66a93933d979a666c0416c68d18495dca7aedc6cc' },
  legacy: { count: 805, sha256: 'a53d3428ffae25e19587fdda3268e23aa2247a0fdba58522153e07eba984e0cb' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

// Dieselben Tracks mit dem Schalter `variety` (Streuung, mehr Muster); aus dem Generator vor dem Umbau auf Taktarten und Grooves
// aufgenommen (2026-11-09), damit "auch mit variety unverändert" prüfbar ist
const GOLDEN_VARIETY = {
  funk: { count: 1041, sha256: '89f5cbb494e773e44e8e848245dd8b979325bb794dd0975e800eecf679fc71c2' },
  psych: { count: 925, sha256: '7d233762046fc2439a312b3793d85b3731b6bfcc486d07646c2ac9cacd2d6cb2' },
  dreamy: { count: 610, sha256: 'd9340c56009ce4ed8a350247359eddd7f48f2ffafa41c85de52d785d2d31fffc' },
  legacy: { count: 846, sha256: '560314b98e65251a918474a5f1417df1f0c5fe5e7f2ea942a41a4fc281ade9f7' },
};

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

for (const [id, track] of Object.entries(tracks)) {
  test(`Golden variety: ${id}`, () => {
    const events = buildEvents({ ...track, variety: true });
    const sha256 = createHash('sha256').update(JSON.stringify(events)).digest('hex');
    assert.deepEqual({ count: events.length, sha256 }, GOLDEN_VARIETY[id], `${id} (variety): ${HINT}`);
  });
}
