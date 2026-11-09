// Mischpult und Variantenwechsel auf der Spielseite (echte Seite /ui/index.html, Echtzeit).
import { test, expect } from '@playwright/test';
import { progressionFor } from '../../src/core/progressions.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor)\.[A-Za-z.]+$/;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const AM = { root: 'A', mode: 'minor' };
const LAYERS = ['drums', 'bass', 'chords', 'pad'];

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  // zählt AudioContexts und zeichnet auf, wie die Pegel ans Audiosystem gehen: Zielwerte von setTargetAtTime (Live-Rampe)
  // und direkt gesetzte Parameterwerte (Anfangspegel beim Start)
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
    window.__targets = [];
    window.__assigned = [];
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, ...rest) {
      window.__targets.push(value);
      return target.call(this, value, ...rest);
    };
    const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
    Object.defineProperty(AudioParam.prototype, 'value', {
      ...desc,
      set(v) {
        window.__assigned.push(v);
        desc.set.call(this, v);
      },
    });
  });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const playGo = (page) => page.locator('#play-go');
const position = (page) => page.locator('#play-position');
const mixerBtn = (page) => page.locator('#mixer-btn');
const pop = (page) => page.locator('#mixer-pop');
const slider = (page, name) => page.locator(`#mix-${name}`);
const mixMute = (page, name) => page.locator(`#mixer .mix-row:has(#mix-${name}) button`);
const laneBtn = (page, name) => page.locator(`#lane-buttons [data-layer="${name}"]`);
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const targets = (page) => page.evaluate(() => window.__targets);
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const shownVariant = async (page) => Number((await page.locator('#play-variant').textContent()).match(/\d+/)[0]);
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const expectedChords = (seed) => progressionFor(AM, seed).map((c) => c.root + SYMBOLS[c.quality]);

async function openPlayPage(page) {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
}

// Wiedergabe bei 200 bpm (1,2 s je Takt)
async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von \d+$/, { timeout: BAR_TIMEOUT });
}

const recordPositions = (page) => page.evaluate(() => {
  window.__positions = [];
  const el = document.querySelector('#play-position');
  new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
});
const positionsSince = (page) => page.evaluate(() => window.__positions.splice(0));

