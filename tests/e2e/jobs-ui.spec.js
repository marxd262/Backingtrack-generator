// Aufgaben (Jobs) in der Hauptoberfläche: je Schicht mit Aufgaben ein Dropdown in ihrer Klanggruppe (Lead: Job, Percussion: Part),
// Wechsel live ohne Neustart, Percussion startet aus, beide Sprachen ohne rohe Schlüssel.
import { test, expect } from '@playwright/test';
import { chooseStyle } from './style-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|voice|variant|chord|groove|meter|job)\.[A-Za-z.]+$/;
let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#side-left')).toBeVisible();
  for (const id of ['lead', 'percussion']) {
    if (!(await group(page, id).evaluate((el) => el.open))) await group(page, id).locator('> summary').click();
  }
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const group = (page, id) => page.locator(`details[data-group="${id}"]`);
const job = (page, layer) => page.locator(`#job-${layer}`);
const values = (page, layer) => job(page, layer).locator('option').evaluateAll((els) => els.map((e) => e.value));

test('Lead-Gruppe: Dropdown Job mit Standard "off", alle fünf Aufgaben; Percussion-Gruppe: Part mit Standard "mixed", alle sieben', async ({ page }) => {
  await expect(job(page, 'lead')).toHaveValue('off');
  await expect(page.locator('label[for="job-lead"]')).toHaveText('Lead-Aufgabe');
  expect(await values(page, 'lead')).toEqual(['off', 'fills', 'arpeggio', 'melody', 'callResponse']);
  await expect(job(page, 'percussion')).toHaveValue('mixed');
  await expect(page.locator('label[for="job-percussion"]')).toHaveText('Percussion-Part');
  expect(await values(page, 'percussion')).toEqual(['mixed', 'shaker', 'tambourine', 'congas', 'bongos', 'claves', 'cowbell']);
  // Schichten ohne Aufgaben bekommen kein Dropdown; Lead hat die Verzerrer, Percussion keine Regler
  await expect(page.locator('select[id^="job-"]')).toHaveCount(2);
  await expect(group(page, 'lead').locator('input[type="range"]')).toHaveCount(3);
  await expect(group(page, 'percussion').locator('input[type="range"]')).toHaveCount(0);
});

test('die Percussion-Schicht startet aus, Lead an; sechs Schichtknöpfe', async ({ page }) => {
  await expect(page.locator('#lane-buttons button')).toHaveCount(6);
  await expect(page.locator('#lane-buttons [data-layer="percussion"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#lane-buttons [data-layer="lead"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Aufgabe während der Wiedergabe wechseln: die Wiedergabe läuft weiter, kein neuer AudioContext', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await job(page, 'lead').selectOption('melody');
  await job(page, 'percussion').selectOption('congas');
  await page.waitForTimeout(500);
  await expect(job(page, 'lead')).toHaveValue('melody');
  await expect(job(page, 'percussion')).toHaveValue('congas');
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await page.locator('#play-go').click();
});

test('ein Stilwechsel lässt die gewählten Aufgaben stehen', async ({ page }) => {
  await job(page, 'lead').selectOption('arpeggio');
  await chooseStyle(page, 'blues');
  await expect(job(page, 'lead')).toHaveValue('arpeggio');
});

test('Sprachwechsel: Aufgabennamen in Englisch ohne rohe Schlüssel, danach wieder Deutsch', async ({ page }) => {
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('label[for="job-lead"]')).toHaveText('Lead job');
  await expect(job(page, 'percussion').locator('option[value="tambourine"]')).toHaveText('Tambourine');
  const texts = await page.locator('#timbre-groups').evaluate((el) => [...el.querySelectorAll('summary, label, option')].map((n) => n.textContent.trim()).filter(Boolean));
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
  await page.locator('[data-lang="de"]').click();
  await expect(job(page, 'percussion').locator('option[value="tambourine"]')).toHaveText('Tamburin');
});
