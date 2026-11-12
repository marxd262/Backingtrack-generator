// Songform: Datenmodell, Prüfung, Länge, Akkordfolge je Teil, Typ-Tabelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formLength, normalizeForm, sectionAt, chordIndex, checkForm } from '../../src/core/form.js';
import { PART_TYPES, TRANSITIONS, FORM_LIMITS, FEEL_DEFAULTS, TYPE_TABLE, resolveSection, levelAt, densityAt } from '../../src/core/form-types.js';
import { normalizeTrack, MAX_LENGTH } from '../../src/core/track.js';
import { validateTrack } from '../../src/index.js';
import { chordTimeline } from '../../src/core/timeline.js';
import { buildEvents } from '../../src/core/events.js';
import { nextDistinctChord } from '../../src/core/fretboard.js';
import { play } from '../../src/audio/play.js';

const sec = (type, bars, extra = {}) => ({ type, bars, ...extra });
const FORM = () => ({ sections: [sec('intro', 4), sec('verse', 6)] });
const reasons = (form) => { const out = []; checkForm(form, (code, p) => out.push([code, p.reason])); return out; };
const chord = (root, quality = 'min', beats = 4) => ({ chord: { root, quality }, beats });
const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 120, seed: 1,
  bars: [chord('A'), chord('D'), chord('E', 'maj'), chord('A')], ...extra,
});

test('Konstanten: Typen, Übergänge, Grenzen, Standardregler, Tabelle', () => {
  assert.deepEqual([...PART_TYPES], ['intro', 'verse', 'build', 'chorus', 'break', 'outro']);
  assert.deepEqual([...TRANSITIONS], ['none', 'fill', 'roll', 'stop']);
  assert.deepEqual({ ...FEEL_DEFAULTS }, { structure: 0.6, dynamics: 0.6, pauses: 0.4, randomness: 0.5 });
  assert.equal(FORM_LIMITS.parts, 64);
  assert.equal(FORM_LIMITS.bars, 64);
  assert.equal(FORM_LIMITS.length, MAX_LENGTH);
  assert.deepEqual(Object.keys(TYPE_TABLE), PART_TYPES);
  for (const row of Object.values(TYPE_TABLE)) {
    assert.ok(row.level.every((x) => x <= 0 && x >= FORM_LIMITS.levelMin));
    assert.ok(row.density.every((x) => x >= -1 && x <= 1));
    assert.ok(TRANSITIONS.includes(row.transition));
    assert.ok(!row.layers.includes('lead') && !row.layers.includes('percussion'));
  }
});

test('formLength: Summe der Takte', () => {
  assert.equal(formLength(FORM()), 10);
  assert.equal(formLength({ sections: [] }), 0);
  assert.equal(formLength(undefined), 0);
});

test('normalizeForm: Standard-feel, unbekannte Felder weg, undefined/null', () => {
  assert.equal(normalizeForm(undefined), undefined);
  assert.equal(normalizeForm(null), undefined);
  const raw = { template: 'pop', evil: 1, feel: { dynamics: 1, other: 3 }, sections: [{ type: 'verse', bars: 4, junk: true, locked: true }] };
  const frozen = structuredClone(raw);
  const f = normalizeForm(raw);
  assert.deepEqual(raw, frozen, 'Eingabe unverändert');
  assert.deepEqual(f, { template: 'pop', feel: { ...FEEL_DEFAULTS, dynamics: 1 }, sections: [{ type: 'verse', bars: 4, locked: true }] });
  assert.deepEqual(normalizeForm({ sections: [] }).feel, { ...FEEL_DEFAULTS });
  assert.equal(normalizeForm(5), 5, 'Ungültiges bleibt für checkForm erkennbar');
});

test('sectionAt: Teilgrenzen, außerhalb gibt null', () => {
  const f = FORM();
  assert.deepEqual(sectionAt(f, 0), { index: 0, section: f.sections[0], start: 0, barInSection: 0 });
  assert.equal(sectionAt(f, 3).index, 0);
  assert.deepEqual([sectionAt(f, 4).index, sectionAt(f, 4).start, sectionAt(f, 4).barInSection], [1, 4, 0]);
  assert.equal(sectionAt(f, 9).barInSection, 5);
  for (const bar of [10, -1, 1.5, NaN, '2']) assert.equal(sectionAt(f, bar), null, String(bar));
  assert.equal(sectionAt(undefined, 0), null);
});

