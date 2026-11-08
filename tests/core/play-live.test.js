// Live-Änderungen am laufenden Player (setTimbre, setTrack) mit Attrappen-Kontext: currentTime steuert der Test selbst,
// der Planer (setInterval, 25 ms) läuft echt. Kein Browser nötig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { play } from '../../src/audio/play.js';

const node = () => {
  const n = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} };
  n.connect = (target) => target ?? n;
  return n;
};
const makeCtx = () => ({ currentTime: 0, destination: node(), createGain: node });

// Spion-Instrumente: merken sich Aufrufe von trigger und setTimbre
function spy() {
  const calls = { trigger: [], timbre: [] };
  const create = () => {
    const layers = {};
    for (const name of ['drums', 'bass', 'chords', 'pad']) {
      layers[name] = { trigger: (e, when) => calls.trigger.push({ layer: name, e, when }), setMuted() {} };
    }
    return { output: node(), layers, setTimbre: (x) => calls.timbre.push(x) };
  };
  return { calls, create };
}

const track = (extra = {}) => ({
  key: { root: 'A', mode: 'minor' },
  bpm: 240,
  bars: [['A', 'min'], ['A', 'min'], ['D', 'min'], ['E', 'maj']].map(([root, quality]) => ({ chord: { root, quality }, beats: 4 })),
  length: 4,
  tags: { development: ['fullFromStart'] },
  seed: 1,
  ...extra,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 70)); // mehr als zwei Planer-Takte

test('setTimbre reicht die Eingabe genau einmal an die Instrumente weiter', async () => {
  const { calls, create } = spy();
  const h = play(makeCtx(), track(), { loops: Infinity, createInstruments: create });
  try {
    const timbre = { bass: { fuzz: 0.8 } };
    h.setTimbre(timbre);
    assert.deepEqual(calls.timbre, [timbre]);
  } finally {
    h.stop();
  }
});

test('setTimbre nach stop() tut nichts und wirft nicht', async () => {
  const { calls, create } = spy();
  const h = play(makeCtx(), track(), { loops: Infinity, createInstruments: create });
  h.stop();
  assert.doesNotThrow(() => h.setTimbre({ bass: { fuzz: 1 } }));
  assert.deepEqual(calls.timbre, []);
  await tick();
});

test('Instrumente ohne setTimbre bleiben gültig', async () => {
  const create = () => ({ output: node(), layers: Object.fromEntries(['drums', 'bass', 'chords', 'pad'].map((n) => [n, { trigger() {}, setMuted() {} }])) });
  const h = play(makeCtx(), track(), { loops: Infinity, createInstruments: create });
  try {
    assert.doesNotThrow(() => h.setTimbre({}));
  } finally {
    h.stop();
  }
});
