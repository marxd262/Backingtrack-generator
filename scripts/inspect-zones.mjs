// Welche Regionen mischt der Importer je Zone (Töne)? Für die Gruppen einer Taste: Stufe, Round-Robin und die Sample-Pfade der Zone.
// Aufruf: node scripts/inspect-zones.mjs <library-ordner> <pack-id> <taste nach transpose>
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [lib, id, keyArg] = process.argv.slice(2);
const m = await import(pathToFileURL(resolve('scripts/import-sfz.mjs')).href);
const spec = m.SFZ_PACKS[id], sfz = resolve(lib, spec.sfz), key = Number(keyArg), shift = spec.transpose ?? 0;
const { regions } = m.defaultRegions(m.parseSfz(m.expandSfz(sfz)), dirname(sfz));
const own = regions.filter((r) => !r.silent && r.lokey + shift <= key && key <= r.hikey + shift);
const byGroup = {};
for (const r of own) (byGroup[`${r.trigger} ${spec.art?.find(([p]) => p.test(r.path))?.[1] ?? '-'} center ${r.center + shift}`] ??= []).push(r);
for (const [g, rs] of Object.entries(byGroup)) {
  console.log(g, `${rs.length} Regionen`);
  for (const z of m.selectZones(rs, g.startsWith('release') ? [1, spec.releases] : spec.select[g.split(' ')[1]] ?? spec.select.default)) {
    console.log(`  ${z.velLo}-${z.velHi} rr ${z.regions[0].rr}: ${z.regions.map((r) => `${r.path.split(/[\\/]/).slice(-2).join('/')} (g ${r.gain.toFixed(2)}, lorand ${r.lorand ?? '-'}, seq ${r.seq_position ?? '-'})`).join(' + ')}`);
  }
}
