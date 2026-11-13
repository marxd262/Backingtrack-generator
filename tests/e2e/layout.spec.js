// Seitengerüst der Spielseite: Kopfleiste, Visualisierung und Rack; Fokus ⇄ Einstellen, gemerkt; die Seite scrollt nie.
import { test, expect } from '@playwright/test';
import { countingScript, sets, contexts } from './count-helpers.js';

const BAR_TIMEOUT = 10_000;

let problems;

test.use({ locale: 'de-DE', reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(countingScript);
  await page.setViewportSize({ width: 1600, height: 960 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const rack = (page) => page.locator('#rack');
const modeSwitch = (page) => page.locator('#mode-switch');
const savedLayout = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')));
const pageScroll = (page) => page.evaluate(() => ({
  y: document.documentElement.scrollHeight - innerHeight,
  x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
// Leinwand und Puffer passen zusammen (fitCanvas zeichnet in der neuen Größe)
const canvasSize = (page, id) => page.locator(id).evaluate((c) => ({
  height: c.clientHeight,
  fits: c.width === Math.round(c.clientWidth * devicePixelRatio) && c.height === Math.round(c.clientHeight * devicePixelRatio),
}));

test('1600 × 960 im Zustand Einstellen: Seite scrollt nicht, Visualisierung und Rack überlappen nicht, das Rack scrollt in sich', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  expect(await pageScroll(page)).toEqual({ y: 0, x: 0 });
  const [viz, box] = await Promise.all([page.locator('#viz').boundingBox(), rack(page).boundingBox()]);
  expect(overlaps(viz, box)).toBe(false);
  expect(box.y + box.height).toBeLessThanOrEqual(960);
  expect(await rack(page).evaluate((el) => getComputedStyle(el).overflow)).toBe('auto');
  // Module in einer Reihe, von links nach rechts
  const xs = await page.locator('#rack .module, #rack-instruments').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  const ids = await page.locator('#rack > .rack-row > *').evaluateAll((els) => els.map((el) => el.id));
  expect(ids).toEqual(['mod-harmony', 'mod-rhythm', 'mod-character', 'rack-instruments', 'mod-mixer']);
});

test('1366 × 768: Griffbrett, Akkordkreis und Spuren ganz sichtbar, die Seite scrollt nicht, das Rack schon', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  for (const id of ['.play-head', '#fretboard', '#wheel', '#lanes']) await expect(page.locator(id), id).toBeInViewport({ ratio: 1 });
  expect(await pageScroll(page)).toEqual({ y: 0, x: 0 });
  expect(await rack(page).evaluate((el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)).toBe(true);
  const boxes = await Promise.all(['.play-head', '#mod-fretboard', '#mod-wheel', '#mod-song'].map((s) => page.locator(s).boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i} ${j}`).toBe(false);
});

test('Schalter Fokus/Einstellen: Rack und Formfelder nur im Zustand Einstellen, gemerkt über Neuladen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const sw = modeSwitch(page);
  await expect(sw).toHaveAttribute('role', 'switch');
  await expect(sw).toHaveAccessibleName('Einstellen');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'setup');
  for (const id of ['#rack', '#form-song', '#form-insp']) await expect(page.locator(id), id).toBeVisible();

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(sw).toBeFocused();
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'focus');
  for (const id of ['#rack', '#form-song', '#form-insp']) await expect(page.locator(id), id).toBeHidden();
  for (const id of ['#fretboard', '#wheel', '#lanes', '#form-strip']) await expect(page.locator(id), id).toBeVisible();
  expect(await pageScroll(page)).toEqual({ y: 0, x: 0 });
  expect((await savedLayout(page)).mode).toBe('focus');

  // nach dem Neuladen steht der Zustand wieder da
  await page.reload();
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'focus');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => localStorage.setItem('backingtrack.layout', JSON.stringify({ mode: 'setup' })));
  await page.reload();
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'setup');

  // Tastatur: Leertaste schaltet
  await page.locator('#tune-btn').click();
  await sw.focus();
  await page.keyboard.press(' ');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(rack(page)).toBeHidden();
});

test('Los öffnet die Spielseite im Fokus, Feintuning im Zustand Einstellen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  await page.locator('#play-back').click();
  await page.locator('#go').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'focus');
  await expect(rack(page)).toBeHidden();
  await expect(modeSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await page.locator('#play-go').click();
  await page.locator('#play-back').click();
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  expect((await savedLayout(page)).mode).toBe('setup');
});

test('Umschalten während der Wiedergabe: kein Neustart, Akkordkreis und Spuren zeichnen in der neuen Größe', async ({ page }) => {
  await page.locator('#go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von \d+$/, { timeout: BAR_TIMEOUT });
  const before = { contexts: await contexts(page), sets: await sets(page) };
  expect(before.contexts).toBe(1);
  const focus = { wheel: await canvasSize(page, '#wheel'), lanes: await canvasSize(page, '#lanes') };
  await modeSwitch(page).click();
  await expect(rack(page)).toBeVisible();
  for (const id of ['#wheel', '#lanes']) {
    await expect.poll(async () => (await canvasSize(page, id)).fits, id).toBe(true);
    expect((await canvasSize(page, id)).height, id).not.toBe(focus[id.slice(1)].height);
  }
  await modeSwitch(page).click();
  await expect(rack(page)).toBeHidden();
  for (const id of ['#wheel', '#lanes']) {
    await expect.poll(async () => (await canvasSize(page, id)).fits, id).toBe(true);
    expect((await canvasSize(page, id)).height, id).toBe(focus[id.slice(1)].height);
  }
  expect({ contexts: await contexts(page), sets: await sets(page) }).toEqual(before);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
});

test('Name der App in der Kopfleiste führt zur Startseite, die Wiedergabe läuft weiter', async ({ page }) => {
  await page.locator('#go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von \d+$/, { timeout: BAR_TIMEOUT });
  const back = page.locator('.play-head #play-back');
  await expect(back).toHaveText('Backingtrack-Generator');
  await expect(back).toHaveAttribute('title', 'Zur Startseite');
  const sets0 = await sets(page);
  await back.click();
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#play')).toBeHidden();
  await expect(page.locator('#go')).toHaveText('Stopp');
  await expect(page.locator('#go')).toBeFocused();
  await expect(page.locator('#position')).toHaveText(/^Takt \d+ von \d+$/);
  expect(await sets(page)).toBe(sets0);
  await page.locator('#go').click();
});

test('Kopfleiste: genau eine h2 auf der Spielseite, Module mit Titeln, Sprachtasten in der Kopfleiste', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play h2:not(#profiles-pop h2)')).toHaveCount(1); // das Profil-Fenster ist ein eigener Dialog
  for (const id of ['mod-key', 'mod-fretboard', 'mod-wheel', 'mod-song', 'mod-harmony', 'mod-rhythm', 'mod-character', 'mod-mixer']) {
    const mod = page.locator(`#${id}`);
    await expect(mod, id).toHaveJSProperty('tagName', 'SECTION');
    const title = await mod.getAttribute('aria-labelledby');
    await expect(page.locator(`#${title}`), id).toHaveText(/\S/);
  }
  await expect(page.locator('.play-head [data-lang="en"]')).toBeVisible();
  await page.locator('[data-lang="en"]').click();
  await expect(modeSwitch(page)).toHaveAccessibleName('Setup');
  await expect(page.locator('#mod-harmony-title')).toHaveText('Harmony');
  await page.locator('#play-back').click();
  await expect(page.locator('.top [data-lang="en"]')).toBeVisible();
  await expect(page.locator('[data-lang="en"]')).toHaveCount(1);
});

test('1280 × 720 im Zustand Einstellen: die Seite scrollt nicht, das Rack hat mindestens 150 px, das Griffbrett behält seine 240 px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  expect(await pageScroll(page)).toEqual({ y: 0, x: 0 });
  expect((await rack(page).boundingBox()).height).toBeGreaterThanOrEqual(150);
  expect((await page.locator('#fretboard').boundingBox()).height).toBeGreaterThanOrEqual(240);
  // die Kopfleiste bleibt eine Zeile (sonst fehlt dem Rack die Höhe)
  expect((await page.locator('.play-head').boundingBox()).height).toBeLessThan(60);
  // alles bleibt im Fenster und nichts überlappt: Griffbrett ganz, Spuren ganz
  for (const id of ['#fretboard', '#wheel', '#lanes', '#form-strip']) await expect(page.locator(id), id).toBeInViewport({ ratio: 1 });
  const boxes = await Promise.all(['.play-head', '#mod-fretboard', '#mod-wheel', '#mod-song', '#rack'].map((s) => page.locator(s).boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${i} ${j}`).toBe(false);
});

test('1600 × 960 im Zustand Einstellen: das Rack hat mindestens 300 px, das Feld "Ganzes Lied" scrollt nicht in sich', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(rack(page)).toBeVisible();
  expect((await rack(page).boundingBox()).height).toBeGreaterThanOrEqual(300);
  const song = await page.locator('#form-song').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(song.scroll).toBeLessThanOrEqual(song.client + 1);
});
