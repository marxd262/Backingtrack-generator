// Alle Akkordarten des Registers in den Mustern: Bass-Quinte und -Septime, Arpeggio-Vorrat, Stabs und Pad bleiben gültig und endlich.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, arpPool } from '../../src/core/events.js';
import { validateTrack } from '../../src/core/track.js';
import { CHORDS } from '../../src/core/chords.js';
import { chordTones, chordOptions } from '../../src/core/music.js';
import { STYLE_PRESETS } from '../../src/core/tags.js';

const MODES = ['minor', 'major', 'dorian'];
const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const aMinor = { root: 'A', mode: 'minor' };
const bars = (chords) => chords.map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
const preset = (id) => STYLE_PRESETS.find((p) => p.id === id);
const track = (over = {}) => ({ key: aMinor, bpm: 100, seed: 1, length: 8, tags: { development: ['fullFromStart'] }, ...over });
const pcsOf = (events, pick) => new Set(events.filter(pick).map((e) => e.midi % 12));

// Gültigkeit aller Ereignisse: sortiert, endlich, Töne im Bereich
function assertValid(events, label) {
  let last = -Infinity;
  for (const e of events) {
    assert.ok(Number.isFinite(e.t) && e.t >= last, `${label}: Reihenfolge ${e.t}`);
    last = e.t;
    if (e.type === 'hit' || e.type === 'note') assert.ok(e.vel > 0 && e.vel <= 1, `${label}: vel ${e.vel}`);
    if (e.type === 'note') {
      assert.ok(Number.isInteger(e.midi), `${label}: midi ${e.midi}`);
      assert.ok(Number.isFinite(e.dur) && e.dur > 0, `${label}: dur ${e.dur}`);
      if (e.layer === 'bass') assert.ok(e.midi >= 28 && e.midi <= 52, `${label}: Bass ${e.midi}`);
      else assert.ok(e.midi >= 24 && e.midi <= 100, `${label}: ${e.layer} ${e.midi}`);
    }
  }
}

test('arpPool: Dreiklänge bitgleich wie die bisherige Rechnung, sonst zyklisch über die Akkordtöne', () => {
  for (const q of ['maj', 'min', 'dim']) {
    const tones = chordTones({ root: 'A', quality: q }, 3);
    assert.deepEqual(arpPool(tones), [...tones, tones[0] + 12].map((m) => m + 12), q);
  }
  const power = chordTones({ root: 'A', quality: 'power' }, 3); // [57, 64]
  assert.deepEqual(arpPool(power), [69, 76, 81, 88]);
  const seventh = chordTones({ root: 'A', quality: 'dom7' }, 3); // [57, 61, 64, 67]
  assert.deepEqual(arpPool(seventh), [69, 73, 76, 79]);
  const ninth = chordTones({ root: 'C', quality: 'dom9' }, 3);
  assert.equal(arpPool(ninth).length, 4);
  for (const m of arpPool(ninth)) assert.ok(Number.isFinite(m));
});

test('Powerchords und 5-Ton-Akkorde: in allen Stilen, mit und ohne Arpeggio und variety, sind alle Ereignisse gültig', () => {
  const sets = [
    [['A', 'power'], ['D', 'power'], ['E', 'power'], ['A', 'power']],
    [['A', 'min9'], ['D', 'min9'], ['E', 'dom9'], ['C', 'add9']],
  ];
  for (const { id, tags } of STYLE_PRESETS) {
    for (const arp of [false, true]) {
      for (const variety of [false, true]) {
        for (const chords of sets) {
          for (let seed = 0; seed < 8; seed++) {
            const t = track({ seed, variety, bpm: preset(id).bpm, bars: bars(chords), tags: { ...tags, development: ['fullFromStart'], ...(arp ? { synths: [...(tags.synths ?? []), 'arpeggio'] } : {}) } });
            assert.deepEqual(validateTrack(t), []);
            assertValid(buildEvents(t), `${id} arp=${arp} variety=${variety} seed=${seed}`);
          }
        }
      }
    }
  }
});

