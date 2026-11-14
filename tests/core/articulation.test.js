// Artikulations-Schicht (Phase 3, core/articulation.js): aus = unveränderter Strom; Stil-Profil aus Groove und Schlagworten; Regeln je Schicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, STYLE_PRESETS, GROOVES } from '../../src/index.js';
import { profileOf, completeArt, ART_DEFAULTS } from '../../src/core/articulation.js';
import { pickArtZone } from '../../src/audio/voices/sample-zones.js';

const bar = (root, quality) => ({ chord: { root, quality }, beats: 4 });
const style = (id) => STYLE_PRESETS.find((s) => s.id === id);
const mk = (id, over = {}) => ({
  key: { root: 'A', mode: 'minor' }, bpm: style(id).bpm, seed: 3, length: 8, tags: { ...style(id).tags, development: ['fullFromStart'] },
  bars: [bar('A', 'min'), bar('A', 'min'), bar('D', 'min'), bar('E', 'maj')],
  layers: { drums: true, bass: true, chords: true, pad: true },
  voices: { bass: { id: 'sample', variant: 'finger' }, chords: { id: 'sample', variant: 'guitar' } },
  ...over,
});
const ON = { ornaments: { on: 1 } };

test('aus ist der Standard: gleicher Strom wie ohne die Schicht; Regler 0 schaltet alles ab; ungültiger Regler wirft', () => {
  assert.equal(ART_DEFAULTS.on, 0);
  assert.deepEqual(completeArt({ on: 1, bass: -1, chords: 'x' }), { ...ART_DEFAULTS, on: 1 });
  for (const id of ['funk', 'rock', 'blues']) {
    assert.deepEqual(buildEvents(mk(id)), buildEvents(mk(id), { ornaments: { on: 0 } }));
    assert.deepEqual(buildEvents(mk(id, { ornaments: 0 }), ON), buildEvents(mk(id)));
    assert.deepEqual(buildEvents(mk(id), { ornaments: { on: 1, bass: 0, chords: 0 } }), buildEvents(mk(id)));
  }
  assert.throws(() => buildEvents(mk('funk', { ornaments: 2 })), /badOrnaments/);
});

test('Stil-Profil: jeder Stil der App und jeder Groove ergibt das Profil aus SPEC_PHASE3, Abschnitt 6', () => {
  const styles = { funk: 'funk', psych: 'rock', dreamy: 'ballad', blues: 'shuffle', rock: 'rock', hardrock: 'rock', reggae: 'reggae', country: 'country', poppunk: 'rock' };
  assert.deepEqual(Object.fromEntries(STYLE_PRESETS.map((s) => [s.id, profileOf({ tags: s.tags })])), styles);
  const grooves = { straight: 'rock', latin: 'latin', waltz: 'ballad', waltzRock: 'rock', ballad68: 'ballad', rock68: 'rock', shuffle: 'shuffle', slowBlues: 'slowBlues', fiveFour: 'rock' };
  assert.deepEqual(Object.fromEntries(Object.keys(GROOVES).map((id) => [id, profileOf({ groove: id, meter: GROOVES[id].meter.split('/').map(Number), tags: style('rock').tags })])), grooves);
});

test('Sample-Gruppen: eine Artikulation nimmt die Zone mit ihrem art, wenn das Pack eine hat; normale Noten nehmen nie eine art-Zone', () => {
  const zone = (art) => ({ keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, art });
  const plain = zone(undefined), dead = zone('dead');
  assert.equal(pickArtZone([dead, plain], 40, 0.8, 'dead'), dead);
  assert.equal(pickArtZone([dead, plain], 40, 0.8, 'palmMute'), plain); // keine eigene Gruppe: normale Zone, die Stimme rechnet
  assert.equal(pickArtZone([dead, plain], 40, 0.8, undefined), plain);
  assert.equal(pickArtZone([plain], 40, 0.8, 'dead'), plain);
  assert.equal(pickArtZone(null, 40, 0.8, 'dead'), null);
});
