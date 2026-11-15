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
// neu erzeugt 2026-11-15 (Urteil des Nutzers: Samples sind die Standardstimmen; die Regeln der Sample-Gitarre und der Crash mit Choke gelten nun auch ohne Stimmenwahl; auch GOLDEN_VARIETY)
const GOLDEN = {
  funk: { count: 1419, sha256: '0e7f91726fd0694c502398fbde082e7526dc69d9eced6fd6863ec6274cf22d5c' },
  psych: { count: 925, sha256: '0804f79de96538592449887df3b6ba8b742647823954b9ddfe72eb4fa91eb4f1' },
  dreamy: { count: 580, sha256: '4e9faabd539b6f147ae4434687cd3843a313364175b3e4e136a0ebef8cb76f67' },
  legacy: { count: 821, sha256: 'c8faa1a78eb092401b3c582e23d3c6a1f949b4922de321214d3d4c55159daf88' },
};
const tracks = { funk: preset('funk'), psych: preset('psych'), dreamy: preset('dreamy'), legacy };

// Dieselben Tracks mit dem Schalter `variety` (Streuung, mehr Muster); aus dem Generator vor dem Umbau auf Taktarten und Grooves
// aufgenommen (2026-11-09), damit "auch mit variety unverändert" prüfbar ist
const GOLDEN_VARIETY = {
  funk: { count: 1450, sha256: 'b330108586e3f2e75473a1200af0b3a2dcc71df6039bafb670cad15cb08deefb' },
  psych: { count: 943, sha256: '8c1ad22f784b20e1c062759aa346492c490d21d0395808146ed4d7ac6c6a3ba6' },
  dreamy: { count: 612, sha256: 'd3fcd8977eb72400fdb365aa79a5789f78486ae950b98ecabc9a61d67a906a75' },
  legacy: { count: 861, sha256: '241ad0fb11142ed8322b9ea74e7d365b8e9a9694491e79b40d2986ce080dcf65' },
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
