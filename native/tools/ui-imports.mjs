// The app's page (native/app/ui) stands on its own: no file imports a path that leaves the folder, and no page loads a script from elsewhere.
// Usage: node native/tools/ui-imports.mjs (a ctest test, ui_imports).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '../app/ui');

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const name = (file) => relative(ui, file).split(sep).join('/');
// what a file loads: a module's static and dynamic imports and re-exports, a page's scripts
function loads(file) {
  const text = readFileSync(file, 'utf8');
  const patterns = extname(file) === '.html' ? [/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi]
    : [/^\s*import\b[^'";()]*?['"]([^'"]+)['"]/gm, /^\s*export\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm, /\bimport\s*\(\s*['"]([^'"]+)['"]/g];
  const found = patterns.flatMap((p) => [...text.matchAll(p)].map((m) => m[1]));
  // a page's src is a URL: "app.js" is relative to it (a module's bare name is not)
  return extname(file) === '.html' ? found.map((s) => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(s) || s.startsWith('.') ? s : `./${s}`)) : found;
}
// the file a specifier names, or null when it leaves the folder (a bare name, a URL, an absolute path, a ../ above ui)
const target = (file, spec) => {
  if (!/^\.\.?\//.test(spec)) return null;
  const path = resolve(dirname(file), spec);
  return path.startsWith(ui + sep) ? path : null;
};

const problems = [];
const all = files(ui).filter((f) => ['.js', '.html'].includes(extname(f)));
for (const file of all) {
  for (const spec of loads(file)) {
    const to = target(file, spec);
    if (to === null) problems.push(`${name(file)} loads ${spec}, outside native/app/ui`);
    else if (!existsSync(to)) problems.push(`${name(file)} loads ${spec}, which does not exist`);
  }
}

for (const p of problems) console.log(p);
console.log(problems.length ? `ui-imports: ${problems.length} problems` : `ui-imports: ${all.length} files, every import inside native/app/ui`);
process.exitCode = problems.length ? 1 : 0;
