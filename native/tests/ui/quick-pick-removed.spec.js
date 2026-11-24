// Die frühere Schnellauswahl der Stile ist weg: Stile kommen aus den Werksprofilen im Profil-Fenster.
// Portiert aus tests/e2e/quick-pick-removed.spec.js: die App lädt ihre Seite; STYLE_PRESETS aus tables() der Sitzung.
import { test, expect, fromSession } from './fixture.js';
import { chooseStyle, currentStyle } from './style-helpers.js';

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
});

test('keine Schnellauswahl; das Modul Charakter hält die Schlagworte', async ({ page }) => {
  await expect(page.locator('#quick-pick')).toHaveCount(0);
  await expect(page.locator('#quick-title')).toHaveCount(0);
  await expect(page.locator('#mod-character #tags')).toBeAttached();
});

test('chooseStyle(blues) setzt das Tempo des Stils, currentStyle meldet blues; alle neun Stile stehen als Werksprofile im Baum', async ({ page }) => {
  const { STYLE_PRESETS } = await fromSession(page, 'tables');
  expect(await currentStyle(page)).toBe('funk');
  await chooseStyle(page, 'blues');
  // Standard-Taktart 4/4: das Tempo des Stils ohne Umrechnung
  await expect(page.locator('#tuning-tempo-out')).toHaveText(`${STYLE_PRESETS.find((p) => p.id === 'blues').bpm} bpm`);
  expect(await currentStyle(page)).toBe('blues');
  await expect(page.locator('#profiles-pop')).toBeHidden();
  await page.locator('#profiles-btn').click();
  await expect(page.locator('#profile-tree [data-key^="factory:"]')).toHaveCount(STYLE_PRESETS.length);
  // Fenster offen: beide Helfer lassen es offen
  await chooseStyle(page, 'funk');
  expect(await currentStyle(page)).toBe('funk');
  await expect(page.locator('#profiles-pop')).toBeVisible();
});
