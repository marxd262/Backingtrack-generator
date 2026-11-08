// Wächter gegen eingeschlichene Steuerzeichen in den Quellen (z. B. ein kaputter CSS-Escape wie '\25B8', der als Byte 0x15 landete
// und als Müll in der Oberfläche und im zugänglichen Namen erschien). Erlaubt sind nur Tab, Zeilenvorschub und Wagenrücklauf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

test('keine Steuerzeichen in src (css, js, html)', () => {
  const files = walk(ROOT).filter((f) => /\.(css|js|html)$/.test(f));
  assert.ok(files.length > 20);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const at = text.search(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    assert.equal(at, -1, `${file}: Steuerzeichen an Position ${at}`);
  }
});
