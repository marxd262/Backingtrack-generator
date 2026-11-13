// Hilfsbaustein für die zweistufige Akkordauswahl der Spielseite: erst ein Grundton-Chip, dann ein Chip der Akkordart.
import { CHORDS } from '../../src/core/chords.js';

/** Zerlegt einen Akkordnamen wie 'Gm7' oder 'Edim' über das Register in Grundton und Art-ID. */
export function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const quality = m ? Object.entries(CHORDS).find(([, c]) => c.symbol === m[2])?.[0] : undefined;
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
  const { root } = parseChord(name);
  await openAddPop(page);
  const area = page.locator(`${scope} #add-chords`.trim());
  await area.locator('#add-roots button', { hasText: new RegExp(`^${root}$`) }).click();
  await openQualityGroup(page, parseChord(name).quality, scope);
  await area.locator('#add-qualities button', { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator('#add-pop').evaluate((el) => el.hidePopover());
}

/** Klappt die einklappbare Gruppe (Dreiklänge, Septakkorde, Erweiterungen) auf, in der die Akkordart steht, falls sie zu ist. */
export async function openQualityGroup(page, quality, scope = '') {
  const group = page.locator(`${scope} #add-qualities details[data-group="${CHORDS[quality].group}"]`.trim());
  if (!(await group.evaluate((el) => el.open))) await group.locator('> summary').click();
}
