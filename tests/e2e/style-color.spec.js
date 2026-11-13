// Akkordfarbe der Stil-Vorlagen auf der Spielseite (echte Seite /ui/index.html): der Stil bringt seine Farbe mit, variety wählt
// in etwa jeder vierten Variante die Ausweichfarbe, eine selbst gewählte Farbe bleibt.
import { test, expect } from '@playwright/test';
import { progressionFor } from '../../src/core/progressions.js';
import { colorProgression } from '../../src/core/harmony.js';
import { chordName } from '../../src/core/chords.js';
import { STYLE_PRESETS, styleChordColor } from '../../src/core/tags.js';
import { addChordByName } from './chord-helpers.js';
import { chooseStyle } from './style-helpers.js';

const AM = { root: 'A', mode: 'minor' };
const preset = (id) => STYLE_PRESETS.find((p) => p.id === id);

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    window.__instrumentSets = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
    const convolver = BaseAudioContext.prototype.createConvolver;
    BaseAudioContext.prototype.createConvolver = function (...args) {
      window.__instrumentSets++;
      return convolver.apply(this, args);
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const color = (page, id) => page.locator(`#chord-color [data-color="${id}"]`);
const shown = (page) => page.locator('#progression button').allTextContents();
const seedOf = async (page) => Number(await page.locator('#variant').inputValue());
const pressedColor = (page) => page.locator('#chord-color [aria-pressed="true"]').getAttribute('data-color');
// erwartete Folge: die vom Seed erzeugten Dreiklänge in der Farbe
const expected = (key, seed, c) => colorProgression(progressionFor(key, seed).map((chord) => ({ chord, beats: 4 })), c, key).map((b) => chordName(b.chord));

test('Stil Blues setzt seine Farbe und färbt die Folge, Funk stellt auf Dreiklänge zurück', async ({ page }) => {
  await chooseStyle(page, 'blues');
  const seed = await seedOf(page);
  const c = styleChordColor(preset('blues'), seed, true);
  expect(await pressedColor(page)).toBe(c);
  expect(await shown(page)).toEqual(expected(AM, seed, c));
  await chooseStyle(page, 'funk');
  expect(await pressedColor(page)).toBe('triads');
  expect(await shown(page)).toEqual(expected(AM, seed, 'triads'));
});

test('Hardrock färbt auf Powerchords (oder Ausweichfarbe), andere Stile bleiben bei Dreiklängen', async ({ page }) => {
  await chooseStyle(page, 'hardrock');
  const seed = await seedOf(page);
  expect(await pressedColor(page)).toBe(styleChordColor(preset('hardrock'), seed, true));
  for (const id of ['rock', 'country', 'reggae', 'psych', 'dreamy']) {
    await chooseStyle(page, id);
    expect(await pressedColor(page), id).toBe('triads');
  }
});

test('eine von Hand geänderte Folge wird beim Stilwechsel umgefärbt, nicht neu erzeugt', async ({ page }) => {
  await chooseStyle(page, 'blues');
  await addChordByName(page, 'G');
  const before = await shown(page);
  await chooseStyle(page, 'hardrock');
  const after = await shown(page);
  expect(after).toHaveLength(before.length);
  expect(after.at(-1)).toMatch(/^G(5)?$/); // Powerchord G5 oder, bei der Ausweichfarbe, der Dreiklang G
});

test('Variantenwechsel: Blues zeigt beide Farben, Funk nie eine andere als Dreiklänge', async ({ page }) => {
  await chooseStyle(page, 'blues');
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    seen.add(await pressedColor(page));
    await page.locator('#variant-next').click();
  }
  expect([...seen].sort()).toEqual(['extended', 'sevenths']);
  await chooseStyle(page, 'funk');
  for (let i = 0; i < 12; i++) {
    expect(await pressedColor(page)).toBe('triads');
    await page.locator('#variant-next').click();
  }
});

test('eine selbst gewählte Farbe bleibt über Variantenwechsel und wird vom nächsten Stil wieder überschrieben', async ({ page }) => {
  await chooseStyle(page, 'blues');
  await color(page, 'triads').click();
  for (let i = 0; i < 12; i++) {
    await page.locator('#variant-next').click();
    expect(await pressedColor(page)).toBe('triads');
  }
  await chooseStyle(page, 'blues');
  expect(['sevenths', 'extended']).toContain(await pressedColor(page));
});

test('während der Wiedergabe: Stilwahl bringt die Farbe live, ohne neuen Instrumentensatz', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await chooseStyle(page, 'hardrock');
  expect(['power', 'triads']).toContain(await pressedColor(page));
  expect(await page.evaluate(() => window.__instrumentSets)).toBe(1);
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await page.locator('#play-go').click();
});

test('Stil von der Startseite aus: dieselbe Farbe wie beim Laden des Werksprofils', async ({ page }) => {
  await page.locator('#play-back').click();
  await page.locator('#style-btn').click();
  await page.locator('#style-cards [data-style="poppunk"]').click();
  await page.locator('#tune-btn').click();
  expect(await pressedColor(page)).toBe(styleChordColor(preset('poppunk'), await seedOf(page), true));
});
