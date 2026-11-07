import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, DRUM_NAMES } from '../../src/core/events.js';
import { chordMidi, noteToPc } from '../../src/core/music.js';
import { STYLE_PRESETS, resolveTags } from '../../src/core/tags.js';
import { createRng } from '../../src/core/rng.js';

const chordBar = (root, quality, beats = 4) => ({ chord: { root, quality }, beats });
const BASE = {
  key: { root: 'A', mode: 'minor' },
  bpm: 100,
  bars: [chordBar('A', 'min'), chordBar('A', 'min'), chordBar('D', 'min'), chordBar('E', 'maj')],
  seed: 1,
};
const LAYERS = ['drums', 'bass', 'chords', 'pad'];
const PRESET_IDS = ['funk', 'psych', 'dreamy'];

const make = (over = {}) => buildEvents({ ...BASE, ...over });
const presetTags = (id) => STYLE_PRESETS.find((p) => p.id === id).tags;
const withPreset = (id, over = {}) =>
  make({ tags: presetTags(id), bpm: STYLE_PRESETS.find((p) => p.id === id).bpm, ...over });
const ofType = (events, type) => events.filter((e) => e.type === type);
const sounding = (events) => events.filter((e) => e.type === 'hit' || e.type === 'note');
const ofLayer = (events, layer) => sounding(events).filter((e) => e.layer === layer);
// Muster-Identität ohne Zeit und Lautstärke, damit Jitter allein keinen Unterschied erzeugt
const drumPattern = (events) => ofType(events, 'hit').map((e) => `${e.bar}:${e.beat}:${e.name}`);
const isGhost = (e) => e.name === 'snare' && e.vel < 0.3;

// [Start, Ende) jedes Takts aus den chord-Ereignissen; Ende des letzten Takts aus seiner Länge
function barBounds(events, bpm, beats) {
  const starts = ofType(events, 'chord').map((c) => c.t);
  return starts.map((s, i) => [s, starts[i + 1] ?? s + (beats * 60) / bpm]);
}

test('ein chord-Ereignis je Takt, Takt 0 bei t 0, Takt 1 bei genau 2.4, Folge läuft im Kreis', () => {
  const chords = ofType(make(), 'chord');
  assert.equal(chords.length, 24);
  assert.deepEqual(chords.map((c) => c.bar), [...Array(24).keys()]);
  assert.equal(chords[0].t, 0);
  assert.equal(chords[1].t, 2.4);
  assert.ok(chords.every((c) => c.beat === 0));
  assert.deepEqual(chords[2].chord, { root: 'D', quality: 'min' });
  assert.deepEqual(chords[7].chord, { root: 'E', quality: 'maj' });
});

test('Strom ist nach t sortiert, bei gleichem t zuerst chord, dann marker', () => {
  const rank = (e) => (e.type === 'chord' ? 0 : e.type === 'marker' ? 1 : 2);
  const events = make();
  for (let i = 1; i < events.length; i++) {
    const [a, b] = [events[i - 1], events[i]];
    assert.ok(a.t < b.t || (a.t === b.t && rank(a) <= rank(b)), `Reihenfolge bei Index ${i}`);
  }
});

test('gleicher Seed ergibt gleichen Strom, Seed 2 einen anderen', () => {
  assert.deepEqual(make(), make());
  assert.notDeepEqual(make({ seed: 2 }), make());
});

test('Seed 0, 2**32+5 und fehlender Seed werfen nicht; 2**32+5 wirkt wie 5, fehlend wie 1', () => {
  assert.doesNotThrow(() => make({ seed: 0 }));
  assert.deepEqual(make({ seed: 2 ** 32 + 5 }), make({ seed: 5 }));
  const { seed, ...noSeed } = BASE;
  assert.deepEqual(buildEvents(noSeed), make({ seed: 1 }));
});

test('gleiche Schlagworte, Seed 1 und 2 ergeben unterschiedliche Drum-Muster', () => {
  const tags = presetTags('funk');
  assert.notDeepEqual(drumPattern(make({ tags, seed: 1 })), drumPattern(make({ tags, seed: 2 })));
});

test('zwei Presets ergeben unterschiedliche Ströme', () => {
  assert.notDeepEqual(drumPattern(withPreset('funk')), drumPattern(withPreset('dreamy')));
  assert.notDeepEqual(withPreset('funk'), withPreset('psych'));
});

test('layers.drums:false ergibt keine hit-Ereignisse, die anderen Schichten bleiben gleich', () => {
  const events = make({ layers: { drums: false } });
  assert.equal(ofType(events, 'hit').length, 0);
  assert.deepEqual(ofLayer(events, 'bass'), ofLayer(make(), 'bass'));
});

test('alle vier Schichten aus ergibt nur chord und marker', () => {
  const events = make({ layers: { drums: false, bass: false, chords: false, pad: false } });
  assert.deepEqual([...new Set(events.map((e) => e.type))], ['chord', 'marker']);
});

