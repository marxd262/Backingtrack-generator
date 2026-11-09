// Groove-Register: Konsistenz über alle Grooves (neue Einträge werden automatisch erfasst), Stufenwahl und Groove-Auswahl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROOVES, DEFAULT_GROOVE, METERS, grooveFor, grooveIdFor, groovesFor, levelOf, meterKey, convertTempo } from '../../src/core/grooves.js';
import { DRUM_NAMES } from '../../src/core/events.js';

const IDS = Object.keys(GROOVES);
const DEGREES = ['r', '5', 'o', 'b7', 'ap'];
const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => typeof v !== 'object' || v === null || deepFrozen(v));
const isStep = (n, cycle) => Number.isInteger(n) && n >= 0 && n < cycle;
const ascending = (list) => list.every((x, i) => i === 0 || x > list[i - 1]);

test('levelOf: für die Schwellen 0,35 und 0,7 gleich der bisherigen Stufenwahl', () => {
  const legacy = (x) => (x < 0.35 ? 0 : x < 0.7 ? 1 : 2);
  for (const x of [0, 0.1, 0.34, 0.35, 0.36, 0.5, 0.69, 0.7, 0.71, 1]) assert.equal(levelOf(x, [0.35, 0.7]), legacy(x), String(x));
  assert.equal(levelOf(0.5, []), 0);
  assert.equal(levelOf(0.9, [0.25, 0.5, 0.75]), 3);
});

test('Register: straight (4/4) ist da, alles tief eingefroren', () => {
  assert.ok(IDS.includes('straight'));
  assert.equal(GROOVES.straight.meter, '4/4');
  assert.ok(deepFrozen(GROOVES) && deepFrozen(DEFAULT_GROOVE));
});

test('Register: jeder Groove ist in sich stimmig (Taktart, Raster, Stufen, Schritte, Fills, Bass, Akkorde)', () => {
  for (const id of IDS) {
    const g = GROOVES[id];
    assert.ok(Object.hasOwn(METERS, g.meter), `${id}: Taktart`);
    const { beats, sub } = METERS[g.meter];
    const cycle = beats * sub;
    assert.ok(Number.isInteger(g.fillBeats) && g.fillBeats >= 1 && g.fillBeats <= beats, `${id}: fillBeats`);

    const { drums, bass, chords } = g;
    for (const [name, inst] of [['drums', drums], ['bass', bass]]) {
      assert.ok(inst.thresholds.every((t) => t > 0 && t < 1) && ascending(inst.thresholds), `${id}.${name}: thresholds`);
      assert.equal(inst.tiers.length, inst.thresholds.length + 1, `${id}.${name}: Stufen`);
    }
    assert.equal(drums.extraKicks.length, drums.tiers.length, `${id}: extraKicks je Stufe`);
    for (const tier of drums.tiers) {
      assert.equal(tier.hat.length, sub, `${id}: Hi-Hat-Werte je Schlag`);
      assert.ok(tier.hat.every((v) => v >= 0 && v <= 1), `${id}: Hi-Hat-Lautstärke`);
      for (const list of [...tier.kicks, tier.snare, tier.ghosts]) assert.ok(list.every((s) => isStep(s, cycle)), `${id}: Schritt im Zyklus`);
      assert.ok(tier.kicks.length > 0 && tier.kicks.every((k) => k.includes(0)), `${id}: Kick auf Schritt 0`);
      assert.ok(tier.snare.length > 0, `${id}: Snare`);
    }
    for (const kicks of drums.extraKicks) for (const k of kicks) assert.ok(k.every((s) => isStep(s, cycle)), `${id}: extraKicks`);
    assert.ok(drums.offbeatKicks.every((s) => isStep(s, cycle)), `${id}: offbeatKicks`);
    assert.ok(isStep(drums.openHatStep, cycle), `${id}: openHatStep`);
    for (const fill of [...drums.fills, ...drums.extraFills]) {
      assert.equal(fill.length, g.fillBeats * sub, `${id}: Fill-Länge`);
      assert.ok(fill.every((n) => n === null || DRUM_NAMES.includes(n)), `${id}: Fill-Namen`);
    }
    assert.ok(drums.fills.length > 0, `${id}: Fills`);

    assert.equal(bass.extra.length, bass.tiers.length, `${id}: bass.extra je Stufe`);
    for (const patterns of [...bass.tiers, ...bass.extra]) {
      for (const pattern of patterns) {
        assert.deepEqual(pattern[0].slice(0, 2), [0, 'r'], `${id}: Bassmuster beginnt mit dem Grundton`);
        pattern.forEach(([step, degree, len], i) => {
          assert.ok(isStep(step, cycle) && DEGREES.includes(degree) && len > 0, `${id}: Bassschritt ${step} ${degree}`);
          assert.ok(step + len <= cycle, `${id}: Bassnote ${step}+${len} über den Zyklus`);
          if (degree === 'ap') assert.equal(i, pattern.length - 1, `${id}: Anlauf zuletzt`);
        });
      }
    }

    for (const list of [...chords.stabs, ...chords.extraStabs]) assert.ok(list.every((s) => isStep(s, cycle)), `${id}: Stabs`);
    assert.ok(chords.offbeatStabs.every((s) => isStep(s, cycle)), `${id}: offbeatStabs`);
    assert.ok(Number.isInteger(chords.arpStep) && chords.arpStep >= 1 && chords.arpStep <= sub, `${id}: arpStep`);
    for (const arp of [...chords.arps, ...chords.extraArps]) assert.ok(arp.length === 8 && arp.every((i) => [0, 1, 2, 3].includes(i)), `${id}: Arpeggio`);
  }
});

