// Tonewheel-Orgel: Teilton-Gewichte aus den Zugriegeln (Foldback, Normierung), Verstimmung der Räder, Register und Feinwerte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tonewheelPartials, WHEEL_CENTS, percussionGate } from '../../src/audio/voices/organ.js';
import { TUNABLES, DRAWBARS } from '../../src/audio/voices/tunables.js';
import { VOICES } from '../../src/core/voices.js';
import { leslieFast } from '../../src/audio/voices/organ-leslie.js';
import { buildEvents } from '../../src/core/events.js';

const bars = (text) => [...text].map(Number);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('Zugriegel -> Teiltöne der Sub-Oktave 1, 3, 2, 4, 6, 8, 10, 12, 16; je Stufe 3 dB; Summe auf rms 1 normiert', () => {
  const full = tonewheelPartials(60, bars('888888888'));
  for (const h of [1, 2, 3, 4, 6, 8, 10, 12, 16]) assert.ok(near(full[h], 1 / 3), `Teilton ${h}`);
  for (const h of [0, 5, 7, 9, 11, 13, 14, 15]) assert.equal(full[h], 0, `Teilton ${h}`);
  const jazz = tonewheelPartials(60, bars('888000000'));
  assert.deepEqual([...jazz].flatMap((a, h) => (a ? [h] : [])), [1, 2, 3]);
  const ballad = tonewheelPartials(60, bars('838000000'));
  assert.ok(near(20 * Math.log10(ballad[3] / ballad[1]), -15), '5⅓\' auf 3 liegt 15 dB unter 16\' auf 8');
  for (const p of [full, jazz, ballad]) assert.ok(near(Math.hypot(...p), 1), 'rms 1');
  assert.ok(near(Math.hypot(...tonewheelPartials(60, bars('000000000'))), 0), 'alle Zugriegel zu: Stille');
});

test('Foldback: oben spielt das Rad eine Oktave tiefer (ab Taste 79 der 1\'), unten das 16\' der tiefsten Oktave eine Oktave höher', () => {
  const one = bars('000000008'), sub = bars('800000000');
  assert.ok(near(tonewheelPartials(78, one)[16], 1), 'Taste 78: 1\' liegt noch auf Rad 91');
  assert.ok(near(tonewheelPartials(79, one)[8], 1) && tonewheelPartials(79, one)[16] === 0, 'Taste 79: 1\' klingt wie 2\'');
  assert.ok(near(tonewheelPartials(85, bars('000000080'))[6], 1), 'Taste 85: 1⅓\' klingt wie 2⅔\'');
  assert.ok(near(tonewheelPartials(48, sub)[1], 1), 'Taste 48: 16\' echt');
  assert.ok(near(tonewheelPartials(47, sub)[2], 1), 'Taste 47: 16\' klingt wie 8\'');
  // zwei Zugriegel auf demselben Rad addieren sich: Taste 79 mit 2' und 1' ist ein einziger Teilton
  assert.deepEqual([...tonewheelPartials(79, bars('000008008'))].flatMap((a, h) => (a ? [h] : [])), [8]);
});

test('Räder: je Tonklasse unter 0,8 Cent neben der gleichstufigen Stimmung, A stimmt genau', () => {
  assert.equal(WHEEL_CENTS.length, 12);
  for (const [pc, c] of WHEEL_CENTS.entries()) assert.ok(Math.abs(c) < 0.8, `Tonklasse ${pc}: ${c}`);
  assert.ok(near(WHEEL_CENTS[9], 0));
  assert.ok(WHEEL_CENTS.some((c) => Math.abs(c) > 0.3), 'die Verstimmung ist nicht null');
});

test('Register und Feinwerte: versteckt, vier Presets mit den neun Zugriegeln als Startwert', () => {
  assert.equal(VOICES.chords.organ.hidden, true);
  const presets = { jazz: '888000000', rock: '888800000', gospel: '888888888', ballad: '838000000' };
  assert.deepEqual(VOICES.chords.organ.variants, Object.keys(presets));
  for (const [variant, text] of Object.entries(presets)) {
    assert.equal(DRAWBARS.map((name) => TUNABLES[`chords/organ/${variant}`][name].value).join(''), text, variant);
  }
});

