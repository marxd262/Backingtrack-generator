// Reine Helfer der Songform-Oberfläche (src/ui/form-ui.js): Geometrie der Blöcke, Beschriftungen, Bearbeitungen und Grenzen. Ohne DOM.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../../src/i18n/index.js';
import { formLength, isValidForm } from '../../src/core/form.js';
import { FEEL_DEFAULTS, PART_TYPES } from '../../src/core/form-types.js';
import { levelHeight, stripBlocks, levelLabel, densityLabel, levelValue, densityValue, limits, editPart, setLocked, addPart, copyPart, deletePart, movePart, barsText } from '../../src/ui/form-ui.js';
import { state, rollNewForm, setFormTemplate } from '../../src/ui/state.js';

beforeEach(() => setLanguage('de'));
after(() => setLanguage('de'));

const form = (...parts) => ({ template: 'pop', auto: false, feel: { ...FEEL_DEFAULTS }, sections: parts.map(([type, bars, extra]) => ({ type, bars, ...extra })) });
const demo = () => form(['intro', 4], ['verse', 8], ['build', 4], ['chorus', 8], ['break', 4], ['outro', 8]);

test('stripBlocks: Breite ist der Anteil der Takte, Takte von/bis zählen lückenlos ab 1', () => {
  const blocks = stripBlocks(demo());
  assert.deepEqual(blocks.map((b) => b.type), ['intro', 'verse', 'build', 'chorus', 'break', 'outro']);
  assert.ok(Math.abs(blocks.reduce((s, b) => s + b.width, 0) - 1) < 1e-9);
  assert.equal(blocks[1].width, 8 / 36);
  assert.deepEqual(blocks.map((b) => [b.from, b.to]), [[1, 4], [5, 12], [13, 16], [17, 24], [25, 28], [29, 36]]);
});

test('Höhe folgt dem mittleren Pegel: Refrain voll, leisere Teile niedriger, nie unter der Mindesthöhe', () => {
  const blocks = stripBlocks(demo());
  const h = Object.fromEntries(blocks.map((b) => [b.type, b.height]));
  assert.equal(h.chorus, 1);
  assert.ok(h.verse < h.chorus && h.break < h.verse && h.intro < h.verse);
  assert.ok(h.build > h.verse && h.build < h.chorus, 'Aufbau steigt von -4 auf -1: Mittel -2,5');
  assert.equal(levelHeight(-24), 0.4);
  assert.equal(levelHeight(-100), 0.4);
  assert.equal(levelHeight(0), 1);
  assert.ok(levelHeight(-6) > levelHeight(-9));
  // ein gesetzter Pegel zählt, auch für den Refrain
  assert.ok(stripBlocks(form(['chorus', 8, { level: -12 }]))[0].height < 0.5);
});

test('stripBlocks: ungültige oder fehlende Form ergibt keine Blöcke, wirft nie', () => {
  for (const bad of [undefined, null, 5, 'x', [], {}, { sections: [] }, { sections: [{ type: 'oops', bars: 4 }] }, { sections: [{ type: 'verse', bars: 0 }] }, { sections: [{ type: 'verse', bars: 'x' }] }]) {
    assert.deepEqual(stripBlocks(bad), [], JSON.stringify(bad));
  }
});

test('Beschriftung "Standard (−3 dB)" solange der Pegel nicht gesetzt ist, danach der Wert', () => {
  const f = demo();
  assert.equal(levelLabel(f.sections[1], f.feel), 'Standard (−3 dB)');
  assert.equal(levelLabel(f.sections[3], f.feel), 'Standard (0 dB)');
  assert.equal(levelLabel(f.sections[2], f.feel), 'Standard (−4 … −1 dB)', 'Aufbau steigt');
  assert.equal(levelLabel({ type: 'verse', bars: 8, level: -9 }, f.feel), '−9 dB');
  assert.equal(levelValue(f.sections[1], f.feel), -3);
  assert.equal(levelValue({ type: 'verse', bars: 8, level: -9 }, f.feel), -9);
  setLanguage('en');
  assert.equal(levelLabel(f.sections[1], f.feel), 'Default (−3 dB)');
});