test('groovesFor und grooveFor: Auswahl nach Taktart, Rückfall auf den Standard', () => {
  assert.ok(groovesFor('4/4').includes('straight'));
  for (const key of Object.keys(METERS)) for (const id of groovesFor(key)) assert.equal(GROOVES[id].meter, key, id);
  const base = { meter: [4, 4] };
  assert.equal(grooveFor(base), GROOVES.straight);
  assert.equal(grooveFor({ ...base, groove: 'straight' }), GROOVES.straight);
  assert.equal(grooveFor({ ...base, groove: 'nope' }), GROOVES.straight);
  assert.equal(grooveFor({}), GROOVES.straight);
  for (const key of Object.keys(METERS)) {
    const meter = key.split('/').map(Number);
    const g = grooveFor({ meter });
    assert.equal(meterKey(meter), key);
    assert.ok(g && Object.hasOwn(GROOVES, DEFAULT_GROOVE[key] ?? 'straight'), key);
  }
});

test('grooveIdFor: die ID des gewählten Grooves, sonst der Standard der Taktart; grooveFor liefert dazu den Datensatz', () => {
  assert.equal(grooveIdFor({ meter: [4, 4] }), 'straight');
  assert.equal(grooveIdFor({}), 'straight');
  assert.equal(grooveIdFor({ meter: [6, 8], groove: 'rock68' }), 'rock68');
  assert.equal(grooveIdFor({ meter: [6, 8], groove: 'waltz' }), DEFAULT_GROOVE['6/8']);
  assert.equal(grooveIdFor({ meter: [4, 4], groove: 'nope' }), 'straight');
  for (const id of Object.keys(GROOVES)) assert.equal(grooveFor({ meter: GROOVES[id].meter.split('/').map(Number), groove: id }), GROOVES[id]);
});

test('convertTempo: einfach zu zusammengesetzt mal 2/3, zurück mal 3/2, gleiche Art bleibt, begrenzt auf 40 bis 200', () => {
  assert.equal(convertTempo(100, '4/4', '6/8'), 67);
  assert.equal(convertTempo(150, '3/4', '12/8'), 100);
  assert.equal(convertTempo(66, '6/8', '4/4'), 99);
  assert.equal(convertTempo(120, '12/8', '5/4'), 180);
  for (const [from, to] of [['4/4', '3/4'], ['3/4', '5/4'], ['6/8', '12/8'], ['4/4', '4/4']]) assert.equal(convertTempo(133, from, to), 133, `${from} nach ${to}`);
  assert.equal(convertTempo(200, '6/8', '4/4'), 200, 'oben begrenzt');
  assert.equal(convertTempo(40, '4/4', '6/8'), 40, 'unten begrenzt');
  assert.equal(convertTempo(100, 'x', '6/8'), 100, 'Unbekanntes lässt das Tempo');
});
