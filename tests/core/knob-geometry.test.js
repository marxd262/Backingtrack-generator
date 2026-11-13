// Winkel und Bogen der Drehknöpfe: reine Geometrie, ohne DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knobAngle, knobArc } from '../../src/ui/knob-geometry.js';

test('Zeigerwinkel läuft von -135 bis 135 Grad', () => {
  assert.equal(knobAngle(0, 0, 100), -135);
  assert.equal(knobAngle(50, 0, 100), 0);
  assert.equal(knobAngle(100, 0, 100), 135);
  assert.equal(knobAngle(120, 40, 200), 0); // Wertebereich ungleich 0..100
  assert.equal(knobAngle(-5, 0, 100), -135); // außerhalb wird begrenzt
  assert.equal(knobAngle(7, 7, 7), -135); // leere Spanne
});

test('Bogen ab Mitte: links vom Zeiger zur Mitte, rechts von der Mitte zum Zeiger', () => {
  assert.deepEqual(knobArc(25, 0, 100, 'center'), { from: -67.5, to: 0, side: 'left' });
  assert.deepEqual(knobArc(80, 0, 100, 'center'), { from: 0, to: 81, side: 'right' });
  assert.equal(knobArc(50, 0, 100, 'center'), null);
});

test('Bogen ab linkem Anschlag ist immer rechts, ohne Bogen bei Anschlag oder none', () => {
  assert.deepEqual(knobArc(30, 0, 100, 'start'), { from: -135, to: -54, side: 'right' });
  assert.equal(knobArc(0, 0, 100, 'start'), null);
  assert.equal(knobArc(70, 0, 100, 'none'), null);
});
