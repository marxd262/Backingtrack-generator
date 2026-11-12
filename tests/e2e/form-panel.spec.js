// Gruppe "Songform" der Spielseite (echte Seite /ui/index.html): Vorlage, Zielgröße, vier Regler, Zustand der Form.
import { test, expect } from '@playwright/test';

const FEEL = ['structure', 'dynamics', 'pauses', 'randomness'];
const RAW_KEY = /\b(ui|form|group)\.[A-Za-z.]+\b/;
const BAR_TIMEOUT = 10_000;

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
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const template = (page) => page.locator('#form-template');
const target = (page) => page.locator('#length');
const slider = (page, name) => page.locator(`#form-${name}`);
const position = (page) => page.locator('#play-position');
// Zustand der App lesen (dasselbe Modul wie die Seite) und verändern
const form = (page) => page.evaluate(async () => structuredClone((await import('/ui/state.js')).state.track.form ?? null));
const trackLength = (page) => page.evaluate(async () => (await import('/ui/state.js')).state.track.length);
const sum = (f) => f.sections.reduce((s, x) => s + x.bars, 0);
// feste Variantennummer über das Eingabefeld der Startseite (wie Eingabe und Enter)
const setVariant = (page, n) => page.evaluate((seed) => {
  const input = document.getElementById('variant');
  input.value = String(seed);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, n);

test('beim Laden hat der Track eine Form: Summe gleich Länge, Vorlage Auto, Ziel 96', async ({ page }) => {
  const f = await form(page);
  expect(f).not.toBeNull();
  expect(f.auto).toBe(true);
  expect(sum(f)).toBe(await trackLength(page));
  await expect(template(page)).toHaveValue('auto');
  await expect(target(page)).toHaveValue('96');
  expect(await target(page).locator('option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['24', '32', '48', '64', '96', '128', '192']);
  await expect(page.locator('#length-label')).toHaveText('Zielgröße');
  expect(await template(page).locator('option').allTextContents()).toEqual(['Auto', 'Jam', 'Pop', 'Build & Drop', 'Blues', 'Rock', 'Ohne Form']);
});

test('Gruppe Songform: offen, nach Rhythmus, per Tastatur erreichbar; Regler zeigen Prozentwerte', async ({ page }) => {
  const group = page.locator('details[data-group="form"]');
  await expect(group).toHaveJSProperty('open', true);
  const order = await page.locator('#side-left details[data-group]').evaluateAll((els) => els.map((el) => el.dataset.group));
  expect(order.indexOf('form')).toBe(order.indexOf('rhythm') + 1);
  await group.locator('> summary').focus();
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement.id));
  }
  expect(seen).toEqual(['form-template', 'length', 'form-structure', 'form-dynamics', 'form-pauses', 'form-randomness']);
  const expected = { structure: 60, dynamics: 60, pauses: 40, randomness: 50 };
  const labels = { structure: 'Struktur', dynamics: 'Dynamik', pauses: 'Pausen', randomness: 'Zufall' };
  for (const name of FEEL) {
    await expect(slider(page, name)).toHaveValue(String(expected[name]));
    await expect(page.locator(`#form-${name}-out`)).toHaveText(`${expected[name]} %`);
    await expect(slider(page, name)).toHaveAttribute('aria-valuetext', new RegExp(`^${expected[name]} %`));
    await expect(page.locator(`label[for="form-${name}"]`)).toHaveText(labels[name]);
  }
  await slider(page, 'randomness').press('ArrowRight');
  await expect(page.locator('#form-randomness-out')).toHaveText('51 %');
  expect((await form(page)).feel.randomness).toBeCloseTo(0.51);
});

test('Variante: gleiche Eingaben gleiche Form, neue Variante neue Form', async ({ page }) => {
  await setVariant(page, 7);
  const a = await form(page);
  const seen = new Set();
  for (const n of [8, 9, 10, 11, 12]) {
    await setVariant(page, n);
    seen.add(JSON.stringify((await form(page)).sections));
  }
  expect(seen.size).toBeGreaterThan(1);
  await setVariant(page, 7);
  expect(await form(page)).toEqual(a);
});

