// Hilfsbaustein für die zweistufige Akkordauswahl der Spielseite: erst ein Grundton-Chip, dann ein Chip der Akkordart.
import { CHORDS } from '../../src/core/chords.js';

/** Zerlegt einen Akkordnamen wie 'Gm7' oder 'Edim' über das Register in Grundton und Art-ID. */
export function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const quality = m ? Object.entries(CHORDS).find(([, c]) => c.symbol === m[2])?.[0] : undefined;
  if (!quality) throw new Error(`Unknown chord name: ${name}`);
  return { root: m[1], quality };
}

/** Fügt den Akkord über die Auswahl an. scope schränkt ein, z. B. '#side-right'. */
export async function addChordByName(page, name, scope = '') {
  const { root } = parseChord(name);
  const area = page.locator(`${scope} #add-chords`.trim());
  await area.locator('#add-roots button', { hasText: new RegExp(`^${root}$`) }).click();
  await openQualityGroup(page, parseChord(name).quality, scope);
  await area.locator('#add-qualities button', { hasText: new RegExp(`^${name}$`) }).click();
}

/** Klappt die einklappbare Gruppe (Dreiklänge, Septakkorde, Erweiterungen) auf, in der die Akkordart steht, falls sie zu ist. */
export async function openQualityGroup(page, quality, scope = '') {
  const group = page.locator(`${scope} #add-qualities details[data-group="${CHORDS[quality].group}"]`.trim());
  if (!(await group.evaluate((el) => el.open))) await group.locator('> summary').click();
}
