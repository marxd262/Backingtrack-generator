// Stimmenwahl in der Hauptoberfläche (echte Seite /ui/index.html): Dropdowns je Instrument, Varianten, Ladezustand, deaktivierte Regler,
// live ohne Neustart, Stilwechsel lässt die Wahl stehen, Sprachen, Tastatur, 360 px.
import { test, expect } from '@playwright/test';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|voice|variant|chord|groove|meter)\.[A-Za-z.]+$/;
const LAYERS = ['bass', 'chords', 'pad'];
const EFFECTS = ['fuzz', 'overdrive', 'distortion'];

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
  for (const layer of LAYERS) await openGroup(page, layer);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const group = (page, id) => page.locator(`details[data-group="${id}"]`);
const voice = (page, layer) => page.locator(`#voice-${layer}`);
const variant = (page, layer) => page.locator(`#variant-${layer}`);
const status = (page, layer) => page.locator(`#voice-status-${layer}`);
const hint = (page, layer) => page.locator(`#voice-hint-${layer}`);
const slider = (page, layer, field) => page.locator(`#timbre-${layer}-${field}`);
const contexts = (page) => page.evaluate(() => window.__audioContexts);

async function openGroup(page, id) {
  if (!(await group(page, id).evaluate((el) => el.open))) await group(page, id).locator('> summary').click();
}

test('je Instrument ein Dropdown Stimme, nach Art gruppiert; Standard ist Synth; ohne mehrere Varianten kein Variantenfeld', async ({ page }) => {
  const groups = (layer) => voice(page, layer).locator('optgroup').evaluateAll((els) => els.map((e) => e.label));
  // Saitenmodelle sind aus der Auswahl genommen (hidden im Register); das E-Piano gehört zur Synthese
  expect(await groups('bass')).toEqual(['Synthese', 'Samples']);
  expect(await groups('chords')).toEqual(['Synthese', 'Samples']);
  expect(await groups('pad')).toEqual(['Synthese', 'Samples']);
  for (const layer of LAYERS) {
    await expect(voice(page, layer)).toHaveValue('synth');
    await expect(variant(page, layer)).toBeHidden();
    await expect(page.locator(`label[for="voice-${layer}"]`)).toHaveText('Stimme');
  }
  const values = (layer) => voice(page, layer).locator('option').evaluateAll((els) => els.map((e) => e.value).sort());
  expect(await values('bass')).toEqual(['sample', 'synth']);
  expect(await values('chords')).toEqual(['epiano', 'sample', 'synth']);
  expect(await values('pad')).toEqual(['sample', 'synth']);
});

test('Sample-Stimme wählen: Variantenfeld erscheint, Ladezustand bereit; zurück zu Synth blendet beides aus', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await expect(variant(page, 'bass')).toBeVisible();
  expect(await variant(page, 'bass').locator('option').evaluateAll((els) => els.map((e) => e.value))).toEqual(['finger', 'pick']);
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await variant(page, 'bass').selectOption('pick');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await voice(page, 'bass').selectOption('synth');
  await expect(variant(page, 'bass')).toBeHidden();
  await expect(status(page, 'bass')).toHaveText('');
  await voice(page, 'chords').selectOption('epiano'); // eine Variante: kein Variantenfeld
  await expect(variant(page, 'chords')).toBeHidden();
});

