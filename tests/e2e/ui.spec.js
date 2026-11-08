// Oberfläche: Startsatz, Auswahl-Popover, Los/Stopp, Variante, Sprachumschalter (echte Seite /ui/index.html).
import { test, expect } from '@playwright/test';
import { allowedChords } from '../../src/core/music.js';
import { progressionFor } from '../../src/core/progressions.js';
import { STYLE_PRESETS } from '../../src/core/tags.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view)\.[A-Za-z.]+$/;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const namesIn = (root, mode) => allowedChords({ root, mode }).map((c) => c.root + SYMBOLS[c.quality]);
const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig

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
  await open(page);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

async function open(page) {
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
}

const sentence = (page) => page.locator('#sentence');
const go = (page) => page.locator('#go');
// Los startet und öffnet die Spielseite; zurück zur Startseite, die Wiedergabe läuft weiter
async function goAndBack(page) {
  await go(page).click();
  await expect(page.locator('#play')).toBeVisible();
  await page.locator('#play-back').click();
  await expect(page.locator('#start')).toBeVisible();
}
const contexts = (page) => page.evaluate(() => window.__audioContexts);
// angezeigte Folge "Am – Am – Dm – E" als Liste
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const normalized = async (locator) => (await locator.textContent()).replace(/\s+/g, ' ').trim();

async function rawKeysIn(page) {
  return page.evaluate((source) => {
    const re = new RegExp(source);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
    for (const el of document.querySelectorAll('[aria-label], [title]')) {
      for (const attr of ['aria-label', 'title']) if (re.test(el.getAttribute(attr) ?? '')) found.push(`${attr}=${el.getAttribute(attr)}`);
    }
    if (re.test(document.title)) found.push(`title=${document.title}`);
    return found;
  }, RAW_KEY.source);
}

async function checkNoRawKeys(page) {
  expect(await rawKeysIn(page)).toEqual([]);
  for (const id of ['#key-btn', '#style-btn', '#tempo-btn']) {
    await page.locator(id).click();
    await expect(page.locator(`#${await page.locator(id).getAttribute('aria-controls')}`)).toBeVisible();
    expect(await rawKeysIn(page), id).toEqual([]);
    await page.keyboard.press('Escape');
  }
}

test('Startsatz auf Deutsch, Spielseite versteckt, kein AudioContext beim Laden', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  const text = await normalized(sentence(page));
  for (const part of ['A-Moll-Pentatonik', 'Funk-Rock', '100']) expect(text).toContain(part);
  expect(text).toBe('A-Moll-Pentatonik im Stil Funk-Rock bei 100 bpm');
  await expect(go(page)).toHaveText('Los');
  await expect(page.getByRole('spinbutton', { name: 'Variante', exact: true })).toHaveValue(/^\d{1,4}$/);
  expect(await shownChords(page)).toHaveLength(4);
  await expect(page.locator('#play')).toBeAttached();
  await expect(page.locator('#play')).toBeHidden();
  expect(await contexts(page)).toBe(0);
});

test('Los startet mit aktuellem Akkord und Taktzeile, Stopp hält an; ein AudioContext für alle Starts', async ({ page }) => {
  const chords = await shownChords(page);
  expect(await contexts(page)).toBe(0);
  await goAndBack(page);
  await expect(go(page)).toHaveText('Stopp');
  const now = page.locator('#now-chord');
  await expect(now).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  expect(chords).toContain(await now.textContent());
  const position = page.locator('#position');
  await expect(position).toHaveText(/^Takt 1 von 96$/, { timeout: BAR_TIMEOUT });
  await expect(position).toHaveText(/^Takt 2 von 96$/, { timeout: BAR_TIMEOUT });
  await go(page).click();
  await expect(go(page)).toHaveText('Los');
  await expect(now).toHaveText('');
  await expect(position).toHaveText('');
  await goAndBack(page);
  await expect(now).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  await go(page).click();
  await expect(go(page)).toHaveText('Los');
  expect(await contexts(page)).toBe(1);
});

test('Stil-Popover: Träumerisch ändert Satz und Tempo, schließt und gibt den Fokus zurück', async ({ page }) => {
  const button = page.locator('#style-btn');
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const pop = page.locator('#style-pop');
  await expect(pop).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(pop.getByRole('button')).toHaveCount(STYLE_PRESETS.length);
  await pop.getByRole('button', { name: /Träumerisch/ }).click();
  await expect(pop).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(sentence(page)).toContainText('Träumerisch');
  await expect(page.locator('#tempo-btn')).toHaveText('80 bpm');
  await button.click();
  await expect(pop.getByRole('button', { name: /Träumerisch/ })).toHaveAttribute('aria-pressed', 'true');
});

