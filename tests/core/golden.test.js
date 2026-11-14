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
// neu erzeugt 2026-11-14 (Phase 3: die Artikulations-Schicht ist Standard; der Bass bekommt Dead Notes, Annäherungstöne, kürzere oder längere Noten und das Feld art; auch GOLDEN_VARIETY)
// neu erzeugt 2026-11-14 (Urteil des Nutzers: Schlagzeug, Tasten, Pad, Lead, Band-Regeln, Bass B, Tasten B und Flams sind Standard; auch GOLDEN_VARIETY)
const GOLDEN = {
  funk: { count: 1050, sha256: 'd3feb0d7d96f3938d98a4d2bf69da1654d2f4829fc59308049557de6d2a45e3d' },
  psych: { count: 925, sha256: '7800f9d0e4ec034180728ae467518a6c71ffff06479910345836274ca7c3a8ea' },
  dreamy: { count: 583, sha256: '91ab7363146b1f06108b257ddc4167f56f4d7e826360ca8dd5d06a370b1ca8ae' },
  legacy: { count: 827, sha256: '1143e566aeabc5806ab43eb3afd8131c60bd708ba0a3ae233f1102ff06a3aaeb' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

// Dieselben Tracks mit dem Schalter `variety` (Streuung, mehr Muster); aus dem Generator vor dem Umbau auf Taktarten und Grooves
// aufgenommen (2026-11-09), damit "auch mit variety unverändert" prüfbar ist
const GOLDEN_VARIETY = {
  funk: { count: 1078, sha256: '668c28d24c5812e251985e004457ae1704bfa8c0d37e00161d0fce803b163271' },
  psych: { count: 943, sha256: 'cf961eca4ec20334847400f3e73f06176402ec63c7411bb0683ce76d8509d4d9' },
  dreamy: { count: 615, sha256: 'b5ef462c121231006995bc343fa90f0fc1eecbb8a2a6fc3689bd1dacc4540fc2' },
  legacy: { count: 870, sha256: '181463099b47f83b5fa8a31ea38a9795baf35ddc583bde49df469dc0806927f0' },
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