test('fill-Marker nur am Start des letzten Takts jedes Abschnitts außer dem letzten', () => {
  const events = make();
  const markers = ofType(events, 'marker');
  assert.deepEqual(markers.map((m) => [m.bar, m.name]), [[7, 'fill'], [15, 'fill']]);
  const chordT = new Map(ofType(events, 'chord').map((c) => [c.bar, c.t]));
  for (const m of markers) assert.equal(m.t, chordT.get(m.bar));
  assert.deepEqual(ofType(make({ length: 12 }), 'marker').map((m) => m.bar), [7]);
});

test('Toms gibt es nur in den letzten 2 Zählzeiten eines Fill-Takts', () => {
  const toms = ofType(make(), 'hit').filter((e) => e.name.startsWith('tom'));
  assert.ok(toms.length > 0);
  for (const e of toms) assert.ok([7, 15].includes(e.bar) && e.beat >= 2, `${e.bar}:${e.beat}`);
});

test('alle note/hit-Zeiten liegen in ihrem Takt, auch bei bpm 40, bpm 240 und beats 3', () => {
  const variants = [{}, { bpm: 40 }, { bpm: 240 }, { bars: BASE.bars.map((b) => ({ ...b, beats: 3 })) }];
  for (const tags of [{}, presetTags('funk')]) {
    for (const over of variants) {
      const events = make({ tags, ...over });
      const beats = over.bars ? 3 : 4;
      const bounds = barBounds(events, over.bpm ?? 100, beats);
      for (const e of sounding(events)) {
        const [start, end] = bounds[e.bar];
        assert.ok(e.t >= start && e.t < end, `${JSON.stringify(over)} ${JSON.stringify(e)}`);
        assert.ok(e.beat >= 0 && e.beat < beats);
      }
    }
  }
});

test('Humanisierung ohne Swing: höchstens 0,02 s vom Raster aus bar und beat', () => {
  for (const bpm of [40, 100, 240]) {
    const events = make({ bpm });
    const chordT = ofType(events, 'chord').map((c) => c.t);
    for (const e of sounding(events)) {
      const grid = chordT[e.bar] + (e.beat * 60) / bpm;
      assert.ok(Math.abs(e.t - grid) <= 0.02, JSON.stringify(e));
    }
  }
});

test('Humanisierung mit Swing: höchstens 0,02 s vom geswingten Raster', () => {
  for (const tags of [presetTags('funk'), { rhythm: ['swing'] }]) {
    const { swing } = resolveTags(tags, createRng(1));
    assert.ok(swing > 0);
    for (const bpm of [40, 100, 240]) {
      const events = make({ tags, bpm });
      const chordT = ofType(events, 'chord').map((c) => c.t);
      const stepSec = 60 / bpm / 4;
      for (const e of sounding(events)) {
        const step = e.beat * 4;
        const grid = chordT[e.bar] + step * stepSec + (step % 2 === 1 ? (swing * stepSec) / 3 : 0);
        assert.ok(Math.abs(e.t - grid) <= 0.02, `${bpm} ${JSON.stringify(e)}`);
      }
    }
  }
});

test('Fill-Bereich hat mehr Schläge als derselbe Bereich im Takt davor, für jede drive-Stufe', () => {
  const tagSets = { low: presetTags('dreamy'), mid: {}, high: { drums: ['driving'] } };
  for (const id of PRESET_IDS) tagSets[id] = presetTags(id);
  for (const [name, tags] of Object.entries(tagSets)) {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = make({ tags, seed });
      const hitsFrom2 = (bar) => ofType(events, 'hit').filter((e) => e.bar === bar && e.beat >= 2).length;
      for (const m of ofType(events, 'marker')) {
        const [fill, before] = [hitsFrom2(m.bar), hitsFrom2(m.bar - 1)];
        if (fill === 0 && before === 0) continue; // Schlagzeug in diesem Abschnitt aus
        assert.ok(fill > before, `${name} Seed ${seed} Takt ${m.bar}: ${fill} <= ${before}`);
        checked++;
      }
    }
    assert.ok(checked > 0, name);
  }
});

test('Bass ist einstimmig: keine Note klingt in die nächste hinein, auch mit Swing', () => {
  for (const id of PRESET_IDS) {
    for (const bpm of [60, 240]) {
      const bass = ofLayer(make({ tags: presetTags(id), bpm }), 'bass');
      for (let i = 1; i < bass.length; i++) {
        const [a, b] = [bass[i - 1], bass[i]];
        assert.ok(a.dur > 0 && a.t + a.dur <= b.t + 1e-9, `${id} ${bpm}: ${JSON.stringify(a)} -> ${b.t}`);
      }
    }
  }
});

test('Swing verschiebt die Off-Sechzehntel nach hinten', () => {
  const events = make({ tags: { drums: ['driving'], rhythm: ['swing'] } });
  const chordT = ofType(events, 'chord').map((c) => c.t);
  const meanShift = (odd) => {
    const hits = ofType(events, 'hit').filter((e) => ((e.beat * 4) % 2 === 1) === odd);
    return hits.reduce((sum, e) => sum + e.t - (chordT[e.bar] + e.beat * 0.6), 0) / hits.length;
  };
  assert.ok(meanShift(true) > 0.015, `ungerade ${meanShift(true)}`);
  assert.ok(Math.abs(meanShift(false)) < 0.003, `gerade ${meanShift(false)}`);
});

