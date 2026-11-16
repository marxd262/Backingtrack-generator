// Namensnennung: jede Lizenzdatei der Packs steht in CREDITS.md und auf der Credits-Seite der App, die Startseite verlinkt die Seite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('jede LICENSE-*.md der Packs steht in CREDITS.md und in src/ui/credits.html; index.html verlinkt credits.html', () => {
  const files = readdirSync(new URL('../../src/assets/samples/', import.meta.url)).filter((f) => /^LICENSE-.+\.md$/.test(f));
  assert.ok(files.length >= 3);
  const credits = read('CREDITS.md'), page = read('src/ui/credits.html');
  for (const f of files) {
    assert.ok(credits.includes(f), `CREDITS.md: ${f}`);
    assert.ok(page.includes(`../assets/samples/${f}`), `credits.html: ${f}`);
  }
  assert.match(read('src/ui/index.html'), /href="credits\.html"/);
});
