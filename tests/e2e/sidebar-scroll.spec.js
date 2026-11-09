// Breites Layout (ab 1200 px): die drei Spalten der Spielseite (Klang | Blöcke | Akkorde) scrollen jede für sich, die Seite nicht.
import { test, expect } from '@playwright/test';

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.setViewportSize({ width: 1280, height: 700 }); // niedrig, damit alle drei Spalten überlaufen
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  for (const side of ['left', 'right']) if (!(await page.locator(`#side-${side}`).isVisible())) await page.locator(`#toggle-${side}`).click();
  await expect(page.locator('#side-left')).toBeVisible();
  await expect(page.locator('#side-right')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const metrics = (page) => page.evaluate(() => {
  const top = (sel) => document.querySelector(sel).scrollTop;
  const over = (sel) => { const el = document.querySelector(sel); return el.scrollHeight - el.clientHeight; };
  return {
    page: window.scrollY, pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
    left: top('#side-left'), right: top('#side-right'), blocks: top('#blocks'),
    leftOver: over('#side-left'), rightOver: over('#side-right'), blocksOver: over('#blocks'),
  };
});

// Maus über die Spalte, dann Rad
async function wheelOver(page, selector, delta) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 200));
  await page.mouse.wheel(0, delta);
}

test('die Seite selbst scrollt nicht, jede Spalte hat ihren eigenen Überlauf', async ({ page }) => {
  const m = await metrics(page);
  expect(m.pageOverflow).toBeLessThanOrEqual(0);
  expect(m.leftOver).toBeGreaterThan(0);
  expect(m.rightOver).toBeGreaterThan(0);
  expect(m.blocksOver).toBeGreaterThan(0);
});

test('Rad über der linken Leiste scrollt nur die linke Leiste', async ({ page }) => {
  await wheelOver(page, '#side-left', 500);
  await expect.poll(async () => (await metrics(page)).left).toBeGreaterThan(0);
  const m = await metrics(page);
  expect(m.blocks).toBe(0);
  expect(m.right).toBe(0);
  expect(m.page).toBe(0);
});

test('Rad über der rechten Leiste scrollt nur die rechte Leiste', async ({ page }) => {
  await wheelOver(page, '#side-right', 500);
  await expect.poll(async () => (await metrics(page)).right).toBeGreaterThan(0);
  const m = await metrics(page);
  expect(m.blocks).toBe(0);
  expect(m.left).toBe(0);
  expect(m.page).toBe(0);
});

test('am Ende einer Leiste wandert das Rad nicht in die Mitte weiter', async ({ page }) => {
  for (let i = 0; i < 12; i++) await wheelOver(page, '#side-right', 800);
  await expect.poll(async () => { const m = await metrics(page); return Math.abs(m.right - m.rightOver) <= 1; }).toBe(true);
  for (let i = 0; i < 4; i++) await wheelOver(page, '#side-right', 800);
  await page.waitForTimeout(300);
  const m = await metrics(page);
  expect(m.blocks).toBe(0);
  expect(m.page).toBe(0);
});

test('Rad über der Mitte scrollt nur die Mitte, die Kopfzeile bleibt sichtbar', async ({ page }) => {
  await wheelOver(page, '#blocks', 600);
  await expect.poll(async () => (await metrics(page)).blocks).toBeGreaterThan(0);
  const m = await metrics(page);
  expect(m.left).toBe(0);
  expect(m.right).toBe(0);
  expect(m.page).toBe(0);
  const go = await page.locator('#play-go').boundingBox();
  expect(go.y).toBeGreaterThanOrEqual(0);
  expect(go.y + go.height).toBeLessThanOrEqual(700);
});

test('alle Blöcke der Mitte sind durch Scrollen erreichbar', async ({ page }) => {
  await page.locator('#blocks').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#wheel')).toBeInViewport();
  await page.locator('#blocks').evaluate((el) => { el.scrollTop = 0; });
  await expect(page.locator('#fretboard')).toBeInViewport();
});

test('schmales Fenster: die Schubladen scrollen weiter in sich, die Seite scrollt wie bisher', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator('#side-right')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#side-left')).toBeHidden();
  const m = await metrics(page);
  expect(m.pageOverflow).toBeGreaterThan(0);
});
