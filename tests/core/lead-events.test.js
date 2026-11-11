// Lead-Aufgaben (Jobs): Umfang 72 bis 88, einstimmig, im Takt, Töne aus Skala oder Akkord, und was jede Aufgabe spielt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS } from '../../src/index.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { chordTones, scalePcs, chordOptions, CHORD_QUALITIES } from '../../src/core/music.js';
import { GROOVES, METERS } from '../../src/core/grooves.js';
import { LEAD_SCALE } from '../../src/core/lead.js';
import { MODE_NAMES as ALL_MODES } from '../../src/core/music.js';

const JOBS = ['fills', 'arpeggio', 'melody', 'callResponse'];
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const KEY = { root: 'A', mode: 'minor' };
const bar = (root, quality, beats = 4) => ({ chord: { root, quality }, beats });
// 4 Takte A-Moll (mit der Dur-Dominante E), 8 Takte lang, alle Schichten von Anfang an
const make = (job, over = {}) => ({
  key: KEY, bpm: 100, seed: 1, length: 8, bars: [bar('A', 'min'), bar('F', 'maj'), bar('D', 'min'), bar('E', 'maj')],
  tags: { development: ['fullFromStart'] }, jobs: { lead: job }, ...over,
});
// D-Dorisch: Dm G C Em (die Stellen, an denen Skalentöne einen Halbton neben Akkordtönen liegen: F/E, B/C, C/B, F/E)
const DORIAN_BARS = [['D', 'min'], ['G', 'maj'], ['C', 'maj'], ['E', 'min']];
const leadOf = (t) => buildEvents(t).filter((e) => e.layer === 'lead');
const pcsOf = (chord) => chordTones(chord, 0).map((m) => m % 12);

// Prüft die gemeinsamen Regeln und gibt die Lead-Noten und die Takte zurück
function checked(t, label) {
  const track = checkedTrack(t);
  const bars = barTimeline(track);
  const scale = scalePcs(track.key, LEAD_SCALE[track.key.mode]);
  const notes = leadOf(t);
  notes.forEach((e, k) => {
    const b = bars[e.bar];
    assert.equal(e.type, 'note', label);
    assert.ok(Number.isInteger(e.midi) && e.midi >= 72 && e.midi <= 88, `${label}: midi ${e.midi}`);
    assert.ok(e.vel > 0 && e.vel <= 1 && e.dur > 0, `${label}: vel ${e.vel} dur ${e.dur}`);
    assert.ok(e.t >= b.start - 1e-9 && e.t < b.end, `${label}: t ${e.t} außerhalb von Takt ${e.bar}`);
    const next = notes[k + 1];
    // 1e-6: Zeiten und Dauern sind auf 6 Stellen gerundet, die letzte Note endet am gerundeten Taktende
    assert.ok(e.t + e.dur <= (next ? next.t : b.end) + 1e-6, `${label}: Takt ${e.bar} nicht einstimmig`);
    const pc = e.midi % 12;
    assert.ok(scale.includes(pc) || pcsOf(b.chord).includes(pc), `${label}: ${e.midi} weder in der Skala noch im Akkord ${b.chord.root}${b.chord.quality}`);
  });
  return { notes, bars };
}
const byBar = (notes) => {
  const map = new Map();
  for (const e of notes) map.set(e.bar, [...(map.get(e.bar) ?? []), e]);
  return map;
};

test('off: keine Lead-Ereignisse, die anderen Schichten bleiben gleich, wenn der Lead spielt', () => {
  assert.equal(leadOf(make('off')).length, 0);
  const others = (job) => buildEvents(make(job)).filter((e) => e.layer !== 'lead');
  for (const job of JOBS) assert.deepEqual(others(job), others('off'), job);
});

test('jede Aufgabe spielt auf 8 Takten, gleicher Track und Seed ergibt dasselbe, melody hängt vom Seed ab', () => {
  for (const job of JOBS) {
    assert.ok(leadOf(make(job)).length > 0, job);
    assert.deepEqual(leadOf(make(job, { seed: 5 })), leadOf(make(job, { seed: 5 })), job);
  }
  const midis = (seed) => leadOf(make('melody', { seed })).map((e) => e.midi);
  assert.ok(SEEDS.slice(1).some((s) => JSON.stringify(midis(s)) !== JSON.stringify(midis(1))));
});

