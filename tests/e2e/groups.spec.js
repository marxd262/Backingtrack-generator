// Einklappbare Gruppen in den Seitenleisten der Spielseite (echte Seite /ui/index.html).
import { test, expect } from '@playwright/test';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre)\.[A-Za-z.]+$/;

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  // breit sind beide Leisten beim ersten Besuch schon offen; nur öffnen, was zu ist
  for (const side of ['left', 'right']) if (!(await page.locator(`#side-${side}`).isVisible())) await page.locator(`#toggle-${side}`).click();
  await expect(page.locator('#side-left')).toBeVisible();
  await expect(page.locator('#side-right')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const group = (page, id) => page.locator(`details[data-group="${id}"]`);
const summary = (page, id) => group(page, id).locator('> summary');

test('Standard: Stil, Tempo, Tonart, Akkordfolge und Ansichten offen', async ({ page }) => {
  for (const id of ['style', 'tempo', 'key', 'progression', 'triad', 'views']) await expect(group(page, id), id).toHaveJSProperty('open', true);
  for (const id of ['seventh', 'extended']) await expect(group(page, id), id).toHaveJSProperty('open', false);
});

test('Gruppen liegen in der richtigen Leiste und Reihenfolge', async ({ page }) => {
  const ids = (side) => page.locator(`#${side} details[data-group]`).evaluateAll((els) => els.map((el) => el.dataset.group));
  expect(await ids('side-left')).toEqual(expect.arrayContaining(['style', 'tempo']));
  expect((await ids('side-left')).indexOf('style')).toBeLessThan((await ids('side-left')).indexOf('tempo'));
  expect(await ids('side-right')).toEqual(['key', 'progression', 'triad', 'seventh', 'extended', 'views']);
});

test('Inhalte stehen in ihren Gruppen', async ({ page }) => {
  await expect(group(page, 'style').locator('#quick-pick')).toBeAttached();
  await expect(group(page, 'style').locator('#tags')).toBeAttached();
  await expect(group(page, 'tempo').locator('#tuning-tempo')).toBeAttached();
  await expect(group(page, 'tempo').locator('#length')).toBeAttached();
  await expect(group(page, 'key').locator('#side-key-chips')).toBeAttached();
  await expect(group(page, 'key').locator('#side-scale-chips')).toBeAttached();
  await expect(group(page, 'progression').locator('#progression')).toBeAttached();
  await expect(group(page, 'progression').locator('#add-chords')).toBeAttached();
  await expect(group(page, 'views').locator('#views')).toBeAttached();
});

test('Klick schließt eine Gruppe, nach dem Neuladen bleibt sie zu', async ({ page }) => {
  await summary(page, 'style').click();
  await expect(group(page, 'style')).toHaveJSProperty('open', false);
  await expect(page.locator('#tags')).toBeHidden();
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(group(page, 'style')).toHaveJSProperty('open', false);
  await expect(group(page, 'tempo')).toHaveJSProperty('open', true);
});

test('Tastatur: Enter auf der Zusammenfassung klappt um', async ({ page }) => {
  await summary(page, 'tempo').focus();
  await page.keyboard.press('Enter');
  await expect(group(page, 'tempo')).toHaveJSProperty('open', false);
  await page.keyboard.press('Enter');
  await expect(group(page, 'tempo')).toHaveJSProperty('open', true);
});

test('schmale Schublade: Gruppe schließen, Escape schließt die Schublade, Fokus zurück zum Knopf', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  // schmal ist nur eine Schublade offen: links ist zuletzt umgeschaltet worden, also erst sauber öffnen
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#side-left')).toBeVisible();
  await summary(page, 'style').click();
  await expect(group(page, 'style')).toHaveJSProperty('open', false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#side-left')).toBeHidden();
  await expect(page.locator('#toggle-left')).toBeFocused();
});

test('kein roher Schlüsselname in den Leisten sichtbar', async ({ page }) => {
  const texts = await page.locator('.side').evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('summary, h4, label, button')].map((n) => n.textContent.trim())));
  expect(texts.length).toBeGreaterThan(5);
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
});
