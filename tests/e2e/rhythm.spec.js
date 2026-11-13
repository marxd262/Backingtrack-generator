// Rhythmus-Gruppe der Spielseite (echte Seite /ui/index.html): Taktart, Groove und Komplexität.
import { test, expect } from '@playwright/test';
import { METERS, GROOVES, DEFAULT_GROOVE, groovesFor } from '../../src/core/grooves.js';
import { chooseStyle, currentStyle } from './style-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const KEYS = Object.keys(METERS);

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

const meter = (page, key) => page.locator(`#meter-chips [data-meter="${key}"]`);
const chooseGroove = (page, id) => page.locator('#groove-select').selectOption(id);
const grooveIds = (page) => page.locator('#groove-select option').evaluateAll((els) => els.map((el) => el.value));
const complexity = (page) => page.locator('#complexity');
const tempo = (page) => page.locator('#tuning-tempo');
const progression = (page) => page.locator('#progression button');
const pressedMeter = (page) => page.locator('#meter-chips [aria-pressed="true"]').getAttribute('data-meter');
const pressedGroove = (page) => page.locator('#groove-select').inputValue();
const sets = (page) => page.evaluate(() => window.__instrumentSets);
const contexts = (page) => page.evaluate(() => window.__audioContexts);

test('Modul Rhythmus: im Rack nach Harmonie und vor den Instrumenten, fünf Taktarten, 4/4 und Standard-Groove gedrückt, Komplexität 50 %', async ({ page }) => {
  const order = await page.locator('#rack .rack-row > *').evaluateAll((els) => els.map((el) => el.id));
  expect(order.indexOf('mod-rhythm')).toBe(order.indexOf('mod-harmony') + 1);
  expect(order.indexOf('mod-rhythm')).toBeLessThan(order.indexOf('rack-instruments'));
  await expect(page.locator('#mod-rhythm')).toBeVisible();
  expect(await page.locator('#meter-chips button').allTextContents()).toEqual(KEYS);
  expect(await pressedMeter(page)).toBe('4/4');
  expect(await pressedGroove(page)).toBe('straight');
  expect(await grooveIds(page)).toEqual(groovesFor('4/4'));
  await expect(complexity(page)).toHaveValue('50');
  await expect(page.locator('#complexity-out')).toHaveText('50 %');
});

test('die Grooves folgen der Taktart, der Standard-Groove ist gewählt', async ({ page }) => {
  for (const key of KEYS) {
    await meter(page, key).click();
    expect(await pressedMeter(page)).toBe(key);
    expect(await grooveIds(page)).toEqual(groovesFor(key));
    expect(await pressedGroove(page)).toBe(DEFAULT_GROOVE[key]);
  }
});

test('Taktartwechsel: Akkorde bleiben, Tempo wird umgerechnet (Achtelgeschwindigkeit bleibt), Rückweg', async ({ page }) => {
  const before = await progression(page).allTextContents();
  await tempo(page).fill('100');
  await meter(page, '3/4').click();
  await expect(tempo(page)).toHaveValue('100');
  await meter(page, '6/8').click();
  await expect(tempo(page)).toHaveValue('67');
  expect(await progression(page).allTextContents()).toEqual(before);
  // zurück zur vorigen Taktart ohne eigene Tempoänderung: das alte Tempo, keine Rundungsabweichung
  await meter(page, '4/4').click();
  await expect(tempo(page)).toHaveValue('100');
});

test('Rückwechsel gibt das alte Tempo nur zurück, wenn das Tempo nicht verändert wurde', async ({ page }) => {
  await tempo(page).fill('100');
  await meter(page, '6/8').click();
  await expect(tempo(page)).toHaveValue('67');
  await tempo(page).fill('70');
  await meter(page, '4/4').click();
  await expect(tempo(page)).toHaveValue('105');
});

test('ein Stil in 6/8 oder 12/8 bringt sein Tempo in Achtelgeschwindigkeit mit, der Stil bleibt gewählt', async ({ page }) => {
  await meter(page, '6/8').click();
  await chooseStyle(page, 'blues');
  await expect(tempo(page)).toHaveValue('59'); // 88 * 2/3
  expect(await currentStyle(page)).toBe('blues');
  await meter(page, '12/8').click();
  await chooseStyle(page, 'funk');
  await expect(tempo(page)).toHaveValue('67');
  expect(await currentStyle(page)).toBe('funk');
  await meter(page, '3/4').click(); // einfache Taktart: Stiltempo unverändert
  await chooseStyle(page, 'blues');
  await expect(tempo(page)).toHaveValue('88');
});

