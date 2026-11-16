// Zeigt die geerbten Opcodes einzelner Regionen einer SFZ-Library (Taste, Muster im Sample-Pfad) nach dem Standardzustand des Importers.
// Aufruf: node scripts/inspect-region.mjs <library-ordner> <pack-id> <taste> <muster im sample-pfad>
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const [lib, id, key, pattern] = process.argv.slice(2);
const m = await import(pathToFileURL(resolve('scripts/import-sfz.mjs')).href);
const sfz = resolve(lib, m.SFZ_PACKS[id].sfz);
const { regions } = m.defaultRegions(m.parseSfz(m.expandSfz(sfz)), dirname(sfz));
for (const r of regions.filter((x) => x.lokey <= +key && +key <= x.hikey && new RegExp(pattern).test(x.path)).slice(0, 2)) {
  const { path, ...rest } = r;
  console.log(path.split(/[\/]/).slice(-1)[0], JSON.stringify(rest));
}
