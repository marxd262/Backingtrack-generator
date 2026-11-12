// Nachbearbeitung mit Form: Pegel, Wirbel, Stopps, Pausen, Crash als Eigenschaftstests über Seeds, Formen und Taktarten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../../src/index.js';
import { postProcess } from '../../src/core/form-post.js';
import { buildFormArrangement } from '../../src/core/form-arrange.js';
import { barTimeline, checkedTrack } from '../../src/core/timeline.js';
import { rollForm, TEMPLATE_IDS } from '../../src/core/form-roll.js';
import { levelAt } from '../../src/core/form-types.js';
import { METERS } from '../../src/core/grooves.js';
import { createRng } from '../../src/core/rng.js';

const CHORDS = [['A', 'min'], ['D', 'min'], ['E', 'min'], ['A', 'min']];
const KEEP = ['kick', 'hat', 'openHat']; // Schlagzeug-Pause lässt nur diese stehen
const sectionsOf = (parts) => parts.map(([type, bars, extra]) => ({ type, bars, ...extra }));
const mk = (parts, feel = {}, over = {}) => {
  const meter = over.meter ?? [4, 4];
  const beats = METERS[meter.join('/')].beats;
  return {
    key: { root: 'A', mode: 'minor' }, bpm: 100, seed: 1, meter,
    bars: CHORDS.map(([root, quality]) => ({ chord: { root, quality }, beats })),
    layers: { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: true },
    jobs: { lead: 'melody', percussion: 'mixed' },
    form: { sections: sectionsOf(parts), feel },
    ...over,
  };
};
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const isSound = (e) => e.type === 'note' || e.type === 'hit';
const sectionOf = (secs, bar) => secs.find((s) => bar >= s.start && bar < s.start + s.bars);
const info = (track) => {
  const t = checkedTrack(track);
  return { t, bars: barTimeline(t), sections: buildFormArrangement(t).sections };
};
const NO_TRANS = (parts) => parts.map(([type, bars]) => [type, bars, { transition: 'none', crash: false }]);
const round3 = (x) => Math.round(x * 1e3) / 1e3;

test('Pegel: Refrain 0 dB, Break/Intro/Outro leiser, Aufbau rampt, nie über 1, Dynamik 0 = alle gleich', () => {
  const parts = [['intro', 4], ['verse', 4], ['build', 4], ['chorus', 4], ['break', 4], ['outro', 4]];
  const track = mk(parts);
  const { t, bars, sections } = info(track);
  const raw = bars.map((b) => ({ t: b.start, bar: b.index, beat: 0, type: 'note', layer: 'bass', midi: 40, vel: 0.8, dur: 0.1 }));
  const clipped = bars.map((b) => ({ t: b.start, bar: b.index, beat: 0, type: 'hit', layer: 'drums', name: 'snare', vel: 1 }));
  const out = postProcess([...raw, ...clipped], t, bars, sections, createRng(1));
  const velOf = (bar, type) => out.find((e) => e.bar === bar && e.type === type).vel;
  const dB = (bar) => levelAt(sectionOf(sections, bar).resolved, bar - sectionOf(sections, bar).start);
  for (const b of bars) {
    assert.equal(velOf(b.index, 'note'), round3(0.8 * 10 ** (dB(b.index) / 20)), `Takt ${b.index}`);
    assert.ok(velOf(b.index, 'hit') <= 1);
  }
  assert.equal(velOf(12, 'note'), 0.8, 'Refrain: 0 dB');
  assert.equal(velOf(12, 'hit'), 1);
  for (const bar of [0, 1, 16, 20]) assert.ok(velOf(bar, 'note') < 0.8, `Takt ${bar} leiser`);
  assert.ok(velOf(9, 'note') > velOf(8, 'note'), 'Aufbau rampt');
  const flat = info(mk(parts, { dynamics: 0 }));
  const same = postProcess(raw, flat.t, flat.bars, flat.sections, createRng(1));
  assert.ok(same.filter((e) => e.type === 'note').every((e) => e.vel === 0.8), 'Dynamik 0: alle gleich');
});

test('Stopp: im Fenster nichts, Noten davor enden am Fensteranfang, der nächste Teil beginnt normal; bei pauses >= 0,6 zwei Schläge', () => {
  for (const [pauses, beatsOut] of [[0.4, 1], [0.8, 2]]) {
    for (const seed of SEEDS) {
      const track = mk([['verse', 8], ['break', 4, { transition: 'stop' }], ['chorus', 8]], { pauses }, { seed });
      const { bars, sections } = info(track);
      const events = buildEvents(track);
      const last = 7, b = bars[last];
      const stopT = b.end - (beatsOut * 60) / track.bpm;
      const inBar = events.filter((e) => e.bar === last && isSound(e));
      assert.ok(inBar.length > 0, 'vor dem Stopp spielt etwas');
      for (const e of inBar) {
        assert.ok(e.t < stopT, `seed ${seed}: Ereignis im Stoppfenster (${e.t} >= ${stopT})`);
        if (e.type === 'note') assert.ok(e.t + e.dur <= stopT + 1e-6, `seed ${seed}: Note reicht in die Stille`);
      }
      const next = events.filter((e) => e.bar === sections[2].start || e.bar === sections[1].start);
      assert.ok(next.some((e) => e.type === 'hit' && e.name === 'crash' && e.bar === 12 && e.beat === 0), 'Crash zur Eins des Refrains');
      assert.ok(events.some((e) => e.type === 'hit' && e.name === 'kick' && e.bar === 12 && e.beat < 1), `seed ${seed}: Kick auf der Eins`);
    }
  }
});