test('Popover: Escape schließt und fokussiert den Knopf, nur eines offen, Klick daneben schließt', async ({ page }) => {
  const keyButton = page.locator('#key-btn');
  const keyPop = page.locator('#key-pop');
  await keyButton.click();
  await expect(keyPop).toBeVisible();
  // Fokus liegt im Popover, Inhalt per Tastatur erreichbar
  await expect.poll(() => keyPop.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => keyPop.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(keyPop).toBeHidden();
  await expect(keyButton).toBeFocused();
  await expect(keyButton).toHaveAttribute('aria-expanded', 'false');

  await keyButton.click();
  await page.locator('#style-btn').click();
  await expect(page.locator('#style-pop')).toBeVisible();
  await expect(keyPop).toBeHidden();
  await page.mouse.click(5, 5);
  await expect(page.locator('#style-pop')).toBeHidden();

  // Tastatur: Enter öffnet, Tempo-Regler bekommt den Fokus
  await page.locator('#tempo-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tempo-pop')).toBeVisible();
  await expect(page.locator('#tempo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tempo-btn')).toBeFocused();
});

test('andere Tonart und Skala: Satz und Akkorde folgen, auch während der Wiedergabe', async ({ page }) => {
  await page.locator('#key-btn').click();
  const pop = page.locator('#key-pop');
  await pop.getByRole('button', { name: 'D', exact: true }).click();
  await expect(sentence(page)).toContainText('D-Moll-Pentatonik');
  await expect(pop.getByRole('button', { name: 'D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const c of await shownChords(page)) expect(namesIn('D', 'minor')).toContain(c);

  await pop.getByRole('button', { name: 'Dur-Pentatonik' }).click();
  await expect(sentence(page)).toContainText('D-Dur-Pentatonik');
  for (const c of await shownChords(page)) expect(namesIn('D', 'major')).toContain(c);

  await page.keyboard.press('Escape');
  await goAndBack(page);
  await expect(page.locator('#now-chord')).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  await page.locator('#key-btn').click();
  await pop.getByRole('button', { name: 'Eb', exact: true }).click();
  await pop.getByRole('button', { name: 'Blues' }).click();
  await expect(sentence(page)).toContainText('Eb-Blues');
  await expect(go(page)).toHaveText('Stopp');
  const ebMinor = namesIn('Eb', 'minor');
  await expect.poll(async () => ebMinor.includes(await page.locator('#now-chord').textContent()), { timeout: BAR_TIMEOUT }).toBe(true);
  await page.keyboard.press('Escape');
  await go(page).click();
  expect(await contexts(page)).toBe(1);
});

test('Dorisch: Satz, Akkorde der dorischen Tonart (mit Dur-IV), Feintuning und Englisch folgen', async ({ page }) => {
  await page.locator('#key-btn').click();
  const pop = page.locator('#key-pop');
  await pop.getByRole('button', { name: 'Dorisch' }).click();
  await expect(sentence(page)).toContainText('A-Dorisch');
  const chords = await shownChords(page);
  expect(chords).toHaveLength(4);
  for (const c of chords) expect(namesIn('A', 'dorian')).toContain(c);
  expect(chords).toContain('D'); // jede dorische Vorlage hat die Dur-IV, die es in A-Moll nicht gibt
  await pop.getByRole('button', { name: 'G', exact: true }).click();
  await expect(sentence(page)).toContainText('G-Dorisch');
  for (const c of await shownChords(page)) expect(namesIn('G', 'dorian')).toContain(c);
  await page.keyboard.press('Escape');
  await page.locator('#tune-btn').click();
  expect(await page.locator('#add-chords button').allTextContents()).toEqual(namesIn('G', 'dorian'));
  await page.getByRole('button', { name: /^EN/i }).click();
  await expect(sentence(page)).toContainText('G dorian');
  expect(await rawKeysIn(page)).toEqual([]);
});

test('andere Variante ändert die Nummer und zeigt vier gültige Akkorde', async ({ page }) => {
  const variant = page.locator('#variant');
  const before = await variant.inputValue();
  let after = before;
  for (let i = 0; i < 5 && after === before; i++) {
    await page.locator('#new-variant').click();
    after = await variant.inputValue();
  }
  expect(after).not.toBe(before);
  const n = Number(after.match(/\d+/)[0]);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(9999);
  const chords = await shownChords(page);
  expect(chords).toHaveLength(4);
  for (const c of chords) expect(namesIn('A', 'minor')).toContain(c);
});

const expectedChords = (key, seed) => progressionFor(key, seed).map((c) => c.root + SYMBOLS[c.quality]);

test('Variantennummer eingeben: gleiche Nummer, gleiche Folge; Feld mit Name, Grenzen und Fokusrahmen', async ({ page }) => {
  const field = page.getByRole('spinbutton', { name: 'Variante', exact: true });
  await expect(field).toHaveAttribute('min', '1');
  await expect(field).toHaveAttribute('max', '9999');
  await field.fill('4711');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  await field.focus();
  expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  // andere Variante würfelt und schreibt die Nummer ins Feld, dieselbe Nummer bringt die Folge zurück
  await page.locator('#new-variant').click();
  const rolled = Number(await field.inputValue());
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, rolled));
  await field.fill('4711');
  await field.blur();
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  // andere Tonart: Nummer bleibt, Folge der neuen Tonart
  await page.locator('#key-btn').click();
  await page.locator('#key-pop').getByRole('button', { name: 'D', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('4711');
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'D', mode: 'minor' }, 4711));
  await field.fill('12');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'D', mode: 'minor' }, 12));
});