test('chordIndex: ohne Form i mod n, mit Form beginnt jeder Teil bei 0', () => {
  const t = { bars: [1, 2, 3, 4].map(() => chord('A')) };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10].map((i) => chordIndex(t, i)), [0, 1, 2, 3, 0, 1, 1, 2]);
  const withForm = { ...t, form: FORM() };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => chordIndex(withForm, i)), [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  assert.equal(chordIndex(withForm, 10), 0, 'hinter dem Ende läuft die Form im Kreis');
});

test('checkForm: gültige Formen ergeben keine Meldung', () => {
  assert.deepEqual(reasons(undefined), []);
  assert.deepEqual(reasons(null), []);
  assert.deepEqual(reasons(FORM()), []);
  assert.deepEqual(reasons({ feel: { dynamics: 1.3, pauses: 0 }, sections: [sec('build', 64, { level: -24, density: 1, transition: 'roll', crash: true, locked: false })] }), []);
  assert.deepEqual(reasons({ sections: Array.from({ length: 64 }, () => sec('verse', 8)) }), []);
});

test('checkForm: je Grund genau eine Meldung badForm mit Stichwort', () => {
  const one = (form, reason) => assert.deepEqual(reasons(form), [['badForm', reason]], reason + JSON.stringify(form));
  one(5, 'form');
  one([], 'form');
  one({}, 'sections');
  one({ sections: 'x' }, 'sections');
  one({ sections: [] }, 'sections');
  one({ sections: Array.from({ length: 65 }, () => sec('verse', 1)) }, 'sections');
  one({ sections: [null] }, 'sections');
  one({ sections: [sec('solo', 4)] }, 'type');
  one({ sections: [{ bars: 4 }] }, 'type');
  for (const bars of [0, 65, 1.5, '4', NaN, null, undefined]) one({ sections: [{ type: 'verse', bars }] }, 'bars');
  for (const level of [1, -25, NaN, '0', Infinity]) one({ sections: [sec('verse', 4, { level })] }, 'level');
  for (const density of [1.1, -1.1, NaN, '0']) one({ sections: [sec('verse', 4, { density })] }, 'density');
  one({ sections: [sec('verse', 4, { transition: 'jump' })] }, 'transition');
  one({ sections: [sec('verse', 4, { crash: 1 })] }, 'crash');
  one({ sections: [sec('verse', 4, { locked: 'yes' })] }, 'locked');
  one({ feel: 3, sections: [sec('verse', 4)] }, 'feel');
  one({ feel: { dynamics: 1.4 }, sections: [sec('verse', 4)] }, 'feel');
  one({ feel: { structure: -0.1 }, sections: [sec('verse', 4)] }, 'feel');
  one({ feel: { pauses: NaN }, sections: [sec('verse', 4)] }, 'feel');
  one({ feel: { randomness: '0.5' }, sections: [sec('verse', 4)] }, 'feel');
  one({ sections: Array.from({ length: 9 }, () => sec('verse', 64)) }, 'length');
});

test('checkForm: feindliche Eingaben werfen nie', () => {
  const nasty = [
    JSON.parse('{"__proto__":{"sections":[]},"sections":[{"__proto__":{"type":"verse"},"bars":4}]}'),
    { sections: Array.from({ length: 1000 }, () => sec('verse', 1)) },
    { sections: [{ type: 'verse', bars: 4, level: NaN }], feel: { dynamics: NaN } },
    Object.create(null), { sections: Object.create(null) }, { sections: [Object.create(null)] },
    '1', 0, true, [[]], { sections: [[]], feel: [] },
  ];
  for (const f of nasty) assert.doesNotThrow(() => checkForm(f, () => {}));
  for (const f of nasty) assert.doesNotThrow(() => validateTrack({ ...track(), form: f }));
  for (const f of nasty) assert.doesNotThrow(() => normalizeTrack({ ...track(), form: f }));
  assert.deepEqual(reasons({ sections: Array.from({ length: 1000 }, () => sec('verse', 1)) }), [['badForm', 'sections']]);
});

test('normalizeTrack: Länge kommt aus der Form, überschreibt abweichende Werte', () => {
  assert.equal(normalizeTrack(track({ form: FORM() })).length, 10);
  assert.equal(normalizeTrack(track({ form: FORM(), length: 24 })).length, 10);
  assert.deepEqual(normalizeTrack(track({ form: FORM() })).form.feel, { ...FEEL_DEFAULTS });
  // ungültige Form: Länge bleibt, validateTrack meldet badForm
  assert.equal(normalizeTrack(track({ form: { sections: [sec('verse', 0)] }, length: 12 })).length, 12);
  assert.equal(normalizeTrack(track({ form: { sections: [] }, length: 12 })).length, 12);
});