test('Blues: alle Teile 12 Takte; Zielgröße 48: Summe nahe 48 und die Taktzeile zeigt sie', async ({ page }) => {
  await template(page).selectOption('blues');
  let f = await form(page);
  expect(f.auto).toBe(false);
  expect(f.template).toBe('blues');
  expect(f.sections.every((s) => s.bars === 12)).toBe(true);
  expect(sum(f)).toBe(await trackLength(page));
  await template(page).selectOption('auto');
  await target(page).selectOption('48');
  f = await form(page);
  expect(Math.abs(sum(f) - 48)).toBeLessThanOrEqual(4);
  expect(sum(f)).toBe(await trackLength(page));
  await page.locator('#play-go').click();
  await expect(position(page)).toHaveText(`Takt 1 von ${sum(f)}`, { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('Wechsel von Vorlage oder Zielgröße hebt Sperren auf, die Variante lässt sie stehen', async ({ page }) => {
  await page.evaluate(async () => { (await import('/ui/state.js')).state.track.form.sections[0].locked = true; });
  const first = (await form(page)).sections[0];
  await setVariant(page, 21);
  expect((await form(page)).sections[0]).toEqual(first);
  await template(page).selectOption('pop');
  expect((await form(page)).sections.some((s) => s.locked)).toBe(false);
  await page.evaluate(async () => { (await import('/ui/state.js')).state.track.form.sections[0].locked = true; });
  await target(page).selectOption('48');
  expect((await form(page)).sections.some((s) => s.locked)).toBe(false);
});

test('Ohne Form: Regler ausgegraut, Länge gleich Zielgröße, Reglerwerte kehren mit der Form zurück', async ({ page }) => {
  await slider(page, 'randomness').fill('80');
  await target(page).selectOption('48');
  await template(page).selectOption('off');
  expect(await form(page)).toBeNull();
  expect(await trackLength(page)).toBe(48);
  await expect(page.locator('#length-label')).toHaveText('Länge');
  for (const name of FEEL) await expect(slider(page, name)).toBeDisabled();
  await expect(slider(page, 'randomness')).toHaveValue('80');
  await target(page).selectOption('24');
  expect(await trackLength(page)).toBe(24);
  await template(page).selectOption('auto');
  for (const name of FEEL) await expect(slider(page, name)).toBeEnabled();
  await expect(slider(page, 'randomness')).toHaveValue('80');
  expect((await form(page)).feel.randomness).toBeCloseTo(0.8);
});

test('Regler während der Wiedergabe: sie läuft weiter, ein AudioContext; neue Zielgröße startet an gleicher Stelle neu', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect(position(page)).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  await slider(page, 'randomness').fill('90');
  await slider(page, 'pauses').fill('10');
  await slider(page, 'dynamics').fill('100');
  await slider(page, 'structure').fill('20'); // Loslassen würfelt neu, die Summe bleibt 96
  expect((await form(page)).feel).toMatchObject({ structure: 0.2, dynamics: 1, pauses: 0.1, randomness: 0.9 });
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await target(page).selectOption('48');
  await expect(position(page)).toHaveText(/^Takt \d+ von 48$/, { timeout: BAR_TIMEOUT });
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await page.locator('#play-go').click();
});

test('Sprachwechsel beschriftet Gruppe, Auswahl und Regler neu', async ({ page }) => {
  await page.locator('[data-lang="en"]').first().click();
  await expect(page.locator('details[data-group="form"] > summary')).toHaveText('Song form');
  await expect(page.locator('label[for="form-template"]')).toHaveText('Template');
  await expect(page.locator('#length-label')).toHaveText('Target size');
  expect(await template(page).locator('option').allTextContents()).toEqual(['Auto', 'Jam', 'Pop', 'Build & Drop', 'Blues', 'Rock', 'No form']);
  await expect(target(page).locator('option').first()).toHaveText('24 bars');
  await expect(page.locator('label[for="form-randomness"]')).toHaveText('Randomness');
  await expect(page.locator('#form-structure-out')).toHaveText('60%');
  await expect(slider(page, 'structure')).toHaveAttribute('aria-valuetext', '60% (default 60%)');
  expect(await page.locator('details[data-group="form"]').innerText()).not.toMatch(RAW_KEY);
  await page.locator('[data-lang="de"]').first().click();
  await expect(page.locator('details[data-group="form"] > summary')).toHaveText('Songform');
});

test('360 px: kein waagerechtes Scrollen, Bedienelemente mindestens 44 px hoch', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#form-template')).toBeVisible();
  await page.locator('#form-template').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector('#side-left')].map((el) => el.scrollWidth - el.clientWidth));
  expect(overflow).toEqual([0, 0]);
  for (const id of ['form-template', 'length', ...FEEL.map((n) => `form-${n}`)]) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, id).toBeLessThanOrEqual(360);
  }
});

test('der Verlauf zeichnet nach einem Wechsel der Form neu', async ({ page }) => {
  const lanes = () => page.locator('#lanes').evaluate((c) => c.toDataURL());
  await setVariant(page, 3);
  await template(page).selectOption('jam');
  const jam = await lanes();
  await template(page).selectOption('blues');
  const blues = await lanes();
  expect(blues).not.toBe(jam);
  await template(page).selectOption('jam');
  expect(await lanes()).toBe(jam);
});
