// Start- und Spielseite: Navigation, Fokus, Wiedergabe über den Seitenwechsel, gemeinsamer Zustand. Gerüst und Fokus/Einstellen: layout.spec.js.
// Portiert aus tests/e2e/play-page.spec.js: die App lädt ihre Seite; gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt;
// AudioContexts zählt count-helpers.js, ein Start, der scheitert, ist das Ereignis der Hülle (failStarts); wo ein Akkord im Rad liegt, sagen die
// Geometrie der Seite (native/app/ui/wheel-geometry.js) und derived().wheel; die Sprache wählt die Leiste der App, die eigenen Sprachtasten der
// Seite stehen dort verborgen; Fokus/Einstellen merkt der Speicher der WebView (backingtrack.layout): ein Neuladen bleibt ein Neuladen.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { addChordByName, wheelPoint } from './chord-helpers.js';
import { openTags } from './style-helpers.js';
import { contexts, countContexts, failStarts } from './count-helpers.js';
import { layoutWheel } from '../../app/ui/wheel-geometry.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
});

const start = (page) => page.locator('#start');
const play = (page) => page.locator('#play');
const playGo = (page) => page.locator('#play-go');
// gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const shownChords = async (page) => { await answered(page); return (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim()); };
const progression = (page) => page.locator('#progression button');
const count = async (page) => { await answered(page); return progression(page).count(); };
const savedLayout = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')));
const modeSwitch = (page) => page.locator('#mode-switch');

// Spielseite über Los öffnen (im Fokus) und die Wiedergabe gleich stoppen
async function openWithGo(page) {
  await page.locator('#go').click();
  await expect(play(page)).toBeVisible();
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
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
  await expect(page.locator('#go')).toHaveText('Los'); // erst mit dem Stopp: die Seite hat ihn gezeichnet
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
  await answered(page); // das Select zeigt die Hand bis zur Antwort
  await expect(side).toHaveValue('D');
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
  const chords = await shownChords(page);
  expect(await progression(page).allTextContents()).toEqual(chords);
  await page.locator('#scale-select').selectOption('majorPentatonic');
  await answered(page);
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
  await answered(page); // das Select zeigt die Hand bis zur Antwort
  await expect(page.locator('#length')).toHaveValue('48');
  await page.locator('#rack #tuning-tempo').fill('120');
  await answered(page);
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
  await failStarts(page);
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
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
  await page.waitForFunction(() => window.__failedStarts === 2); // der zweite Start ist gescheitert und gezeichnet: Startseite und Meldung stünden auch vorher da
  await expect(start(page)).toBeVisible();
  await expect(page.locator('#message')).toHaveText('Die Wiedergabe konnte nicht starten.');
});