test('alle Aufgaben, Seeds 1 bis 20: Umfang, im Takt, einstimmig, Töne aus Skala oder Akkord', () => {
  for (const job of JOBS) for (const seed of SEEDS) checked(make(job, { seed }), `${job} s=${seed}`);
});

test('fills: nur in den letzten zwei Schlägen eines Takts und nicht in jedem Takt', () => {
  for (const seed of SEEDS) {
    const { notes, bars } = checked(make('fills', { seed }), `s=${seed}`);
    for (const e of notes) assert.ok(e.beat >= bars[e.bar].beats - 2 - 1e-9, `s=${seed}: beat ${e.beat}`);
    assert.ok(byBar(notes).size < bars.length, `s=${seed}: Fill in jedem Takt`);
    for (const list of byBar(notes).values()) assert.ok(list.length >= 2 && list.length <= 5, `s=${seed}: ${list.length} Noten`);
  }
});

test('fills: nur in der zweiten Hälfte der Takte eines Abschnitts (Abschnitte à 8 Takte, der letzte kürzer)', () => {
  let count = 0;
  for (const length of [20, 24]) {
    for (const seed of SEEDS) {
      const { notes } = checked(make('fills', { seed, length }), `len=${length} s=${seed}`);
      count += notes.length;
      for (const e of notes) {
        const start = Math.floor(e.bar / 8) * 8;
        const bars = Math.min(8, length - start);
        assert.ok(e.bar - start >= bars / 2, `len=${length} s=${seed}: Fill in Takt ${e.bar} (Abschnitt ab ${start}, ${bars} Takte)`);
      }
    }
  }
  assert.ok(count > 0, 'es gibt Fills');
});

test('fills: kein Ton wiederholt sich innerhalb einer Phrase (Stile, Seeds, Moll, Dur, Dorisch)', () => {
  let phrases = 0;
  for (const preset of STYLE_PRESETS) {
    for (const [key, chords] of [[KEY, [['A', 'min'], ['F', 'maj'], ['D', 'min'], ['E', 'maj']]], [{ root: 'C', mode: 'major' }, [['C', 'maj'], ['A', 'min'], ['F', 'maj'], ['G', 'maj']]], [{ root: 'D', mode: 'dorian' }, DORIAN_BARS]]) {
      for (const seed of SEEDS) {
        const { notes } = checked(make('fills', { key, seed, length: 24, tags: preset.tags, bpm: preset.bpm, bars: chords.map(([r, q]) => bar(r, q)) }), `${preset.id} ${key.mode} s=${seed}`);
        for (const list of byBar(notes).values()) {
          phrases++;
          list.slice(1).forEach((e, k) => assert.notEqual(e.midi, list[k].midi, `${preset.id} ${key.mode} s=${seed}: Takt ${e.bar} wiederholt ${e.midi}`));
        }
      }
    }
  }
  assert.ok(phrases > 0);
});

test('Dorisch: ein Ton, der kein Akkordton ist, liegt nie einen Halbton neben einem Akkordton; jede Aufgabe spielt', () => {
  for (const root of ['D', 'A', 'E']) {
    const key = { root, mode: 'dorian' };
    const options = chordOptions(key);
    const bars = [0, 3, 6, 1, 4].map((i) => bar(options[i].root, options[i].qualities[0]));
    for (const job of JOBS) {
      let count = 0;
      for (const seed of SEEDS) {
        const { notes, bars: timeline } = checked(make(job, { key, seed, length: 16, bars }), `${root} ${job} s=${seed}`);
        count += notes.length;
        for (const e of notes) {
          const chord = pcsOf(timeline[e.bar].chord);
          const pc = e.midi % 12;
          if (chord.includes(pc)) continue;
          assert.ok(chord.every((c) => (pc - c + 12) % 12 !== 1 && (c - pc + 12) % 12 !== 1), `${root} ${job} s=${seed}: ${e.midi} reibt an ${timeline[e.bar].chord.root}${timeline[e.bar].chord.quality}`);
        }
      }
      assert.ok(count > 0, `${root} ${job}: spielt`);
    }
  }
});

test('arpeggio: auf dem arpStep-Raster des Grooves', () => {
  for (const id of ['straight', 'ballad68', 'slowBlues']) {
    const g = GROOVES[id];
    const { beats, sub } = METERS[g.meter];
    const t = make('arpeggio', { meter: g.meter.split('/').map(Number), groove: id, bars: [bar('A', 'min', beats), bar('E', 'maj', beats)] });
    for (const seed of SEEDS.slice(0, 5)) {
      const { notes } = checked({ ...t, seed }, `${id} s=${seed}`);
      assert.ok(notes.length > 0, id);
      for (const e of notes) {
        const step = Math.round(e.beat * sub);
        assert.ok(Math.abs(e.beat * sub - step) < 1e-9 && step % g.chords.arpStep === 0, `${id}: beat ${e.beat}`);
      }
    }
  }
});