test('normalizeTrack: ohne Form unverändert (JSON-gleich zu vorher)', () => {
  const t = track({ length: 16 });
  const n = normalizeTrack(t);
  assert.equal(Object.hasOwn(n, 'form'), false);
  assert.equal(JSON.stringify(n), JSON.stringify({
    ...structuredClone(t), meter: [4, 4], length: 16, layers: n.layers, jobs: n.jobs, tags: {}, seed: 1,
  }));
  assert.equal(normalizeTrack(track({ form: null })).length, 24);
});

test('validateTrack (öffentlich): badForm mit Grund; Form mit Länge 10 ist gültig', () => {
  assert.deepEqual(validateTrack(track({ form: FORM() })), []);
  assert.deepEqual(validateTrack(track({ form: FORM(), length: 99 })), [], 'length wird aus der Form abgeleitet');
  assert.deepEqual(validateTrack(track({ form: { sections: [sec('solo', 4)] } })), [{ code: 'badForm', params: { reason: 'type' } }]);
  assert.deepEqual(validateTrack(track({ form: 'x' })), [{ code: 'badForm', params: { reason: 'form' } }]);
  assert.deepEqual(validateTrack(track({ form: { sections: [sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 64), sec('verse', 1)] } })),
    [{ code: 'badForm', params: { reason: 'length' } }]);
  assert.deepEqual(validateTrack(track({ form: null })), []);
});

test('resolveSection: Standardwerte der Tabelle bei dynamics 0.6', () => {
  for (const type of PART_TYPES) {
    const r = resolveSection(sec(type, 8), { ...FEEL_DEFAULTS });
    const row = TYPE_TABLE[type];
    assert.deepEqual(r.layers, [...row.layers], type);
    assert.deepEqual(r.level.map((x) => +x.toFixed(9)), [...row.level], type);
    assert.deepEqual(r.density.map((x) => +x.toFixed(9)), [...row.density], type);
    assert.equal(r.transition, row.transition);
    assert.equal(r.crash, row.crash);
    assert.equal(r.locked, false);
    assert.equal(r.type, type);
    assert.equal(r.bars, 8);
  }
  assert.deepEqual(resolveSection(sec('verse', 4), undefined).level.map((x) => +x.toFixed(9)), [-3, -3], 'ohne feel gilt der Standard');
  assert.equal(resolveSection(sec('chorus', 4, { locked: true }), FEEL_DEFAULTS).locked, true);
});

test('resolveSection: dynamics 0 ergibt Pegel 0 und gleiche Dichte, 1.3 spreizt, nie über 0 dB', () => {
  for (const type of PART_TYPES) {
    const r = resolveSection(sec(type, 8), { ...FEEL_DEFAULTS, dynamics: 0 });
    assert.deepEqual(r.level, [0, 0], type);
    assert.deepEqual(r.density, [TYPE_TABLE.chorus.density[0], TYPE_TABLE.chorus.density[0]], type);
  }
  const wide = resolveSection(sec('break', 8), { ...FEEL_DEFAULTS, dynamics: 1.3 });
  assert.ok(Math.abs(wide.level[0] - (-7 * (1.3 / 0.6))) < 1e-9);
  assert.ok(wide.density[0] >= -1 && wide.level[0] >= -24);
  const over = resolveSection(sec('break', 8), { ...FEEL_DEFAULTS, dynamics: 99 });
  assert.deepEqual(over.level, wide.level, 'auf 1,3 begrenzt');
  assert.deepEqual(resolveSection(sec('break', 8), { ...FEEL_DEFAULTS, dynamics: -3 }).level, [0, 0]);
});

test('resolveSection: ausdrücklich gesetzte Werte gelten unskaliert als [x, x]', () => {
  for (const dynamics of [0, 0.6, 1.3]) {
    const r = resolveSection(sec('build', 8, { level: -10, density: 0.5, transition: 'stop', crash: true }), { ...FEEL_DEFAULTS, dynamics });
    assert.deepEqual(r.level, [-10, -10]);
    assert.deepEqual(r.density, [0.5, 0.5]);
    assert.equal(r.transition, 'stop');
    assert.equal(r.crash, true);
  }
  assert.deepEqual(resolveSection(sec('verse', 8, { level: 0, density: 0 }), FEEL_DEFAULTS).level, [0, 0], '0 zählt als gesetzt');
});