test('Dichte: Standard und gesetzter Wert in Prozent', () => {
  const f = demo();
  assert.equal(densityLabel(f.sections[1], f.feel), 'Standard (−15 %)');
  assert.equal(densityValue(f.sections[1], f.feel), -15);
  assert.equal(densityLabel({ type: 'verse', bars: 8, density: 0.3 }, f.feel), '30 %');
  assert.equal(densityValue({ type: 'verse', bars: 8, density: -0.5 }, f.feel), -50);
});

test('Dynamik-Regler verschiebt den angezeigten Standard (Regler 0: alle Teile wie der Refrain)', () => {
  const f = { ...demo(), feel: { ...FEEL_DEFAULTS, dynamics: 0 } };
  assert.equal(levelLabel(f.sections[1], f.feel), 'Standard (0 dB)');
});

test('barsText: Einzahl und Mehrzahl in beiden Sprachen', () => {
  assert.equal(barsText(1), '1 Takt');
  assert.equal(barsText(8), '8 Takte');
  setLanguage('en');
  assert.equal(barsText(1), '1 bar');
  assert.equal(barsText(8), '8 bars');
});

test('editPart: sperrt den Teil, ändert nur ihn und lässt die Eingabe unverändert', () => {
  const f = demo();
  const before = JSON.stringify(f);
  const r = editPart(f, 1, { type: 'chorus' });
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.index, 1);
  assert.deepEqual(r.form.sections[1], { type: 'chorus', bars: 8, locked: true });
  assert.deepEqual(r.form.sections.map((s) => s.locked), [undefined, true, undefined, undefined, undefined, undefined]);
  assert.ok(isValidForm(r.form));
});

test('editPart: Takte nur 1 bis 64 ganzzahlig und Summe höchstens 512; Typ nur aus der Liste', () => {
  const f = demo();
  assert.equal(editPart(f, 0, { bars: 0 }), null);
  assert.equal(editPart(f, 0, { bars: 65 }), null);
  assert.equal(editPart(f, 0, { bars: NaN }), null);
  assert.equal(editPart(f, 0, { bars: 7 }).form.sections[0].bars, 7);
  assert.equal(editPart(f, 0, { type: '<b>x</b>' }), null);
  assert.equal(editPart(f, 9, { bars: 4 }), null);
  const big = form(...Array.from({ length: 8 }, () => ['verse', 64]));
  assert.equal(formLength(big), 512);
  assert.equal(editPart(big, 0, { bars: 63 }).form.sections[0].bars, 63);
  assert.equal(editPart(form(['verse', 60], ...Array.from({ length: 7 }, () => ['verse', 64])), 0, { bars: 64 }).form.sections[0].bars, 64);
  assert.equal(editPart(form(['verse', 60], ...Array.from({ length: 7 }, () => ['verse', 64]), ['verse', 4]), 0, { bars: 64 }), null);
});

test('editPart: undefined entfernt das Feld (Zurücksetzen) und sperrt trotzdem', () => {
  const f = form(['verse', 8, { level: -9, density: 0.2 }]);
  const r = editPart(f, 0, { level: undefined });
  assert.deepEqual(r.form.sections[0], { type: 'verse', bars: 8, density: 0.2, locked: true });
});

test('setLocked schaltet nur die Sperre', () => {
  const f = demo();
  const r = setLocked(f, 2, true);
  assert.deepEqual(r.form.sections[2], { type: 'build', bars: 4, locked: true });
  assert.deepEqual(setLocked(r.form, 2, false).form.sections[2], { type: 'build', bars: 4, locked: false });
});

test('addPart: Strophe mit 8 Takten am Ende, gesperrt, Auswahl darauf; am Limit nicht', () => {
  const r = addPart(demo());
  assert.deepEqual(r.form.sections.at(-1), { type: 'verse', bars: 8, locked: true });
  assert.equal(r.index, 6);
  assert.equal(addPart(form(...Array.from({ length: 64 }, () => ['verse', 1]))), null);
  assert.equal(addPart(form(...Array.from({ length: 8 }, () => ['verse', 64]))), null);
  assert.ok(addPart(form(...Array.from({ length: 7 }, () => ['verse', 64]), ['verse', 56])));
});

