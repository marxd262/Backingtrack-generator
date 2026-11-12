// Sampler und Sample-Stimme ohne Browser: Aufrufe an einen aufzeichnenden Audio-Kontext (oneShot nur bei Zonen mit Schleife) und die
// Zufallsziehungen je Anschlag (immer zwei, auch wenn humanCents und humanDb 0 sind).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playNote } from '../../src/audio/voices/sampler.js';
import { sampleVoice } from '../../src/audio/voices/sample.js';

// Attrappe eines Audio-Kontexts: jeder Zugriff liefert wieder eine Attrappe, Aufrufe und Zuweisungen landen mit ihren Werten im Protokoll
function recorder(log, path = 'ctx') {
  return new Proxy(function () {}, {
    get: (_, k) => (k === 'then' ? undefined : recorder(log, `${path}.${String(k)}`)),
    set: (_, k, v) => { log.push(`${path}.${String(k)}=${typeof v === 'number' ? v : typeof v}`); return true; },
    apply: (_, __, args) => { log.push(`${path}(${args.map((a) => (typeof a === 'number' ? a : typeof a)).join(',')})`); return recorder(log, `${path}()`); },
  });
}

// Pack mit einem Sample von 0,3 s (wie die gedämpfte Gitarre ab Ton 51), mit oder ohne Schleife
const tinyPack = (loop) => ({
  meta: {
    samples: [{ offset: 0, frames: 13230, rate: 44100, loopStart: 1000, loopEnd: 12000 }],
    zones: [{ keyLo: 0, keyHi: 127, velLo: 0, velHi: 127, sample: 0, rootKey: 60, tuneCents: 0, loop, attenuationDb: 0, attack: 0, hold: 0, decay: 0, release: 0.3, sustainDb: 0 }],
  },
  pcm: new Int16Array(13230),
});

const calls = (pack, oneShot) => {
  const log = [];
  playNote(recorder(log), recorder([]), 0.05, { pack, midi: 60, dur: 2, vel: 0.8, oneShot });
  return log.filter((line) => !line.includes('getChannelData')); // das Füllen des Puffers ist bei beiden gleich und nur Lärm im Fehlerbericht
};

test('playNote: oneShot ändert nichts an einer Zone ohne Schleife; bei einer Zone mit Schleife wirkt es', () => {
  const plain = tinyPack(false);
  assert.deepEqual(calls(plain, true), calls(plain, false));
  const looped = tinyPack(true);
  assert.notDeepEqual(calls(looped, true), calls(looped, false));
});

test('Sample-Stimme der Gitarre: je Anschlag genau zwei Zufallsziehungen, auch bei humanCents 0 und humanDb 0', async () => {
  const pack = tinyPack(true);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(String(url).endsWith('.json') ? JSON.stringify(pack.meta) : pack.pcm.buffer.slice(0));
  try {
    const values = { level: 1, decay: 3, strum: 0, velExp: 1.6, softHz: 3500, oneShot: 1, humanCents: 0, humanDb: 0 };
    let draws = 0, loading;
    const voice = sampleVoice('test-rng-pack', 'chords', recorder([]), {
      getTimbre: () => ({ brightness: 0.5, length: 0.5 }), tuned: (name) => values[name] ?? NaN, classic: () => assert.fail('Rückfall statt Sample'),
      setStatus() {}, track: (p) => { loading = p; }, rng: { next: () => { draws++; return 0.5; } },
    });
    await loading;
    for (const midi of [52, 57, 64]) voice(recorder([]), 0.1, { type: 'note', midi, dur: 0.5, vel: 0.8, t: 0 });
    assert.equal(draws, 6);
  } finally {
    globalThis.fetch = realFetch;
  }
});