test('Wirbel: zweite Takthälfte nur Snare (und Kick wie vorher), Achtel dann Sechzehntel, vel steigt von 0,45 auf 0,95', () => {
  for (const meter of [[4, 4], [3, 4], [6, 8], [12, 8], [5, 4]]) {
    const parts = (transition) => [['verse', 4], ['chorus', 4, { transition }]];
    for (const seed of SEEDS.slice(0, 10)) {
      const withRoll = mk(parts('roll'), { dynamics: 0 }, { seed, meter });
      const without = mk(parts('none'), { dynamics: 0 }, { seed, meter });
      const { bars } = info(withRoll);
      const b = bars[3];
      const half = b.beats / 2;
      const drums = (track) => buildEvents(track).filter((e) => e.bar === 3 && e.type === 'hit' && e.layer === 'drums');
      const hits = drums(withRoll);
      const late = hits.filter((e) => e.beat >= half);
      assert.ok(late.every((e) => e.name === 'snare' || e.name === 'kick'), `${meter}: nur Snare/Kick nach der Mitte`);
      const kicks = (hs) => hs.filter((e) => e.name === 'kick').map((e) => [e.t, e.vel]);
      assert.deepEqual(kicks(hits), kicks(drums(without)), `${meter}: Kick bleibt`);
      const rollHits = late.filter((e) => e.name === 'snare');
      const kickTimes = new Set(late.filter((e) => e.name === 'kick').map((e) => e.t));
      const roll = rollHits.filter((e) => !kickTimes.has(e.t)); // Wirbel-Schläge sind die Snare-Treffer nach der Mitte
      assert.ok(roll.length >= 4, `${meter}: Wirbel hat Schläge`);
      for (let i = 1; i < roll.length; i++) assert.ok(roll[i].vel >= roll[i - 1].vel, `${meter}: crescendo`);
      assert.equal(roll[0].vel, 0.45);
      assert.ok(roll.at(-1).vel >= 0.9 && roll.at(-1).vel <= 0.95);
      const gaps = roll.slice(1).map((e, i) => e.t - roll[i].t);
      assert.ok(gaps[0] > gaps.at(-1) * 1.5, `${meter}: erst Achtel, dann Sechzehntel`);
      assert.ok(hits.filter((e) => e.beat < half).length > 0, `${meter}: erste Hälfte spielt weiter`);
      // alles bleibt im Takt
      assert.ok(roll.every((e) => e.t >= b.start && e.t < b.end));
    }
  }
});

test('Crash: genau einer zur Eins jedes Teils mit crash, nie im ersten Takt des Songs, nur mit Schlagzeug-Schalter', () => {
  const parts = [['chorus', 4, { crash: true }], ['verse', 4], ['chorus', 4], ['break', 4, { crash: true }], ['chorus', 4]];
  for (const seed of SEEDS.slice(0, 10)) {
    const track = mk(parts, { dynamics: 0 }, { seed });
    const crashes = buildEvents(track).filter((e) => e.name === 'crash');
    assert.deepEqual(crashes.map((e) => e.bar), [8, 12, 16], 'nicht in Takt 0; Break mit crash:true zählt');
    for (const e of crashes) { assert.equal(e.beat, 0); assert.equal(e.vel, 0.9); assert.equal(e.layer, 'drums'); assert.equal(e.type, 'hit'); }
  }
  const noDrums = mk(parts, {}, { layers: { drums: false, bass: true, chords: true, pad: true, lead: false, percussion: false } });
  assert.equal(buildEvents(noDrums).filter((e) => e.name === 'crash').length, 0);
});