test('leere Meldung in der Kopfzeile: gerendert, aber ohne Platz (360 px, dort bricht sie in eine eigene Zeile)', async ({ page }) => {
  await failStarts(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
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
  await chooseLanguage(page, 'en');
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

  // Was die Seite der App noch aus dem localStorage liest: Fokus/Einstellen und das Griffbrett (backingtrack.layout), die Sprache
  // (backingtrack.lang) und die Einträge der alten Seite für die einmalige Übernahme; beide Fälle bleiben ein Neuladen der WebView.
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
    await chooseLanguage(page, 'en');
    await expect(modeSwitch(page)).toHaveAccessibleName('Setup');
    expect(await rawKeys()).toEqual([]);
  });

  test('beim Spielen keine DOM-Schreibvorgänge je Takt an Schalter, Seite und Rack', async ({ page }) => {
    await page.locator('#tune-btn').click();
    await page.locator('#tuning-tempo').fill('200');
    await playGo(page).click();
    await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
    await settled(page); // die Antworten und der Start sind gezeichnet: gezählt wird nur, was je Takt geschrieben wird
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
    // die Sprachtasten der Seite stehen in der App verborgen (die Leiste der App wählt die Sprache): die Seite hängt sie wie die Web-App in die
    // Kopfleiste der Spielseite und zurück in die obere Leiste; ein Wechsel lässt den Fokus, wo er in der Seite war
    const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
    await page.locator('#tune-btn').click();
    const en = page.locator('[data-lang="en"]');
    await expect(page.locator('.play-head .lang')).toBeAttached();
    await expect(page.locator('header.top')).toBeHidden();
    let before = await focused();
    await chooseLanguage(page, 'en');
    await expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(await focused()).toBe(before);
    await page.locator('#play-back').click();
    await expect(page.locator('header.top .lang')).toBeAttached();
    before = await focused();
    await chooseLanguage(page, 'de');
    await expect(page.locator('[data-lang="de"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await focused()).toBe(before);
  });
});

test('Tonart-Modul und Kopfleiste: Tonart, Skala, Teil; bei laufender Wiedergabe folgender Akkord und Countdown, gestoppt leer', async ({ page }) => {
  await page.locator('#tune-btn').click();
  while (await count(page) > 1) await progression(page).first().click();
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
  await chooseLanguage(page, 'en');
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect.poll(() => page.locator('#play-countdown').textContent(), { timeout: 3 * BAR_TIMEOUT, intervals: [50] }).toMatch(/^in \d+ beats?$/);
  await playGo(page).click();
});

test('Akkordkreis: jetziger Akkord pink, nächster türkis gefüllt; darunter die Folge als Spans mit Rollen-Klassen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  while (await count(page) > 1) await progression(page).first().click();
  for (const name of ['Am', 'Am', 'Dm', 'E']) await addChordByName(page, name);
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(['Am', 'Am', 'Dm', 'E']);
  await page.locator('#tuning-tempo').fill('200');
  await expect(page.locator('#wheel-prog > span')).toHaveCount(4);
  await expect(page.locator('#wheel-prog button')).toHaveCount(0); // nur Anzeige, keine zweite Bedienung
  await playGo(page).click();

  const size = (await page.locator('#wheel').boundingBox()).width;
  // der Platz eines Akkords: die Geometrie der Seite, der Knoten aus derived().wheel (erlaubter Akkord an ihm)
  const { nodes: drawn } = (await fromSession(page, 'derived')).wheel;
  const nodes = layoutWheel(size).nodes;
  const where = { Am: ['inner', 'A', 'min'], Dm: ['inner', 'D', 'min'], E: ['outer', 'E', 'maj'] };
  // Farbe einen halben Knotenradius links vom Mittelpunkt (dort steht kein Text)
  const colorAt = (name) => {
    const [ring, root, quality] = where[name];
    const n = nodes[drawn.findIndex((x) => x.ring === ring && x.allowed?.root === root && x.allowed?.quality === quality)];
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

// ---------- Eingaben schneller als die Antwort (Task 33f): jede zählt, wie in der Web-App ----------
// Die Seite der Web-App hält mit dem Klick an (src/ui/app.js stop() 159–167 setzt state.playing sofort auf false); die Seite der App erfährt es aus
// der nächsten Meldung der Engine. Beide Klicks kommen hier in einer Aufgabe der Seite: keine Meldung kann dazwischen kommen. Gespielt wird, wenn die
// Hülle alles getan hat (settled); ein neuer Start trägt eine neue Nummer (run).
const twice = (page, id) => page.evaluate((i) => { const b = document.getElementById(i); b.click(); b.click(); }, id);

test('Zwei schnelle Klicks auf Stopp auf der Spielseite: die Wiedergabe hält an und beginnt von vorn, im Vorlauf steht nichts vom alten Lauf', async ({ page }) => {
  // die Web-App: der erste Klick hält an und leert Takt, Akkord und Countdown (stop() 159–168: state.current null), der zweite findet
  // state.playing falsch und startet (play-go, app.js 325–329); Takt und Akkord kommen erst wieder mit dem ersten Takt (onBar 136)
  await page.locator('#tune-btn').click();
  await playGo(page).click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  await settled(page);
  const { run } = await fromSession(page, 'engine');
  // was die Seite bei jeder Meldung der Engine zeigt, von den Klicks bis zur ersten, die nach Stand oder Vorlauf wieder läuft (dort zeichnet
  // sie den ersten Takt des neuen Starts); die Meldungen alter Läufe kommen davor
  await page.evaluate(() => {
    const got = (window.__lead = []);
    let phase = 'old';
    window.__JUCE__.backend.addEventListener('engine', (m) => {
      if (phase === 'done') return;
      if (!m.playing || m.standing) phase = 'between';
      else if (phase === 'between') { phase = 'done'; return; }
      got.push(['play-position', 'play-now', 'play-countdown'].map((id) => document.getElementById(id).textContent).join(' | '));
    });
    const b = document.getElementById('play-go');
    b.click();
    b.click();
  });
  await settled(page);
  const lead = await page.evaluate(() => window.__lead);
  const engine = await fromSession(page, 'engine');
  expect(engine.playing).toBe(true);
  expect(engine.run).toBeGreaterThan(run);
  expect(lead.length, 'Meldungen zwischen den Klicks und dem ersten Takt').toBeGreaterThan(0);
  expect(lead.filter((shown) => shown !== ' |  | '), 'Takt, Akkord, Countdown bei diesen Meldungen').toEqual([]);
  await expect(page.locator('#play-position'), 'die Anzeige nach dem neuen Start').toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
});

test('Zwei schnelle Klicks auf Stopp auf der Startseite: die Wiedergabe hält an, beginnt von vorn und öffnet die Spielseite', async ({ page }) => {
  // die Web-App: der erste Klick hält an und bleibt (go, app.js 316–320), der zweite startet und öffnet die Spielseite (321–322)
  await page.locator('#go').click();
  await expect(playGo(page)).toHaveText('Stopp');
  await page.locator('#play-back').click();
  await expect(start(page)).toBeVisible();
  await settled(page);
  const { run } = await fromSession(page, 'engine');
  await twice(page, 'go');
  await settled(page);
  const engine = await fromSession(page, 'engine');
  expect(engine.playing).toBe(true);
  expect(engine.run).toBeGreaterThan(run);
  await expect(play(page)).toBeVisible();
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
});
