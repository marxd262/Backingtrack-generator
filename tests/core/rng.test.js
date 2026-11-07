import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng.next());

test('gleicher Seed ergibt gleiche Folge', () => {
  assert.deepEqual(take(createRng(42), 10), take(createRng(42), 10));
});

test('verschiedene Seeds unterscheiden sich', () => {
  assert.notDeepEqual(take(createRng(1), 10), take(createRng(2), 10));
});

test('Werte liegen in [0,1) auch bei Seed 0 und 2**32+5', () => {
  for (const seed of [0, 2 ** 32 + 5]) {
    for (const v of take(createRng(seed), 1000)) assert.ok(v >= 0 && v < 1);
  }
});

test('int und pick bleiben im Bereich', () => {
  const rng = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const n = rng.int(3, 6);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 6);
    seen.add(n);
  }
  assert.equal(seen.size, 4);
  assert.ok(['x', 'y', 'z'].includes(rng.pick(['x', 'y', 'z'])));
});

test('fork: a ungleich b, a reproduzierbar', () => {
  const a1 = take(createRng(5).fork('a'), 10);
  const a2 = take(createRng(5).fork('a'), 10);
  const b = take(createRng(5).fork('b'), 10);
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
});
