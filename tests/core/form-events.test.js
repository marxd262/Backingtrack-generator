// Songform im Ereignisstrom: Abschnitte in den Teilgrenzen, Schichten je Typ, Dichte, Phrasen-Zufall, Marker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS } from '../../src/index.js';
import { buildFormArrangement, withSection, phrasesOf } from '../../src/core/form-arrange.js';
import { resolveSection } from '../../src/core/form-types.js';
import { normalizeForm } from '../../src/core/form.js';

const bar = (root, quality) => ({ chord: { root, quality }, beats: 4 });
const FUNK = STYLE_PRESETS.find((s) => s.id === 'funk');
const COUNTRY = STYLE_PRESETS.find((s) => s.id === 'country');
const PARTS = [['intro', 4], ['verse', 8], ['build', 8], ['chorus', 8], ['break', 4], ['verse', 8], ['chorus', 8]];
const sectionsOf = (parts) => parts.map(([type, bars]) => ({ type, bars }));
const mk = (over = {}, parts = PARTS, feel = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 100, tags: FUNK.tags, seed: 1,
  bars: [bar('A', 'min'), bar('A', 'min'), bar('D', 'min'), bar('E', 'maj')],
  layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
  jobs: { lead: 'melody', percussion: 'mixed' },
  form: { sections: sectionsOf(parts), feel },
  ...over,
});
const range = (parts, type, nth = 0) => {
  let start = 0, seen = 0;
  for (const [t, n] of parts) { if (t === type && seen++ === nth) return [start, start + n]; start += n; }
  throw new Error(`no ${type}`);
};
const inBars = (events, [a, b]) => events.filter((e) => (e.type === 'note' || e.type === 'hit') && e.bar >= a && e.bar < b);
const layersIn = (events, r) => new Set(inBars(events, r).map((e) => e.layer));
const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const drumHitsPerBar = (events, r) => inBars(events, r).filter((e) => e.layer === 'drums').length / (r[1] - r[0]);

test('buildFormArrangement: Abschnitte liegen in den Teilgrenzen, nicht in 8-Takt-Blöcken', () => {
  const t = mk();
  const { sections } = buildFormArrangement({ ...t, form: normalizeForm(t.form) });
  assert.deepEqual(sections.map((s) => [s.start, s.bars, s.kind, s.index]), [[0, 4, 'intro', 0], [4, 8, 'verse', 1], [12, 8, 'build', 2], [20, 8, 'chorus', 3], [28, 4, 'break', 4], [32, 8, 'verse', 5], [40, 8, 'chorus', 6]]);
  // fillAtEnd = der NÄCHSTE Teil hat transition fill (Strophe, Refrain: ja; Aufbau: Wirbel; Break: Stopp); der letzte nie
  assert.deepEqual(sections.map((s) => s.fillAtEnd), [true, false, true, false, true, true, false]);
  assert.deepEqual(sections[3].layers, { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true });
  assert.deepEqual(sections[0].layers, { drums: false, bass: true, chords: true, pad: true, lead: true, percussion: false }, 'Lead folgt den Akkorden, Percussion dem Schlagzeug');
  assert.ok(sections[0].resolved.layers.includes('pad'));
});

test('withSection: Kopie mit verschobenen Parametern, geklemmt; ohne Verschiebung unverändert', () => {
  const params = { drive: 0.5, bassMovement: 0.5, syncopation: 0.5, swing: 0.2 };
  const chorus = resolveSection({ type: 'chorus', bars: 8 }, { dynamics: 0.6 });
  const p = withSection(params, chorus, 0, { randomness: 0.5 });
  assert.ok(Math.abs(p.drive - 0.7) < 1e-9);
  assert.ok(Math.abs(p.bassMovement - 0.62) < 1e-9);
  assert.ok(Math.abs(p.syncopation - 0.58) < 1e-9);
  assert.equal(p.swing, 0.2);
  assert.equal(params.drive, 0.5, 'Eingabe bleibt unverändert');
  const flat = resolveSection({ type: 'chorus', bars: 8, density: 0 }, {});
  assert.equal(withSection(params, flat, 0, { randomness: 0.5 }), params);
  const high = withSection({ ...params, drive: 0.95, syncopation: 0.95 }, chorus, 0, { randomness: 1 });
  assert.equal(high.drive, 1);
  assert.equal(high.syncopation, 1);
  assert.equal(withSection({ ...params, drive: 0.05 }, resolveSection({ type: 'break', bars: 4 }, { dynamics: 0.6 }), 0, { randomness: 0 }).drive, 0);
  // Zufallsregler: 0 senkt, 1 hebt die Synkopen um 0,2
  assert.ok(Math.abs(withSection(params, flat, 0, { randomness: 1 }).syncopation - 0.7) < 1e-9);
  assert.ok(Math.abs(withSection(params, flat, 0, { randomness: 0 }).syncopation - 0.3) < 1e-9);
});

