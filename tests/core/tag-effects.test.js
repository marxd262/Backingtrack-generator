import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagEffect } from '../../src/ui/tag-effects.js';
import { TAG_CATEGORIES, TAG_PLAY_EFFECTS } from '../../src/core/tags.js';
import { TIMBRE_EFFECTS } from '../../src/core/timbre-effects.js';

const FORM = { sections: [{ type: 'verse', bars: 8 }, { type: 'chorus', bars: 8 }] };
const SYNTH = Object.fromEntries(['drums', 'bass', 'chords', 'pad', 'lead', 'percussion'].map((l) => [l, { id: 'synth', variant: 'classic' }]));
const track = (extra = {}) => ({ tags: {}, timbre: {}, voices: SYNTH, form: FORM, ...extra });

test('Spiel-Schlagwort: wirkt immer, unabhängig von Stimme und Form', () => {
  for (const t of [track(), track({ voices: undefined }), track({ form: undefined })]) {
    const fx = tagEffect('driving', t);
    assert.deepEqual(fx.play, [{ param: 'drive', value: 0.3 }]);
    assert.deepEqual(fx.kinds, ['play']);
    assert.equal(fx.effective, true);
  }
});

test('Klang-Schlagwort: kommt nur an, wo die gewählte Stimme den Regler benutzt und der Nutzer ihn nicht von Hand gestellt hat', () => {
  const synth = tagEffect('punchy', track());
  assert.deepEqual(synth.kinds, ['sound']);
  assert.ok(synth.sound.every((s) => s.blocked === null));
  assert.equal(synth.effective, true);
  // Sample-Kit (der Standard ohne voices): es benutzt nur den Raum, das Wort bewirkt nichts
  const sample = tagEffect('punchy', track({ voices: undefined }));
  assert.ok(sample.sound.every((s) => s.blocked === 'voice'));
  assert.equal(sample.effective, false);
  assert.equal(tagEffect('roomy', track({ voices: undefined })).effective, true); // Raum wirkt auch am Sample-Kit
  // ein Feld von Hand gestellt: dort gewinnt der Knopf, die übrigen Felder des Worts wirken weiter
  const knob = tagEffect('punchy', track({ timbre: { drums: { kickPunch: 0.9 } } }));
  assert.deepEqual(knob.sound.map((s) => [s.path, s.blocked]), [['drums.kickPunch', 'knob'], ['drums.kickLength', null], ['drums.snareSnap', null]]);
  assert.equal(knob.effective, true);
  const all = tagEffect('roomy', track({ timbre: { drums: { room: 0 } } }));
  assert.equal(all.effective, false);
});

test('Entwicklung: mit Songform wirken die Wörter beim Würfeln (Art Form), ohne Form die ersten beiden sofort aufs Spiel, „mit Ausbrüchen“ gar nicht', () => {
  const withForm = tagEffect('buildsSlowly', track());
  assert.deepEqual(withForm.kinds, ['form']);
  assert.deepEqual(withForm.form.map((f) => f.type).sort(), ['build', 'intro']);
  assert.ok(withForm.form.every((f) => f.factor > 1));
  assert.ok(tagEffect('fullFromStart', track()).form.every((f) => f.factor < 1));
  const noForm = tagEffect('buildsSlowly', track({ form: undefined }));
  assert.deepEqual(noForm.kinds, ['play']);
  assert.deepEqual(noForm.play, [{ param: 'buildUp', value: 'slow' }]);
  assert.deepEqual(tagEffect('withBreakouts', track()).kinds, ['form']);
  assert.equal(tagEffect('withBreakouts', track()).effective, true);
  const breakouts = tagEffect('withBreakouts', track({ form: undefined }));
  assert.deepEqual(breakouts.kinds, []);
  assert.equal(breakouts.effective, false);
});

test('jedes Schlagwort des Registers ist mit Songform und Synth-Stimmen wirksam und hat mindestens eine Art; Unbekanntes bewirkt nichts', () => {
  for (const { tags } of TAG_CATEGORIES) for (const tag of tags) {
    const fx = tagEffect(tag, track());
    assert.ok(fx.kinds.length >= 1 && fx.effective, tag);
    assert.equal(fx.play.length > 0 || fx.form.length > 0 || fx.sound.length > 0, true, tag);
    assert.equal(fx.sound.length, Object.keys(TIMBRE_EFFECTS[tag] ?? {}).length, tag);
  }
  assert.ok(Object.isFrozen(TAG_PLAY_EFFECTS) && Object.isFrozen(TAG_PLAY_EFFECTS.driving));
  assert.deepEqual(tagEffect('gibtsnicht', track()), { play: [], sound: [], form: [], kinds: [], effective: false });
  assert.doesNotThrow(() => tagEffect('driving', null));
});
