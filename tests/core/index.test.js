import { test } from 'node:test';
import assert from 'node:assert/strict';

// R3: Einstiegspunkt samt allen Importen lädt in reinem Node (keine Browser-Globals beim Import)
test('src/index.js lädt in Node und exportiert die Schnittstelle', async () => {
  const api = await import('../../src/index.js');
  for (const name of ['play', 'buildEvents', 'validateTrack']) assert.equal(typeof api[name], 'function', name);
  assert.ok(Array.isArray(api.TAG_CATEGORIES) && api.TAG_CATEGORIES.length > 0);
  assert.ok(Array.isArray(api.STYLE_PRESETS) && api.STYLE_PRESETS.length > 0);
});