test('copyPart: Kopie direkt dahinter, gesperrt, Auswahl auf der Kopie; Limits', () => {
  const r = copyPart(demo(), 3);
  assert.deepEqual(r.form.sections.slice(3, 5), [{ type: 'chorus', bars: 8 }, { type: 'chorus', bars: 8, locked: true }]);
  assert.equal(r.index, 4);
  assert.equal(copyPart(form(...Array.from({ length: 64 }, () => ['verse', 1])), 0), null);
  assert.equal(copyPart(form(...Array.from({ length: 8 }, () => ['verse', 64])), 0), null);
});

test('deletePart: der letzte verbleibende Teil bleibt; Auswahl rückt auf den Nachbarn', () => {
  assert.equal(deletePart(form(['verse', 8]), 0), null);
  const r = deletePart(demo(), 5);
  assert.equal(r.form.sections.length, 5);
  assert.equal(r.index, 4);
  assert.equal(deletePart(demo(), 1).index, 1);
});

test('movePart: tauscht mit dem Nachbarn, die Auswahl folgt, an den Rändern nichts', () => {
  const r = movePart(demo(), 1, -1);
  assert.deepEqual(r.form.sections.slice(0, 2).map((s) => s.type), ['verse', 'intro']);
  assert.equal(r.index, 0);
  assert.equal(movePart(demo(), 0, -1), null);
  assert.equal(movePart(demo(), 5, 1), null);
  assert.equal(movePart(demo(), 2, 1).index, 3);
});

test('limits: nennt die Gründe', () => {
  const l = limits(form(['verse', 8]), 0);
  assert.equal(l.canDelete, false);
  assert.deepEqual(l.reasons, ['form.limit.last']);
  assert.equal(l.canLeft || l.canRight, false);
  const many = limits(form(...Array.from({ length: 64 }, () => ['verse', 1])), 3);
  assert.equal(many.canAdd || many.canCopy, false);
  assert.ok(many.reasons.includes('form.limit.parts'));
  const full = limits(form(...Array.from({ length: 8 }, () => ['verse', 64])), 0);
  assert.equal(full.canLonger, false);
  assert.ok(full.reasons.includes('form.limit.length') && full.reasons.includes('form.limit.part'));
  assert.equal(limits(form(['verse', 1], ['verse', 4]), 0).canShorter, false);
});

test('jede Bearbeitung liefert eine gültige Form (alle Typen, Grenzen)', () => {
  let f = demo();
  for (const type of PART_TYPES) f = editPart(f, 0, { type }).form;
  for (let i = 0; i < 70; i++) f = (addPart(f) ?? { form: f }).form;
  assert.ok(isValidForm(f));
  assert.ok(f.sections.length <= 64);
});

test('Neu würfeln (reroll): dieselbe Variante, andere Teile; gesperrte bleiben stehen; ohne reroll wieder die Form der Variante', () => {
  state.style = 'rock';
  state.formTarget = 96;
  state.track.seed = 11;
  setFormTemplate('auto');
  const base = JSON.stringify(state.track.form.sections);
  state.track.form.sections[0].locked = true;
  const first = state.track.form.sections[0];
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    rollNewForm({ reroll: true });
    assert.deepEqual(state.track.form.sections[0], first, 'gesperrter Teil bleibt');
    assert.equal(state.track.length, formLength(state.track.form));
    seen.add(JSON.stringify(state.track.form.sections));
  }
  assert.ok(seen.size > 1, 'mehrere Würfe ergeben verschiedene Formen');
  state.track.form.sections[0].locked = false;
  rollNewForm();
  assert.equal(JSON.stringify(state.track.form.sections), base, 'Variante allein bestimmt die Form (Salz 0)');
});
