// Würfeln und Regler der Songform im UI-Zustand (state.js) sowie der Memo-Schlüssel des Verlaufs. Ohne DOM.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, formChoice, rollNewForm, setFormTemplate, setFormTarget, setFormFeel } from '../../src/ui/state.js';
import { laneKey } from '../../src/ui/lanes.js';
import { formLength, isValidForm } from '../../src/core/form.js';
import { FEEL_DEFAULTS } from '../../src/core/form-types.js';

beforeEach(() => {
  state.style = 'funk';
  state.formTarget = 96;
  state.formFeel = { ...FEEL_DEFAULTS };
  state.track.seed = 7;
  delete state.track.form;
  state.track.length = 96;
});

test('Vorlage Auto: gültige Form, Länge ist die Summe, Gewähltes bleibt "auto"', () => {
  setFormTemplate('auto');
  assert.ok(isValidForm(state.track.form));
  assert.equal(state.track.length, formLength(state.track.form));
  assert.equal(formChoice(), 'auto');
  assert.deepEqual(state.track.form.feel, FEEL_DEFAULTS);
});

test('Blues: alle Teile 12 Takte; Zielgröße 48 ergibt eine Summe nahe 48', () => {
  setFormTemplate('blues');
  assert.ok(state.track.form.sections.every((s) => s.bars === 12));
  assert.equal(formChoice(), 'blues');
  setFormTarget(48);
  assert.ok(Math.abs(state.track.length - 48) <= 4);
  assert.equal(state.track.length, formLength(state.track.form));
});

test('Ohne Form: Form entfällt, Länge ist die Zielgröße, Reglerwerte bleiben und kehren zurück', () => {
  setFormTemplate('auto');
  setFormFeel('randomness', 0.8);
  setFormTemplate('off');
  assert.equal(state.track.form, undefined);
  assert.equal(formChoice(), 'off');
  assert.equal(state.track.length, 96);
  setFormTarget(48);
  assert.equal(state.track.length, 48);
  assert.equal(state.track.form, undefined);
  rollNewForm(); // ohne Form nichts zu würfeln
  assert.equal(state.track.form, undefined);
  setFormTemplate('auto');
  assert.equal(state.track.form.feel.randomness, 0.8);
});

test('Neuwürfeln: gleiche Eingaben gleiche Form, andere Variante andere Form; gesperrte Teile bleiben', () => {
  setFormTemplate('auto');
  const first = structuredClone(state.track.form);
  rollNewForm();
  assert.deepEqual(state.track.form, first);
  state.track.form.sections[0].locked = true;
  const locked = structuredClone(state.track.form.sections[0]);
  const seen = new Set();
  for (let seed = 8; seed < 14; seed++) {
    state.track.seed = seed;
    rollNewForm();
    seen.add(JSON.stringify(state.track.form.sections));
    assert.deepEqual(state.track.form.sections[0], locked, `Seed ${seed}`);
  }
  assert.ok(seen.size > 1);
});

test('Wechsel von Vorlage oder Zielgröße hebt Sperren auf', () => {
  setFormTemplate('auto');
  for (const s of state.track.form.sections) s.locked = true;
  setFormTemplate('pop');
  assert.ok(state.track.form.sections.every((s) => !s.locked));
  state.track.form.sections[0].locked = true;
  setFormTarget(48);
  assert.ok(state.track.form.sections.every((s) => !s.locked));
});

test('Regler schreiben in die Form und in state.formFeel, ohne die Sektionen zu ändern', () => {
  setFormTemplate('auto');
  const before = structuredClone(state.track.form.sections);
  setFormFeel('pauses', 0.9);
  assert.equal(state.track.form.feel.pauses, 0.9);
  assert.equal(state.formFeel.pauses, 0.9);
  assert.deepEqual(state.track.form.sections, before);
  assert.ok(isValidForm(state.track.form));
});

test('laneKey ändert sich mit Form, Aufgaben, Stimmen und Vielfalt, nicht mit Tempo und Schichten', () => {
  const base = { key: { root: 'A', mode: 'minor' }, bars: [], tags: {}, seed: 1, length: 8, meter: [4, 4], jobs: { lead: 'off' }, variety: true };
  const k = laneKey(base);
  assert.equal(laneKey({ ...base, bpm: 200, layers: { drums: false } }), k);
  const form = { template: 'pop', sections: [{ type: 'verse', bars: 8 }], feel: FEEL_DEFAULTS };
  for (const change of [{ form }, { jobs: { lead: 'melody' } }, { voices: { lead: 'saw' } }, { variety: false }]) {
    assert.notEqual(laneKey({ ...base, ...change }), k, Object.keys(change)[0]);
  }
  assert.notEqual(laneKey({ ...base, form }), laneKey({ ...base, form: { ...form, feel: { ...FEEL_DEFAULTS, pauses: 1 } } }));
});