test('vel liegt immer in (0,1], Drum-Namen aus DRUM_NAMES, Funk hat Geisternoten', () => {
  for (const events of [make(), ...PRESET_IDS.map((id) => withPreset(id))]) {
    for (const e of sounding(events)) assert.ok(e.vel > 0 && e.vel <= 1, JSON.stringify(e));
    for (const e of ofType(events, 'hit')) assert.ok(DRUM_NAMES.includes(e.name), e.name);
  }
  assert.ok(ofType(withPreset('funk'), 'hit').some(isGhost));
});

test('Bass trifft in jedem Takt auf Zählzeit 1 den Grundton und bleibt in MIDI 28..52', () => {
  for (const id of PRESET_IDS) {
    const events = withPreset(id);
    const chords = ofType(events, 'chord');
    const bass = ofLayer(events, 'bass');
    for (const c of chords) {
      const first = bass.find((n) => n.bar === c.bar && n.beat === 0);
      assert.ok(first, `${id}: Takt ${c.bar} ohne Bass auf 1`);
      assert.equal(first.midi % 12, noteToPc(c.chord.root), `${id}: Takt ${c.bar}`);
    }
    for (const n of bass) assert.ok(n.midi >= 28 && n.midi <= 52, `${id}: ${n.midi}`);
  }
});

test('bewegter Bass: Quinte über dim-Akkord ist ein Tritonus, über Moll eine reine Quinte', () => {
  const bars = [chordBar('A', 'min'), chordBar('B', 'dim'), chordBar('E', 'maj'), chordBar('A', 'min')];
  const events = make({ bars, tags: { bass: ['bouncy'] } });
  const intervals = (root) => {
    const bass = ofLayer(events, 'bass').filter((n) => bars[n.bar % 4].chord.root === root);
    return new Set(bass.map((n) => (n.midi - noteToPc(root) + 120) % 12));
  };
  assert.ok(intervals('B').has(6));
  assert.ok(!intervals('B').has(7));
  assert.ok(intervals('A').has(7));
});

test('wenig drive (Halbzeit): Snare nur auf Zählzeit 3, mittlerer drive: auf 2 und 4', () => {
  const backbeats = (events) => {
    const fills = new Set(ofType(events, 'marker').map((m) => m.bar));
    const snares = ofType(events, 'hit').filter((e) => e.name === 'snare' && !isGhost(e) && !fills.has(e.bar));
    return [...new Set(snares.map((e) => e.beat))].sort();
  };
  assert.deepEqual(backbeats(withPreset('dreamy')), [2]);
  assert.deepEqual(backbeats(make()), [1, 3]);
});

test('Pad: je Akkordton eine Note über den ganzen Takt, bei breitem Pad zusätzlich eine Oktave höher', () => {
  const padIn = (events, bar) => ofLayer(events, 'pad').filter((n) => n.bar === bar);
  const narrow = padIn(make(), 16);
  assert.deepEqual(narrow.map((n) => n.midi).sort((a, b) => a - b), chordMidi({ root: 'A', quality: 'min' }, 3));
  for (const n of narrow) assert.deepEqual([n.t, n.beat, n.dur], [16 * 2.4, 0, 2.4]);
  const wide = padIn(make({ tags: { synths: ['widePad', 'shimmering'] } }), 16).map((n) => n.midi);
  assert.deepEqual(wide.sort((a, b) => a - b), [57, 60, 64, 69, 72, 76]);
});

test('Akkord-Schicht: Stabs spielen alle Akkordtöne gleichzeitig, Arpeggio einzelne Achtel', () => {
  const stabs = ofLayer(make(), 'chords');
  const byT = Map.groupBy(stabs, (n) => n.t);
  for (const group of byT.values()) assert.equal(group.length, 3);

  const arp = ofLayer(make({ tags: { synths: ['arpeggio'] } }), 'chords');
  assert.ok(arp.length > 0);
  const slots = new Set(arp.map((n) => `${n.bar}:${n.beat}`));
  assert.equal(slots.size, arp.length);
  for (const n of arp) assert.equal((n.beat * 2) % 1, 0);
});

test('jedes Preset ergibt einen Strom mit allen vier Schichten im letzten Abschnitt', () => {
  for (const id of PRESET_IDS) {
    const events = withPreset(id);
    assert.ok(sounding(events).length > 0);
    const last = sounding(events).filter((e) => e.bar >= 16);
    assert.deepEqual(new Set(last.map((e) => e.layer)), new Set(LAYERS), id);
  }
});

test('ungültiger Track wirft Error mit den Codes in errors', () => {
  assert.throws(
    () => make({ bpm: 5, length: 0 }),
    (err) => {
      assert.equal(err.message, 'Invalid track: badBpm, badLength');
      assert.deepEqual(err.errors.map((e) => e.code), ['badBpm', 'badLength']);
      return true;
    },
  );
});
