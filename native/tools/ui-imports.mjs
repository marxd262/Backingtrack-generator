// The app's page (native/app/ui) stands on its own: no file imports a path that leaves the folder, no page loads a script from elsewhere, and
// what the pages load does not reach a file that is still the web's. Usage: node native/tools/ui-imports.mjs (a ctest test, ui_imports).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '../app/ui');
// shortcut: the files of 32b-2 are still the web's, upgrade: the list is empty after 32b-2
const WEB_FILES = [
  'progression-editor.js', 'form-panel.js', 'form-strip.js', 'form-ui.js', 'profiles.js', 'profile-parts-picker.js', 'profile-tree-view.js', 'profile-drag.js',
  'fretboard.js', 'wheel.js', 'wheel-geometry.js',
  // what only they import, deleted with them
  'state.js', 'profile-store.js', 'profile-factory.js', 'profile-session.js', 'mix-state.js',
];

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
for (const listed of WEB_FILES) if (!existsSync(join(ui, listed))) problems.push(`${listed} is in the list of the web's files, but it is gone: take it out of the list`);
for (const file of all) {
  for (const spec of loads(file)) {
    const to = target(file, spec);
    if (to === null && !WEB_FILES.includes(name(file))) problems.push(`${name(file)} loads ${spec}, outside native/app/ui`);
    else if (to !== null && !existsSync(to)) problems.push(`${name(file)} loads ${spec}, which does not exist`);
  }
}
// from every page's scripts: the modules they load, all the way down; none of them may be one of the web's files
for (const page of all.filter((f) => extname(f) === '.html')) {
  const seen = new Set();
  const visit = (file, from) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (WEB_FILES.includes(name(file))) problems.push(`${name(page)} loads ${name(file)} (through ${from}), which is still the web's`);
    for (const spec of loads(file)) {
      const to = target(file, spec);
      if (to !== null && existsSync(to)) visit(to, name(file));
    }
  };
  for (const spec of loads(page)) { const to = target(page, spec); if (to !== null && existsSync(to)) visit(to, name(page)); }
}

for (const p of problems) console.log(p);
console.log(problems.length ? `ui-imports: ${problems.length} problems` : `ui-imports: ${all.length} files, every import inside native/app/ui`);
process.exitCode = problems.length ? 1 : 0;
