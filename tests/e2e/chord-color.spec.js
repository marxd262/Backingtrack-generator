// Akkordfarbe der Spielseite (echte Seite /ui/index.html): eine Einstellung, die die ganze Folge umfärbt und für neu erzeugte Folgen gilt.
import { test, expect } from '@playwright/test';
import { progressionFor } from '../../src/core/progressions.js';
import { colorProgression } from '../../src/core/harmony.js';
import { chordName } from '../../src/core/chords.js';
import { addChordByName } from './chord-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor)\.[A-Za-z.]+$/;
const AM = { root: 'A', mode: 'minor' };

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
  if (!(await page.locator('#side-right').isVisible())) await page.locator('#toggle-right').click();
  await expect(page.locator('#side-right')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const color = (page, id) => page.locator(`#chord-color [data-color="${id}"]`);
const progression = (page) => page.locator('#progression button');
const shown = (page) => progression(page).allTextContents();
const seedOf = async (page) => Number(await page.locator('#variant').inputValue());
// erwartete Folge: die vom Seed erzeugten Dreiklänge in der Farbe
const expected = (key, seed, c) => colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), c, key).map((b) => chordName(b.chord));

test('vier Farben als Chips, Dreiklänge gedrückt am Anfang', async ({ page }) => {
  expect(await page.locator('#chord-color button').allTextContents()).toEqual(['Dreiklänge', 'Septakkorde', 'Erweiterungen', 'Powerchords']);
  await expect(color(page, 'triads')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#chord-color [aria-pressed="true"]')).toHaveCount(1);
});

test('Septakkorde färben die Folge um, Dreiklänge stellen sie zurück', async ({ page }) => {
  const seed = await seedOf(page);
  expect(await shown(page)).toEqual(expected(AM, seed, 'triads'));
  await color(page, 'sevenths').click();
  await expect(color(page, 'sevenths')).toHaveAttribute('aria-pressed', 'true');
  expect(await shown(page)).toEqual(expected(AM, seed, 'sevenths'));
  expect((await shown(page)).every((n) => /7|m7b5/.test(n))).toBe(true);
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'triads'));
  await color(page, 'extended').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'extended'));
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'triads'));
  await color(page, 'power').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'power'));
  // auch von Powerchords zurück ist die unveränderte Folge verlustfrei (sie wird neu abgeleitet, E5 würde sonst zu Em)
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'triads'));
});

test('Wechsel über Powerchords zu Septakkorden ergibt dieselbe Folge wie direkt (die Dominante geht nicht verloren)', async ({ page }) => {
  const seed = await seedOf(page);
  await color(page, 'power').click();
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'sevenths'));
  await color(page, 'power').click();
  await color(page, 'extended').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'extended'));
  // derselbe Seed, dieselbe Farbe: nach Variantenwechsel hin und zurück bleibt die Folge gleich
  await page.locator('#variant-next').click();
  await page.locator('#variant-prev').click();
  expect(await shown(page)).toEqual(expected(AM, seed, 'extended'));
});

test('eine von Hand geänderte Folge wird beim Farbwechsel umgefärbt, nicht neu erzeugt', async ({ page }) => {
  await color(page, 'sevenths').click();
  const before = await shown(page);
  await addChordByName(page, 'G');
  await color(page, 'extended').click();
  const after = await shown(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toBe('Gadd9');
});

test('Variantenwechsel und Tonartwechsel behalten die Farbe', async ({ page }) => {
  await color(page, 'sevenths').click();
  await page.locator('#variant-next').click();
  expect(await shown(page)).toEqual(expected(AM, await seedOf(page), 'sevenths'));
  await page.locator('#side-key-chips').getByRole('button', { name: 'D', exact: true }).click();
  expect(await shown(page)).toEqual(expected({ root: 'D', mode: 'minor' }, await seedOf(page), 'sevenths'));
  await expect(color(page, 'sevenths')).toHaveAttribute('aria-pressed', 'true');
});

test('von Hand Angefügtes bleibt bis zur nächsten Ableitung; erneutes Wählen der Farbe färbt es', async ({ page }) => {
  await color(page, 'sevenths').click();
  const before = await shown(page);
  await addChordByName(page, 'G');
  expect(await shown(page)).toEqual([...before, 'G']);
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual([...before, 'Gmaj7']);
  await page.locator('#variant-next').click();
  expect(await shown(page)).toEqual(expected(AM, await seedOf(page), 'sevenths'));
});

test('während der Wiedergabe: Farbwahl startet neu im selben AudioContext', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await color(page, 'extended').click();
  await expect(color(page, 'extended')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('Griffbrett nennt gefärbte Akkorde mit ihren Tönen', async ({ page }) => {
  while ((await progression(page).count()) > 1) await progression(page).first().click();
  await addChordByName(page, 'Am');
  await addChordByName(page, 'E');
  await progression(page).first().click();
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual(['Am7', 'E7']);
  await expect(page.locator('#fretboard-text')).toContainText('Am7');
  await expect(page.locator('#fretboard-text')).toContainText('A, C, E, G');
  await expect(page.locator('#fretboard-text')).toContainText('E, G#, B, D');
});

test('Tastatur und beide Sprachen ohne rohe Schlüssel', async ({ page }) => {
  await color(page, 'power').focus();
  await page.keyboard.press('Enter');
  await expect(color(page, 'power')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-lang="en"]').click();
  expect(await page.locator('#chord-color button').allTextContents()).toEqual(['Triads', 'Sevenths', 'Extended', 'Power chords']);
  await expect(page.getByRole('heading', { name: 'Chord colour' })).toBeVisible();
  for (const text of await page.locator('#chord-color button, #add-chords button, #add-chords .sub-label').allTextContents()) {
    expect(RAW_KEY.test(text.trim()), text).toBe(false);
  }
});
