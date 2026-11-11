// Hörprobe-Seite (Entwicklerwerkzeug): Stimme und Variante je Instrument wählen, Feinwerte live verstellen, Werte exportieren.
import { test, expect } from '@playwright/test';
import { TUNABLES } from '../../src/audio/voices/tunables.js';

let problems;

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
  await page.goto('/ui/render-harness.html');
  await expect(page.locator('#voice-chords')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const contexts = (page) => page.evaluate(() => window.__audioContexts);

test('je Instrument eine Stimmenauswahl mit allen Stimmen des Registers, Variante folgt der Stimme', async ({ page }) => {
  const values = (id) => page.locator(`${id} option`).evaluateAll((els) => els.map((e) => e.value).sort());
  expect(await values('#voice-chords')).toEqual(['epiano', 'sample', 'string', 'synth']);
  expect(await values('#voice-bass')).toEqual(['sample', 'string', 'synth']);
  expect(await values('#voice-pad')).toEqual(['sample', 'synth']);
  // nach Art gruppiert
  expect(await page.locator('#voice-chords optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual(['Synthese', 'Saitenmodell', 'Samples']);
  await expect(page.locator('#voice-chords')).toHaveValue('synth');
  await page.locator('#voice-chords').selectOption('string');
  expect(await page.locator('#variant-chords option').evaluateAll((els) => els.map((e) => e.value))).toEqual(['electric']);
  await expect(page.locator('#variant-chords')).toHaveValue('electric');
  await page.locator('#voice-chords').selectOption('synth');
  await expect(page.locator('#variant-chords')).toHaveValue('classic');
});

test('Tuning-Panel: ein Regler je Feinwert der gewählten Stimme, mit Grenzen und Standardwert aus der Tabelle', async ({ page }) => {
  await expect(page.locator('#tuning input[type="range"]')).toHaveCount(0); // Synth hat keine Feinwerte
  await page.locator('#voice-chords').selectOption('string');
  const key = 'chords/string/electric';
  await expect(page.locator('#tuning input[type="range"]')).toHaveCount(Object.keys(TUNABLES[key]).length);
  for (const [name, spec] of Object.entries(TUNABLES[key])) {
    const input = page.locator(`#tuning input[data-key="${key}"][data-name="${name}"]`);
    await expect(input).toHaveAttribute('min', String(spec.min));
    await expect(input).toHaveAttribute('max', String(spec.max));
    await expect(input).toHaveValue(String(spec.value));
  }
  await page.locator('#voice-bass').selectOption('string');
  await expect(page.locator('#tuning input[type="range"]')).toHaveCount(Object.keys(TUNABLES[key]).length + Object.keys(TUNABLES['bass/string/finger']).length);
});

test('Export: gültiges JSON mit dem geänderten Wert und allen Werten der gewählten Stimmen', async ({ page }) => {
  await page.locator('#voice-chords').selectOption('epiano');
  const input = page.locator('#tuning input[data-name="index"]');
  await input.fill('3.5');
  await page.locator('#export').click();
  const exported = JSON.parse(await page.locator('#export-text').inputValue());
  const key = 'chords/epiano/rhodes';
  expect(exported[key].index).toBe(3.5);
  expect(Object.keys(exported[key]).sort()).toEqual(Object.keys(TUNABLES[key]).sort());
  expect(exported[key].ratio).toBe(TUNABLES[key].ratio.value);
});

test('Wiedergabe: Stimme und Feinwert während des Spiels ändern, ohne Fehler und ohne zweiten AudioContext', async ({ page }) => {
  await page.locator('[data-style="funk"]').click();
  await page.waitForTimeout(400);
  await page.locator('#voice-bass').selectOption('string');
  await page.locator('#voice-chords').selectOption('epiano');
  await page.locator('#tuning input[data-name="index"]').fill('4');
  await page.locator('#voice-chords').selectOption('string');
  await page.locator('#tuning input[data-name="decay"]').first().fill('0.5');
  await page.waitForTimeout(400);
  expect(await contexts(page)).toBe(1);
  await page.locator('#stop').click();
});

test('Ton anspielen: der Knopf je Instrument spielt eine Note der gewählten Stimme ohne Fehler', async ({ page }) => {
  await page.locator('#voice-bass').selectOption('string');
  await page.locator('#note-bass').click();
  await expect(page.locator('#note-bass')).toBeEnabled();
  await page.waitForTimeout(500);
  expect(await contexts(page)).toBeLessThanOrEqual(1);
});

test('Sample-Stimmen: Varianten, Ladezustand lädt, dann bereit; Ton anspielen wartet auf das Laden', async ({ page }) => {
  await page.locator('#voice-bass').selectOption('sample');
  expect(await page.locator('#variant-bass option').evaluateAll((els) => els.map((e) => e.value))).toEqual(['finger', 'pick', 'upright']);
  await expect(page.locator('#status-bass')).toHaveText('bereit', { timeout: 15_000 });
  await page.locator('#variant-bass').selectOption('pick');
  await expect(page.locator('#status-bass')).toHaveText(/lädt|bereit/);
  await expect(page.locator('#status-bass')).toHaveText('bereit', { timeout: 15_000 });
  await page.locator('#note-bass').click();
  await expect(page.locator('#note-bass')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#voice-bass').selectOption('synth');
  await expect(page.locator('#status-bass')).toHaveText('');
  expect(await contexts(page)).toBeLessThanOrEqual(1);
});

test('Sample-Stimmen während des Spiels wählen und zurück: kein Fehler, kein zweiter AudioContext', async ({ page }) => {
  await page.locator('[data-style="funk"]').click();
  await page.waitForTimeout(300);
  await page.locator('#voice-chords').selectOption('sample');
  await page.locator('#voice-pad').selectOption('sample');
  await expect(page.locator('#status-chords')).toHaveText('bereit', { timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.locator('#voice-chords').selectOption('synth');
  await page.waitForTimeout(300);
  expect(await contexts(page)).toBe(1);
  await page.locator('#stop').click();
});