// Mit 'bouncy' und variety enthält das Bassmuster der Stufe 2 den Septim-Schritt (b7); ein Takt, danach ein anderer Grundton, damit der
// chromatische Anlauf (ap) nie mit der Septime zusammenfällt
function bassPcs(key, first, second, seeds = 160) {
  const pcs = new Set();
  for (let seed = 0; seed < seeds; seed++) {
    const events = buildEvents(track({ key, seed, variety: true, tags: { bass: ['bouncy'], development: ['fullFromStart'] }, bars: bars([first, second, first, second]) }));
    for (const pc of pcsOf(events, (e) => e.layer === 'bass' && e.bar === 0)) pcs.add(pc);
  }
  return pcs;
}
const C = { root: 'C', mode: 'major' };

test('Bass: Septime kommt aus dem Akkord (maj7 elf Halbtöne, 7 zehn, dim7 neun), ohne eigene Septime bleibt es die kleine', () => {
  const maj7 = bassPcs(C, ['C', 'maj7'], ['F', 'maj']);
  assert.ok(maj7.has(11), 'Cmaj7: große Septime');
  assert.ok(!maj7.has(10), 'Cmaj7: nie die kleine');
  const dom7 = bassPcs(C, ['C', 'maj'], ['F', 'maj']); // zum Vergleich ein Dreiklang: kleine Septime bleibt
  assert.ok(dom7.has(10), 'Dreiklang: kleine Septime wie bisher');
  const seventh = bassPcs(C, ['G', 'dom7'], ['C', 'maj']); // G7: Septime F = 5
  assert.ok(seventh.has(5), 'G7: kleine Septime');
  const dim7 = bassPcs(C, ['B', 'dim7'], ['C', 'maj']); // Bdim7: Septime A = 9... Grundton B (11) + 9 = 8 (G#)
  assert.ok(dim7.has(8), 'Bdim7: verminderte Septime (G#)');
  assert.ok(!dim7.has(9), 'Bdim7: nie die kleine Septime (A)');
});

test('Bass: bei Sext-Akkorden spielt der b7-Grad die Sexte, die kleine Septime stieße an', () => {
  const maj6 = bassPcs(C, ['C', 'maj6'], ['F', 'maj']);
  assert.ok(maj6.has(9) && !maj6.has(10), 'C6: Sexte A statt Bb');
  const min6 = bassPcs(C, ['D', 'min6'], ['G', 'maj']);
  assert.ok(min6.has(11) && !min6.has(0), 'Dm6: Sexte H statt C');
});

test('Bass: Quinte aus dem Akkord (aug acht, power sieben, dim sechs Halbtöne)', () => {
  const aug = bassPcs(C, ['C', 'aug'], ['F', 'maj']);
  assert.ok(aug.has(8) && !aug.has(7), 'Caug: übermäßige Quinte (G#), nie die reine');
  const power = bassPcs(C, ['C', 'power'], ['F', 'maj']);
  assert.ok(power.has(7), 'C5: reine Quinte');
  const dim = bassPcs(C, ['B', 'dim'], ['C', 'maj']);
  assert.ok(dim.has(5) && !dim.has(6), 'Bdim: verminderte Quinte (F), wie bisher');
});

test('Alle 17 Akkordarten: auf jeder Stufe, in jeder Tonart und jedem Modus, in drei Stilen, mit und ohne variety gültig', () => {
  for (const quality of Object.keys(CHORDS)) {
    for (const mode of MODES) {
      for (const root of ROOTS) {
        const key = { root, mode };
        const roots = chordOptions(key).filter((o) => o.qualities.includes(quality)).map((o) => o.root).slice(0, 4);
        assert.ok(roots.length > 0, `${quality} in ${root} ${mode}`);
        const chords = roots.map((r) => [r, quality]);
        for (const id of ['funk', 'hardrock', 'dreamy']) {
          for (const variety of [false, true]) {
            const t = track({ key, variety, bpm: preset(id).bpm, bars: bars(chords), tags: { ...preset(id).tags, development: ['fullFromStart'] } });
            assert.deepEqual(validateTrack(t), [], `${quality} in ${root} ${mode}`);
            assertValid(buildEvents(t), `${quality} ${root} ${mode} ${id} variety=${variety}`);
          }
        }
      }
    }
  }
});