test('der Komplexitätsregler nennt seinen Wert mit aria-valuetext', async ({ page }) => {
  await expect(complexity(page)).toHaveAttribute('aria-valuetext', '50 %');
  await complexity(page).fill('80');
  await expect(complexity(page)).toHaveAttribute('aria-valuetext', '80 %');
});

test('Wiedergabe in 3/4: ein Takt dauert drei Schläge, in 4/4 vier', async ({ page }) => {
  test.setTimeout(60_000);
  await tempo(page).fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  const barSeconds = async () => {
    const stamps = await page.evaluate(() => new Promise((resolve) => {
      const el = document.querySelector('#play-position');
      const seen = new Map();
      const observer = new MutationObserver(() => {
        const n = Number((el.textContent.match(/^Takt (\d+)/) ?? [])[1]);
        if (n && !seen.has(n)) seen.set(n, performance.now());
        if (seen.size >= 4) { observer.disconnect(); resolve([...seen.entries()]); }
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    }));
    return (stamps.at(-1)[1] - stamps[1][1]) / (stamps.length - 2) / 1000;
  };
  const four = await barSeconds();
  expect(four).toBeGreaterThan(1.0);
  expect(four).toBeLessThan(1.4); // 4 Schläge bei 200 = 1,2 s
  await meter(page, '3/4').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  const three = await barSeconds();
  expect(three).toBeGreaterThan(0.75);
  expect(three).toBeLessThan(1.05); // 3 Schläge bei 200 = 0,9 s
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Groove und Komplexität wirken live: kein neuer Instrumentensatz, kein neuer AudioContext', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await sets(page)).toBe(1);
  await chooseGroove(page, 'latin');
  expect(await pressedGroove(page)).toBe('latin');
  await complexity(page).fill('90');
  await expect(page.locator('#complexity-out')).toHaveText('90 %');
  await complexity(page).fill('10');
  expect(await sets(page)).toBe(1);
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Taktartwechsel während der Wiedergabe startet im selben AudioContext neu', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await meter(page, '12/8').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('ein Stil-Klick lässt Taktart, Groove und Komplexität stehen', async ({ page }) => {
  await meter(page, '12/8').click();
  await chooseGroove(page, 'slowBlues');
  await complexity(page).fill('80');
  await chooseStyle(page, 'blues');
  expect(await pressedMeter(page)).toBe('12/8');
  expect(await pressedGroove(page)).toBe('slowBlues');
  await expect(complexity(page)).toHaveValue('80');
});

test('Tastatur und beide Sprachen ohne rohe Schlüssel', async ({ page }) => {
  await meter(page, '6/8').focus();
  await page.keyboard.press('Enter');
  expect(await pressedMeter(page)).toBe('6/8');
  // Tasten ‹ › der LCD-Auswahl: ein Eintrag weiter
  const index = (await grooveIds(page)).indexOf('rock68');
  await page.locator('#groove-select').selectOption({ index: index - 1 });
  await page.locator('#mod-rhythm .lcd-btn').last().focus();
  await page.keyboard.press('Enter');
  expect(await pressedGroove(page)).toBe('rock68');
  await complexity(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(complexity(page)).toHaveValue('51');
  for (const lang of ['de', 'en']) {
    await page.locator(`[data-lang="${lang}"]`).click();
    for (const text of await page.locator('#mod-rhythm').evaluate((el) => [...el.querySelectorAll('h3, h4, label, button, output')].map((n) => n.textContent.trim()))) {
      expect(RAW_KEY.test(text), `${lang}: ${text}`).toBe(false);
    }
  }
  await expect(page.locator('#groove-select option[value="rock68"]')).toHaveText('Rock (6/8)');
  expect(Object.keys(GROOVES)).toContain('rock68');
});

test('360 px: kein waagerechtes Scrollen, Chips mindestens 44 px hoch', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('#mod-rhythm').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const h of await page.locator('#meter-chips button, #groove-select, #mod-rhythm .lcd-btn').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
    expect(h).toBeGreaterThanOrEqual(43.5);
  }
});
