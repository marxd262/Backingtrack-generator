// Start- und Spielseite: Navigation, Fokus, Wiedergabe über den Seitenwechsel, gemeinsamer Zustand, Leisten.
import { test, expect } from '@playwright/test';
import { layoutWheel } from '../../src/ui/wheel-geometry.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig
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
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const start = (page) => page.locator('#start');
const play = (page) => page.locator('#play');
const playGo = (page) => page.locator('#play-go');
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const progression = (page) => page.locator('#progression button');
const savedLayout = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')));

async function wheelPoint(page, root, quality, ring = 'outer') {
  const canvas = page.locator('#wheel');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const node = layoutWheel(box.width, AM).nodes.find((n) => n.ring === ring && n.chord.root === root && n.chord.quality === quality);
  return { x: node.x, y: node.y };
}

test('beim Laden: Startseite sichtbar, Spielseite versteckt', async ({ page }) => {
  await expect(start(page)).toBeVisible();
  await expect(play(page)).toHaveAttribute('hidden', '');
  await expect(play(page)).toBeHidden();
  await expect(page.locator('#to-play')).toBeHidden();
});

test('Feintuning öffnet die Spielseite ohne zu starten, Fokus auf dem Titel, beide Leisten gemerkt', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(play(page)).toBeVisible();
  await expect(start(page)).toBeHidden();
  await expect(page.locator('#play-title')).toBeFocused();
  await expect(page.locator('#play-title')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#play-title')).toHaveText('Spielseite');
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#play-now')).toHaveText('');
  expect(await contexts(page)).toBe(0);
  expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: true });
  // Kopfzeile, Leisten und Blöcke
  await expect(page.locator('#play-variant')).toHaveText(`Variante ${await page.locator('#variant').inputValue()}`);
  await expect(page.locator('#play-back')).toHaveText('Zur Startseite');
  await expect(page.locator('#side-left')).toBeVisible();
  await expect(page.locator('#side-right')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Klang' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Akkorde', exact: true })).toBeVisible();
  expect(await page.locator('#blocks > .block').evaluateAll((els) => els.map((el) => el.dataset.view))).toEqual(['fretboard', 'lanes', 'wheel']);
  for (const name of ['Griffbrett', 'Verlauf', 'Akkordrad']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // zurück: Startseite, Fokus auf dem auslösenden Knopf
  await page.locator('#play-back').click();
  await expect(start(page)).toBeVisible();
  await expect(play(page)).toBeHidden();
  await expect(page.locator('#tune-btn')).toBeFocused();
});

test('Los startet und öffnet die Spielseite; Wiedergabe läuft beim Seitenwechsel weiter', async ({ page }) => {
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  await expect(page.locator('#play-title')).toBeFocused();
  await expect(playGo(page)).toHaveText('Stopp');
  await expect(page.locator('#play-now')).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  expect(await shownChords(page)).toContain(await page.locator('#play-now').textContent());
  await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 96$/);
  // erster Besuch: Leisten aus dem Standardlayout (geschlossen), nichts überschrieben
  expect(await savedLayout(page)).toBeNull();

  await page.locator('#play-back').click();
  await expect(start(page)).toBeVisible();
  await expect(page.locator('#go')).toBeFocused();
  await expect(page.locator('#go')).toHaveText('Stopp');
  await expect(page.locator('#now-chord')).toHaveText(/\S/);
  expect(await shownChords(page)).toContain(await page.locator('#now-chord').textContent());
  await expect(page.locator('#position')).toHaveText(/^Takt \d+ von 96$/);
  const toPlay = page.locator('#to-play');
  await expect(toPlay).toBeVisible();
  await expect(toPlay).toHaveText('Zur Spielseite');
  await toPlay.click();
  await expect(play(page)).toBeVisible();
  await expect(page.locator('#play-title')).toBeFocused();
  await expect(playGo(page)).toHaveText('Stopp');

  // Stopp auf der Spielseite, zurück: kein "Zur Spielseite" mehr, Fokus landet auf Los
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#play-now')).toHaveText('');
  await page.locator('#play-back').click();
  await expect(toPlay).toBeHidden();
  await expect(page.locator('#go')).toHaveText('Los');
  await expect(page.locator('#go')).toBeFocused();
  expect(await contexts(page)).toBe(1);
});

