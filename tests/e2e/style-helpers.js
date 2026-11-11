// Stil wählen und lesen über das Profil-Fenster (die Schnellauswahl gibt es nicht mehr): Werksprofil "Laden" macht dasselbe
// wie früher der Klick auf den Chip. Nur auf der Spielseite benutzen.
import { expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

// Fenster öffnen (falls zu), fn ausführen, Zustand wiederherstellen. Eine offene schmale Schublade macht die Kopfzeile inert:
// dann kurz schließen und danach wieder öffnen.
async function withWindow(page, fn) {
  const pop = page.locator('#profiles-pop');
  const wasOpen = await pop.evaluate((el) => el.matches(':popover-open'));
  let drawer = false;
  let side;
  if (!wasOpen) {
    drawer = await page.locator('#profiles-btn').evaluate((b) => Boolean(b.closest('[inert]')));
    // welche Schublade offen ist, steht in der Kennung der Leiste (side-left/side-right); ihr Knopf heißt toggle-<Seite>
    if (drawer) {
      const open = page.locator('.side:not([hidden])').first();
      side = (await open.getAttribute('id')).replace('side-', '');
      await open.locator('.side-close').click();
    }
    await page.locator('#profiles-btn').click();
    await expect(pop).toBeVisible();
  }
  const result = await fn();
  if (!wasOpen) {
    await pop.evaluate((el) => el.hidePopover());
    if (drawer) await page.locator(`#toggle-${side}`).click();
  }
  return result;
}

/** Werksprofil des Stils laden (Tempo, Schlagworte, Klang, Akkordfarbe wie der frühere Chip). */
export const chooseStyle = (page, id) => withWindow(page, async () => {
  await page.locator(`#profile-tree [data-key="factory:${id}"] .tree-label`).click();
  await page.locator('#profile-load').click();
});

/** Stil-Kennung der laufenden Sitzung (aus "Stil: <Name>" / "Style: <Name>" der Zeile "Aktuelle Sitzung"); der Stil bleibt nach eigenen Änderungen stehen. */
export const currentStyle = (page) => withWindow(page, async () => {
  await page.locator('#profile-tree [data-key="session"] .tree-label').click();
  const text = await page.locator('#profile-session-summary').innerText();
  const name = text.match(/(?:Stil|Style): (.+)$/)?.[1].trim();
  const id = STYLE_PRESETS.find((p) => [de, en].some((d) => d[`style.${p.id}`] === name))?.id;
  expect(id, `Stil aus "${text}"`).toBeTruthy();
  return id;
});
