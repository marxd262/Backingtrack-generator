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
// neu erzeugt 2026-11-13 (Klang v2, Schritt 4: Mikrotiming ist Standard; gleiche Ereignisse, nur Zeiten und Notenlängen um Millisekunden anders)
const GOLDEN = {
  funk: { count: 1023, sha256: '757c90759da0f1cb20afe28dc8c9de15550d7885899a99d2abd2b3d657516ad4' },
  psych: { count: 909, sha256: 'c24a47c1abdd027da8ccc32a560a1ad373a431de4c596be4a47ee16eb9a0899a' },
  dreamy: { count: 578, sha256: '4365b1b3b5f880a4f930b4ba86d21dbf17c5ef9c27fa3449884b7f52be5fe68f' },
  legacy: { count: 805, sha256: '046c56270553af1685fbc9140a639a7345830a8c8c2baf641c6ef9957da059e9' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

// Dieselben Tracks mit dem Schalter `variety` (Streuung, mehr Muster); aus dem Generator vor dem Umbau auf Taktarten und Grooves
// aufgenommen (2026-11-09), damit "auch mit variety unverändert" prüfbar ist
const GOLDEN_VARIETY = {
  funk: { count: 1041, sha256: 'd21c72e89b63b4fae087d30ae919594814972c59c71df3ce164d6229716071a1' },
  psych: { count: 925, sha256: '7d233762046fc2439a312b3793d85b3731b6bfcc486d07646c2ac9cacd2d6cb2' },
  dreamy: { count: 610, sha256: '3a3363836029892ae2337af425bbb1a03cddc9bc6cfc4d9fc53042f02a34d9dc' },
  legacy: { count: 846, sha256: 'fdc526243a82b3b14ec239ba3bdb4e0d8b88dde2a00b63be17b79e7a29e5c7bc' },
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
