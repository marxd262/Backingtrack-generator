// Zweistufige Akkordauswahl der Spielseite (echte Seite /ui/index.html): erst der Grundton, dann die Akkordart.
import { test, expect } from '@playwright/test';
import { chordOptions } from '../../src/core/music.js';
import { CHORDS } from '../../src/core/chords.js';
import { addChordByName, openQualityGroup } from './chord-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor)\.[A-Za-z.]+$/;

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
  if (!(await page.locator('#side-right').isVisible())) await page.locator('#toggle-right').click();
  await expect(page.locator('#side-right')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const roots = (page) => page.locator('#add-roots button');
const root = (page, name) => page.locator('#add-roots button', { hasText: new RegExp(`^${name}$`) });
const quality = (page, name) => page.locator('#add-qualities button', { hasText: new RegExp(`^${name}$`) });
const enabled = (page) => page.locator('#add-qualities button:not([disabled])').allTextContents();
const progression = (page) => page.locator('#progression button');
const shown = (page) => progression(page).allTextContents();

test('A-Moll: sieben Grundtöne, A gewählt, nur die dort erlaubten Akkordarten aktiv', async ({ page }) => {
  expect(await roots(page).allTextContents()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  await expect(root(page, 'A')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#add-roots button[aria-pressed="true"]')).toHaveCount(1);
  expect(await enabled(page)).toEqual(['Am', 'Asus2', 'Asus4', 'A5', 'Am7', 'Am6', 'Am9']);
  for (const name of ['A', 'Aaug', 'A7', 'Amaj7', 'Am7b5']) await expect(quality(page, name), name).toBeDisabled();
});

test('deaktivierte Akkordarten sehen anders aus als aktive und bieten keinen Klick-Zeiger', async ({ page }) => {
  const look = (name) => quality(page, name).evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, border: s.borderTopStyle, cursor: s.cursor };
  });
  const on = await look('Am');
  const off = await look('A');
  expect(off.color).not.toBe(on.color);
  expect(off.cursor).not.toBe(on.cursor);
  expect(off.border).not.toBe(on.border);
});

test('Akkordarten stehen in einklappbaren Gruppen: Dreiklänge offen, Septakkorde und Erweiterungen zu, jede Art hat einen Chip', async ({ page }) => {
  await expect(page.locator('#add-qualities button')).toHaveCount(Object.keys(CHORDS).length);
  const summaries = page.locator('#add-qualities details > summary');
  expect(await summaries.allTextContents()).toEqual(['Dreiklänge', 'Septakkorde', 'Erweiterungen']);
  const open = () => page.locator('#add-qualities details').evaluateAll((els) => els.map((el) => el.open));
  expect(await open()).toEqual([true, false, false]);
  // zu: nur die Chips der Dreiklänge sind zu sehen, die Leiste bleibt kurz
  const triads = Object.values(CHORDS).filter((c) => c.group === 'triad').length;
  await expect(page.locator('#add-qualities button:visible')).toHaveCount(triads);
  await summaries.nth(1).click();
  expect(await open()).toEqual([true, true, false]);
  await expect(page.locator('#add-qualities button:visible')).toHaveCount(triads + Object.values(CHORDS).filter((c) => c.group === 'seventh').length);
  // der Zustand wird gemerkt (das toggle-Ereignis speichert asynchron: erst warten, bis er im Speicher steht)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')).groups.seventh)).toBe(true);
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  expect(await open()).toEqual([true, true, false]);
});

test('E in A-Moll vereint Moll- und Dur-Arten; Klick auf eine Art hängt den Akkord an', async ({ page }) => {
  await root(page, 'E').click();
  await expect(root(page, 'E')).toHaveAttribute('aria-pressed', 'true');
  const on = await enabled(page);
  for (const name of ['E', 'Em', 'E7', 'E9', 'Emaj7', 'Em7', 'Esus4', 'E5']) expect(on, name).toContain(name);
  const before = await shown(page);
  await openQualityGroup(page, 'min7');
  await quality(page, 'Em7').click();
  expect(await shown(page)).toEqual([...before, 'Em7']);
  await expect(page.locator('#tuning-message')).toHaveText('');
});

