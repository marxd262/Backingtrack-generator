// Start- und Spielseite: Navigation, Fokus, Wiedergabe über den Seitenwechsel, gemeinsamer Zustand, Leisten.
import { test, expect } from '@playwright/test';
import { addChordByName } from './chord-helpers.js';
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
const toggle = (page, side) => page.locator(`#toggle-${side}`);
const aside = (page, side) => page.locator(`#side-${side}`);
const box = (page, selector) => page.locator(selector).boundingBox();
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// Auslöser und Leiste stimmen überein: aria-expanded am Knopf, hidden an der Leiste
async function expectSides(page, left, right) {
  for (const [side, open] of [['left', left], ['right', right]]) {
    await expect(toggle(page, side), side).toHaveAttribute('aria-expanded', String(open));
    if (open) await expect(aside(page, side), side).not.toHaveAttribute('hidden');
    else await expect(aside(page, side), side).toHaveAttribute('hidden', '');
  }
}

// Spielseite über Los öffnen (gemerkter Zustand) und die Wiedergabe gleich stoppen
async function openWithGo(page) {
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

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

test('gemerkte Leisten: Feintuning merkt beide offen, Los zeigt nach Neuladen beide offen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await page.locator('#play-back').click();
  await page.reload();
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  await expectSides(page, true, true);
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
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
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
  await addChordByName(page, 'C', '#side-right');
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
  await page.keyboard.press('Escape'); // schmal öffnet Feintuning die Klang-Schublade (modal); erst schließen
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

test('Reihenfolge: Blöcke zuerst, schmal (360, 800 px) Leisten als Schublade außerhalb des Flusses, breit links und rechts, Tab erreicht zuerst die Blöcke', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const order = () => page.evaluate(() => {
    const els = ['#blocks', '#side-left', '#side-right'].map((s) => document.querySelector(s));
    const dom = [...els].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((e) => e.id);
    const visual = [...els].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.id);
    return { dom, visual };
  });
  // schmal stehen die Leisten nicht im Fluss: die offene ist Schublade (fixed), die andere hidden (nur eine offen)
  for (const width of [360, 800]) {
    await page.setViewportSize({ width, height: 740 });
    await expectSides(page, true, false); // matchMedia meldet die neue Breite erst im nächsten Bild
    expect((await order()).dom).toEqual(['blocks', 'side-left', 'side-right']);
    const flow = await page.evaluate(() => ['side-left', 'side-right'].map((id) => {
      const el = document.getElementById(id);
      return el.hidden ? 'hidden' : getComputedStyle(el).position;
    }));
    expect(flow, `${width} px`).toEqual(['fixed', 'hidden']);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await toggle(page, 'right').click(); // beim Schmalwerden geschlossen
  expect((await order()).dom).toEqual(['blocks', 'side-left', 'side-right']);
  const [left, blocks, right] = await Promise.all(['#side-left', '#blocks', '#side-right'].map((id) => page.locator(id).boundingBox()));
  expect(left.x + left.width).toBeLessThanOrEqual(blocks.x);
  expect(blocks.x + blocks.width).toBeLessThanOrEqual(right.x);

  // Tab vom Seitentitel: das erste Element in den Bereichen liegt in den Blöcken (Namen/Stufen-Schalter des
  // Griffbretts, des ersten Blocks), nicht in "Klang"
  await page.locator('#play-title').focus();
  let region = null;
  for (let i = 0; i < 10 && !region; i++) {
    await page.keyboard.press('Tab');
    region = await page.evaluate(() => {
      const el = document.activeElement;
      const r = ['blocks', 'side-left', 'side-right'].find((id) => document.getElementById(id).contains(el));
      return r ? { id: r, first: el.id } : null;
    });
  }
  expect(region).toEqual({ id: 'blocks', first: 'labels-names' });
});

test('Spielseite auf Englisch: Kopfzeile und Überschriften übersetzt', async ({ page }) => {
  await page.locator('[data-lang="en"]').click();
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play-back')).toHaveText('To start page');
  await expect(page.locator('#play-title')).toHaveText('Play page');
  await expect(page.locator('#play-variant')).toHaveText(/^Variant \d+$/);
  for (const name of ['Sound', 'Chords', 'Fretboard', 'Timeline', 'Chord wheel']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await playGo(page).click();
  await page.locator('#play-back').click();
  await expect(page.locator('#to-play')).toHaveText('To play page');
  await page.locator('#go').click();
});

test('1280 px: Leisten neben den Blöcken; 360 px: eine Leiste als Schublade im Fenster', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#tune-btn').click();
  const box = async (id) => page.locator(id).boundingBox();
  const [left, blocks, right] = [await box('#side-left'), await box('#blocks'), await box('#side-right')];
  expect(left.x + left.width).toBeLessThanOrEqual(blocks.x);
  expect(blocks.x + blocks.width).toBeLessThanOrEqual(right.x);
  // Rad bleibt in seiner bisherigen Größe (CSS min(100%, 24rem) = 384 px), mittig im Block
  const wheel = await box('#wheel');
  const block = await box('[data-view="wheel"]');
  expect(Math.round(wheel.width)).toBe(384);
  expect(Math.abs(wheel.x + wheel.width / 2 - (block.x + block.width / 2))).toBeLessThanOrEqual(2);

  await page.setViewportSize({ width: 360, height: 740 });
  await expectSides(page, true, false);
  const drawer = await box('#side-left');
  expect(drawer.x).toBe(0);
  expect(drawer.width).toBeLessThanOrEqual(360);
  expect(await noScrollX(page)).toBe(true);
});

// --- Einklappbare Seitenleisten (Task 4); ohne Bewegung, damit Maße nicht in eine Einblendung fallen ---
test.describe('Seitenleisten', () => {
  test.use({ reducedMotion: 'reduce' });
  const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;

  test('erster Besuch: Los öffnet die Spielseite mit beiden Leisten zu; Auslöser in der Kopfzeile', async ({ page }) => {
    await openWithGo(page);
    await expectSides(page, false, false);
    expect(await savedLayout(page)).toBeNull();
    for (const [side, name] of [['left', 'Klang'], ['right', 'Akkorde']]) {
      await expect(page.locator(`.play-head #toggle-${side}`)).toBeVisible();
      await expect(toggle(page, side)).toHaveAccessibleName(name); // Zustandszeichen ist dekorativ
      await expect(toggle(page, side)).toHaveText(name);
      await expect(toggle(page, side)).toHaveAttribute('aria-controls', `side-${side}`);
    }
    // am Ende der Kopfzeile, nach der Variantennummer
    expect(await page.evaluate(() => {
      const v = document.getElementById('play-variant');
      return ['toggle-left', 'toggle-right'].every((id) => v.compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
  });

  test('1280 px: Klick öffnet und schließt, Fokus auf die Überschrift und zurück zum Auslöser, beide unabhängig', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithGo(page);
    for (const side of ['left', 'right']) {
      await toggle(page, side).click();
      await expect(aside(page, side)).toBeVisible();
      await expect(page.locator(`#side-${side}-title`)).toBeFocused();
      await expect(page.locator(`#side-${side}-title`)).toHaveAttribute('tabindex', '-1');
    }
    await expectSides(page, true, true);
    expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: true });
    await toggle(page, 'left').click();
    await expectSides(page, false, true);
    await expect(toggle(page, 'left')).toBeFocused();
    expect((await savedLayout(page)).sidebars).toEqual({ left: false, right: true });
    // breit: kein Schließen-Knopf in der Leiste, Escape lässt die Leisten stehen
    await expect(page.locator('#side-right .side-close')).toBeHidden();
    await page.keyboard.press('Escape');
    await expectSides(page, false, true);
  });

  test('1280 px: offene Leisten verdecken das Griffbrett nicht, geschlossene geben den Platz den Blöcken', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#tune-btn').click();
    await expectSides(page, true, true);
    const fretboard = await box(page, 'section[data-view="fretboard"]');
    for (const side of ['left', 'right']) expect(overlaps(await box(page, `#side-${side}`), fretboard), side).toBe(false);
    const both = { blocks: await box(page, '#blocks'), lanes: await box(page, 'section[data-view="lanes"]') };
    await toggle(page, 'left').click();
    const one = (await box(page, '#blocks')).width;
    await toggle(page, 'right').click();
    await expectSides(page, false, false);
    const none = { blocks: await box(page, '#blocks'), lanes: await box(page, 'section[data-view="lanes"]') };
    expect(one).toBeGreaterThan(both.blocks.width);
    expect(none.blocks.width).toBeGreaterThan(one);
    expect(none.lanes.width).toBeGreaterThan(both.lanes.width);
    expect(none.blocks.width).toBeGreaterThan(1280 - 2 * 16 - 2); // volle Breite der Mitte (Seitenrand 16 px)
  });

  test('gemerkter Zustand überlebt Neuladen, Los zeigt ihn; Feintuning öffnet beide und merkt es', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWithGo(page);
    await toggle(page, 'right').click();
    await page.reload();
    await openWithGo(page);
    await expectSides(page, false, true);
    expect((await savedLayout(page)).sidebars).toEqual({ left: false, right: true });
    await page.locator('#play-back').click();
    await page.locator('#tune-btn').click();
    await expectSides(page, true, true);
    await page.reload();
    await openWithGo(page);
    await expectSides(page, true, true);
  });

  test('800 px: Schublade, nur eine offen (Auslöser darunter inert), Klick daneben schließt nicht, Escape und Schließen-Knopf', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    await openWithGo(page);
    await toggle(page, 'left').click();
    await expectSides(page, true, false);
    await expect(page.locator('#side-left-title')).toBeFocused();
    const left = await box(page, '#side-left');
    expect(await aside(page, 'left').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    expect(left.x).toBe(0);
    expect(left.y).toBe(0);
    expect(left.height).toBe(740);
    expect(left.width).toBeLessThan(800);

    // modal: die zweite Leiste lässt sich erst nach dem Schließen der ersten öffnen
    expect(await toggle(page, 'right').evaluate((el) => el.closest('[inert]') !== null)).toBe(true);
    await page.keyboard.press('Escape');
    await toggle(page, 'right').click();
    await expectSides(page, false, true);
    await expect(page.locator('[aria-expanded="true"]')).toHaveCount(1);
    expect((await savedLayout(page)).sidebars).toEqual({ left: false, right: true });
    const right = await box(page, '#side-right');
    expect(right.x + right.width).toBe(800);

    // Klick daneben (auf die Blöcke links der Schublade): bleibt offen
    await page.mouse.click(right.x / 2, 500);
    await expectSides(page, false, true);
    await page.keyboard.press('Escape');
    await expectSides(page, false, false);
    await expect(toggle(page, 'right')).toBeFocused();
    expect((await savedLayout(page)).sidebars).toEqual({ left: false, right: false });

    await toggle(page, 'left').click();
    const close = page.locator('#side-left .side-close');
    await expect(close).toHaveText('Schließen');
    await close.click();
    await expectSides(page, false, false);
    await expect(toggle(page, 'left')).toBeFocused();
  });

  test('schmal (360, 800 px): offene Schublade dunkelt die Seite dahinter ab, nur Optik; zu oder breit keine Abdunklung', async ({ page }) => {
    const backdrop = page.locator('.drawer-backdrop');
    // was an einem Punkt sichtbar oben liegt: Schublade, Abdunklung oder etwas anderes. Inertes übergeht die Trefferprüfung,
    // und die Abdunklung ist als Geschwister der Schublade inert: für die Messung kurz aufheben (im selben Zug zurück)
    const topAt = (x, y) => page.evaluate(([px, py]) => {
      const inert = [...document.querySelectorAll('[inert]')];
      for (const el of inert) el.inert = false;
      const el = document.elementFromPoint(px, py);
      for (const e of inert) e.inert = true;
      return el.closest('.side')?.id ?? (el.classList.contains('drawer-backdrop') ? 'backdrop' : el.id || el.className || el.nodeName);
    }, [x, y]);
    for (const width of [360, 800]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto('/ui/index.html');
      await openWithGo(page);
      await expect(backdrop).toBeHidden();
      for (const side of ['left', 'right']) {
        await toggle(page, side).click();
        await expect(backdrop, `${width} ${side}`).toBeVisible();
        await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
        const style = await backdrop.evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, events: getComputedStyle(el).pointerEvents }));
        expect(style.color, `${width} ${side}`).toMatch(/^rgba\(\d+, \d+, \d+, 0?\.\d+\)$/); // halbdurchsichtig, nicht leer
        expect(Number(style.color.match(/[\d.]+\)$/)[0].slice(0, -1))).toBeGreaterThanOrEqual(0.2);
        expect(await backdrop.boundingBox()).toEqual({ x: 0, y: 0, width, height: 740 });
        // liegt über der Seite und unter der Schublade
        const drawer = await box(page, `#side-${side}`);
        expect(await topAt(drawer.x + drawer.width / 2, 400), `${width} ${side} Schublade`).toBe(`side-${side}`);
        const outside = side === 'left' ? (drawer.x + drawer.width + width) / 2 : drawer.x / 2;
        expect(await topAt(outside, 400), `${width} ${side} daneben`).toBe('backdrop');
        expect(await topAt(outside, 20), `${width} ${side} Kopfzeile`).toBe('backdrop');
        expect(await noScrollX(page), `${width} ${side}`).toBe(true);
        await page.keyboard.press('Escape');
        await expectSides(page, false, false);
        await expect(backdrop).toBeHidden();
      }
    }
    // breit mit beiden Leisten: keine Abdunklung
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#play-back').click();
    await page.locator('#tune-btn').click();
    await expectSides(page, true, true);
    await expect(backdrop).toBeHidden();
  });

  test('Wechsel von 1280 auf 800 px mit beiden offen: eine Schublade bleibt, das Layout merkt es', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#tune-btn').click();
    await expectSides(page, true, true);
    await page.setViewportSize({ width: 800, height: 740 });
    await expectSides(page, true, false);
    expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectSides(page, true, false);
  });

  test('360 px: Schublade passt ins Fenster, kein waagerechtes Scrollen, Schließen stellt die Seite wieder her', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openWithGo(page);
    const before = await box(page, '#blocks');
    for (const side of ['left', 'right']) {
      await toggle(page, side).click();
      await expect(aside(page, side)).toBeVisible();
      const drawer = await box(page, `#side-${side}`);
      expect(drawer.x, side).toBeGreaterThanOrEqual(0);
      expect(drawer.x + drawer.width, side).toBeLessThanOrEqual(360);
      expect(await noScrollX(page), side).toBe(true);
      await page.keyboard.press('Escape');
      await expectSides(page, false, false);
      expect(await box(page, '#blocks'), side).toEqual(before);
    }
  });

  test('Speicher wirft oder JSON kaputt: Standard (beide zu), Leisten bedienbar, kein Fehler', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('backingtrack.layout', '{'));
    await page.reload();
    await openWithGo(page);
    await expectSides(page, false, false);
    await toggle(page, 'left').click();
    await expectSides(page, true, false);
    expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: false });

    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await page.reload();
    await openWithGo(page);
    await expectSides(page, false, false);
    await toggle(page, 'right').click();
    await expectSides(page, false, true);
    await toggle(page, 'right').click();
    await expectSides(page, false, false);
  });

  test('Tastatur: Tab zum Auslöser, Enter und Leertaste, Inhalt der Schublade erreichbar (800 px)', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    await openWithGo(page);
    await page.locator('#mixer-btn').focus(); // Reihenfolge: Los, Variante, Mischpult, Klang
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'left')).toBeFocused();
    await page.keyboard.press('Enter');
    await expectSides(page, true, false);
    await expect(page.locator('#side-left-title')).toBeFocused();
    // Tab aus der Überschrift bleibt in der Schublade
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('side-left').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(toggle(page, 'left')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(toggle(page, 'right')).toBeFocused();
    await page.keyboard.press(' ');
    await expectSides(page, false, true);
    await expect(page.locator('#side-right-title')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('side-right').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(toggle(page, 'right')).toBeFocused();
  });

  test('keine rohen Schlüssel an Auslösern und Leisten in beiden Sprachen, auch in aria-Attributen', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    const rawKeys = () => page.evaluate((source) => {
      const re = new RegExp(source);
      const found = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
      for (const el of document.querySelectorAll('*')) {
        for (const { name, value } of el.attributes) if ((name.startsWith('aria-') || name === 'title') && re.test(value)) found.push(`${name}=${value}`);
      }
      return found;
    }, RAW_KEY.source);
    await openWithGo(page);
    await toggle(page, 'left').click();
    expect(await rawKeys()).toEqual([]);
    await page.keyboard.press('Escape'); // Sprachleiste ist unter der Schublade inert
    await page.locator('[data-lang="en"]').click();
    await toggle(page, 'left').click();
    await expect(toggle(page, 'left')).toHaveAccessibleName('Sound');
    await expect(toggle(page, 'right')).toHaveAccessibleName('Chords');
    await expect(page.locator('#side-left .side-close')).toHaveText('Close');
    expect(await rawKeys()).toEqual([]);
  });

  test('beim Spielen keine DOM-Schreibvorgänge je Takt an Auslösern, Leisten und inert-Zielen (1280 und 800 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#tune-btn').click();
    await page.locator('#tuning-tempo').fill('200');
    await playGo(page).click();
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await expectSides(page, true, width === 1280); // 800 px: nur die linke Schublade
      await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
      await page.evaluate(() => {
        window.__sideMutations = [];
        const record = new MutationObserver((list) => window.__sideMutations.push(...list.map((m) => `${m.target.id || m.target.className || m.target.nodeName} ${m.attributeName ?? m.type}`)));
        for (const id of ['toggle-left', 'toggle-right']) record.observe(document.getElementById(id), { attributes: true, childList: true, characterData: true, subtree: true });
        // Leisten und alles, was inert werden kann, selbst; ihr Inhalt (z. B. aria-current der Folge) darf sich je Takt ändern
        for (const sel of ['#side-left', '#side-right', '#blocks', '.play-head', '.top', '#start', 'main > h1']) record.observe(document.querySelector(sel), { attributes: true });
        for (const sel of ['#side-left-title', '#side-right-title', '.side-close']) {
          for (const el of document.querySelectorAll(sel)) record.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
        }
      });
      const bar = Number((await page.locator('#play-position').textContent()).match(/\d+/)[0]);
      await expect(page.locator('#play-position')).toHaveText(`Takt ${bar + 2} von 96`, { timeout: BAR_TIMEOUT });
      expect(await page.evaluate(() => window.__sideMutations), `${width} px`).toEqual([]);
    }
    await page.keyboard.press('Escape');
    await playGo(page).click();
  });

  // Fokus bleibt in der offenen Schublade: Ziel liegt in der Schublade oder ist body (Browseroberfläche)
  const focusInside = (page, side) => page.evaluate((id) => {
    const el = document.activeElement;
    return el === document.body || el.closest(`#${id}`) !== null ? 'ok' : `${el.id || el.className || el.nodeName} außerhalb`;
  }, `side-${side}`);
  const usable = (id) => [...document.getElementById(id).querySelectorAll('button, input, select')].filter((el) => !el.disabled && el.checkVisibility());

  for (const width of [360, 800]) {
    test(`${width} px: offene Schublade ist modal, Shift+Tab und Tab verlassen sie nicht, nach dem Schließen nichts inert`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      await openWithGo(page);
      for (const side of ['left', 'right']) {
        await toggle(page, side).click();
        await expect(page.locator(`#side-${side}-title`)).toBeFocused();
        // erstes Bedienelement (Schließen) rückwärts verlassen
        await page.locator(`#side-${side} .side-close`).focus();
        await page.keyboard.press('Shift+Tab');
        expect(await focusInside(page, side), `${side} Shift+Tab`).toBe('ok');
        // letztes Bedienelement vorwärts verlassen
        expect(await page.evaluate(`(${usable})('side-${side}').length`)).toBeGreaterThan(3);
        await page.evaluate(`(${usable})('side-${side}').at(-1).focus()`);
        await page.keyboard.press('Tab');
        expect(await focusInside(page, side), `${side} Tab nach dem letzten`).toBe('ok');
        // viele Tabs ab der Überschrift: nie außerhalb
        await page.locator(`#side-${side}-title`).focus();
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press('Tab');
          expect(await focusInside(page, side), `${side} Tab ${i + 1}`).toBe('ok');
        }
        await page.locator(`#side-${side}-title`).focus();
        await page.keyboard.press('Escape');
        await expectSides(page, false, false);
        await expect(toggle(page, side)).toBeFocused();
        // nichts bleibt inert, Kopfzeile und Blöcke wieder bedienbar
        await expect(page.locator('[inert]')).toHaveCount(0);
        await page.locator('#play-back').focus();
        await expect(page.locator('#play-back')).toBeFocused();
        await page.locator('#lane-buttons button').first().focus();
        await expect(page.locator('#lane-buttons button').first()).toBeFocused();
      }
    });
  }

  test('offene Schublade, dann breit: nichts bleibt inert; zurück auf schmal wieder modal', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    await openWithGo(page);
    await toggle(page, 'left').click();
    await expect(page.locator('.play-head')).toHaveAttribute('inert', '');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('[inert]')).toHaveCount(0);
    await expectSides(page, true, false);
    await page.setViewportSize({ width: 800, height: 740 });
    await expect(page.locator('.play-head')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('[inert]')).toHaveCount(0);
  });

  test('Startseite mit gemerkter offener Leiste (schmal): nichts inert, Escape ändert nichts; Los zeigt die Schublade', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    await page.evaluate(() => localStorage.setItem('backingtrack.layout', JSON.stringify({ sidebars: { left: true, right: false } })));
    await page.reload();
    await expect(start(page)).toBeVisible();
    await expect(page.locator('[inert]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect((await savedLayout(page)).sidebars).toEqual({ left: true, right: false });
    await page.locator('#go').click();
    await expectSides(page, true, false);
    // Navigation bei offener modaler Schublade: Fokus in die Schublade (der Seitentitel ist inert)
    await expect(page.locator('#side-left-title')).toBeFocused();
    await expect(page.locator('.play-head')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('[inert]')).toHaveCount(0);
    await playGo(page).click();
  });

  test('Escape, das ein anderer schon behandelt hat (defaultPrevented, z. B. offene Auswahlliste), schließt die Schublade nicht', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 740 });
    await openWithGo(page);
    await toggle(page, 'left').click();
    await page.locator('#length').focus();
    await page.evaluate(() => window.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); }, { capture: true, once: true }));
    await page.keyboard.press('Escape');
    await expectSides(page, true, false);
    await page.keyboard.press('Escape');
    await expectSides(page, false, false);
  });

  // Andocken erst ab 1200 px: dort zeigt die Mitte das ganze Griffbrett (40rem), auch neben einer klassischen
  // Bildlaufleiste von 17 px (headless hat keine, daher 640 + 17)
  test('breit mit beiden Leisten: Blöcke mindestens 657 px (1200 px) bzw. 640 px (1280 px), Griffbrett ohne inneres Scrollen, keine Überlappung; 1199 px Schubladen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#tune-btn').click();
    for (const [width, min] of [[1200, 657], [1280, 640]]) {
      await page.setViewportSize({ width, height: 900 });
      await expectSides(page, true, true);
      const [left, blocks, right] = [await box(page, '#side-left'), await box(page, '#blocks'), await box(page, '#side-right')];
      expect(blocks.width, `${width} px`).toBeGreaterThanOrEqual(min);
      expect(overlaps(left, blocks), `${width} px links`).toBe(false);
      expect(overlaps(right, blocks), `${width} px rechts`).toBe(false);
      expect(left.x + left.width).toBeLessThanOrEqual(blocks.x);
      expect(blocks.x + blocks.width).toBeLessThanOrEqual(right.x);
      const fret = await page.locator('#fretboard').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(fret.scroll, `${width} px Griffbrett`).toBeLessThanOrEqual(fret.client + 1);
    }
    // eine Spalte schmaler: Schubladen, nur die linke bleibt offen
    await page.setViewportSize({ width: 1199, height: 900 });
    await expectSides(page, true, false);
    expect(await aside(page, 'left').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await expect(page.locator('.play-head')).toHaveAttribute('inert', '');
  });
});
