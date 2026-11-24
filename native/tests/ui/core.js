// What a web test computed with src/core for a seed (progressionFor, colorProgression, styleChordColor): the app's core, a fresh session that
// plays the given actions on an empty storage (btg_session, native/core/tools/session.cpp, built with native/build.ps1). Gives state() after each.
// As strong as the web's oracle: the web page computes with the very functions those tests imported (src/ui/state.js 4, 9, 10, 95-122), so they
// too held the page against its own core; the core's functions are held equal to the web's by btg_logic_tests (native/tools/export-logic.mjs
// 378, 388, 417).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const program = join(import.meta.dirname, '../../build/core/Release/btg_session.exe');

/** Every action must be one whose valid form always sets a flag: a key, chip or card that triggers again, a select set to another value. The
 *  core rejects an action with all flags false and the state unchanged; a select set to the value it shows does the same and is valid
 *  (native/PROTOKOLL.md section 1), so nothing else tells the two apart. */
export function core(actions) {
  const dir = mkdtempSync(join(tmpdir(), 'btg-ui-core-'));
  try {
    writeFileSync(join(dir, 'steps.json'), JSON.stringify(actions.map((a) => JSON.stringify(a))));
    const ran = spawnSync(program, [join(dir, 'steps.json'), join(dir, 'out.json')], { encoding: 'utf8' });
    if (ran.status !== 0) throw new Error(`btg_session failed (${program}): ${ran.stdout}${ran.stderr}${ran.error ?? ''}`);
    const records = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')).slice(0, actions.length); // the last record: the storage
    records.forEach((r, i) => { if (!Object.values(r.change).some(Boolean)) throw new Error(`the core rejected ${JSON.stringify(actions[i])}`); });
    return records.map((r) => JSON.parse(r.state));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
