// Songform im Ereignisstrom: Abschnitte in den Teilgrenzen, Schichten je Typ, Dichte, Phrasen-Zufall, Marker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS } from '../../src/index.js';
import { buildFormArrangement, withSection, phrasesOf } from '../../src/core/form-arrange.js';
import { resolveSection, DRIVE_WINDOW, BASS_WINDOW } from '../../src/core/form-types.js';
import { normalizeForm } from '../../src/core/form.js';
import { chordTimeline } from '../../src/core/timeline.js';
import { noteToPc } from '../../src/core/music.js';
import { createRng } from '../../src/core/rng.js';

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

test('withSection: Stilwert ins Fenster, Dichte darauf, Kopie, geklemmt', () => {
  const params = { drive: 0.5, bassMovement: 0.5, syncopation: 0.5, swing: 0.2 };
  const chorus = resolveSection({ type: 'chorus', bars: 8 }, { dynamics: 0.6 });
  const p = withSection(params, chorus, 0, { randomness: 0.5 });
  assert.ok(Math.abs(p.drive - 0.7) < 1e-9);
  assert.ok(Math.abs(p.bassMovement - 0.62) < 1e-9);
  assert.ok(Math.abs(p.syncopation - 0.58) < 1e-9);
  assert.equal(p.swing, 0.2);
  assert.equal(params.drive, 0.5, 'Eingabe bleibt unverändert');
  // hohe und niedrige Stilwerte werden erst ins Fenster gelegt (sonst klemmte jeder Teil auf 1 bzw. 0)
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ~ ${y}`);
  const verse = resolveSection({ type: 'verse', bars: 8 }, { dynamics: 0.6 });
  const hi = { ...params, drive: 1, bassMovement: 1 }, lo = { ...params, drive: 0, bassMovement: 0 };
  near(withSection(hi, chorus, 0, {}).drive, DRIVE_WINDOW[1] + 0.2);
  near(withSection(hi, verse, 0, {}).drive, DRIVE_WINDOW[1] - 0.15);
  near(withSection(hi, verse, 0, {}).bassMovement, BASS_WINDOW[1] - 0.09);
  near(withSection(lo, chorus, 0, {}).drive, DRIVE_WINDOW[0] + 0.2);
  near(withSection(lo, verse, 0, {}).bassMovement, BASS_WINDOW[0] - 0.09);
  // ohne Dichte und Zufallsverschiebung bleibt ein Wert im Fenster gleich, es ist aber immer eine Kopie
  const flat = resolveSection({ type: 'chorus', bars: 8, density: 0 }, {});
  assert.deepEqual(withSection(params, flat, 0, { randomness: 0.5 }), params);
  assert.notEqual(withSection(params, flat, 0, { randomness: 0.5 }), params);
  // Klemmen auf 0 bis 1
  assert.equal(withSection(params, resolveSection({ type: 'chorus', bars: 8, density: 1 }, {}), 0, { randomness: 1 }).drive, 0.75 + 0.25);
  assert.equal(withSection({ ...params, syncopation: 0.95 }, chorus, 0, { randomness: 1 }).syncopation, 1);
  assert.equal(withSection({ ...params, syncopation: 0.05 }, resolveSection({ type: 'break', bars: 4 }, { dynamics: 0.6 }), 0, { randomness: 0 }).syncopation, 0);
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

test('Aufbau rampt auch bei Zufall 0 (die Dichte, nicht die Münze, wählt neue Muster)', () => {
  const parts = [['verse', 8], ['build', 16], ['chorus', 8]];
  const [a, b] = range(parts, 'build');
  const first = [], late = [];
  for (const seed of SEEDS) {
    const ev = buildEvents(mk({ seed, tags: COUNTRY.tags }, parts, { randomness: 0 }));
    first.push(drumHitsPerBar(ev, [a, a + 4]));
    late.push(drumHitsPerBar(ev, [b - 5, b - 1]));
  }
  assert.ok(mean(late) > mean(first) + 1, `${mean(late)} > ${mean(first)}`);
});

test('Dichte in jedem Stil: Refrain > Aufbau > Strophe > Break (Mittel über Seeds)', () => {
  const parts = [['verse', 8], ['build', 16], ['chorus', 8], ['break', 4]];
  for (const style of STYLE_PRESETS) {
    const per = SEEDS.map((seed) => {
      const ev = buildEvents(mk({ seed, tags: style.tags, bpm: style.bpm }, parts));
      return ['verse', 'build', 'chorus', 'break'].map((t) => drumHitsPerBar(ev, range(parts, t)));
    });
    const [verse, build, chorus, brk] = [0, 1, 2, 3].map((k) => mean(per.map((x) => x[k])));
    assert.ok(chorus > build && build > verse && verse > brk, `${style.id}: Refrain ${chorus} > Aufbau ${build} > Strophe ${verse} > Break ${brk}`);
  }
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

// Eigenschaftstest über zufällige Formen (Teillängen 1 bis 64, mehrere Stile und Taktarten, Zufall 0 / 0,5 / 1)
test('Eigenschaften: zufällige Formen halten den Vertrag', () => {
  const LENGTHS = [1, 2, 3, 5, 6, 10, 64];
  const TYPES = ['intro', 'verse', 'build', 'chorus', 'break', 'outro'];
  const STYLES = ['funk', 'rock', 'dreamy', 'country', 'reggae', 'blues', 'psych'].map((id) => STYLE_PRESETS.find((s) => s.id === id));
  const METERS = [[4, 4], [3, 4], [6, 8]];
  const LAYER_SETS = [
    { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
    { drums: false, bass: true, chords: false, pad: true, lead: true, percussion: true },
  ];
  const rng = createRng(2026);
  const EPS = 1e-5;
  for (let n = 0; n < 90; n++) {
    const parts = Array.from({ length: rng.int(2, 8) }, () => ({ type: rng.pick(TYPES), bars: rng.pick(LENGTHS) }));
    if (parts.reduce((x, p) => x + p.bars, 0) > 160) parts.forEach((p) => { if (p.bars === 64) p.bars = 5; }); // schnell genug bleiben
    const style = rng.pick(STYLES), meter = rng.pick(METERS), randomness = rng.pick([0, 0.5, 1]), layers = rng.pick(LAYER_SETS);
    // complexity 0 senkt die Synkopen auf 0: ohne Zufallsstreuung ist das Muster einer Phrase festgelegt
    const track = { ...mk({ seed: n + 1, tags: style.tags, bpm: style.bpm, layers, meter, complexity: 0 }), form: { sections: parts, feel: { randomness } } };
    const ctx = `#${n} ${style.id} ${meter} r${randomness} ${parts.map((p) => p.type + p.bars)}`;
    const ev = buildEvents(track);
    const timeline = chordTimeline(track);
    assert.equal(timeline.length, parts.reduce((x, p) => x + p.bars, 0), ctx);
    const ts = ev.map((e) => e.t);
    assert.deepEqual(ts, [...ts].sort((x, y) => x - y), `${ctx}: sortiert`);
    for (const e of ev) {
      const tb = timeline[e.bar];
      assert.ok(tb, `${ctx}: Takt ${e.bar}`);
      assert.ok(e.t >= tb.time - EPS && e.t < tb.time + tb.durationSec, `${ctx}: t im Takt ${e.bar}`);
      if (e.dur !== undefined) assert.ok(e.t + e.dur <= tb.time + tb.durationSec + EPS, `${ctx}: dur über Taktende`);
      if (e.vel !== undefined) assert.ok(e.vel >= 0.05 && e.vel <= 1, `${ctx}: vel ${e.vel}`);
      if (e.layer) assert.ok(layers[e.layer], `${ctx}: ${e.layer} ist aus`);
    }
    // Marker: genau einer je Teil; fill nur im letzten Takt vor einem Teil mit fill, nie nach dem letzten Teil
    let acc = 0;
    const starts = parts.map((p) => { const s0 = acc; acc += p.bars; return s0; });
    assert.deepEqual(ev.filter((e) => e.name === 'section').map((m) => [m.bar, m.kind, m.index]), parts.map((p, i) => [starts[i], p.type, i]), `${ctx}: section-Marker`);
    const expectFill = parts.flatMap((p, i) => (i > 0 && resolveSection(p, {}).transition === 'fill' ? [starts[i] - 1] : []));
    assert.deepEqual(ev.filter((e) => e.name === 'fill').map((m) => m.bar), expectFill, `${ctx}: fill-Marker`);
    // Bass: ein Ton auf der Eins spielt den Grundton des Akkords dieses Takts (die Folge beginnt in jedem Teil neu)
    for (const e of ev.filter((x) => x.layer === 'bass' && x.beat === 0)) {
      assert.equal(e.midi % 12, noteToPc(timeline[e.bar].chord.root), `${ctx}: Bass-Grundton in Takt ${e.bar}`);
    }
    // Zufall 0 (nur Stile ohne Synkopen-Streuung nach complexity 0: sonst würfeln Zusatzstabs): Teile mit gleichbleibender Dichte spielen in allen Phrasen dasselbe Muster (Takt j und j + 4, ohne den Fill-Takt)
    if (randomness === 0 && ['rock', 'country', 'psych'].includes(style.id)) {
      const sig = (bar, layer) => ev.filter((e) => e.bar === bar && e.layer === layer).map((e) => `${e.name ?? ''}@${e.beat}`).sort().join();
      parts.forEach((p, i) => {
        if (p.type === 'build' || p.type === 'outro') return;
        for (let j = starts[i]; j + 4 < starts[i] + p.bars - 1; j++) {
          for (const layer of ['drums', 'chords']) assert.equal(sig(j + 4, layer), sig(j, layer), `${ctx}: ${layer} Takt ${j} gegen ${j + 4}`);
        }
      });
    }
  }
});

test('Ungültige Form wirft wie ein ungültiger Track', () => {
  for (const form of [{ sections: [{ type: 'verse', bars: 0 }] }, { sections: [{ type: 'zzz', bars: 4 }] }, { sections: [] }]) {
    assert.throws(() => buildEvents(mk({ form })), (e) => e.errors?.some((x) => x.code === 'badForm'));
  }
});
