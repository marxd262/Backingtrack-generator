// Reine Helfer des Ziehens im Profil-Baum (ohne DOM): wann ein Druck auf den Griff zum Ziehen wird, wie schnell der Baum am Rand scrollt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LONG_PRESS_MS, MOVE_TOLERANCE_PX, EDGE_PX, EDGE_STEP_PX, pressState, edgeStep } from '../../src/ui/profile-drag.js';

test('Konstanten wie vereinbart', () => {
  assert.equal(LONG_PRESS_MS, 400);
  assert.equal(MOVE_TOLERANCE_PX, 8);
});

test('pressState Maus: zieht erst nach mehr als 8 px, Halten allein zieht nie', () => {
  assert.equal(pressState('mouse', 0, 0), 'wait');
  assert.equal(pressState('mouse', MOVE_TOLERANCE_PX, 0), 'wait');
  assert.equal(pressState('mouse', 0, 5000), 'wait');
  assert.equal(pressState('mouse', MOVE_TOLERANCE_PX + 1, 10), 'drag');
});

test('pressState Touch und Stift: Bewegung vor 400 ms ist Scrollen, Halten ab 400 ms ohne Bewegung zieht', () => {
  for (const type of ['touch', 'pen']) {
    assert.equal(pressState(type, 0, 0), 'wait', type);
    assert.equal(pressState(type, MOVE_TOLERANCE_PX, LONG_PRESS_MS - 1), 'wait', type);
    assert.equal(pressState(type, MOVE_TOLERANCE_PX + 1, 10), 'scroll', type);
    assert.equal(pressState(type, MOVE_TOLERANCE_PX + 1, LONG_PRESS_MS - 1), 'scroll', type);
    assert.equal(pressState(type, 0, LONG_PRESS_MS), 'drag', type);
    assert.equal(pressState(type, MOVE_TOLERANCE_PX, LONG_PRESS_MS + 100), 'drag', type);
    assert.equal(pressState(type, MOVE_TOLERANCE_PX + 1, LONG_PRESS_MS + 100), 'scroll', type); // erst bewegt, dann gehalten: kein Ziehen
  }
});

test('edgeStep: 0 in der Mitte, nach oben negativ und nach unten positiv, am Rand und darüber hinaus am schnellsten', () => {
  const [top, bottom] = [100, 500];
  assert.equal(edgeStep(300, top, bottom), 0);
  assert.equal(edgeStep(top + EDGE_PX, top, bottom), 0);
  assert.equal(edgeStep(bottom - EDGE_PX, top, bottom), 0);
  assert.ok(edgeStep(top + EDGE_PX - 1, top, bottom) < 0);
  assert.ok(edgeStep(bottom - EDGE_PX + 1, top, bottom) > 0);
  assert.ok(edgeStep(top + 2, top, bottom) < edgeStep(top + EDGE_PX / 2, top, bottom)); // näher am Rand: schneller
  assert.equal(edgeStep(top, top, bottom), -EDGE_STEP_PX);
  assert.equal(edgeStep(top - 200, top, bottom), -EDGE_STEP_PX);
  assert.equal(edgeStep(bottom + 200, top, bottom), EDGE_STEP_PX);
  // sehr niedriger Baum: die Ränder überlappen, die Mitte scrollt nicht
  assert.equal(edgeStep(130, 100, 160), 0);
});
