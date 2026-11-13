// Start- und Spielseite: Navigation, Fokus, Wiedergabe über den Seitenwechsel, gemeinsamer Zustand. Gerüst und Fokus/Einstellen: layout.spec.js.
import { test, expect } from '@playwright/test';
import { addChordByName } from './chord-helpers.js';
import { openTags } from './style-helpers.js';
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
const modeSwitch = (page) => page.locator('#mode-switch');

// Spielseite über Los öffnen (im Fokus) und die Wiedergabe gleich stoppen
async function openWithGo(page) {
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
}

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

test('Feintuning öffnet die Spielseite ohne zu starten, Fokus auf dem Titel, Zustand Einstellen gemerkt', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await expect(play(page)).toBeVisible();
  await expect(start(page)).toBeHidden();
  await expect(page.locator('#play-title')).toBeFocused();
  await expect(page.locator('#play-title')).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#play-title')).toHaveText('Spielseite');
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#play-now')).toHaveText('');
  expect(await contexts(page)).toBe(0);
  expect((await savedLayout(page)).mode).toBe('setup');
  // Kopfleiste, Visualisierung und Rack
  await expect(page.locator('#play-variant')).toHaveText(`Variante ${await page.locator('#variant').inputValue()}`);
  await expect(page.locator('#play-back')).toHaveText('Backingtrack-Generator');
  await expect(page.locator('#play-back')).toHaveAttribute('title', 'Zur Startseite');
  await expect(modeSwitch(page)).toHaveAttribute('aria-checked', 'true');
  expect(await page.locator('#viz .module').evaluateAll((els) => els.map((el) => el.id))).toEqual(['mod-key', 'mod-fretboard', 'mod-wheel', 'mod-song']);
  for (const name of ['Tonart', 'Griffbrett', 'Akkorde', 'Form & Spuren', 'Harmonie', 'Rhythmus', 'Charakter', 'Mixer']) await expect(page.getByRole('heading', { name, exact: true, level: 3 }).first()).toBeVisible(); // "Akkorde" gibt es auch als Instrument-Modul
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
  // erster Besuch: Fokus ist schon der Standard, nichts überschrieben
  expect(await savedLayout(page)).toBeNull();
  await expect(modeSwitch(page)).toHaveAttribute('aria-checked', 'false');

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

test('Tonart im Modul Harmonie: Folge ändert sich, Popover der Startseite zeigt dieselbe Tonart', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const side = page.locator('#key-select');
  await expect(side.locator('option')).toHaveCount(12);
  await expect(side).toHaveValue('A');
  await side.selectOption('D');
  await expect(side).toHaveValue('D');
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
  const chords = await shownChords(page);
  expect(await progression(page).allTextContents()).toEqual(chords);
  await page.locator('#scale-select').selectOption('majorPentatonic');
  await expect(page.locator('#scale-select')).toHaveValue('majorPentatonic');

  await page.locator('#play-back').click();
  await expect(page.locator('#sentence')).toContainText('D-Dur-Pentatonik');
  await page.locator('#key-btn').click();
  await expect(page.locator('#key-chips').getByRole('button', { name: 'D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scale-chips').getByRole('button', { name: 'Dur-Pentatonik' })).toHaveAttribute('aria-pressed', 'true');
  // und umgekehrt: Popover ändert das Modul
  await page.locator('#key-chips').getByRole('button', { name: 'E', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#tune-btn').click();
  await expect(page.locator('#key-select')).toHaveValue('E');
});

test('Feintuning-Funktionen arbeiten auf der Spielseite: Schlagworte, Länge, Akkorde, Rad, Stummschalter', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const swing = page.locator('#rack #tags [data-tag="swing"]');
  await openTags(page);
  await swing.click();
  await expect(swing).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#form-song #length').selectOption('48');
  await expect(page.locator('#length')).toHaveValue('48');
  await page.locator('#rack #tuning-tempo').fill('120');
  await expect(page.locator('#tuning-tempo-out')).toHaveText('120 bpm');

  const before = await shownChords(page);
  await addChordByName(page, 'C', '#rack');
  await expect.poll(() => shownChords(page)).toEqual([...before, 'C']);
  await page.locator('#rack #progression button').last().click();
  await expect.poll(() => shownChords(page)).toEqual(before);
  await page.locator('#wheel').click({ position: await wheelPoint(page, 'F', 'maj') });
  await expect.poll(() => shownChords(page)).toEqual([...before, 'F']);

  const drums = page.locator('#viz #lane-buttons [data-layer="drums"]');
  await page.locator('#mixer button[data-mute="drums"]').click();
  await expect(drums).toHaveAttribute('data-muted', 'true');
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

test('Reihenfolge: Kopfleiste, Visualisierung, Rack; Tab vom Seitentitel erreicht zuerst die Kopfleiste', async ({ page }) => {
  await page.locator('#tune-btn').click();
  const ids = await page.locator('#play > :is(.play-head, #viz, #rack)').evaluateAll((els) => els.map((el) => el.id || el.className));
  expect(ids).toEqual(['play-head', 'viz', 'rack']);
  await page.locator('#play-title').focus();
  await page.keyboard.press('Tab');
  await expect(playGo(page)).toBeFocused();
  // nach der Kopfleiste die Visualisierung (Namen/Stufen am Griffbrett), dann erst das Rack
  let region = null;
  for (let i = 0; i < 20 && !region; i++) {
    await page.keyboard.press('Tab');
    region = await page.evaluate(() => {
      const el = document.activeElement;
      const r = ['viz', 'rack'].find((id) => document.getElementById(id).contains(el));
      return r ? { id: r, first: el.id } : null;
    });
  }
  expect(region).toEqual({ id: 'viz', first: 'labels-names' });
});

test('Spielseite auf Englisch: Kopfzeile und Überschriften übersetzt', async ({ page }) => {
  await page.locator('[data-lang="en"]').click();
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play-back')).toHaveText('Backing track generator');
  await expect(page.locator('#play-back')).toHaveAttribute('title', 'To start page');
  await expect(page.locator('#play-title')).toHaveText('Play page');
  await expect(page.locator('#play-variant')).toHaveText(/^Variant \d+$/);
  await expect(modeSwitch(page)).toHaveAccessibleName('Setup');
  for (const name of ['Key', 'Fretboard', 'Chords', 'Form & lanes', 'Harmony', 'Rhythm', 'Character', 'Mixer']) await expect(page.getByRole('heading', { name, exact: true, level: 3 }).first()).toBeVisible(); // "Chords" gibt es auch als Instrument-Modul
  await playGo(page).click();
  await page.locator('#play-back').click();
  await expect(page.locator('#to-play')).toHaveText('To play page');
  await page.locator('#go').click();
});

test.describe('Fokus/Einstellen', () => {
  test.use({ reducedMotion: 'reduce' });
  const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|mod|category|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;

  test('Speicher wirft oder JSON kaputt: Standard (Fokus), Schalter bedienbar, kein Fehler', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('backingtrack.layout', '{'));
    await page.reload();
    await openWithGo(page);
    await expect(modeSwitch(page)).toHaveAttribute('aria-checked', 'false');
    await modeSwitch(page).click();
    await expect(page.locator('#rack')).toBeVisible();
    expect((await savedLayout(page)).mode).toBe('setup');

    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await page.reload();
    await openWithGo(page);
    await expect(page.locator('#rack')).toBeHidden();
    await modeSwitch(page).click();
    await expect(page.locator('#rack')).toBeVisible();
    await modeSwitch(page).click();
    await expect(page.locator('#rack')).toBeHidden();
  });

  test('keine rohen Schlüssel in Kopfleiste, Visualisierung und Rack in beiden Sprachen, auch in aria-Attributen', async ({ page }) => {
    const rawKeys = () => page.evaluate((source) => {
      const re = new RegExp(source);
      const found = [];
      const walker = document.createTreeWalker(document.getElementById('play'), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
      for (const el of document.querySelectorAll('#play *')) {
        for (const { name, value } of el.attributes) if ((name.startsWith('aria-') || name === 'title') && re.test(value)) found.push(`${name}=${value}`);
      }
      return found;
    }, RAW_KEY.source);
    await page.locator('#tune-btn').click();
    expect(await rawKeys()).toEqual([]);
    await page.locator('[data-lang="en"]').click();
    await expect(modeSwitch(page)).toHaveAccessibleName('Setup');
    expect(await rawKeys()).toEqual([]);
  });

  test('beim Spielen keine DOM-Schreibvorgänge je Takt an Schalter, Seite und Rack', async ({ page }) => {
    await page.locator('#tune-btn').click();
    await page.locator('#tuning-tempo').fill('200');
    await playGo(page).click();
    await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
    await page.evaluate(() => {
      window.__mutations = [];
      const record = new MutationObserver((list) => window.__mutations.push(...list.map((m) => `${m.target.id || m.target.className || m.target.nodeName} ${m.attributeName ?? m.type}`)));
      record.observe(document.getElementById('mode-switch'), { attributes: true, childList: true, characterData: true, subtree: true });
      for (const sel of ['#play', '#viz', '#rack', '.play-head', '.lang', '#start']) record.observe(document.querySelector(sel), { attributes: true });
      record.observe(document.querySelector('.play-head'), { childList: true });
    });
    const bar = Number((await page.locator('#play-position').textContent()).match(/\d+/)[0]);
    await expect(page.locator('#play-position')).toHaveText(`Takt ${bar + 2} von 96`, { timeout: BAR_TIMEOUT });
    expect(await page.evaluate(() => window.__mutations)).toEqual([]);
    await playGo(page).click();
  });

  test('Sprachtasten wandern mit der Seite und behalten beim Umschalten der Sprache den Fokus', async ({ page }) => {
    await page.locator('#tune-btn').click();
    const en = page.locator('[data-lang="en"]');
    await expect(page.locator('.play-head .lang')).toBeVisible();
    await expect(page.locator('header.top')).toBeHidden();
    await en.click();
    await expect(en).toBeFocused();
    await page.locator('#play-back').click();
    await expect(page.locator('header.top .lang')).toBeVisible();
    await page.locator('[data-lang="de"]').click();
    await expect(page.locator('[data-lang="de"]')).toBeFocused();
  });
});

test('Tonart-Modul und Kopfleiste: Tonart, Skala, Teil; bei laufender Wiedergabe folgender Akkord und Countdown, gestoppt leer', async ({ page }) => {
  await page.locator('#tune-btn').click();
  while (await progression(page).count() > 1) await progression(page).first().click();
  for (const name of ['Am', 'Am', 'Dm', 'E']) await addChordByName(page, name);
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(['Am', 'Am', 'Dm', 'E']);
  await page.locator('#tuning-tempo').fill('200'); // ein Takt 1,2 s

  // Stand: Tonart groß als LCD, Skala darunter, Teil des ersten Takts; kein Countdown
  await expect(page.locator('#play-key')).toHaveText('Am');
  await expect(page.locator('#play-scale')).toHaveText('Moll-Pentatonik');
  await expect(page.locator('#play-part')).toHaveText(/^\p{L}+ 1$/u);
  await expect(page.locator('#play-countdown')).toHaveText('');
  expect(await page.locator('#play-key').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(185, 242, 107)'); // LCD-Schrift
  expect(await page.locator('#play-now').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(22, 26, 20)'); // LCD, kein Rosa auf Hellgrau

  await playGo(page).click();
  const next = { Am: 'Dm', Dm: 'E', E: 'Am' };
  const seen = new Set();
  await expect.poll(async () => {
    const s = await page.evaluate(() => ({ now: document.getElementById('play-now').textContent, next: document.getElementById('play-next').textContent, text: document.getElementById('play-countdown').textContent }));
    if (!s.now || !s.text) return false;
    expect(s.next).toBe(next[s.now]);
    const n = Number(s.text.match(/^in (\d+) Schl/)?.[1]);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(8); // höchstens zwei Takte (Am Am bis Dm)
    seen.add(n);
    return seen.size >= 3 && seen.has(1);
  }, { timeout: 3 * BAR_TIMEOUT, intervals: [50] }).toBe(true);
  await expect(page.locator('#play-part')).toHaveText(/^\p{L}+ \d+$/u);

  await playGo(page).click();
  await expect(page.locator('#play-countdown')).toHaveText('');
  await page.waitForTimeout(300);
  await expect(page.locator('#play-countdown')).toHaveText(''); // die Schleife ist beendet, schreibt nichts mehr
});

test('Countdown auf Englisch: Einzahl und Mehrzahl', async ({ page }) => {
  await page.locator('#tune-btn').click();
  await page.locator('[data-lang="en"]').click();
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect.poll(() => page.locator('#play-countdown').textContent(), { timeout: 3 * BAR_TIMEOUT, intervals: [50] }).toMatch(/^in \d+ beats?$/);
  await playGo(page).click();
});

test('Akkordkreis: jetziger Akkord pink, nächster türkis gefüllt; darunter die Folge als Spans mit Rollen-Klassen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  while (await progression(page).count() > 1) await progression(page).first().click();
  for (const name of ['Am', 'Am', 'Dm', 'E']) await addChordByName(page, name);
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(['Am', 'Am', 'Dm', 'E']);
  await page.locator('#tuning-tempo').fill('200');
  await expect(page.locator('#wheel-prog > span')).toHaveCount(4);
  await expect(page.locator('#wheel-prog button')).toHaveCount(0); // nur Anzeige, keine zweite Bedienung
  await playGo(page).click();

  const size = (await page.locator('#wheel').boundingBox()).width;
  const nodes = layoutWheel(size, AM).nodes;
  const where = { Am: ['inner', 'A'], Dm: ['inner', 'D'], E: ['outer', 'E'] };
  // Farbe einen halben Knotenradius links vom Mittelpunkt (dort steht kein Text)
  const colorAt = (name) => {
    const [ring, root] = where[name];
    const n = nodes.find((x) => x.ring === ring && x.chord.root === root);
    return page.locator('#wheel').evaluate((canvas, p) => {
      const k = canvas.width / canvas.clientWidth;
      return [...canvas.getContext('2d').getImageData(Math.round((p.x - p.r * 0.75) * k), Math.round(p.y * k), 1, 1).data.slice(0, 3)].join(',');
    }, n);
  };
  const PINK = '227,70,94';
  const TEAL = '24,162,166';
  const seen = new Set();
  await expect.poll(async () => {
    const now = await page.locator('#play-now').textContent();
    const next = await page.locator('#play-next').textContent();
    if (!now || !next) return false;
    const roles = await page.locator('#wheel-prog > span').evaluateAll((els) => els.map((e) => e.className));
    const [a, b] = [await colorAt(now), await colorAt(next)];
    // der Takt kann zwischen Lesen und Zeichnen wechseln: nur Treffer zählen, nie Ausreißer verbuchen
    if (a === PINK && b === TEAL && (await page.locator('#play-now').textContent()) === now && roles.filter((c) => c.includes('role-now')).length === 1) seen.add(now);
    return seen.has('Dm') && seen.has('E');
  }, { timeout: 3 * BAR_TIMEOUT, intervals: [50] }).toBe(true);
  await playGo(page).click();
});