test('B ist die verminderte Stufe: Bdim, B5, Bm7b5 und Bdim7', async ({ page }) => {
  await root(page, 'B').click();
  expect(await enabled(page)).toEqual(['Bdim', 'B5', 'Bm7b5', 'Bdim7']);
});

test('Tastatur: Enter wählt den Grundton und fügt eine Art an, der Fokus bleibt auf dem Chip', async ({ page }) => {
  await root(page, 'E').focus();
  await page.keyboard.press('Enter');
  await expect(root(page, 'E')).toHaveAttribute('aria-pressed', 'true');
  const before = await shown(page);
  await openQualityGroup(page, 'dom7');
  await quality(page, 'E7').focus();
  await page.keyboard.press('Enter');
  expect(await shown(page)).toEqual([...before, 'E7']);
  await expect(quality(page, 'E7')).toBeFocused();
});

test('volle Folge (acht Akkorde): weitere Auswahl wird abgelehnt und gemeldet', async ({ page }) => {
  while ((await progression(page).count()) < 8) await quality(page, 'Am').click();
  await quality(page, 'Am').click();
  await expect(page.locator('#tuning-message')).toHaveText(/8/);
  await expect(progression(page)).toHaveCount(8);
});

test('anderer Modus: die Grundtöne folgen chordOptions, die Auswahl springt auf den ersten', async ({ page }) => {
  await root(page, 'E').click();
  await page.locator('#side-scale-chips').getByRole('button', { name: /Dorisch/ }).click();
  expect(await roots(page).allTextContents()).toEqual(chordOptions({ root: 'A', mode: 'dorian' }).map((o) => o.root));
  await expect(roots(page).first()).toHaveAttribute('aria-pressed', 'true');
});

test('kein roher Schlüssel in beiden Sprachen, englische Gruppennamen', async ({ page }) => {
  const texts = () => page.locator('#add-chords').evaluate((el) => [...el.querySelectorAll('button, .sub-label, summary')].map((n) => n.textContent.trim()));
  for (const text of await texts()) expect(RAW_KEY.test(text), text).toBe(false);
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('#add-qualities summary').first()).toHaveText('Triads');
  for (const text of await texts()) expect(RAW_KEY.test(text), text).toBe(false);
});

test('jeder Chip nennt die Akkordart als Hilfetext und im zugänglichen Namen, in beiden Sprachen', async ({ page }) => {
  const am7 = quality(page, 'Am7');
  await expect(am7).toHaveAttribute('title', 'Mollseptakkord');
  await expect(am7).toHaveAttribute('aria-label', 'Am7 (Mollseptakkord) hinzufügen');
  await expect(quality(page, 'A5')).toHaveAttribute('title', 'Powerchord');
  await page.locator('[data-lang="en"]').click();
  await expect(am7).toHaveAttribute('title', 'Minor seventh');
  await expect(am7).toHaveAttribute('aria-label', 'Add Am7 (Minor seventh)');
  for (const q of Object.keys(CHORDS)) {
    const title = await page.locator(`#add-qualities button[data-quality="${q}"]`).getAttribute('title');
    expect(title && !title.startsWith('chord.'), q).toBeTruthy();
  }
});

test('helper addChordByName fügt einen Akkord über beide Schritte an', async ({ page }) => {
  const before = await shown(page);
  await addChordByName(page, 'G', '#side-right');
  await addChordByName(page, 'Bdim');
  expect(await shown(page)).toEqual([...before, 'G', 'Bdim']);
});

test('360 px: kein waagerechtes Scrollen, alle Chips mindestens 44 px hoch', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // schmal sind beide Leisten nicht zugleich offen: die rechte schließt erst nach dem Größenwechsel, dann als Schublade öffnen
  await expect(page.locator('#side-right')).toBeHidden();
  await page.keyboard.press('Escape'); // die linke Schublade bleibt offen und ist modal: erst schließen
  await expect(page.locator('#side-left')).toBeHidden();
  await page.locator('#toggle-right').click();
  await expect(page.locator('#side-right')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('#side-right').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const quality of ['dom7', 'maj6']) await openQualityGroup(page, quality); // zugeklappte Chips haben keine Höhe
  const heights = await page.locator('#add-chords button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights.length).toBe(7 + Object.keys(CHORDS).length);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(43.5);
});
