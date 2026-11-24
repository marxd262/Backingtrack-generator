// Akkordfarbe der Stil-Vorlagen auf der Spielseite (echte Seite der App): der Stil bringt seine Farbe mit, variety wählt
// in etwa jeder vierten Variante die Ausweichfarbe, eine selbst gewählte Farbe bleibt.
// Portiert aus tests/e2e/style-color.spec.js: die App lädt ihre Seite; was der Test aus src/core rechnete (die Farbe des Stils, die Folge des
// Seeds in einer Farbe), rechnet der Kern der App (core.js); AudioContexts und Instrumentensätze zählt count-helpers.js.
import { test, expect, answered, fromSession } from './fixture.js';
import { addChordByName } from './chord-helpers.js';
import { chooseStyle } from './style-helpers.js';
import { contexts, countContexts, sets } from './count-helpers.js';
import { core } from './core.js';

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
// gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const shown = async (page) => { await answered(page); return page.locator('#progression button').allTextContents(); };
const seedOf = async (page) => { await answered(page); return Number(await page.locator('#variant').inputValue()); };
const pressedColor = async (page) => { await answered(page); return page.locator('#chord-color [aria-pressed="true"]').getAttribute('data-color'); };
// die Farbe des Stils für den Seed (styleChordColor mit variety): der Stil in einer frischen Sitzung auf dem Seed, gewählt wie mit der Karte der
// Startseite (sie löst auch auf dem Stil, der schon gilt, aus: so kann core() eine Ablehnung erkennen)
const styleColor = (id, seed) => core([{ action: 'start', variant: seed }, { action: 'setStyle', style: id, from: 'start' }]).at(-1).chordColor;
// erwartete Folge: die vom Seed erzeugten Dreiklänge in der Farbe (eine frische Sitzung auf dem Seed in der Tonart; die Namen der Tonart aus derived())
const expected = async (page, key, seed, c) => {
  const steps = [{ action: 'start', variant: seed }, ...(key.root === 'A' ? [] : [{ action: 'setRoot', root: key.root, from: 'play' }]), { action: 'setChordColor', color: c }];
  const { chordOptions } = await fromSession(page, 'derived');
  return core(steps).at(-1).track.bars.map(({ chord }) => chordOptions.find((o) => o.root === chord.root)?.names[chord.quality]);
};

test('Stil Blues setzt seine Farbe und färbt die Folge, Funk stellt auf Dreiklänge zurück', async ({ page }) => {
  await chooseStyle(page, 'blues');
  const seed = await seedOf(page);
  const c = styleColor('blues', seed);
  expect(await pressedColor(page)).toBe(c);
  expect(await shown(page)).toEqual(await expected(page, AM, seed, c));
  await chooseStyle(page, 'funk');
  expect(await pressedColor(page)).toBe('triads');
  expect(await shown(page)).toEqual(await expected(page, AM, seed, 'triads'));
});

test('Hardrock färbt auf Powerchords (oder Ausweichfarbe), andere Stile bleiben bei Dreiklängen', async ({ page }) => {
  await chooseStyle(page, 'hardrock');
  const seed = await seedOf(page);
  expect(await pressedColor(page)).toBe(styleColor('hardrock', seed));
  for (const id of ['rock', 'country', 'reggae', 'psych', 'dreamy']) {
    await chooseStyle(page, id);
    expect(await pressedColor(page), id).toBe('triads');
  }
});

test('eine von Hand geänderte Folge wird beim Stilwechsel umgefärbt, nicht neu erzeugt', async ({ page }) => {
  await chooseStyle(page, 'blues');
  await addChordByName(page, 'G');
  const before = await shown(page);
  await chooseStyle(page, 'hardrock');
  const after = await shown(page);
  expect(after).toHaveLength(before.length);
  expect(after.at(-1)).toMatch(/^G(5)?$/); // Powerchord G5 oder, bei der Ausweichfarbe, der Dreiklang G
});

test('Variantenwechsel: Blues zeigt beide Farben, Funk nie eine andere als Dreiklänge', async ({ page }) => {
  await chooseStyle(page, 'blues');
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    seen.add(await pressedColor(page));
    await page.locator('#variant-next').click();
  }
  expect([...seen].sort()).toEqual(['extended', 'sevenths']);
  await chooseStyle(page, 'funk');
  for (let i = 0; i < 12; i++) {
    expect(await pressedColor(page)).toBe('triads');
    await page.locator('#variant-next').click();
  }
});

test('eine selbst gewählte Farbe bleibt über Variantenwechsel und wird vom nächsten Stil wieder überschrieben', async ({ page }) => {
  await chooseStyle(page, 'blues');
  await color(page, 'triads').click();
  for (let i = 0; i < 12; i++) {
    await page.locator('#variant-next').click();
    expect(await pressedColor(page)).toBe('triads');
  }
  await chooseStyle(page, 'blues');
  expect(['sevenths', 'extended']).toContain(await pressedColor(page));
});

test('während der Wiedergabe: Stilwahl bringt die Farbe live, ohne neuen Instrumentensatz', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await chooseStyle(page, 'hardrock');
  expect(['power', 'triads']).toContain(await pressedColor(page));
  expect(await sets(page)).toBe(1);
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Stil von der Startseite aus: dieselbe Farbe wie beim Laden des Werksprofils', async ({ page }) => {
  await page.locator('#play-back').click();
  await page.locator('#style-btn').click();
  await page.locator('#style-cards [data-style="poppunk"]').click();
  await page.locator('#tune-btn').click();
  expect(await pressedColor(page)).toBe(styleColor('poppunk', await seedOf(page)));
});
