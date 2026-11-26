// Hilfsbaustein für die zweistufige Akkordauswahl der Spielseite: erst ein Grundton-Chip, dann ein Chip der Akkordart.
// Portiert aus tests/e2e/chord-helpers.js: Register und Namen aus der Sitzung (tables().CHORDS: die Gruppe je Art; derived().chordOptions: der
// Name jeder Art auf jedem Grundton der Tonart) statt aus src/core/chords.js.
import { answered, fromSession } from './fixture.js';
import { layoutWheel } from '../../app/ui/wheel-geometry.js';

const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };

/** Knotenmitte im Canvas des Akkordrads (CSS-Pixel relativ zur linken oberen Ecke): der Platz aus der Geometrie der Seite, der Knoten aus
 *  derived().wheel (der erlaubte Akkord an ihm, sonst seine Beschriftung). Erst die Antworten, dann die Größe des Canvas: eine Antwort kann das
 *  Modul umbauen (ein Akkord mehr in der Folge), und ein Punkt aus der Größe davor träfe neben das Rad. */
export async function wheelPoint(page, root, quality, ring = 'outer') {
  await answered(page);
  const canvas = page.locator('#wheel');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const { nodes } = (await fromSession(page, 'derived')).wheel;
  const at = nodes.findIndex((n) => n.ring === ring && (n.allowed ? n.allowed.root === root && n.allowed.quality === quality : n.short === root + SYMBOLS[quality]));
  if (at < 0) throw new Error(`no node of ${root} ${quality} ${ring} in derived().wheel`);
  const node = layoutWheel(box.width).nodes[at];
  return { x: node.x, y: node.y };
}

/** Zerlegt einen Akkordnamen wie 'Gm7' oder 'Edim' über die Namen der Tonart in Grundton und Art-ID. */
async function parseChord(page, name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  await answered(page); // die Namen der Tonart, wie sie nach den Aktionen davor steht
  const { chordOptions } = await fromSession(page, 'derived');
  const quality = m ? Object.entries(chordOptions.find((o) => o.root === m[1])?.names ?? {}).find(([, n]) => n === name)?.[0] : undefined;
  if (!quality) throw new Error(`Unknown chord name: ${name}`);
  return { root: m[1], quality };
}

/** Öffnet das Popover der Akkordauswahl (+ im Modul Harmonie), falls zu. */
export async function openAddPop(page) {
  const pop = page.locator('#add-pop');
  if (!(await pop.evaluate((el) => el.matches(':popover-open')))) await page.locator('#add-btn').click();
}

/** Fügt den Akkord über die Auswahl an und schließt das Popover wieder (es läge sonst über Griffbrett und Rad). scope schränkt ein, z. B. '#mod-harmony'. */
export async function addChordByName(page, name, scope = '') {
  const { root, quality } = await parseChord(page, name);
  await openAddPop(page);
  const area = page.locator(`${scope} #add-chords`.trim());
  await area.locator('#add-roots button', { hasText: new RegExp(`^${root}$`) }).click();
  await openQualityGroup(page, quality, scope);
  await area.locator('#add-qualities button', { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator('#add-pop').evaluate((el) => el.hidePopover());
}

/** Klappt die einklappbare Gruppe (Dreiklänge, Septakkorde, Erweiterungen) auf, in der die Akkordart steht, falls sie zu ist. */
export async function openQualityGroup(page, quality, scope = '') {
  const { CHORDS } = await fromSession(page, 'tables');
  const group = page.locator(`${scope} #add-qualities details[data-group="${CHORDS[quality].group}"]`.trim());
  if (!(await group.evaluate((el) => el.open))) await group.locator('> summary').click();
}
