// Die Schnellauswahl der Leiste "Klang" ist weg: Stile kommen aus den Werksprofilen im Profil-Fenster.
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { chooseStyle, currentStyle } from './style-helpers.js';

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.goto('/ui/index.html');
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
});

test('keine Schnellauswahl; der Abschnitt Stil der Leiste Klang hält die Schlagworte', async ({ page }) => {
  await expect(page.locator('#quick-pick')).toHaveCount(0);
  await expect(page.locator('#quick-title')).toHaveCount(0);
  await expect(page.locator('details[data-group="style"] #tags')).toBeAttached();
});

test('chooseStyle(blues) setzt das Tempo des Stils, currentStyle meldet blues; alle neun Stile stehen als Werksprofile im Baum', async ({ page }) => {
  expect(await currentStyle(page)).toBe('funk');
  await chooseStyle(page, 'blues');
  // Standard-Taktart 4/4: das Tempo des Stils ohne Umrechnung
  await expect(page.locator('#tuning-tempo-out')).toHaveText(String(STYLE_PRESETS.find((p) => p.id === 'blues').bpm));
  expect(await currentStyle(page)).toBe('blues');
  await expect(page.locator('#profiles-pop')).toBeHidden();
  await page.locator('#profiles-btn').click();
  await expect(page.locator('#profile-tree [data-key^="factory:"]')).toHaveCount(STYLE_PRESETS.length);
  // Fenster offen: beide Helfer lassen es offen
  await chooseStyle(page, 'funk');
  expect(await currentStyle(page)).toBe('funk');
  await expect(page.locator('#profiles-pop')).toBeVisible();
});