test('Percussion ist single-trigger: nur der erste Ton nach freier Tastatur löst aus, gebundene Töne nicht', () => {
  const state = { held: -Infinity };
  const fired = [[0, 0.5], [0, 0.5], [0.001, 0.5], [0.5, 1], [0.9, 1.4], [1.398, 2], [3, 3.2]].map(([t, end]) => percussionGate(state, t, end));
  // Akkord aus drei Tönen: nur der erste; Anschluss genau am Ende: löst aus; in den gehaltenen Ton hinein: nicht; 2 ms vor dem Ende: löst aus; nach einer Pause: löst aus
  assert.deepEqual(fired, [true, false, false, true, false, true, true]);
  assert.equal(state.held, 3.2);
});

const formTrack = (chords) => ({
  key: { root: 'A', mode: 'minor' }, bpm: 120, seed: 3, length: 8, tags: {},
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  layers: { drums: true, bass: true, chords: true, pad: false, lead: false, percussion: false },
  form: { sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4 }] },
  voices: { chords },
});
const chordNotes = (track, options) => buildEvents(track, options).filter((e) => e.layer === 'chords' && e.type === 'note');

test('Leslie-Regel: schnell im Refrain und im letzten Takt davor, sonst langsam; nur an der Orgel-Stimme, nicht ohne die Artikulations-Schicht', () => {
  const notes = chordNotes(formTrack({ id: 'organ', variant: 'rock' }));
  for (const bar of [0, 1, 2, 3, 4, 5, 6, 7]) assert.ok(notes.some((e) => e.bar === bar), `Takt ${bar} hat Töne`);
  for (const e of notes) assert.equal(e.leslie, e.bar >= 3 ? 1 : undefined, `Takt ${e.bar}`);
  assert.ok(chordNotes(formTrack({ id: 'epiano', variant: 'rhodes' })).every((e) => !('leslie' in e) && !('swell' in e)), 'andere Stimme: kein Feld');
  assert.ok(chordNotes(formTrack({ id: 'organ', variant: 'rock' }), { ornaments: { on: 0 } }).every((e) => !('leslie' in e)), 'Schicht aus: kein Feld');
  const noForm = { ...formTrack({ id: 'organ', variant: 'jazz' }), form: undefined };
  assert.ok(chordNotes(noForm).every((e) => !('leslie' in e)), 'ohne Songform: immer langsam');
});

test('leslieFast: 0 aus und 2 immer langsam, 3 immer schnell, 1 folgt dem Feld des Tons', () => {
  assert.deepEqual([0, 1, 2, 3].map((mode) => leslieFast(mode, 1)), [false, true, false, true]);
  assert.deepEqual([0, 1, 2, 3].map((mode) => leslieFast(mode, undefined)), [false, false, false, true]);
});

test('Schweller-Regel: das Pedal steht auf dem Pegel der Songform (Strophe unter 0 dB, Refrain ganz auf) und zieht im Takt vor dem Refrain bis zu dessen Eins auf', () => {
  const notes = chordNotes(formTrack({ id: 'organ', variant: 'rock' }));
  for (const e of notes.filter((n) => n.bar < 3)) assert.ok(e.swell < 0 && e.swell >= -6 && e.art === undefined, `Strophe, Takt ${e.bar}: ${e.swell}`);
  const rise = notes.filter((n) => n.bar === 3);
  assert.ok(rise.length > 0);
  for (const e of rise) {
    assert.equal(e.art, 'swell');
    assert.equal(e.swell, undefined, 'Ziel ist der Pegel des Refrains');
    assert.ok(Math.abs(e.t + e.artTime - 8) < 0.03, `endet auf der Eins des Refrains (8 s): ${e.t + e.artTime}`); // das Mikrotiming verschiebt t danach um Millisekunden
  }
  for (const e of notes.filter((n) => n.bar > 3)) assert.ok(e.swell === undefined && e.art === undefined, `Refrain, Takt ${e.bar}`);
  const noForm = { ...formTrack({ id: 'organ', variant: 'jazz' }), form: undefined };
  assert.ok(chordNotes(noForm).every((e) => !('swell' in e) && e.art === undefined), 'ohne Songform: Pedal ganz auf');
});
