// Klangregler der Spielseite (echte Seite /ui/index.html): ein Regler je Klangfeld, live ohne Neustart.
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { DEFAULT_TIMBRE, resolveTimbre } from '../../src/core/timbre.js';
import { masterParams } from '../../src/audio/voice-params.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre)\.[A-Za-z.]+$/;
const BAR_TIMEOUT = 10_000;
const FIELDS = Object.entries(DEFAULT_TIMBRE).flatMap(([group, fields]) => Object.keys(fields).map((field) => [group, field]));
const funk = STYLE_PRESETS.find((p) => p.id === 'funk');

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
    // Ziele der weichen Rampen (setTargetAtTime): so sieht man, dass ein Regler die Audioknoten live erreicht
    window.__targets = [];
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, ...rest) {
      window.__targets.push(value);
      return target.call(this, value, ...rest);
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

const group = (page, id) => page.locator(`details[data-group="${id}"]`);
const slider = (page, g, f) => page.locator(`#timbre-${g}-${f}`);
const position = (page) => page.locator('#play-position');
const playGo = (page) => page.locator('#play-go');
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const targets = (page) => page.evaluate(() => window.__targets);
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const percent = (value) => String(Math.round(value * 100));

async function openGroup(page, id) {
  if (!(await group(page, id).evaluate((el) => el.open))) await group(page, id).locator('> summary').click();
}

async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Stopp');
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
}

// Auswahl nach einem Klick auf ein Schlagwort: aus den Chips der Seite gelesen, damit der Test den Umschalter nicht nachbaut
const currentTags = (page) => page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => {
  const tags = {};
  for (const el of els) (tags[el.dataset.category] ??= []).push(el.dataset.tag);
  return tags;
});

test('26 Regler in 5 Gruppen, alle beschriftet ohne rohen Schlüsselnamen', async ({ page }) => {
  expect(FIELDS).toHaveLength(26);
  for (const [g, fields] of Object.entries(DEFAULT_TIMBRE)) {
    await expect(group(page, g), g).toHaveCount(1);
    await expect(group(page, g).locator('input[type="range"]'), g).toHaveCount(Object.keys(fields).length);
  }
  for (const [g, f] of FIELDS) {
    const label = await page.locator(`label[for="timbre-${g}-${f}"]`).textContent();
    expect(label.trim().length, `${g}.${f}`).toBeGreaterThan(0);
    expect(RAW_KEY.test(label.trim()), `${g}.${f}: ${label}`).toBe(false);
  }
  const summaries = await page.locator('details[data-group] > summary').allTextContents();
  for (const text of summaries) expect(RAW_KEY.test(text.trim()), text).toBe(false);
});

test('Startwerte der Regler kommen aus den Schlagworten der Vorlage', async ({ page }) => {
  const timbre = resolveTimbre(funk.tags);
  for (const [g, f] of FIELDS) {
    await expect(slider(page, g, f), `${g}.${f}`).toHaveValue(percent(timbre[g][f]));
  }
});

test('Regler während der Wiedergabe: wirkt live auf die Audioknoten, kein Neustart, ein AudioContext', async ({ page }) => {
  await playFast(page);
  expect(await contexts(page)).toBe(1);
  await page.evaluate(() => {
    window.__positions = [];
    const el = document.querySelector('#play-position');
    new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const before = await shownBar(page);
  await openGroup(page, 'master');
  await slider(page, 'master', 'reverb').fill('100');
  const expected = masterParams({ ...resolveTimbre(funk.tags).master, reverb: 1 }).reverbWet;
  await expect.poll(() => targets(page)).toContain(expected);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  const shown = (await page.evaluate(() => window.__positions));
  for (const text of shown) expect(text, 'Taktzeile nie leer (kein Neustart)').not.toBe('');
  expect(await contexts(page)).toBe(1);
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
});

test('Überschreibung gewinnt gegen Schlagwörter, Zurücksetzen holt den Schlagwortwert zurück', async ({ page }) => {
  await openGroup(page, 'bass');
  const startFuzz = await slider(page, 'bass', 'fuzz').inputValue();
  await slider(page, 'bass', 'fuzz').fill('80');
  // 'gritty' schiebt bass.fuzz um +0,3; der Regler bleibt auf 80
  await page.locator('#tags [data-category="bass"][data-tag="gritty"]').click();
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  // ein nicht überschriebenes Feld folgt dem Schlagwort: 'sub' (bassSound) hebt bass.sub
  await page.locator('#tags [data-category="bassSound"][data-tag="sub"]').click();
  const tags = await currentTags(page);
  await expect(slider(page, 'bass', 'sub')).toHaveValue(percent(resolveTimbre(tags).bass.sub));
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  await group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(percent(resolveTimbre(tags).bass.fuzz));
  expect(percent(resolveTimbre(tags).bass.fuzz)).not.toBe(startFuzz); // gritty ist noch gewählt: der Wert ist ein anderer als am Anfang
});

test('Zurücksetzen ist nur aktiv, wenn die Gruppe Überschreibungen hat', async ({ page }) => {
  await openGroup(page, 'drums');
  const reset = group(page, 'drums').getByRole('button', { name: 'Zurücksetzen' });
  await expect(reset).toBeDisabled();
  await slider(page, 'drums', 'room').fill('70');
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
});

test('Schnellauswahl leert die Überschreibungen', async ({ page }) => {
  await openGroup(page, 'bass');
  await slider(page, 'bass', 'fuzz').fill('80');
  const psych = STYLE_PRESETS.find((p) => p.id === 'psych');
  await page.locator('#quick-pick [data-style="psych"]').click();
  await expect(page.locator('#quick-pick [data-style="psych"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(percent(resolveTimbre(psych.tags).bass.fuzz));
});

test('Regler vor dem Start bewegen: kein AudioContext, der Start läuft ohne Fehler', async ({ page }) => {
  await openGroup(page, 'bass');
  await slider(page, 'bass', 'fuzz').fill('90');
  expect(await contexts(page)).toBe(0);
  await playFast(page);
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('90');
  await playGo(page).click();
});

test('Fuzz schnell von 0 bis 100 ziehen während der Wiedergabe: keine Fehler, ein AudioContext', async ({ page }) => {
  await openGroup(page, 'bass');
  await playFast(page);
  for (let v = 0; v <= 100; v += 5) await slider(page, 'bass', 'fuzz').fill(String(v));
  for (let v = 100; v >= 0; v -= 5) await slider(page, 'bass', 'fuzz').fill(String(v));
  expect(await contexts(page)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
});

test('schmale Schublade mit allen Klang-Gruppen offen: scrollbar, letzter Regler erreichbar, kein Seiten-Überlauf, Escape schließt', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#side-left')).toBeVisible();
  for (const g of Object.keys(DEFAULT_TIMBRE)) await openGroup(page, g);
  const side = await page.locator('#side-left').evaluate((el) => ({ scrolls: el.scrollHeight > el.clientHeight, over: el.scrollWidth > el.clientWidth }));
  expect(side.scrolls).toBe(true);
  expect(side.over).toBe(false);
  const last = slider(page, 'master', 'reverb');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.fill('40');
  await expect(last).toHaveValue('40');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#side-left')).toBeHidden();
});