test('ungültige Variantennummer (0, 10000, Buchstaben, leer) wird ignoriert, Feld springt zurück', async ({ page }) => {
  const field = page.locator('#variant');
  await field.fill('4711');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  const chords = await shownChords(page);
  for (const bad of ['0', '10000', '-3', '2.5', '']) {
    await field.fill(bad);
    await field.press('Enter');
    await field.blur();
    await expect(field).toHaveValue('4711');
    expect(await shownChords(page), bad).toEqual(chords);
  }
  await field.fill('');
  await field.pressSequentially('abc');
  await field.blur();
  await expect(field).toHaveValue('4711');
  expect(await shownChords(page)).toEqual(chords);
});

test('Variantennummer während der Wiedergabe startet im laufenden Takt neu; auf Englisch ohne rohe Schlüssel', async ({ page }) => {
  await goAndBack(page);
  const position = page.locator('#position');
  await expect(position).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  const field = page.locator('#variant');
  // Absichtliche Verhaltensänderung: kein Sprung mehr auf Takt 1, die Taktzeile läuft weiter (Aufbau schon voll)
  await page.evaluate(() => {
    window.__positions = [];
    const el = document.querySelector('#position');
    new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await field.fill('321');
  await field.press('Enter');
  await expect(position).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  expect((await page.evaluate(() => window.__positions)).filter(Boolean)).not.toContain('Takt 1 von 96');
  await expect(go(page)).toHaveText('Stopp');
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 321));
  await go(page).click();

  await page.getByRole('button', { name: /^EN/i }).click();
  const en = page.getByRole('spinbutton', { name: 'Variant', exact: true });
  await expect(en).toHaveValue('321');
  await en.fill('9999');
  await en.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 9999));
  expect(await rawKeysIn(page)).toEqual([]);
  expect(await contexts(page)).toBe(1);
});

