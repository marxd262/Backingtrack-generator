// Aufgaben (Jobs) in der Hauptoberfläche: je Schicht mit Aufgaben ein LCD-Select in ihrem Instrument-Modul (Lead: Job, Percussion: Part),
// Wechsel live ohne Neustart, Percussion startet aus, beide Sprachen ohne rohe Schlüssel.
import { test, expect } from '@playwright/test';
import { chooseStyle, openSetup } from './style-helpers.js';

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
  await openSetup(page);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const module = (page, id) => page.locator(`.instrument[data-layer="${id}"]`);
const job = (page, layer) => page.locator(`#job-${layer}`);
const values = (page, layer) => job(page, layer).locator('option').evaluateAll((els) => els.map((e) => e.value));

test('Lead-Modul: Auswahl Job mit Standard "off", alle fünf Aufgaben; Percussion-Modul: Part mit Standard "mixed", alle sieben', async ({ page }) => {
  await expect(job(page, 'lead')).toHaveValue('off');
  await expect(page.locator('label[for="job-lead"]')).toHaveText('Lead-Aufgabe');
  expect(await values(page, 'lead')).toEqual(['off', 'fills', 'arpeggio', 'melody', 'callResponse']);
  await expect(job(page, 'percussion')).toHaveValue('mixed');
  await expect(page.locator('label[for="job-percussion"]')).toHaveText('Percussion-Part');
  expect(await values(page, 'percussion')).toEqual(['mixed', 'shaker', 'tambourine', 'congas', 'bongos', 'claves', 'cowbell']);
  // Schichten ohne Aufgaben bekommen keine Auswahl; Lead hat die Verzerrer, Percussion keine Knöpfe, aber den Hinweis
  await expect(page.locator('select[id^="job-"]')).toHaveCount(2);
  await expect(module(page, 'lead').locator('input[type="range"]')).toHaveCount(3);
  await expect(module(page, 'percussion').locator('input[type="range"]')).toHaveCount(0);
  await expect(module(page, 'percussion')).toContainText('Raum des Schlagzeugs');
});

test('die Percussion-Schicht startet aus, Lead an; sechs Spurnamen', async ({ page }) => {
  await expect(page.locator('#lane-buttons [data-layer]')).toHaveCount(6);
  await expect(page.locator('#lane-buttons [data-layer="percussion"]')).toHaveAttribute('data-muted', 'true');
  await expect(page.locator('#lane-buttons [data-layer="lead"]')).toHaveAttribute('data-muted', 'false');
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
  const texts = await page.locator('#rack-instruments').evaluate((el) => [...el.querySelectorAll('h3, label, option, p')].map((n) => n.textContent.trim()).filter(Boolean));
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
  await page.locator('[data-lang="de"]').click();
  await expect(job(page, 'percussion').locator('option[value="tambourine"]')).toHaveText('Tamburin');
});

test('die Tasten ‹ › am Display schalten die Aufgabe weiter, am Ende ist die Taste aus', async ({ page }) => {
  const [prev, next] = await module(page, 'lead').locator('.inst-job .lcd-btn').all();
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(job(page, 'lead')).toHaveValue('fills');
  await expect(prev).toBeEnabled();
  await job(page, 'lead').selectOption('callResponse');
  await expect(next).toBeDisabled();
});
