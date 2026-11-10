// Live-Änderungen am laufenden Player (setTimbre, setTrack) mit Attrappen-Kontext: currentTime steuert der Test selbst,
// der Planer (setInterval, 25 ms) läuft echt. Kein Browser nötig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { play } from '../../src/audio/play.js';
import { buildEvents } from '../../src/core/events.js';

const node = () => {
  const n = { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, disconnect() {} };
  n.connect = (target) => target ?? n;
  return n;
};
const makeCtx = () => ({ currentTime: 0, destination: node(), createGain: node });

// Spion-Instrumente: merken sich Aufrufe von trigger und setTimbre
function spy() {
  const calls = { trigger: [], timbre: [], voices: [], created: [] };
  const create = (_ctx, options) => {
    calls.created.push(options);
    const layers = {};
    for (const name of ['drums', 'bass', 'chords', 'pad']) {
      layers[name] = { trigger: (e, when) => calls.trigger.push({ layer: name, e, when }), setMuted() {} };
    }
    return { output: node(), layers, setTimbre: (x) => calls.timbre.push(x), setVoices: (x) => calls.voices.push(x) };
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

// --- setTrack: Ereignisstrom im laufenden Betrieb tauschen (240 bpm, ein Takt = 1 s, Durchlauf = 4 s, Vorlauf 0,15 s) ---
const TAGS_B = { development: ['fullFromStart'], rhythm: ['syncopated'], synths: ['arpeggio'] };
const isSound = (e) => e.type === 'hit' || e.type === 'note';
const key = (layer, e) => `${layer}|${e.name ?? e.midi}|${Math.round(e.t * 1000)}`;
// Schlüssel der Ereignisse eines Stroms (Schicht, Name oder MIDI, Zeit in ms), shift = Versatz um ganze Durchläufe
const streamKeys = (events, pick, shift = 0) => events.filter((e) => isSound(e) && pick(e)).map((e) => key(e.layer, { ...e, t: e.t + shift })).sort();

async function setup(extra = {}) {
  const { calls, create } = spy();
  const ctx = makeCtx();
  const bars = [];
  const h = play(ctx, track(extra), { loops: Infinity, createInstruments: create, onBar: (b) => bars.push(b.bar) });
  return {
    h, bars,
    advance: async (to) => { ctx.currentTime = to; await tick(); await tick(); },
    keysOf: (pick) => calls.trigger.filter((c) => pick(c.e)).map((c) => key(c.layer, c.e)).sort(),
  };
}
const unique = (keys) => assert.equal(new Set(keys).size, keys.length, 'kein Ereignis doppelt');

test('setTrack mitten im Durchlauf: danach spielt der neue Strom, nichts doppelt, kein Takt fehlt', async () => {
  const A = buildEvents(track()), B = buildEvents(track({ tags: TAGS_B }));
  const s = await setup();
  try {
    await s.advance(1.5);
    assert.equal(s.h.setTrack(track({ tags: TAGS_B })), true);
    await s.advance(4.0);
    const late = (e) => e.bar >= 2 && e.bar <= 3;
    assert.notDeepEqual(streamKeys(A, late), streamKeys(B, late), 'die Ströme müssen sich unterscheiden, sonst prüft der Test nichts');
    assert.deepEqual(s.keysOf(late), streamKeys(B, late));
    unique(s.keysOf(() => true));
    assert.deepEqual(s.bars, [0, 1, 2, 3]);
  } finally {
    s.h.stop();
  }
});

test('setTrack, wenn alle Ereignisse des Durchlaufs geplant sind: der nächste Durchlauf spielt den neuen Strom ohne Doppelung', async () => {
  const A = buildEvents(track()), B = buildEvents(track({ tags: TAGS_B }));
  const maxA = Math.max(...A.map((e) => e.t));
  assert.ok(maxA < 3.99 && Math.max(...B.map((e) => e.t)) < 3.98, 'Vorbedingung: Ereignisse liegen deutlich vor dem Durchlaufende');
  const s = await setup();
  try {
    await s.advance(maxA + 0.06); // Horizont deckt das letzte Ereignis, das Durchlaufende (4,15) noch nicht
    assert.equal(s.h.setTrack(track({ tags: TAGS_B })), true);
    await s.advance(8.04);
    // Durchlauf 1: alle schon geplanten alten Ereignisse plus die neuen, die nach dem letzten geplanten alten liegen
    assert.deepEqual(s.keysOf((e) => e.bar < 4), [...streamKeys(A, () => true), ...streamKeys(B, (e) => e.t > maxA)].sort());
    assert.deepEqual(s.keysOf((e) => e.bar >= 4 && e.bar < 8), streamKeys(B, () => true, 4));
    unique(s.keysOf(() => true));
    assert.deepEqual(s.bars.slice(0, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  } finally {
    s.h.stop();
  }
});

test('setTrack direkt nach dem Umbruch in den nächsten Durchlauf: kein Takt doppelt oder fehlend', async () => {
  const B = buildEvents(track({ tags: TAGS_B }));
  const s = await setup();
  try {
    await s.advance(4.055);
    assert.equal(s.h.setTrack(track({ tags: TAGS_B })), true);
    await s.advance(8.04);
    const late = (e) => e.bar >= 5 && e.bar < 8;
    assert.deepEqual(s.keysOf(late), streamKeys(B, (e) => e.bar >= 1, 4));
    unique(s.keysOf(() => true));
    assert.deepEqual(s.bars.slice(0, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  } finally {
    s.h.stop();
  }
});

test('setTrack liefert false und ändert nichts bei anderer Länge oder anderer Taktlänge; ungültiger Track wirft', async () => {
  const A = buildEvents(track());
  const s = await setup();
  try {
    await s.advance(1.5);
    assert.equal(s.h.setTrack(track({ length: 8, tags: TAGS_B })), false);
    const odd = track({ tags: TAGS_B });
    odd.bars = odd.bars.map((b, i) => (i === 1 ? { ...b, beats: 3 } : b));
    assert.equal(s.h.setTrack(odd), false);
    assert.throws(() => s.h.setTrack(track({ tags: { nope: ['x'] } })));
    await s.advance(4.0);
    const early = (e) => e.t <= 3.9;
    assert.deepEqual(s.keysOf(early), streamKeys(A, early), 'der alte Strom läuft unverändert weiter');
  } finally {
    s.h.stop();
  }
});

test('setTrack nach setTempo: Liedzeiten bleiben auf das Starttempo bezogen, das bpm des übergebenen Tracks zählt nicht', async () => {
  const B = buildEvents(track({ tags: TAGS_B }));
  const s = await setup();
  try {
    await s.advance(0.3);
    s.h.setTempo(400);
    assert.equal(s.h.setTrack(track({ tags: TAGS_B, bpm: 400 })), true);
    await s.advance(3.0);
    const bar3 = (e) => e.bar === 3;
    assert.deepEqual(s.keysOf(bar3), streamKeys(B, bar3));
  } finally {
    s.h.stop();
  }
});

test('setTrack nach stop() liefert false und wirft nicht', async () => {
  const s = await setup();
  s.h.stop();
  assert.equal(s.h.setTrack(track({ tags: TAGS_B })), false);
});

test('setTrack meldet false bei geänderter Taktart, auch wenn die Dauer eines Durchlaufs gleich bleibt (4/4 zu 12/8)', async () => {
  const A = buildEvents(track());
  const s = await setup();
  try {
    await s.advance(1.5);
    assert.equal(s.h.setTrack(track({ meter: [12, 8] })), false);
    assert.equal(s.h.setTrack(track({ meter: [3, 4], bars: track().bars.map((b) => ({ ...b, beats: 4 })) })), false, 'auch 3/4 mit gleich langen Takten');
    await s.advance(4.0);
    const early = (e) => e.t <= 3.9;
    assert.deepEqual(s.keysOf(early), streamKeys(A, early), 'der alte Strom läuft unverändert weiter');
  } finally {
    s.h.stop();
  }
});

test('setTrack: anderer Groove oder andere Komplexität bei gleicher Taktart tauscht live, meter fehlend und [4,4] sind dieselbe Taktart', async () => {
  const A = buildEvents(track());
  const B = buildEvents(track({ groove: 'latin', complexity: 0.9 }));
  const s = await setup();
  try {
    await s.advance(1.5);
    assert.equal(s.h.setTrack(track({ groove: 'latin', complexity: 0.9, meter: [4, 4] })), true);
    await s.advance(4.0);
    const late = (e) => e.bar >= 2 && e.bar <= 3;
    assert.notDeepEqual(streamKeys(A, late), streamKeys(B, late), 'die Ströme müssen sich unterscheiden, sonst prüft der Test nichts');
    assert.deepEqual(s.keysOf(late), streamKeys(B, late));
  } finally {
    s.h.stop();
  }
});

test('setVoices reicht die Eingabe genau einmal an die Instrumente weiter, nach stop() nicht mehr', async () => {
  const { calls, create } = spy();
  const h = play(makeCtx(), track(), { loops: Infinity, createInstruments: create });
  const voices = { bass: { id: 'string', variant: 'finger' } };
  h.setVoices(voices);
  assert.deepEqual(calls.voices, [voices]);
  h.stop();
  h.setVoices({ bass: { id: 'synth' } });
  assert.deepEqual(calls.voices, [voices]);
  await tick();
});

test('play gibt die aufgefüllte Stimmenwahl des Tracks an die Instrumente (Standard, wenn fehlend); Ungültiges wirft wie bei den anderen Feldern', async () => {
  for (const [voices, expected] of [
    [undefined, 'synth/classic'], [null, 'synth/classic'], [{}, 'synth/classic'], [{ bass: 'string' }, 'string/finger'], [{ bass: { id: 'string', variant: 'finger' } }, 'string/finger'],
  ]) {
    const { calls, create } = spy();
    const h = play(makeCtx(), track(voices === undefined ? {} : { voices }), { loops: Infinity, createInstruments: create });
    h.stop();
    const bass = calls.created[0].voices.bass;
    assert.equal(`${bass.id}/${bass.variant}`, expected, JSON.stringify(voices));
  }
  for (const bad of ['x', [], { bass: { id: 'nope' } }, { drums: {} }]) {
    const { create } = spy();
    assert.throws(() => play(makeCtx(), track({ voices: bad }), { createInstruments: create }), /badVoice/, JSON.stringify(bad));
  }
});

test('Instrumente ohne setVoices bleiben gültig', async () => {
  const create = () => ({ output: node(), layers: Object.fromEntries(['drums', 'bass', 'chords', 'pad'].map((n) => [n, { trigger() {}, setMuted() {} }])) });
  const h = play(makeCtx(), track(), { loops: Infinity, createInstruments: create });
  try {
    assert.doesNotThrow(() => h.setVoices({}));
  } finally {
    h.stop();
  }
});