test('phrasesOf: Phrasen zu 4 Takten ab Teilanfang, die letzte kürzer', () => {
  assert.deepEqual(phrasesOf({ start: 6, bars: 10 }), [{ start: 6, bars: 4 }, { start: 10, bars: 4 }, { start: 14, bars: 2 }]);
  assert.deepEqual(phrasesOf({ start: 0, bars: 4 }), [{ start: 0, bars: 4 }]);
  assert.deepEqual(phrasesOf({ start: 3, bars: 1 }), [{ start: 3, bars: 1 }]);
});

test('Ereignisse mit Form: Schichten richten sich nach dem Typ des Teils, in den Teilgrenzen', () => {
  for (const seed of [1, 2, 3]) {
    const ev = buildEvents(mk({ seed }));
    const intro = layersIn(ev, range(PARTS, 'intro'));
    assert.ok(!intro.has('drums') && !intro.has('percussion'), 'Intro ohne Schlagzeug (und Percussion)');
    for (const l of ['bass', 'chords', 'pad']) assert.ok(intro.has(l), `Intro hat ${l}`);
    const brk = layersIn(ev, range(PARTS, 'break'));
    assert.ok(!brk.has('drums') && !brk.has('bass') && !brk.has('percussion'), 'Break ohne Schlagzeug und Bass');
    assert.ok(brk.has('pad') && brk.has('chords'));
    const chorus = layersIn(ev, range(PARTS, 'chorus'));
    for (const l of ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion']) assert.ok(chorus.has(l), `Refrain hat ${l}`);
    // die Teilgrenze liegt bei Takt 4, nicht bei 8
    assert.ok(!inBars(ev, [3, 4]).some((e) => e.layer === 'drums'));
    assert.ok(inBars(ev, [4, 5]).some((e) => e.layer === 'drums'));
  }
});

test('Dichte: Schlagzeug im Refrain dichter als in der Strophe, Break ohne Schlagzeug (Mittel über Seeds)', () => {
  const per = SEEDS.map((seed) => {
    const ev = buildEvents(mk({ seed }));
    return [drumHitsPerBar(ev, range(PARTS, 'chorus')), drumHitsPerBar(ev, range(PARTS, 'verse')), drumHitsPerBar(ev, range(PARTS, 'break'))];
  });
  const [chorus, verse, brk] = [0, 1, 2].map((k) => mean(per.map((p) => p[k])));
  assert.ok(chorus > verse, `Refrain ${chorus} > Strophe ${verse}`);
  assert.ok(verse > brk, `Strophe ${verse} > Break ${brk}`);
});

test('Aufbau rampt: der Schluss ist dichter als der Anfang (Mittel über Seeds)', () => {
  const parts = [['verse', 8], ['build', 16], ['chorus', 8]];
  const [a, b] = range(parts, 'build');
  const first = [], late = [];
  for (const seed of SEEDS) {
    const ev = buildEvents(mk({ seed, tags: COUNTRY.tags }, parts)); // mittlerer drive: die Stufen des Schlagzeugs wechseln im Aufbau
    first.push(drumHitsPerBar(ev, [a, a + 4]));
    late.push(drumHitsPerBar(ev, [b - 5, b - 1])); // ohne den Fill-Takt am Ende
  }
  assert.ok(mean(late) > mean(first) + 1, `${mean(late)} > ${mean(first)}`);
});

test('Zufallsregler: 0 hält das Bass-Muster in allen Phrasen eines Teils, 1 wechselt (Mittel über Seeds)', () => {
  const parts = [['verse', 16], ['chorus', 16]];
  const beatsOf = (ev, i) => inBars(ev, [i, i + 1]).filter((e) => e.layer === 'bass').map((e) => e.beat).join();
  const changes = (randomness) => SEEDS.map((seed) => {
    const ev = buildEvents(mk({ seed }, parts, { randomness }));
    let n = 0;
    for (const base of [0, 16]) for (const k of [4, 8, 12]) if (beatsOf(ev, base + k - 4) !== beatsOf(ev, base + k)) n++;
    return n;
  });
  assert.equal(Math.max(...changes(0)), 0, 'Zufall 0: nie ein anderes Muster');
  assert.ok(mean(changes(1)) > 0.5, `Zufall 1 wechselt: ${mean(changes(1))}`);
});

test('Refrain: offene Hi-Hat sicher, in Strophe nicht', () => {
  for (const seed of SEEDS) {
    const ev = buildEvents(mk({ seed }));
    const open = (r) => inBars(ev, r).filter((e) => e.name === 'openHat').length;
    assert.equal(open(range(PARTS, 'verse')), 0, `Strophe 1, Seed ${seed}`);
    assert.equal(open(range(PARTS, 'verse', 1)), 0, `Strophe 2, Seed ${seed}`);
    assert.ok(open(range(PARTS, 'chorus')) > 0, `Refrain, Seed ${seed}`);
  }
});

test('Marker: section am Anfang jedes Teils, fill nur vor Teilen mit fill', () => {
  const ev = buildEvents(mk());
  const markers = ev.filter((e) => e.type === 'marker');
  const secs = markers.filter((e) => e.name === 'section');
  assert.deepEqual(secs.map((m) => [m.bar, m.beat, m.kind, m.index]), [[0, 0, 'intro', 0], [4, 0, 'verse', 1], [12, 0, 'build', 2], [20, 0, 'chorus', 3], [28, 0, 'break', 4], [32, 0, 'verse', 5], [40, 0, 'chorus', 6]]);
  const chordT = new Map(ev.filter((e) => e.type === 'chord').map((e) => [e.bar, e.t]));
  for (const m of secs) assert.equal(m.t, chordT.get(m.bar), 'Marker auf dem Taktanfang');
  // fill im letzten Takt vor Strophe (4, 32) und Refrain (20, 40); nicht vor Aufbau (Wirbel) und Break (Stopp)
  assert.deepEqual(markers.filter((e) => e.name === 'fill').map((m) => m.bar), [3, 19, 31, 39]);
  assert.equal(buildEvents(mk({ form: undefined, length: 24 })).filter((e) => e.name === 'section').length, 0, 'ohne Form kein section-Marker');
});

test('Mit Form: dieselben Ereignisformen wie bisher, nur der neue Marker kommt dazu', () => {
  const withForm = buildEvents(mk());
  const shape = (e) => `${e.type}:${e.layer ?? ''}:${Object.keys(e).sort().join()}`;
  const old = new Set(buildEvents(mk({ form: undefined, length: 24 })).map(shape));
  for (const e of withForm.filter((x) => x.name !== 'section')) assert.ok(old.has(shape(e)), `bekannte Form ${shape(e)}`);
  const ts = withForm.map((e) => e.t);
  assert.deepEqual(ts, [...ts].sort((x, y) => x - y), 'nach t sortiert');
});

test('Determinismus und Eingabe: gleicher Track gleicher Strom, Eingabe bleibt unverändert', () => {
  const t = mk();
  const copy = structuredClone(t);
  assert.deepEqual(buildEvents(t), buildEvents(t));
  assert.deepEqual(t, copy);
  assert.notDeepEqual(buildEvents(t), buildEvents(mk({ seed: 2 })));
  assert.equal(Math.max(...buildEvents(t).map((e) => e.bar)), 47, 'Länge = Summe der Teile');
});

test('Schichten aus: nichts für abgeschaltete Schichten, auch mit Form', () => {
  const ev = buildEvents(mk({ layers: { drums: false, bass: false, chords: true, pad: false, lead: false, percussion: false } }));
  assert.deepEqual([...new Set(ev.filter((e) => e.layer).map((e) => e.layer))], ['chords']);
});

test('Ungültige Form wirft wie ein ungültiger Track', () => {
  for (const form of [{ sections: [{ type: 'verse', bars: 0 }] }, { sections: [{ type: 'zzz', bars: 4 }] }, { sections: [] }]) {
    assert.throws(() => buildEvents(mk({ form })), (e) => e.errors?.some((x) => x.code === 'badForm'));
  }
});
