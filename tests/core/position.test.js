import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { positionLabel } from '../../src/ui/position.js';
import { setLanguage } from '../../src/i18n/index.js';

after(() => setLanguage('de'));

test('positionLabel zählt 1-basiert und beginnt nach jedem Durchlauf neu', () => {
  setLanguage('de');
  assert.equal(positionLabel(0, 96), 'Takt 1 von 96');
  assert.equal(positionLabel(95, 96), 'Takt 96 von 96');
  assert.equal(positionLabel(96, 96), 'Takt 1 von 96');
  assert.equal(positionLabel(200, 96), 'Takt 9 von 96');
  assert.equal(positionLabel(7, 4), 'Takt 4 von 4');
  setLanguage('en');
  assert.equal(positionLabel(4, 4), 'Bar 1 of 4');
});