test('Los während der Wiedergabe auf der Startseite stoppt und bleibt dort', async ({ page }) => {
  await page.locator('#go').click();
  await expect(playGo(page)).toHaveText('Stopp');
  await page.locator('#play-back').click();
  await page.locator('#go').click();
  await expect(page.locator('#go')).toHaveText('Los');
  await expect(start(page)).toBeVisible();
  await expect(play(page)).toBeHidden();
  await expect(page.locator('#to-play')).toBeHidden();
  await expect(page.locator('#now-chord')).toHaveText('');
});

test('gemerkte Leisten: Feintuning merkt beide offen, Los übernimmt sie nach Neuladen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await page.locator('#play-back').click();
  await page.reload();
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: true });
  await playGo(page).click();
});

test('Tonart in der rechten Leiste: Folge ändert sich, Popover der Startseite zeigt dieselbe Tonart', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const side = page.locator('#side-key-chips');
  await expect(side.getByRole('button')).toHaveCount(12);
  await expect(side.getByRole('button', { name: 'A', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await side.getByRole('button', { name: 'D', exact: true }).click();
  await expect(side.getByRole('button', { name: 'D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#add-chords button').allTextContents()).toEqual(['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C', 'A']);
  const chords = await shownChords(page);
  expect(await progression(page).allTextContents()).toEqual(chords);
  await page.locator('#side-scale-chips').getByRole('button', { name: 'Dur-Pentatonik' }).click();
  await expect(page.locator('#side-scale-chips').getByRole('button', { name: 'Dur-Pentatonik' })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#play-back').click();
  await expect(page.locator('#sentence')).toContainText('D-Dur-Pentatonik');
  await page.locator('#key-btn').click();
  await expect(page.locator('#key-chips').getByRole('button', { name: 'D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scale-chips').getByRole('button', { name: 'Dur-Pentatonik' })).toHaveAttribute('aria-pressed', 'true');
  // und umgekehrt: Popover ändert die Leiste
  await page.locator('#key-chips').getByRole('button', { name: 'E', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#tune-btn').click();
  await expect(page.locator('#side-key-chips').getByRole('button', { name: 'E', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('Feintuning-Funktionen arbeiten auf der Spielseite: Schlagworte, Länge, Akkorde, Rad, Stummschalter', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const swing = page.locator('#side-left #tags [data-tag="swing"]');
  await swing.click();
  await expect(swing).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#side-left #length').selectOption('48');
  await expect(page.locator('#length')).toHaveValue('48');
  await page.locator('#side-left #tuning-tempo').fill('120');
  await expect(page.locator('#tuning-tempo-out')).toHaveText('120');

  const before = await shownChords(page);
  await page.locator('#side-right #add-chords button', { hasText: /^C$/ }).click();
  await expect.poll(() => shownChords(page)).toEqual([...before, 'C']);
  await page.locator('#side-right #progression button').last().click();
  await expect.poll(() => shownChords(page)).toEqual(before);
  await page.locator('#wheel').click({ position: await wheelPoint(page, 'F', 'maj') });
  await expect.poll(() => shownChords(page)).toEqual([...before, 'F']);

  const drums = page.locator('#blocks #lane-buttons [data-layer="drums"]');
  await drums.click();
  await expect(drums).toHaveAttribute('aria-pressed', 'false');
});

test('Startfehler auf der Spielseite: Meldung dort sichtbar', async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error('no audio');
      }
    };
  });
  await page.reload();
  await page.locator('#tune-btn').click();
  const message = page.locator('#play-message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  await expect(message).toHaveText('');
  await playGo(page).click();
  await expect(message).toHaveText('Die Wiedergabe konnte nicht starten.');
  await expect(message).toBeVisible();
  await expect(playGo(page)).toHaveText('Los');
  // Los auf der Startseite bleibt bei einem Fehler dort, damit die Meldung sichtbar ist
  await page.locator('#play-back').click();
  await page.locator('#go').click();
  await expect(start(page)).toBeVisible();
  await expect(page.locator('#message')).toHaveText('Die Wiedergabe konnte nicht starten.');
});

test('leere Meldung in der Kopfzeile: gerendert, aber ohne Platz (360 px, dort bricht sie in eine eigene Zeile)', async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error('no audio');
      }
    };
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  await page.locator('#tune-btn').click();
  const message = page.locator('#play-message');
  // Live-Region bleibt im Barrierefreiheitsbaum: nicht display:none, sichtbar im Sinne von checkVisibility
  expect(await message.evaluate((el) => ({
    display: getComputedStyle(el).display !== 'none',
    shown: el.checkVisibility({ visibilityProperty: true }),
  }))).toEqual({ display: true, shown: true });
  // Kopfzeile genauso hoch wie ganz ohne Meldung
  const heights = await page.evaluate(() => {
    const head = document.querySelector('.play-head');
    const msg = document.querySelector('#play-message');
    const empty = head.getBoundingClientRect().height;
    msg.style.display = 'none';
    const without = head.getBoundingClientRect().height;
    msg.style.display = '';
    return { empty, without };
  });
  expect(heights.empty).toBe(heights.without);
  await playGo(page).click();
  await expect(message).toHaveText(/\S/);
  expect(await page.locator('.play-head').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(heights.empty);
});

test('Reihenfolge: DOM wie Bildschirm (360, 800 px), breit Leisten links und rechts, Tab erreicht zuerst die Blöcke', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const order = () => page.evaluate(() => {
    const els = ['#blocks', '#side-left', '#side-right'].map((s) => document.querySelector(s));
    const dom = [...els].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((e) => e.id);
    const visual = [...els].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.id);
    return { dom, visual };
  });
  for (const width of [360, 800]) {
    await page.setViewportSize({ width, height: 740 });
    const { dom, visual } = await order();
    expect(visual, `${width} px`).toEqual(dom);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await order()).dom).toEqual(['blocks', 'side-left', 'side-right']);
  const [left, blocks, right] = await Promise.all(['#side-left', '#blocks', '#side-right'].map((id) => page.locator(id).boundingBox()));
  expect(left.x + left.width).toBeLessThanOrEqual(blocks.x);
  expect(blocks.x + blocks.width).toBeLessThanOrEqual(right.x);

  // Tab vom Seitentitel: das erste Element in den Bereichen liegt in den Blöcken (Schicht-Knopf), nicht in "Klang"
  await page.locator('#play-title').focus();
  let region = null;
  for (let i = 0; i < 10 && !region; i++) {
    await page.keyboard.press('Tab');
    region = await page.evaluate(() => {
      const el = document.activeElement;
      const r = ['blocks', 'side-left', 'side-right'].find((id) => document.getElementById(id).contains(el));
      return r ? { id: r, layer: el.closest('#lane-buttons') !== null } : null;
    });
  }
  expect(region).toEqual({ id: 'blocks', layer: true });
});

test('Spielseite auf Englisch: Kopfzeile und Überschriften übersetzt', async ({ page }) => {
  await page.locator('[data-lang="en"]').click();
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play-back')).toHaveText('To start page');
  await expect(page.locator('#play-title')).toHaveText('Play page');
  await expect(page.locator('#play-variant')).toHaveText(/^Variant \d+$/);
  for (const name of ['Sound', 'Chords', 'Fretboard', 'Course', 'Chord wheel']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await playGo(page).click();
  await page.locator('#play-back').click();
  await expect(page.locator('#to-play')).toHaveText('To play page');
  await page.locator('#go').click();
});

test('1280 px: Leisten neben den Blöcken; 360 px: Blöcke zuerst, darunter die Leisten', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#tune-btn').click();
  const box = async (id) => page.locator(id).boundingBox();
  let [left, blocks, right] = [await box('#side-left'), await box('#blocks'), await box('#side-right')];
  expect(left.x + left.width).toBeLessThanOrEqual(blocks.x);
  expect(blocks.x + blocks.width).toBeLessThanOrEqual(right.x);
  // Rad bleibt in seiner bisherigen Größe (CSS min(100%, 24rem) = 384 px), mittig im Block
  const wheel = await box('#wheel');
  const block = await box('[data-view="wheel"]');
  expect(Math.round(wheel.width)).toBe(384);
  expect(Math.abs(wheel.x + wheel.width / 2 - (block.x + block.width / 2))).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 360, height: 740 });
  [left, blocks, right] = [await box('#side-left'), await box('#blocks'), await box('#side-right')];
  expect(blocks.y + blocks.height).toBeLessThanOrEqual(left.y);
  expect(left.y + left.height).toBeLessThanOrEqual(right.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
