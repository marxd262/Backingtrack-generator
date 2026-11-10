// Spektrogramm-Seite (Entwicklerwerkzeug): zeichnet etwas, wirft nicht, fällt bei unbekannter Stimme auf den Standard zurück.
import { test, expect } from '@playwright/test';

let problems;

test.beforeEach(({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const colors = (page) => page.evaluate(() => {
  const c = document.getElementById('plot');
  const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 97) seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
  return seen.size;
});

test('zeichnet ein Spektrogramm mit Messwerten (Standardstimme der Akkorde)', async ({ page }) => {
  await page.goto('/ui/spectrogram.html?layer=chords&id=synth&variant=classic&midi=57');
  await expect(page.locator('#plot[data-ready="1"]')).toBeAttached();
  expect(await colors(page)).toBeGreaterThan(5);
  await expect(page.locator('#metrics')).toContainText('Anschlag');
  await expect(page.locator('#metrics')).toContainText('Cent');
});

test('Saitenmodell und unbekannte Stimme: kein Fehler, unbekannt zeichnet den Standard', async ({ page }) => {
  await page.goto('/ui/spectrogram.html?layer=bass&id=string&variant=finger&midi=40');
  await expect(page.locator('#plot[data-ready="1"]')).toBeAttached();
  const known = await page.locator('#metrics').textContent();
  await page.goto('/ui/spectrogram.html?layer=bass&id=nope&midi=40&tuning=%7Bkaputt');
  await expect(page.locator('#plot[data-ready="1"]')).toBeAttached();
  expect(await colors(page)).toBeGreaterThan(5);
  expect(await page.locator('#metrics').textContent()).not.toBe(known);
});

test('ungültige Angaben: der Titel nennt es, unsinnige Zahlen werden begrenzt, kein Warten ins Leere', async ({ page }) => {
  await page.goto('/ui/spectrogram.html?layer=drums&id=nope&midi=-5&seconds=0&vel=9&dur=-1');
  await expect(page.locator('#plot[data-ready="1"]')).toBeAttached();
  await expect(page.locator('#title')).toContainText('ungültige Angabe');
  expect(await colors(page)).toBeGreaterThan(5);
});
