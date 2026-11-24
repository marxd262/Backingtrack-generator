// Akkordfarbe der Spielseite (echte Seite der App): eine Einstellung, die die ganze Folge umfärbt und für neu erzeugte Folgen gilt.
// Portiert aus tests/e2e/chord-color.spec.js: die App lädt ihre Seite; was der Test aus src/core rechnete (die Folge des Seeds in einer Farbe),
// rechnet der Kern der App (core.js); gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts zählt count-helpers.js;
// die Sprache wählt die Leiste der App.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { addChordByName } from './chord-helpers.js';
import { contexts, countContexts } from './count-helpers.js';
import { core } from './core.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const AM = { root: 'A', mode: 'minor' };

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
});

const color = (page, id) => page.locator(`#chord-color [data-color="${id}"]`);
const progression = (page) => page.locator('#progression button');
// gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const shown = async (page) => { await answered(page); return progression(page).allTextContents(); };
const count = async (page) => { await answered(page); return progression(page).count(); };
const seedOf = async (page) => { await answered(page); return Number(await page.locator('#variant').inputValue()); };
// erwartete Folge: die vom Seed erzeugten Dreiklänge in der Farbe (eine frische Sitzung auf dem Seed in der Tonart; die Namen der Tonart aus derived())
const expected = async (page, key, seed, c) => {
  const steps = [{ action: 'start', variant: seed }, ...(key.root === 'A' ? [] : [{ action: 'setRoot', root: key.root, from: 'play' }]), { action: 'setChordColor', color: c }];
  const { chordOptions } = await fromSession(page, 'derived');
  return core(steps).at(-1).track.bars.map(({ chord }) => chordOptions.find((o) => o.root === chord.root)?.names[chord.quality]);
};

test('vier Farben als Chips, Dreiklänge gedrückt am Anfang', async ({ page }) => {
  expect(await page.locator('#chord-color button').allTextContents()).toEqual(['Dreiklänge', 'Septakkorde', 'Erweiterungen', 'Powerchords']);
  await expect(color(page, 'triads')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#chord-color [aria-pressed="true"]')).toHaveCount(1);
});

test('Septakkorde färben die Folge um, Dreiklänge stellen sie zurück', async ({ page }) => {
  const seed = await seedOf(page);
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'triads'));
  await color(page, 'sevenths').click();
  await answered(page);
  await expect(color(page, 'sevenths')).toHaveAttribute('aria-pressed', 'true');
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'sevenths'));
  expect((await shown(page)).every((n) => /7|m7b5/.test(n))).toBe(true);
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'triads'));
  await color(page, 'extended').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'extended'));
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'triads'));
  await color(page, 'power').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'power'));
  // auch von Powerchords zurück ist die unveränderte Folge verlustfrei (sie wird neu abgeleitet, E5 würde sonst zu Em)
  await color(page, 'triads').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'triads'));
});

test('Wechsel über Powerchords zu Septakkorden ergibt dieselbe Folge wie direkt (die Dominante geht nicht verloren)', async ({ page }) => {
  const seed = await seedOf(page);
  await color(page, 'power').click();
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'sevenths'));
  await color(page, 'power').click();
  await color(page, 'extended').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'extended'));
  // derselbe Seed, dieselbe Farbe: nach Variantenwechsel hin und zurück bleibt die Folge gleich
  await page.locator('#variant-next').click();
  await page.locator('#variant-prev').click();
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'extended'));
});

test('eine von Hand geänderte Folge wird beim Farbwechsel umgefärbt, nicht neu erzeugt', async ({ page }) => {
  await color(page, 'sevenths').click();
  const before = await shown(page);
  await addChordByName(page, 'G');
  await color(page, 'extended').click();
  const after = await shown(page);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toBe('Gadd9');
});

test('Variantenwechsel und Tonartwechsel behalten die Farbe', async ({ page }) => {
  await color(page, 'sevenths').click();
  await page.locator('#variant-next').click();
  expect(await shown(page)).toEqual(await expected(page, AM, await seedOf(page), 'sevenths'));
  await page.locator('#key-select').selectOption('D');
  expect(await shown(page)).toEqual(await expected(page, { root: 'D', mode: 'minor' }, await seedOf(page), 'sevenths'));
  await expect(color(page, 'sevenths')).toHaveAttribute('aria-pressed', 'true');
});

test('von Hand Angefügtes bleibt bis zur nächsten Ableitung; erneutes Wählen der Farbe färbt es', async ({ page }) => {
  await color(page, 'sevenths').click();
  const before = await shown(page);
  await addChordByName(page, 'G');
  expect(await shown(page)).toEqual([...before, 'G']);
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual([...before, 'Gmaj7']);
  await page.locator('#variant-next').click();
  expect(await shown(page)).toEqual(await expected(page, AM, await seedOf(page), 'sevenths'));
});

test('während der Wiedergabe: Farbwahl startet neu im selben AudioContext', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await contexts(page)).toBe(1);
  await color(page, 'extended').click();
  await settled(page);
  await expect(color(page, 'extended')).toHaveAttribute('aria-pressed', 'true');
  expect(await contexts(page)).toBe(1);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('Griffbrett nennt gefärbte Akkorde mit ihren Tönen', async ({ page }) => {
  while ((await count(page)) > 1) await progression(page).first().click();
  await addChordByName(page, 'Am');
  await addChordByName(page, 'E');
  await progression(page).first().click();
  await color(page, 'sevenths').click();
  expect(await shown(page)).toEqual(['Am7', 'E7']);
  await expect(page.locator('#fretboard-text')).toContainText('Am7');
  await expect(page.locator('#fretboard-text')).toContainText('A, C, E, G');
  await expect(page.locator('#fretboard-text')).toContainText('E, G#, B, D');
});

test('Tastatur und beide Sprachen ohne rohe Schlüssel', async ({ page }) => {
  await color(page, 'power').focus();
  await page.keyboard.press('Enter');
  await answered(page);
  await expect(color(page, 'power')).toHaveAttribute('aria-pressed', 'true');
  await chooseLanguage(page, 'en');
  expect(await page.locator('#chord-color button').allTextContents()).toEqual(['Triads', 'Sevenths', 'Extended', 'Power chords']);
  await expect(page.getByRole('heading', { name: 'Chord colour' })).toBeVisible();
  for (const text of await page.locator('#chord-color button, #add-chords button, #add-chords .sub-label').allTextContents()) {
    expect(RAW_KEY.test(text.trim()), text).toBe(false);
  }
});
