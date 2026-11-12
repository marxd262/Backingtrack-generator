import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { positionLabel, chordAtBar } from '../../src/ui/position.js';
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

test('positionLabel ohne gültige Länge zeigt nichts statt NaN', () => {
  setLanguage('de');
  for (const length of [0, undefined, -4, NaN]) assert.equal(positionLabel(3, length), '', String(length));
});

test('chordAtBar: mit Form beginnt die Folge in jedem Teil neu, ohne Form läuft sie im Kreis', () => {
  const chord = (root) => ({ root, quality: 'maj' });
  const bars = ['A', 'B', 'C'].map((root) => ({ chord: chord(root), beats: 4 }));
  const form = { template: 'pop', sections: [{ type: 'verse', bars: 4 }, { type: 'chorus', bars: 4 }] };
  const withForm = { bars, length: 8, form };
  // Takt 4 ist der erste des zweiten Teils: wieder A; ohne Form wäre es B (4 mod 3)
  assert.equal(chordAtBar(withForm, 4).root, 'A');
  assert.equal(chordAtBar(withForm, 6).root, 'C');
  assert.equal(chordAtBar(withForm, 12).root, 'A'); // zweiter Durchlauf zählt weiter
  assert.equal(chordAtBar({ bars, length: 8 }, 4).root, 'B');
});