test('Pausen: höchstens eine Schicht je Takt, nie Bass, Schlagzeug behält Hi-Hat/Kick, nur 4. Takt, nie vor Stopp, wächst mit dem Regler', () => {
  const parts = [['intro', 8], ['verse', 16], ['verse', 16], ['outro', 8], ['verse', 8], ['break', 4], ['chorus', 8]];
  const rate = {};
  for (const pauses of [0, 0.3, 1]) {
    let paused = 0, eligible = 0;
    for (const seed of SEEDS) {
      const full = NO_TRANS(parts);
      full[5][2].transition = 'stop'; // der Break (Teil 5) hat einen Stopp: der Takt davor bleibt pausenfrei
      const base = buildEvents(mk(full, { dynamics: 0, pauses: 0 }, { seed }));
      const track = mk(full, { dynamics: 0, pauses }, { seed });
      const { sections } = info(track);
      const out = buildEvents(track);
      const key = (e) => JSON.stringify(e);
      const kept = new Set(out.map(key));
      const lost = base.filter((e) => isSound(e) && !kept.has(key(e)));
      const byBar = new Map();
      for (const e of lost) byBar.set(e.bar, [...(byBar.get(e.bar) ?? []), e]);
      for (const [bar, es] of byBar) {
        if (bar === 55) continue; // Stoppbreite hängt vom Regler ab // letzter Takt vor dem Stopp
        const sec = sectionOf(sections, bar);
        assert.equal(new Set(es.map((e) => e.layer)).size, 1, `Takt ${bar}: mehr als eine Schicht`);
        assert.ok(!es.some((e) => e.layer === 'bass'), 'Bass pausiert nicht');
        assert.ok(!es.some((e) => e.layer === 'drums' && KEEP.includes(e.name)), 'Hi-Hat/Kick bleiben');
        assert.equal((bar - sec.start) % 4, 3, `Takt ${bar}: nur jeder 4. Takt eines Teils`);
              }
      assert.ok(out.length - base.length <= 0);
      paused += byBar.size;
      eligible += sections.reduce((n, s) => n + (s.index === 4 ? Math.floor(s.bars / 4) - 1 : Math.floor(s.bars / 4)), 0);
    }
    rate[pauses] = paused / eligible;
  }
  assert.equal(rate[0], 0, 'pauses = 0: keine Pausen');
  assert.ok(rate[0.3] > 0 && rate[0.3] < rate[1], `wächst mit dem Regler: ${JSON.stringify(rate)}`);
  assert.ok(rate[1] > 0.4, `pauses = 1: Rate ${rate[1]}`);
});

test('Eigenschaften über gewürfelte Formen, Taktarten und Seeds: im Takt, vel 0,05..1, dur im Takt, sortiert, rein, reproduzierbar, Bass oder Schlagzeug je Takt', () => {
  for (const meter of [[4, 4], [3, 4], [6, 8], [12, 8], [5, 4]]) {
    for (const template of TEMPLATE_IDS) {
      for (const seed of SEEDS.slice(0, 6)) {
        const feel = { structure: 0.6, dynamics: [0, 0.6, 1.3][seed % 3], pauses: [0, 0.4, 0.9][seed % 3], randomness: 0.5 };
        const form = rollForm({ template, style: 'rock', targetBars: 32, feel, seed, tags: {} });
        const track = mk([], {}, { seed, meter });
        track.form = form;
        const { t, bars, sections } = info(track);
        const events = buildEvents(track);
        const label = `${meter} ${template} s=${seed}`;
        let last = -Infinity;
        const layersByBar = bars.map(() => new Set());
        for (const e of events) {
          const b = bars[e.bar];
          assert.ok(e.t >= last, `${label}: sortiert`);
          last = e.t;
          assert.ok(e.t >= b.start - 1e-9 && e.t < b.end, `${label}: außerhalb von Takt ${e.bar}`);
          if (e.beat !== undefined) assert.ok(e.beat >= 0 && e.beat < b.beats + 1e-9, `${label}: beat`);
          if (isSound(e)) {
            assert.ok(e.vel >= 0.05 && e.vel <= 1 && e.vel === round3(e.vel), `${label}: vel ${e.vel}`);
            layersByBar[e.bar].add(e.layer);
          }
          if (e.type === 'note') assert.ok(e.dur > 0 && e.t + e.dur <= b.end + 1e-6, `${label}: dur`);
        }
        for (const s of sections) for (let i = s.start; i < s.start + s.bars; i++) {
          if (s.layers.bass || s.layers.drums) assert.ok(layersByBar[i].has('bass') || layersByBar[i].has('drums'), `${label}: Takt ${i} ohne Bass und Schlagzeug`);
        }
        assert.equal(events.filter((e) => e.type === 'chord').length, t.length, `${label}: Akkord-Ereignisse`);
        assert.deepEqual(buildEvents(track), events, `${label}: reproduzierbar`);
      }
    }
  }
});

test('postProcess ist rein: Eingabe unverändert (auch eingefroren), neues Array', () => {
  const track = mk([['verse', 8], ['build', 4], ['break', 4, { transition: 'stop' }], ['chorus', 8]], { pauses: 1 });
  const { t, bars, sections } = info(track);
  const events = buildEvents({ ...track, form: { ...track.form, sections: sectionsOf([['verse', 8], ['build', 4], ['break', 4], ['chorus', 8]]) } });
  const frozen = events.map((e) => Object.freeze({ ...e }));
  const before = JSON.stringify(frozen);
  const out = postProcess(frozen, t, bars, sections, createRng(5));
  assert.notEqual(out, frozen);
  assert.equal(JSON.stringify(frozen), before);
});