// Die Taktzeile springt nie zurück und läuft weiter
async function expectKeepsCounting(page, before, label) {
  await expect.poll(() => shownBar(page), { message: label, timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  const shown = (await positionsSince(page)).filter(Boolean).map((text) => Number(text.match(/^Takt (\d+) von/)[1]));
  expect(shown.length, label).toBeGreaterThan(0);
  for (const bar of shown) expect(bar, `${label}: ${shown}`).toBeGreaterThanOrEqual(before);
}

test('Mischpult-Knopf öffnet das Popover: 5 Regler, 4 Tasten, Namen deutsch und englisch, per Tastatur bedienbar', async ({ page }) => {
  await openPlayPage(page);
  await expect(mixerBtn(page)).toHaveAccessibleName('Mischpult');
  await expect(mixerBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(pop(page)).toBeHidden();
  await mixerBtn(page).click();
  await expect(pop(page)).toBeVisible();
  await expect(mixerBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(pop(page).locator('input[type="range"]')).toHaveCount(5);
  await expect(pop(page).locator('button')).toHaveCount(4);
  for (const [name, label] of [['master', 'Gesamt'], ['drums', 'Schlagzeug'], ['bass', 'Bass'], ['chords', 'Akkorde'], ['pad', 'Pad']]) {
    await expect(pop(page).getByRole('slider', { name: label, exact: true })).toHaveValue('100');
    await expect(slider(page, name)).toHaveAttribute('min', '0');
    await expect(slider(page, name)).toHaveAttribute('max', '100');
  }
  await expect(pop(page).getByRole('button', { name: 'Bass stumm', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixer output')).toHaveText(['100 %', '100 %', '100 %', '100 %', '100 %']);

  // Fokus beim Öffnen im Popover, Pfeiltasten ändern den Wert, Escape schließt und gibt den Fokus an den Knopf zurück
  await expect(slider(page, 'master')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(slider(page, 'master')).toHaveValue('99');
  await expect(page.locator('#mixer .mix-row').first().locator('output')).toHaveText('99 %');
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();
  await expect(mixerBtn(page)).toBeFocused();

  await page.getByRole('button', { name: /^EN/i }).click();
  await expect(mixerBtn(page)).toHaveAccessibleName('Mixer');
  await mixerBtn(page).click();
  for (const [label, value] of [['Overall', '99'], ['Drums', '100'], ['Bass', '100'], ['Chords', '100'], ['Pad', '100']]) {
    await expect(pop(page).getByRole('slider', { name: label, exact: true })).toHaveValue(value);
  }
  await expect(pop(page).getByRole('button', { name: 'Drums muted', exact: true })).toBeVisible();
  await expect(page.locator('#mixer .mix-row').first().locator('output')).toHaveText('99%');
  const texts = await page.locator('#mixer, #variant-prev, #variant-next, #variant-random').evaluateAll((els) => els.flatMap((el) => [el.textContent, el.getAttribute('aria-label')]).filter(Boolean));
  for (const text of texts) expect(text).not.toMatch(RAW_KEY);
});

test('Regler während der Wiedergabe: setLevel/setMaster wirken live, kein Neustart, ein AudioContext', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von/, { timeout: BAR_TIMEOUT });
  expect(await contexts(page)).toBe(1);
  await recordPositions(page);
  const before = await shownBar(page);
  await mixerBtn(page).click();
  await page.evaluate(() => { window.__targets.length = 0; });
  await slider(page, 'bass').fill('50');
  await expect.poll(() => targets(page)).toContain(0.25); // Reglerstellung 0.5 -> Verstärkung 0.25
  await slider(page, 'master').fill('30');
  await expect.poll(() => targets(page)).toContain(0.3 * 0.3);
  await slider(page, 'drums').fill('0');
  await expect.poll(() => targets(page)).toContain(0);
  await expect(page.locator('#mixer .mix-row').nth(2).locator('output')).toHaveText('50 %');
  await expectKeepsCounting(page, before, 'Regler');
  expect(await contexts(page)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
});

test('Stummtaste im Mischpult und Schichtknopf zeigen immer denselben Zustand, in beide Richtungen', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  const same = async (name, expected) => {
    await expect(laneBtn(page, name), `Schichtknopf ${name}`).toHaveAttribute('aria-pressed', String(expected));
    await expect(mixMute(page, name), `Taste ${name}`).toHaveAttribute('aria-pressed', String(!expected)); // Stummtaste: gedrückt = stumm, also umgekehrt zum Schichtknopf
  };
  for (const name of LAYERS) await same(name, true);
  await mixerBtn(page).click();
  await mixMute(page, 'bass').click();
  await same('bass', false);
  await same('chords', true);
  await mixMute(page, 'bass').click();
  await same('bass', true);
  await pop(page).evaluate((el) => el.hidePopover());
  await laneBtn(page, 'pad').click();
  await same('pad', false);
  await mixerBtn(page).click();
  await same('pad', false);
  await laneBtn(page, 'pad').click({ force: true });
  await same('pad', true);
  // Stummschalten ändert die Reglerstellung nicht und startet nicht neu
  await expect(slider(page, 'pad')).toHaveValue('100');
  expect(await contexts(page)).toBe(1);
});

test('Mix überlebt das Neuladen, Stummschaltungen nicht; kaputter Speicher wird ignoriert; Anfangspegel gehen mit dem Start', async ({ page }) => {
  await openPlayPage(page);
  await mixerBtn(page).click();
  await slider(page, 'bass').fill('40');
  await slider(page, 'master').fill('70');
  await mixMute(page, 'chords').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.mix')))).toEqual({ drums: 1, bass: 0.4, chords: 1, pad: 1, master: 0.7 });
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openPlayPage(page);
  await mixerBtn(page).click();
  await expect(slider(page, 'bass')).toHaveValue('40');
  await expect(slider(page, 'master')).toHaveValue('70');
  await expect(slider(page, 'drums')).toHaveValue('100');
  await expect(mixMute(page, 'chords')).toHaveAttribute('aria-pressed', 'false');
  // Start: die gespeicherten Pegel werden gleich beim Bau der Instrumente gesetzt (nicht erst per Rampe danach)
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__assigned.length = 0; window.__targets.length = 0; });
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  const assigned = await page.evaluate(() => window.__assigned);
  expect(assigned).toContain(0.4 * 0.4);
  expect(assigned).toContain(0.7 * 0.7);
  expect(await targets(page)).not.toContain(0.4 * 0.4);
  await playGo(page).click();

  for (const garbage of ['{kaputt', '[1,2]', '{"bass":5,"drums":"laut","pad":-1,"master":null}']) {
    await page.evaluate((g) => localStorage.setItem('backingtrack.mix', g), garbage);
    await page.reload();
    await expect(page.locator('#go')).toHaveText(/\S/);
    await openPlayPage(page);
    await mixerBtn(page).click();
    for (const name of ['master', ...LAYERS]) await expect(slider(page, name), `${garbage} ${name}`).toHaveValue('100');
  }
});

test('Variantenknöpfe: vor, zurück, neu, Umbruch 9999 und 1, Fokus bleibt, nichts anderes ändert sich', async ({ page }) => {
  const field = page.locator('#variant');
  await field.fill('9999');
  await field.press('Enter');
  await openPlayPage(page);
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
  for (const id of ['variant-prev', 'variant-next', 'variant-random']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nächste Variante', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vorherige Variante', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zufällige Variante', exact: true })).toBeVisible();

  const focusId = () => page.evaluate(() => document.activeElement.id);
  await page.locator('#variant-next').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  expect(await focusId()).toBe('variant-next');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(1).join(' – '));
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
  expect(await focusId()).toBe('variant-prev');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(9999).join(' – '));
  await page.keyboard.press('Enter'); // per Tastatur ebenso
  await expect(page.locator('#play-variant')).toHaveText('Variante 9998');
  await page.locator('#variant-prev').click();
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9996');
  let rolled = 9996;
  for (let i = 0; i < 3 && rolled === 9996; i++) {
    await page.locator('#variant-random').click();
    await expect(page.locator('#play-variant')).toHaveText(/^Variante \d+$/);
    rolled = await shownVariant(page);
  }
  expect(rolled).not.toBe(9996);
  expect(rolled).toBeGreaterThanOrEqual(1);
  expect(rolled).toBeLessThanOrEqual(9999);
  expect(await focusId()).toBe('variant-random');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(rolled).join(' – '));
  // Wrap von 1 nach 9999 mit dem Zurück-Knopf
  await field.evaluate((el, n) => { el.value = n; el.dispatchEvent(new Event('change')); }, '1');
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
});

test('Variante während der Wiedergabe: Neustart im laufenden Takt, Tags, Tempo, Mix und Stummschaltungen bleiben, ein AudioContext', async ({ page }) => {
  test.setTimeout(60_000);
  await openPlayPage(page);
  await mixerBtn(page).click();
  await slider(page, 'bass').fill('60');
  await mixMute(page, 'pad').click();
  await page.keyboard.press('Escape');
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von/, { timeout: BAR_TIMEOUT });
  const tagsOf = () => page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());
  const tags = await tagsOf();
  const settings = () => page.evaluate(() => ({
    tempo: document.getElementById('tuning-tempo').value,
    length: document.getElementById('length').value,
    mix: localStorage.getItem('backingtrack.mix'),
    pad: document.querySelector('#lane-buttons [data-layer="pad"]').getAttribute('aria-pressed'),
  }));
  const settingsBefore = await settings();
  expect(settingsBefore.pad).toBe('false');
  await recordPositions(page);
  for (const id of ['variant-next', 'variant-prev', 'variant-random', 'variant-next']) {
    const before = await shownBar(page);
    const seed = await shownVariant(page);
    await positionsSince(page);
    await page.locator(`#${id}`).click();
    if (id === 'variant-random') await expect.poll(() => shownVariant(page)).not.toBe(seed);
    else await expect(page.locator('#play-variant')).toHaveText(`Variante ${id === 'variant-next' ? (seed % 9999) + 1 : ((seed + 9997) % 9999) + 1}`);
    await expectKeepsCounting(page, before, id);
    expect(await tagsOf(), id).toEqual(tags);
    expect(await settings(), id).toEqual(settingsBefore);
    expect(await contexts(page), id).toBe(1);
    await expect(playGo(page), id).toHaveText('Stopp');
    expect(await page.evaluate(() => document.activeElement.id), id).toBe(id);
  }
  await expect(page.locator('#chords')).toHaveText(expectedChords(await shownVariant(page)).join(' – '));
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
});

test('390 px: Kopfzeile und Mischpult passen ohne waagerechtes Scrollen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // über Los: Feintuning öffnet hier die Klang-Schublade, und die macht die Kopfzeile inert
  await page.locator('#go').click();
  await expect(page.locator('#play')).toBeVisible();
  await playGo(page).click();
  expect(await noScrollX(page)).toBe(true);
  await mixerBtn(page).click();
  await expect(pop(page)).toBeVisible();
  expect(await noScrollX(page)).toBe(true);
  const box = await pop(page).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  for (const name of ['master', ...LAYERS]) {
    const s = await slider(page, name).boundingBox();
    expect(s.width, name).toBeGreaterThan(80);
    expect(s.x + s.width, name).toBeLessThanOrEqual(box.x + box.width);
  }
  for (const name of LAYERS) {
    const b = await mixMute(page, name).boundingBox();
    expect(b.x + b.width, name).toBeLessThanOrEqual(box.x + box.width);
    expect(b.width, name).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  for (const id of ['variant-prev', 'variant-next', 'variant-random', 'mixer-btn']) {
    const b = await page.locator(`#${id}`).boundingBox();
    expect(b.x, id).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, id).toBeLessThanOrEqual(390);
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
  }
});
