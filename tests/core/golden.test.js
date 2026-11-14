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
const GOLDEN = {
  funk: { count: 1041, sha256: '388d2d9266c85e46ea4e1585e7fb40602db33b323b88e899d81c0d2849ec463a' },
  psych: { count: 916, sha256: '01a29234ef046f6972642ab1370e6a6415c9f984a073a933b5ac4c8c073bf691' },
  dreamy: { count: 578, sha256: '72a2f2fd248e4d5efb0b8266458689054c59872abd51fa95ab23694ef259e3f7' },
  legacy: { count: 817, sha256: '90bcf1cf0cce10c24c5afe3e21564e871ad43f76891d8cbe498e9a7b1ac905f3' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

// Dieselben Tracks mit dem Schalter `variety` (Streuung, mehr Muster); aus dem Generator vor dem Umbau auf Taktarten und Grooves
// aufgenommen (2026-11-09), damit "auch mit variety unverändert" prüfbar ist
const GOLDEN_VARIETY = {
  funk: { count: 1069, sha256: '8e69e6d6ceac60ba349d4bb8665084b00f63c0db9d11933049e1ed25a433a2f7' },
  psych: { count: 934, sha256: '92e8c07c49a44fc7330376fce06f653b3dd5288278cd3b8c8f6ab03048516d0e' },
  dreamy: { count: 610, sha256: '50e45500cd91dd8bbddfe3134a4dc9a735da1622449cbb1bfaad06251d6292e4' },
  legacy: { count: 860, sha256: 'c285d2125943a0d3869649f918b70532983307057e59e61a4ca201f4ff2264ab' },
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