test('Tempo-Regler während der Wiedergabe: kein Neustart, kein Fehler', async ({ page }) => {
  await goAndBack(page);
  const position = page.locator('#position');
  await expect(position).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await page.locator('#tempo-btn').click();
  await page.locator('#tempo').fill('160');
  await expect(page.locator('#tempo-out')).toHaveText('160');
  await expect(page.locator('#tempo-btn')).toHaveText('160 bpm');
  // ein Neustart würde die Taktzeile leeren und bei Takt 1 beginnen
  expect(await position.textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  await expect(go(page)).toHaveText('Stopp');
  await page.locator('#tempo').fill('40');
  await expect(page.locator('#tempo-btn')).toHaveText('40 bpm');
  await page.keyboard.press('Escape');
  await go(page).click();
  expect(await contexts(page)).toBe(1);
});

test('Sprachumschalter: Englisch ohne Neuladen, bleibt nach Neuladen, keine rohen Schlüssel', async ({ page }) => {
  await checkNoRawKeys(page);
  const en = page.getByRole('button', { name: /^EN/i });
  await expect(page.getByRole('group', { name: 'Sprache' })).toBeVisible();
  await en.click();
  await expect(en).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  expect(await normalized(sentence(page))).toMatch(/^A minor pentatonic in Funk rock at 100 bpm$/i);
  await expect(go(page)).toHaveText('Go');
  await expect(page.locator('#new-variant')).toHaveText('another variant');
  await expect(page.getByRole('spinbutton', { name: 'Variant', exact: true })).toHaveValue(/^\d+$/);
  await checkNoRawKeys(page);
  await goAndBack(page);
  await expect(page.locator('#position')).toHaveText(/^Bar \d+ of 96$/, { timeout: BAR_TIMEOUT });
  await go(page).click();

  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  await page.getByRole('button', { name: /^DE/i }).click();
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('genau eine h1 mit übersetztem Titel, nur für Screenreader sichtbar', async ({ page }) => {
  for (const [lang, title] of [['de', 'Backingtrack-Generator'], ['en', 'Backing track generator']]) {
    await page.getByRole('button', { name: new RegExp(`^${lang}`, 'i') }).click();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    // versteckt per Clip, nicht per display:none (sonst fehlt sie im Barrierefreiheitsbaum)
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
  }
});

test.describe('englischer Browser', () => {
  test.use({ locale: 'en-US' });
  test('erster Besuch folgt navigator.language', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#tonight')).toHaveText('Tonight:');
    await expect(go(page)).toHaveText('Go');
  });
});

test('ohne localStorage (Zugriff wirft) läuft die Seite weiter', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await open(page);
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  await page.getByRole('button', { name: /^EN/i }).click();
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  await goAndBack(page);
  await expect(go(page)).toHaveText('Stop');
  await go(page).click();
  await expect(go(page)).toHaveText('Go');
  // Feintuning merkt die Leisten: ohne Speicher nur bis zum Neuladen, ohne Fehler
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
});

test('Startfehler stürzt nicht ab: Meldung in der gewählten Sprache', async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error('no audio');
      }
    };
  });
  await open(page);
  const message = page.locator('#message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  // Live-Region muss schon leer gerendert sein, sonst kündigen Screenreader den ersten Text oft nicht an
  await expect(message).toHaveText('');
  expect(await message.evaluate((el) => {
    const s = getComputedStyle(el);
    return { display: s.display !== 'none', visibility: s.visibility, ancestorsShown: el.checkVisibility({ visibilityProperty: true }) };
  })).toEqual({ display: true, visibility: 'visible', ancestorsShown: true });
  await go(page).click();
  await expect(message).toHaveText('Die Wiedergabe konnte nicht starten.');
  await expect(message).toBeVisible();
  await expect(go(page)).toHaveText('Los');
  const german = await message.textContent();
  await page.getByRole('button', { name: /^EN/i }).click();
  await expect(message).not.toHaveText(german);
  await expect(message).toHaveText(/\S/);
  expect(await rawKeysIn(page)).toEqual([]);
});

test('360 px breit: kein waagerechtes Scrollen, Popover im Bild, Knöpfe mindestens 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noScroll()).toBe(true);
  const small = () => page.evaluate(() => [...document.querySelectorAll('button, input')]
    .filter((el) => el.checkVisibility())
    .map((el) => ({ el: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(await small()).toEqual([]);
  for (const id of ['key', 'style', 'tempo']) {
    await page.locator(`#${id}-btn`).click();
    const box = await page.locator(`#${id}-pop`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(344);
    expect(await noScroll()).toBe(true);
    expect(await small(), id).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

test('Stil-Karten: jeder Stil hat Name, Tempo, Hinweis und ein 16er-Rhythmusbild, ohne rohe Schlüsselnamen', async ({ page }) => {
  await page.locator('#style-btn').click();
  const cards = page.locator('#style-cards .card');
  await expect(cards).toHaveCount(STYLE_PRESETS.length);
  for (const { id, bpm } of STYLE_PRESETS) {
    const card = page.locator(`#style-cards [data-style="${id}"]`);
    await expect(card.locator('.card-name'), id).toHaveText(/\S/);
    await expect(card.locator('.card-hint'), id).toHaveText(/\S/);
    await expect(card.locator('.card-bpm'), id).toContainText(String(bpm));
    await expect(card.locator('.rhythm i'), id).toHaveCount(16);
    for (const part of ['.card-name', '.card-hint']) expect(RAW_KEY.test((await card.locator(part).textContent()).trim()), `${id} ${part}`).toBe(false);
  }
});

test('jeder neue Stil: Auswahl setzt Tempo und Namen, Los startet ohne Fehler', async ({ page }) => {
  test.setTimeout(60_000);
  for (const { id, bpm } of STYLE_PRESETS.filter((p) => !['funk', 'psych', 'dreamy'].includes(p.id))) {
    await page.locator('#style-btn').click();
    await page.locator(`#style-cards [data-style="${id}"]`).click();
    await expect(page.locator(`#style-cards [data-style="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tempo-btn'), id).toContainText(String(bpm));
  }
  await go(page).click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
});
