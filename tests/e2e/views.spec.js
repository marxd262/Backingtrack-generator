// Ansichten ein- und ausblenden: Schalter in der rechten Leiste, gemerkter Zustand, Canvas und Griffbrett beim Wiedereinblenden.
import { test, expect } from '@playwright/test';
import { layoutWheel } from '../../src/ui/wheel-geometry.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const AM = { root: 'A', mode: 'minor' };
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view)\.[A-Za-z.]+$/;

let problems;

test.use({ locale: 'de-DE', reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const views = (page) => page.locator('#views');
const switchOf = (page, name) => views(page).getByRole('checkbox', { name, exact: true });
const block = (page, id) => page.locator(`section[data-view="${id}"]`);
const savedLayout = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')));
const playGo = (page) => page.locator('#play-go');
const chords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());

// Feintuning: Spielseite mit beiden Leisten (1280 px: neben den Blöcken)
async function openPlayPage(page) {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#side-right')).toBeVisible();
}

// Spielseite über Los öffnen und stoppen; die Leisten stehen im gemerkten Zustand
async function openWithGo(page) {
  await page.locator('#go').click();
  await expect(page.locator('#play')).toBeVisible();
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
}

// Schnell starten, damit mehrere Taktwechsel in die Testzeit passen
async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von/, { timeout: BAR_TIMEOUT });
}

const barNumber = async (page) => Number((await page.locator('#play-position').textContent()).match(/\d+/)[0]);
async function waitBars(page, n) {
  const from = await barNumber(page);
  await expect(page.locator('#play-position')).toHaveText(`Takt ${from + n} von 96`, { timeout: BAR_TIMEOUT * 2 });
}

const canvasHasPixels = (page, id) => page.locator(`#${id}`).evaluate((c) => {
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  return data.some((v, i) => i % 4 === 3 && v !== 0);
});

test('rechte Leiste: Kontrollkästen für Griffbrett und Akkordrad, keiner für den Verlauf, Gruppe mit Überschrift', async ({ page }) => {
  await openPlayPage(page);
  await expect(page.locator('#side-right').getByRole('group', { name: 'Ansichten' })).toBeVisible();
  await expect(views(page).getByRole('checkbox')).toHaveCount(2);
  await expect(switchOf(page, 'Griffbrett')).toBeChecked();
  await expect(switchOf(page, 'Akkordrad')).toBeChecked();
  await expect(views(page).getByRole('checkbox', { name: 'Verlauf' })).toHaveCount(0);
  // 44 px Ziel (die Beschriftung ist Teil des Ziels)
  expect((await views(page).locator('label').first().boundingBox()).height).toBeGreaterThanOrEqual(44);
});

for (const [name, id] of [['Griffbrett', 'fretboard'], ['Akkordrad', 'wheel']]) {
  test(`${name} abwählen blendet den Block aus (nicht im Zugänglichkeitsbaum), Verlauf bleibt`, async ({ page }) => {
    await openPlayPage(page);
    await switchOf(page, name).uncheck();
    await expect(block(page, id)).toBeHidden();
    await expect(block(page, id)).toHaveAttribute('hidden', '');
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(block(page, 'lanes')).toBeVisible();
    await expect(page.locator('#lane-buttons button')).toHaveCount(4);
    await expect(page.locator('#lane-buttons button').first()).toBeVisible();
    expect((await savedLayout(page)).views[id]).toBe(false);
    await switchOf(page, name).check();
    await expect(block(page, id)).toBeVisible();
    expect((await savedLayout(page)).views[id]).toBe(true);
  });
}

test('Wahl überlebt Neuladen', async ({ page }) => {
  await openPlayPage(page);
  await switchOf(page, 'Griffbrett').uncheck();
  await switchOf(page, 'Akkordrad').uncheck();
  await page.reload();
  await openWithGo(page);
  await expect(block(page, 'fretboard')).toBeHidden();
  await expect(block(page, 'wheel')).toBeHidden();
  await expect(block(page, 'lanes')).toBeVisible();
  expect((await savedLayout(page)).views).toEqual({ fretboard: false, wheel: false });
  await expect(page.locator('#side-right')).toBeVisible(); // Feintuning hat die Leiste offen gemerkt
  await expect(switchOf(page, 'Griffbrett')).not.toBeChecked();
  await expect(switchOf(page, 'Akkordrad')).not.toBeChecked();
});