test('deaktivierte Regler: Standard alle aktiv; je Stimme nur die von ihr benutzten, Verzerrer immer; Hinweis nur dann', async ({ page }) => {
  for (const layer of LAYERS) {
    await expect(page.locator(`details[data-group="${layer}"] input[type="range"]:disabled`)).toHaveCount(0);
    await expect(hint(page, layer)).toBeHidden();
  }
  await voice(page, 'chords').selectOption('epiano');
  await expect(slider(page, 'chords', 'chorus')).toBeDisabled();
  for (const field of ['brightness', 'length', 'tremolo', ...EFFECTS]) await expect(slider(page, 'chords', field)).toBeEnabled();
  await expect(hint(page, 'chords')).toBeVisible();
  await voice(page, 'bass').selectOption('sample');
  for (const field of ['sub', 'pluck', 'resonance', 'roundness']) await expect(slider(page, 'bass', field)).toBeDisabled();
  for (const field of ['cutoff', ...EFFECTS]) await expect(slider(page, 'bass', field)).toBeEnabled();
  await voice(page, 'pad').selectOption('sample');
  for (const field of ['lfoSpeed', 'lfoDepth', 'shimmer', 'thickness']) await expect(slider(page, 'pad', field)).toBeDisabled();
  for (const field of ['attack', 'cutoff', ...EFFECTS]) await expect(slider(page, 'pad', field)).toBeEnabled();
  await voice(page, 'chords').selectOption('synth');
  await expect(page.locator('details[data-group="chords"] input[type="range"]:disabled')).toHaveCount(0);
  await expect(hint(page, 'chords')).toBeHidden();
});

test('während der Wiedergabe wechseln: ohne Fehler, ohne neuen AudioContext, die Wiedergabe läuft weiter', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await voice(page, 'chords').selectOption('sample');
  await voice(page, 'bass').selectOption('sample');
  await expect(status(page, 'chords')).toHaveText('bereit', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await voice(page, 'chords').selectOption('epiano');
  await page.waitForTimeout(300);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('ein Stilwechsel lässt die gewählten Stimmen stehen', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await voice(page, 'chords').selectOption('epiano');
  await page.locator('#quick-pick [data-style="blues"]').click();
  await expect(voice(page, 'bass')).toHaveValue('sample');
  await expect(voice(page, 'chords')).toHaveValue('epiano');
});

test('Sprachwechsel: Beschriftungen und Gruppen in Englisch ohne rohe Schlüssel, danach wieder Deutsch', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Voice');
  await expect(page.locator('label[for="variant-bass"]')).toHaveText('Variant');
  expect(await voice(page, 'bass').locator('optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual(['Synthesis', 'Samples']);
  const texts = await page.locator('#timbre-groups').evaluate((el) => [...el.querySelectorAll('label, option, optgroup, p, span')].map((n) => (n.label || n.textContent).trim()).filter(Boolean));
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
  await page.locator('[data-lang="de"]').click();
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Stimme');
});

test('Zurücksetzen im Bass-Bereich mit Sample-Stimme: der Fokus bleibt in der Gruppe (der erste Regler Sub ist ausgegraut)', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await expect(slider(page, 'bass', 'sub')).toBeDisabled();
  await slider(page, 'bass', 'cutoff').fill('80');
  const reset = group(page, 'bass').locator('.timbre-reset');
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(reset).toBeDisabled();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  expect(await group(page, 'bass').evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test('Ein schon geladenes Pack zeigt direkt bereit, ohne zwischendurch lädt', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await voice(page, 'bass').selectOption('synth');
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => window.__seen.push(document.getElementById('voice-status-bass').textContent)).observe(document.getElementById('voice-status-bass'), { childList: true, characterData: true, subtree: true });
  });
  await voice(page, 'bass').selectOption('sample');
  await expect(status(page, 'bass')).toHaveText('bereit');
  expect(await page.evaluate(() => window.__seen)).not.toContain('lädt …');
});

test('Tastatur: das Dropdown ist fokussierbar und mit den Pfeiltasten umschaltbar', async ({ page }) => {
  await voice(page, 'bass').focus();
  await page.keyboard.press('ArrowDown');
  await expect(voice(page, 'bass')).toHaveValue('sample');
  await expect(variant(page, 'bass')).toBeVisible();
  await variant(page, 'bass').focus();
  await page.keyboard.press('ArrowDown');
  await expect(variant(page, 'bass')).toHaveValue('pick');
});

test('360 px: kein waagerechtes Scrollen mit Variantenfeld und Hinweis, Dropdowns mindestens 44 px hoch', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample');
  await voice(page, 'chords').selectOption('epiano');
  await page.setViewportSize({ width: 360, height: 740 });
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#side-left')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.locator('#side-left').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const h of await page.locator('#timbre-groups select').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height))) {
    expect(h).toBeGreaterThanOrEqual(43.5);
  }
});
