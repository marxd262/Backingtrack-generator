import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_LAYERS } from '../../src/core/voices.js';
import { LAYERS, LAYER_IDS, layerDefaults, jobsFor, isJob, completeJobs } from '../../src/core/layers.js';

const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => v === null || typeof v !== 'object' || deepFrozen(v));

test('LAYER_IDS: die vier bisherigen Schichten in fester Reihenfolge, dahinter Lead und Percussion', () => {
  assert.deepEqual(LAYER_IDS, ['drums', 'bass', 'chords', 'pad', 'lead', 'percussion']);
  assert.deepEqual(LAYER_IDS, Object.keys(LAYERS));
});

test('Registry ist tief eingefroren', () => {
  assert.ok(deepFrozen(LAYERS));
  assert.ok(Object.isFrozen(LAYER_IDS));
});

test('layerDefaults: Lead an, Percussion aus, jedes Mal ein neues Objekt', () => {
  assert.deepEqual(layerDefaults(), { drums: true, bass: true, chords: true, pad: true, lead: true, percussion: false });
  assert.notEqual(layerDefaults(), layerDefaults());
});

test('jobsFor / isJob: nur Lead und Percussion haben Aufgaben, die erste ist der Standard', () => {
  assert.deepEqual(jobsFor('drums'), []);
  assert.deepEqual(jobsFor('unbekannt'), []);
  assert.deepEqual(jobsFor('lead'), ['off', 'fills', 'arpeggio', 'melody', 'callResponse']);
  assert.deepEqual(jobsFor('percussion'), ['mixed', 'shaker', 'tambourine', 'congas', 'bongos', 'claves', 'cowbell']);
  assert.equal(isJob('drums', 'x'), false);
  assert.equal(isJob('lead', 'melody'), true);
  assert.equal(isJob('lead', 'mixed'), false);
});

test('completeJobs: fehlende und ungültige Angaben bekommen die erste Aufgabe, Eingabe bleibt unverändert', () => {
  assert.deepEqual(completeJobs(), { lead: 'off', percussion: 'mixed' });
  assert.deepEqual(completeJobs('str'), { lead: 'off', percussion: 'mixed' });
  assert.deepEqual(completeJobs({ lead: 'melody', percussion: 'nope', x: 'y' }), { lead: 'melody', percussion: 'mixed' });
  const given = { nope: 'x' };
  completeJobs(given);
  assert.deepEqual(given, { nope: 'x' });
});

test('Mischpult leitet seine Namen aus der Registry ab', async () => {
  const { MIX_NAMES } = await import('../../src/audio/mix.js');
  const { DEFAULT_MIX, loadMix } = await import('../../src/ui/mix-state.js');
  assert.deepEqual(MIX_NAMES, [...LAYER_IDS, 'master']);
  assert.deepEqual(Object.keys(DEFAULT_MIX), MIX_NAMES);
  const stored = loadMix({ getItem: () => JSON.stringify({ drums: 0.5, bass: 0.25 }) });
  assert.deepEqual(stored, { ...Object.fromEntries(MIX_NAMES.map((n) => [n, 1])), drums: 0.5, bass: 0.25 });
});

test('keine handgeschriebene Schichtliste mehr in src (außer der Registry)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = readdirSync('src', { recursive: true }).filter((f) => /\.(js|html)$/.test(f)).map((f) => f.replaceAll('\\', '/'));
  const bad = files.filter((f) => f !== 'core/layers.js' && /'drums', 'bass', 'chords', 'pad'|pad: true/.test(readFileSync(`src/${f}`, 'utf8')));
  assert.deepEqual(bad, []);
});

test('Audio-Tabelle hat genau die Schichten der Registry', async () => {
  const { LAYER_AUDIO } = await import('../../src/audio/synth.js');
  assert.deepEqual(Object.keys(LAYER_AUDIO), [...LAYER_IDS]);
});

test('fx-Schichten haben ein Effektprofil, fx: false keines', async () => {
  const { LAYER_FX } = await import('../../src/audio/fx-params.js');
  assert.deepEqual(LAYER_IDS.filter((id) => LAYERS[id].fx), Object.keys(LAYER_FX));
  assert.equal(LAYERS.percussion.fx, false);
});

test('VOICE_LAYERS entspricht LAYER_IDS: synth.js ruft impl[name] für jede Schicht, eine Schicht ohne VOICES-Eintrag würfe beim ersten Ereignis', () => {
  assert.deepEqual([...VOICE_LAYERS], [...LAYER_IDS]);
});