test('levelAt/densityAt: linear über die Takte, ein Takt gibt den Startwert', () => {
  const build = resolveSection(sec('build', 4), FEEL_DEFAULTS);
  const lv = [0, 1, 2, 3].map((i) => levelAt(build, i));
  assert.deepEqual(lv.map((x) => +x.toFixed(9)), [-4, -3, -2, -1]);
  assert.ok(lv.every((x, i) => i === 0 || x > lv[i - 1]), 'Aufbau steigt');
  assert.ok(densityAt(build, 3) > densityAt(build, 0));
  const outro = resolveSection(sec('outro', 5), FEEL_DEFAULTS);
  assert.ok(levelAt(outro, 4) < levelAt(outro, 0), 'Outro fällt');
  assert.ok(densityAt(outro, 4) < densityAt(outro, 0));
  assert.equal(levelAt(resolveSection(sec('build', 1), FEEL_DEFAULTS), 0), -4);
  assert.equal(levelAt(build, 99), levelAt(build, 3), 'außerhalb geklemmt');
});

test('chordTimeline/barTimeline: mit Form beginnt die Akkordfolge je Teil neu, ohne Form unverändert', () => {
  const t = track({ form: FORM() });
  const tl = chordTimeline(t);
  assert.equal(tl.length, 10);
  assert.deepEqual(tl.map((b) => b.chord.root), ['A', 'D', 'E', 'A', 'A', 'D', 'E', 'A', 'A', 'D']);
  assert.deepEqual(tl.map((b) => b.bar), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const chords = buildEvents(t).filter((e) => e.type === 'chord');
  assert.deepEqual(chords.map((e) => e.chord.root), tl.map((b) => b.chord.root));
  assert.deepEqual(chords.map((e) => e.t), tl.map((b) => b.time));
  // ohne Form läuft die Folge durch (Länge 10, vier Akkorde): A D E A | A D E A | A D wäre falsch, hier A D E A A D E A A D
  // gleich, darum ein Track, bei dem der Unterschied sichtbar ist
  const odd = chordTimeline(track({ length: 10, bars: [chord('A'), chord('D'), chord('E', 'maj')] }));
  assert.deepEqual(odd.map((b) => b.chord.root), ['A', 'D', 'E', 'A', 'D', 'E', 'A', 'D', 'E', 'A']);
  const oddForm = chordTimeline(track({ form: FORM(), bars: [chord('A'), chord('D'), chord('E', 'maj')] }));
  assert.deepEqual(oddForm.map((b) => b.chord.root), ['A', 'D', 'E', 'A', 'A', 'D', 'E', 'A', 'D', 'E']);
});

test('barTimeline: next im letzten Takt der Form springt zu Takt 0', async () => {
  const { barTimeline } = await import('../../src/core/timeline.js');
  const tl = barTimeline(normalizeTrack(track({ form: FORM(), bars: [chord('A'), chord('D'), chord('E', 'maj')] })));
  assert.equal(tl[3].next.root, 'A', 'Teilgrenze: nächster Teil beginnt bei Akkord 0');
  assert.equal(tl[9].next.root, 'A', 'Ende der Form: Wiederholung beginnt bei Akkord 0');
});

test('nextDistinctChord: mit Form beginnt die Folge je Teil neu', () => {
  const bars = [chord('A'), chord('D'), chord('E', 'maj')];
  // Teile 4 + 6: Takt 3 (Akkord 0 = A, 3 mod 3 wäre ebenfalls 0) ; Takt 2 ist E, danach beginnt der Teil neu mit A
  assert.deepEqual(nextDistinctChord(bars, 10, 3, FORM()), bars[1].chord);
  assert.deepEqual(nextDistinctChord(bars, 10, 9, FORM()), bars[0].chord, 'Takt 9 ist E (Index 5 mod 3), danach springt die Form zu Takt 0: A');
  assert.deepEqual(nextDistinctChord(bars, 10, 3), bars[1].chord, 'ohne Form wie bisher');
});

test('play: Dauer und Startposition mit Form nutzen die Akkordfolge je Teil', async () => {
  // Takte mit 4, 2, 3 Schlägen; mit Form (Teile 4 + 5) beginnt die Folge je Teil neu (28 Schläge), ohne Form läuft sie durch (27)
  const bars = [chord('A', 'min', 4), chord('D', 'min', 2), chord('E', 'maj', 3)];
  const form = { sections: [sec('intro', 4), sec('verse', 5)] };
  const calls = [];
  const node = () => { const n = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} }; n.connect = (x) => x ?? n; return n; };
  const create = () => ({
    output: node(),
    layers: Object.fromEntries(['drums', 'bass', 'chords', 'pad'].map((name) => [name, { trigger: (e, when) => calls.push({ name, e, when }), setMuted() {} }])),
  });
  const ctx = { currentTime: 0, destination: node(), createGain: node };
  const t = track({ bpm: 240, bars, form, tags: { development: ['fullFromStart'] } });
  const h = play(ctx, t, { loops: 1, startBar: 6, createInstruments: create });
  ctx.currentTime = 0.1; // Planer plant bis 0,1 s voraus: der Start bei 0,15 s kommt erst jetzt in Reichweite
  await new Promise((r) => setTimeout(r, 70));
  try {
    // Takt 6 liegt im Teil 2 (19 Schläge davor, ohne Form wären es 18): das erste Ereignis kommt zum Vorlauf von 0,15 s, wenn startSec stimmt (sonst läge es außerhalb der Planungsreichweite).
    const first = calls[0];
    assert.ok(first, 'Ereignis zum Takt 6 geplant');
    assert.ok(Math.abs(first.when - 0.15) < 0.05, `Start bei Vorlauf (when=${first.when})`);
    // Dauer eines Durchlaufs: setTrack mit gleicher Länge und gleicher Dauer klappt, ohne Form (27 statt 28 Schläge) nicht
    assert.equal(h.setTrack({ ...t, tags: { development: ['fullFromStart'], rhythm: ['syncopated'] } }), true);
    assert.equal(h.setTrack({ ...t, form: undefined, length: 9 }), false);
  } finally {
    h.stop();
  }
});