test('Tastatur: Leertaste schaltet den Kontrollkasten', async ({ page }) => {
  await openPlayPage(page);
  await switchOf(page, 'Griffbrett').focus();
  await page.keyboard.press(' ');
  await expect(block(page, 'fretboard')).toBeHidden();
  await expect(switchOf(page, 'Griffbrett')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(block(page, 'fretboard')).toBeVisible();
});

test('Akkordrad wieder einblenden: Canvas gezeichnet, Klick auf einen erlaubten Knoten fügt einen Akkord hinzu', async ({ page }) => {
  await openPlayPage(page);
  expect(await canvasHasPixels(page, 'wheel')).toBe(true);
  await switchOf(page, 'Akkordrad').uncheck();
  await expect(block(page, 'wheel')).toBeHidden();
  const before = await chords(page);
  await switchOf(page, 'Akkordrad').check();
  await expect(block(page, 'wheel')).toBeVisible();
  await expect.poll(() => canvasHasPixels(page, 'wheel')).toBe(true);
  const canvas = page.locator('#wheel');
  await canvas.scrollIntoViewIfNeeded();
  const { width } = await canvas.boundingBox();
  const node = layoutWheel(width, AM).nodes.find((n) => n.ring === 'outer' && n.chord.root === 'F' && n.chord.quality === 'maj');
  await canvas.click({ position: { x: node.x, y: node.y } });
  await expect.poll(() => chords(page)).toEqual([...before, 'F']);
});

test('verborgenes Akkordrad wird nicht gezeichnet, beim Einblenden schon', async ({ page }) => {
  await openPlayPage(page);
  await switchOf(page, 'Akkordrad').uncheck();
  // Puffer leeren, dann die Folge ändern: im verborgenen Zustand darf nichts gemalt werden
  await page.evaluate(() => { const c = document.getElementById('wheel'); c.getContext('2d').clearRect(0, 0, c.width, c.height); });
  await page.locator('#add-chords button', { hasText: /^C$/ }).click();
  expect(await canvasHasPixels(page, 'wheel')).toBe(false);
  await switchOf(page, 'Akkordrad').check();
  await expect.poll(() => canvasHasPixels(page, 'wheel')).toBe(true);
});

test('Griffbrett ausgeblendet beim Spielen: kein Fehler über Taktwechsel, Wiedereinblenden zeigt den jetzigen Akkord', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  await switchOf(page, 'Griffbrett').uncheck();
  await expect(block(page, 'fretboard')).toBeHidden();
  await waitBars(page, 3);
  await expect(page.locator('#play-next')).toBeVisible();
  await expect(page.locator('#play-next')).toHaveText(/^Als Nächstes: \S+/);
  await switchOf(page, 'Griffbrett').check();
  await expect(block(page, 'fretboard')).toBeVisible();
  // Schnappschuss in einem einzigen evaluate: die Rollen gehören zum angezeigten Akkord
  const snap = await page.evaluate(() => {
    const sentence = document.getElementById('fretboard-text').textContent; // "Jetzt: Dm (D, F, A). Als Nächstes: ..."
    const [, sentenceNow, tones] = sentence.match(/^Jetzt: (\S+) \(([^)]*)\)/);
    const current = [...document.querySelectorAll('#fretboard .fret-note:not([hidden])')]
      .filter((g) => g.getAttribute('data-role').split(' ').some((r) => r === 'current' || r === 'both'))
      .map((g) => g.querySelector('text').textContent);
    return { now: document.getElementById('play-now').textContent, sentenceNow, tones: tones.split(', '), current: [...new Set(current)] };
  });
  expect(snap.sentenceNow).toBe(snap.now);
  expect(snap.current.length).toBeGreaterThan(0);
  expect(snap.current.sort()).toEqual(snap.tones.sort());
  await playGo(page).click();
});

test('Griffbrett ausgeblendet: "Als Nächstes" in der Kopfzeile bleibt sichtbar', async ({ page }) => {
  await openPlayPage(page);
  await switchOf(page, 'Griffbrett').uncheck();
  await expect(page.locator('#play-next')).toHaveText(/^Als Nächstes: \S+/);
  await expect(page.locator('#play-next')).toBeVisible();
});

test('gespeichertes views.lanes=false lässt den Verlauf stehen', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('backingtrack.layout', JSON.stringify({ views: { lanes: false, fretboard: true, wheel: true } })));
  await page.reload();
  await openWithGo(page);
  for (const id of ['fretboard', 'lanes', 'wheel']) await expect(block(page, id)).toBeVisible();
});

test('Englisch: Überschrift und Beschriftungen übersetzt, keine rohen Schlüssel', async ({ page }) => {
  await page.locator('[data-lang="en"]').click();
  await openPlayPage(page);
  await expect(page.locator('#side-right').getByRole('group', { name: 'Views' })).toBeVisible();
  await expect(switchOf(page, 'Fretboard')).toBeVisible();
  await expect(switchOf(page, 'Chord wheel')).toBeVisible();
  const raw = await page.evaluate((source) => {
    const re = new RegExp(source);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
    for (const el of document.querySelectorAll('*')) for (const { name, value } of el.attributes) if ((name.startsWith('aria-') || name === 'title') && re.test(value)) found.push(`${name}=${value}`);
    return found;
  }, RAW_KEY.source);
  expect(raw).toEqual([]);
  await page.locator('[data-lang="de"]').click();
  await expect(switchOf(page, 'Griffbrett')).toBeVisible();
});

test('beim Spielen keine DOM-Schreibvorgänge je Takt in den Ansichten-Schaltern', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  await page.evaluate(() => {
    window.__viewMutations = [];
    new MutationObserver((list) => window.__viewMutations.push(...list.map((m) => `${m.target.id || m.target.nodeName} ${m.attributeName ?? m.type}`)))
      .observe(document.getElementById('views'), { attributes: true, childList: true, characterData: true, subtree: true });
  });
  await waitBars(page, 2);
  expect(await page.evaluate(() => window.__viewMutations)).toEqual([]);
  await playGo(page).click();
});

test('Speicher kaputt (JSON) oder wirft: alle Ansichten sichtbar, Seite bedienbar', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('backingtrack.layout', '{'));
  await page.reload();
  await openWithGo(page);
  for (const id of ['fretboard', 'lanes', 'wheel']) await expect(block(page, id)).toBeVisible();
  await page.locator('#toggle-right').click();
  await expect(switchOf(page, 'Griffbrett')).toBeChecked();
  await switchOf(page, 'Griffbrett').uncheck();
  await expect(block(page, 'fretboard')).toBeHidden();

  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.reload();
  await openWithGo(page);
  for (const id of ['fretboard', 'lanes', 'wheel']) await expect(block(page, id)).toBeVisible();
  await page.locator('#toggle-right').click();
  await switchOf(page, 'Akkordrad').uncheck();
  await expect(block(page, 'wheel')).toBeHidden();
  await switchOf(page, 'Akkordrad').check();
  await expect(block(page, 'wheel')).toBeVisible();
});
