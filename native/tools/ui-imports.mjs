// The app's pages (native/app/ui) stand on their own: no module imports a path that leaves the folder, no page loads a script from elsewhere, and
// every other link of a page (src, href) and of a stylesheet (url()) is http(s):, data: or a file of the folder. The one exception: the packs'
// licence texts, which the shell serves under /samples/ from the packs' folder (PluginEditor.cpp; credits.html links them).
// Usage: node native/tools/ui-imports.mjs (a ctest test, ui_imports).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '../app/ui');
const packs = resolve(ui, '../../../src/assets/samples'); // the packs' folder (BTG_WEB_ROOT, native/app/CMakeLists.txt)

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const name = (file) => relative(ui, file).split(sep).join('/');
const matches = (text, patterns) => patterns.flatMap((p) => [...text.matchAll(p)].map((m) => m.at(-1)));
// a page's src or href is a URL: "app.js" is relative to it (a module's bare name is not)
const relativeUrl = (s) => (/^([a-z][a-z0-9+.-]*:|\/)/i.test(s) || s.startsWith('.') ? s : `./${s}`);
// what a file loads, as [specifier, may it be http(s): or data:]: a module's static and dynamic imports and re-exports; a page's scripts, and its
// other src and href; a stylesheet's url()
function loads(file) {
  const text = readFileSync(file, 'utf8');
  if (extname(file) === '.css') return matches(text, [/url\(\s*(['"]?)([^'")]+)\1\s*\)/g]).map((s) => [relativeUrl(s), true]);
  if (extname(file) === '.js') {
    return matches(text, [/^\s*import\b[^'";()]*?['"]([^'"]+)['"]/gm, /^\s*export\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm, /\bimport\s*\(\s*['"]([^'"]+)['"]/g]).map((s) => [s, false]);
  }
  const scripts = matches(text, [/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi]);
  const links = matches(text, [/<(?!script\b)[a-z][^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi]);
  return [...scripts.map((s) => [relativeUrl(s), false]), ...links.map((s) => [relativeUrl(s), true])];
}
// the file a specifier names, or null when it leaves the folder (a bare name, a URL, an absolute path, a ../ above ui)
const target = (file, spec) => {
  if (!/^\.\.?\//.test(spec)) return null;
  const path = resolve(dirname(file), spec);
  return path.startsWith(ui + sep) ? path : null;
};
const licence = (spec) => /^\/samples\/LICENSE-[^/\\]+$/.test(spec) ? join(packs, spec.slice('/samples/'.length)) : null;

const problems = [];
const all = files(ui).filter((f) => ['.js', '.html', '.css'].includes(extname(f)));
for (const file of all) {
  for (const [spec, external] of loads(file)) {
    if (external && /^(https?:|data:)/i.test(spec)) continue;
    const to = target(file, spec) ?? licence(spec);
    if (to === null) problems.push(`${name(file)} loads ${spec}, outside native/app/ui`);
    else if (!existsSync(to)) problems.push(`${name(file)} loads ${spec}, which does not exist`);
  }
}

for (const p of problems) console.log(p);
console.log(problems.length ? `ui-imports: ${problems.length} problems` : `ui-imports: ${all.length} files, every import and link inside native/app/ui`);
process.exitCode = problems.length ? 1 : 0;