test('melody: höchstens 2 Noten je Takt, die erste ein Akkordton auf Schlag 0', () => {
  for (const seed of SEEDS) {
    const { notes, bars } = checked(make('melody', { seed }), `s=${seed}`);
    const map = byBar(notes);
    assert.equal(map.size, bars.length, `s=${seed}: jeder Takt hat eine Melodienote`);
    for (const [i, list] of map) {
      assert.ok(list.length <= 2, `s=${seed}: Takt ${i} hat ${list.length} Noten`);
      assert.equal(list[0].beat, 0, `s=${seed}: Takt ${i}`);
      assert.ok(pcsOf(bars[i].chord).includes(list[0].midi % 12), `s=${seed}: Takt ${i} beginnt nicht auf einem Akkordton`);
    }
  }
});

test('callResponse: Ruf in geraden Takten, Antwort im ungeraden Takt mit demselben Rhythmus, endet auf einem Akkordton', () => {
  for (const seed of SEEDS) {
    const { notes, bars } = checked(make('callResponse', { seed }), `s=${seed}`);
    const map = byBar(notes);
    for (let i = 0; i < bars.length; i += 2) {
      const call = map.get(i);
      const answer = map.get(i + 1);
      assert.ok(call?.length > 0 && answer?.length > 0, `s=${seed}: Takte ${i}/${i + 1}`);
      assert.deepEqual(answer.map((e) => e.beat), call.map((e) => e.beat), `s=${seed}: Rhythmus ${i}/${i + 1}`);
      assert.ok(pcsOf(bars[i + 1].chord).includes(answer.at(-1).midi % 12), `s=${seed}: Antwort ${i + 1} endet nicht auf einem Akkordton`);
    }
  }
});

test('alle Grooves und Taktarten (4/4, 3/4, 5/4, 6/8, 12/8): Regeln halten, nichts wirft', () => {
  for (const id of Object.keys(GROOVES)) {
    const g = GROOVES[id];
    const { beats } = METERS[g.meter];
    for (const job of JOBS) {
      for (const seed of SEEDS.slice(0, 5)) {
        for (const complexity of [0, 1]) {
          // 16 Takte: der erste Abschnitt endet mit einem Fill-Takt, darum spielt auch `fills` sicher
          const t = make(job, { seed, complexity, length: 16, meter: g.meter.split('/').map(Number), groove: id, bars: [bar('A', 'min', beats), bar('D', 'min', beats), bar('E', 'maj', beats)], tags: { development: ['fullFromStart'], rhythm: ['swing'] } });
          assert.ok(checked(t, `${id} ${job} s=${seed} c=${complexity}`).notes.length > 0, `${id} ${job}: spielt`);
        }
      }
    }
  }
});

test('jede Akkordart in Moll, Dur und Dorisch, Takte mit 1 bis 7 Schlägen und ein Track mit einem Takt', () => {
  for (const key of [KEY, { root: 'C', mode: 'major' }, { root: 'D', mode: 'dorian' }]) {
    const options = chordOptions(key);
    for (const quality of Object.keys(CHORD_QUALITIES)) {
      const root = options.find((o) => o.qualities.includes(quality)).root;
      for (const job of JOBS) {
        for (const seed of [1, 2, 3]) checked(make(job, { key, seed, length: 4, bars: [bar(root, quality), bar(options[0].root, options[0].qualities[0])] }), `${key.mode} ${root}${quality} ${job}`);
      }
    }
  }
  for (const job of JOBS) {
    for (const seed of SEEDS.slice(0, 5)) {
      checked(make(job, { seed, bars: [1, 2, 3, 5, 7].map((beats) => bar('A', 'min', beats)), length: 10 }), `${job} Schläge 1..7`);
      checked(make(job, { seed, bars: [bar('A', 'min')], length: 1 }), `${job} ein Takt`);
    }
  }
});

test('LEAD_SCALE hat für jede Tonart-Art einen Eintrag', () => {
  assert.deepEqual(Object.keys(LEAD_SCALE).sort(), [...ALL_MODES].sort());
});