test('normalizeForm: null im feel gilt als fehlend, template nur als Text, auto nur als Wahrheitswert', () => {
  assert.equal(normalizeForm({ feel: { pauses: null }, sections: [] }).feel.pauses, 0.4);
  assert.equal(normalizeForm({ feel: { pauses: undefined }, sections: [] }).feel.pauses, 0.4);
  const f = normalizeForm({ template: 5, auto: 'yes', sections: [] });
  assert.equal(Object.hasOwn(f, 'template'), false);
  assert.equal(Object.hasOwn(f, 'auto'), false);
  const g = normalizeForm({ template: 'pop', auto: true, sections: [] });
  assert.deepEqual([g.template, g.auto], ['pop', true]);
});

test('resolveSection: unbrauchbare dynamics fällt auf den Standard zurück', () => {
  const ref = resolveSection(sec('break', 8), FEEL_DEFAULTS);
  for (const dynamics of [NaN, 'x', Infinity, null, undefined]) {
    const r = resolveSection(sec('break', 8), { ...FEEL_DEFAULTS, dynamics });
    assert.ok(r.level.every(Number.isFinite) && r.density.every(Number.isFinite), String(dynamics));
    assert.deepEqual(r, ref, String(dynamics));
  }
});

test('resolveSection: feste Spec-Werte bei dynamics 0.6 (unabhängig von der Tabelle)', () => {
  const near = (actual, expected, msg) => assert.ok(actual.every((x, i) => Math.abs(x - expected[i]) < 1e-9), `${msg}: ${actual}`);
  const lv = (type) => resolveSection(sec(type, 8), { ...FEEL_DEFAULTS }).level;
  near(lv('intro'), [-5, -5], 'intro');
  near(lv('verse'), [-3, -3], 'verse');
  near(lv('break'), [-7, -7], 'break');
  near(lv('build'), [-4, -1], 'build');
  near(lv('outro'), [-4, -8], 'outro');
  near(lv('chorus'), [0, 0], 'chorus');
  near(resolveSection(sec('chorus', 8), FEEL_DEFAULTS).density, [0.2, 0.2], 'chorus Dichte');
  near(resolveSection(sec('build', 8), FEEL_DEFAULTS).density, [-0.1, 0.25], 'build Dichte');
});

test('chordIndex: ungültige Form fällt auf barIndex mod n zurück', () => {
  const t = { bars: [1, 2, 3].map(() => chord('A')) };
  for (const form of [{ sections: [sec('solo', 4)] }, { sections: [] }, 'x', 5, { sections: [sec('verse', 0)] }]) {
    assert.deepEqual([0, 3, 4, 7].map((i) => chordIndex({ ...t, form }, i)), [0, 0, 1, 1], JSON.stringify(form));
  }
});

test('checkForm: gleiche Meldungen nur einmal, auch bei dünnen Listen', () => {
  assert.deepEqual(reasons({ sections: [sec('solo', 4), sec('solo', 4), sec('solo', 4)] }), [['badForm', 'type']]);
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(reasons({ sections: [, , ,] }), [['badForm', 'sections']]);
  assert.deepEqual(reasons({ sections: [{ type: 'verse', bars: 0 }, { type: 'verse', bars: 99 }] }), [['badForm', 'bars']]);
});
