// Startseite im Rack: zwei Module (Satz, Spielen), Überrasch mich, Zuletzt gespielt mit Weitermachen (gemerkte Sitzung).
// Portiert aus tests/e2e/start.spec.js: die App lädt ihre Seite; die gemerkte Sitzung liegt in session.json im Speicher der App (nicht im
// localStorage), ein Neuladen, das das Merken beweist, ist ein Neustart der App; gelesen wird, wenn die Seite die Antworten auf ihre Aktionen
// zeigt; die Sprache wählt die Leiste der App.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';

const BAR_TIMEOUT = 15_000;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await expect(page.locator('#go')).toHaveText(/\S/);
});

const sentence = async (page) => { await answered(page); return Promise.all(['#key-btn', '#style-btn', '#tempo-btn'].map((id) => page.locator(id).textContent())); };
const variant = async (page) => { await answered(page); return page.locator('#variant').inputValue(); };
const position = (page) => page.locator('#play-position');
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);

async function chooseStyle(page, name) {
  await page.locator('#style-btn').click();
  await page.locator('#style-cards').getByRole('button', { name }).click();
  await answered(page);
  await expect(page.locator('#style-btn')).toHaveText(name);
}
async function chooseTempo(page, bpm) {
  await page.locator('#tempo-btn').click();
  await page.locator('#tempo').fill(String(bpm));
  await page.keyboard.press('Escape');
  await answered(page); // die Taste zeigt die Hand des Reglers bis zur Antwort
  await expect(page.locator('#tempo-btn')).toHaveText(`${bpm} bpm`);
}

test('Startseite im Rack: zwei Module nebeneinander mit Titel, Werte des Satzes als Displays, die Seite scrollt nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('region', { name: 'Start', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Spielen', exact: true })).toBeVisible();
  const [left, right] = await Promise.all(['#mod-start', '#mod-go'].map((s) => page.locator(s).boundingBox()));
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(left.height - right.height)).toBeLessThanOrEqual(1);
  for (const id of ['#key-btn', '#style-btn', '#tempo-btn']) {
    expect(await page.locator(id).evaluate((el) => getComputedStyle(el).backgroundColor), id).toBe('rgb(22, 26, 20)'); // LCD
  }
  expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }))).toEqual({ x: 0, y: 0 });
  await expect(page.locator('#surprise')).toHaveText('Überrasch mich');
  await expect(page.locator('#tune-btn')).toHaveText('Einstellen');
  await expect(page.locator('#last')).toBeHidden(); // erster Besuch: nichts gemerkt
  await chooseLanguage(page, 'en');
  await expect(page.locator('#surprise')).toHaveText('Surprise me');
  await expect(page.locator('#mod-go-title')).toHaveText('Play');
});

test('Überrasch mich würfelt Tonart, Stil, Tempo und Variante neu; die Sitzung bleibt spielbar', async ({ page }) => {
  const seen = new Set();
  const before = { sentence: await sentence(page), variant: await variant(page) };
  for (let i = 0; i < 6; i++) {
    await page.locator('#surprise').click();
    seen.add(JSON.stringify([await sentence(page), await variant(page)]));
    await expect(page.locator('#message')).toBeEmpty();
    const bpm = Number((await page.locator('#tempo-btn').textContent()).match(/\d+/)[0]);
    expect(bpm).toBeGreaterThanOrEqual(40);
    expect(bpm).toBeLessThanOrEqual(200);
  }
  expect(seen.size).toBeGreaterThanOrEqual(5); // jeder Wurf ist (so gut wie) anders
  expect(seen.has(JSON.stringify([before.sentence, before.variant]))).toBe(false);
  await page.locator('#go').click();
  await expect(position(page)).toHaveText(/^Takt \d+ von \d+$/, { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('Überrasch mich lässt stehen, was auf der Startseite selbst gewählt wurde: Stil, Tempo, Tonart, Variantennummer', async ({ page }) => {
  await chooseStyle(page, 'Träumerisch, langsam');
  await chooseTempo(page, 77);
  await page.locator('#variant').fill('1234');
  await page.locator('#variant').press('Enter');
  const keys = new Set();
  for (let i = 0; i < 6; i++) {
    await page.locator('#surprise').click();
    await answered(page); // was stehen bleibt, stünde auch vor der Antwort da
    await expect(page.locator('#style-btn')).toHaveText('Träumerisch, langsam');
    await expect(page.locator('#tempo-btn')).toHaveText('77 bpm');
    expect(await variant(page)).toBe('1234');
    keys.add(await page.locator('#key-btn').textContent());
  }
  expect(keys.size).toBeGreaterThan(1); // die Tonart wurde nicht angefasst und wird gewürfelt
  // jetzt auch die Tonart wählen: nichts ändert sich mehr
  await page.locator('#key-btn').click();
  await page.locator('#key-chips').getByRole('button', { name: 'D', exact: true }).click();
  await page.keyboard.press('Escape');
  const fixed = await sentence(page);
  for (let i = 0; i < 4; i++) {
    await page.locator('#surprise').click();
    expect(await sentence(page)).toEqual(fixed);
  }
});

test('Weitermachen: die Sitzung wird beim Stopp gemerkt, übersteht das Neuladen und spielt am gemerkten Takt weiter', async ({ page, app }) => {
  await chooseStyle(page, 'Classic Rock');
  await chooseTempo(page, 200);
  await page.locator('#variant').fill('4321');
  await page.locator('#variant').press('Enter');
  await page.locator('#go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(3);
  await page.locator('#play-go').click(); // Stopp merkt die Sitzung
  // die App schreibt sie nach dem Stopp in ihren Speicher (die Web-App sofort in den localStorage)
  const file = join(app.folder, 'session.json');
  await expect.poll(() => existsSync(file)).toBe(true);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  expect(saved.bar).toBeGreaterThanOrEqual(2);
  expect(saved.parts.variant.seed).toBe(4321);
  await page.locator('#play-back').click();
  await expect(page.locator('#last')).toBeVisible();
  const summary = await page.locator('#last-summary').textContent();
  expect(summary).toContain('Classic Rock');
  expect(summary).toContain('200 bpm');
  expect(summary).toContain('Variante 4321');
  expect(summary).toContain(`Takt ${saved.bar + 1}`);

  page = await app.restart();
  await expect(page.locator('#go')).toHaveText(/\S/);
  await expect(page.locator('#style-btn')).toHaveText('Funk-Rock'); // die Seite beginnt wie immer
  await expect(page.locator('#last-summary')).toHaveText(summary);
  await expect(page.getByRole('button', { name: 'Weitermachen' })).toBeVisible();
  await page.evaluate(() => {
    window.__bars = [];
    const el = document.querySelector('#play-position');
    new MutationObserver(() => window.__bars.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#resume').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play')).toHaveAttribute('data-mode', 'focus');
  await expect(position(page)).toHaveText(/^Takt \d+ von \d+$/, { timeout: BAR_TIMEOUT });
  const first = (await page.evaluate(() => window.__bars)).find((text) => /^Takt/.test(text));
  expect(first).toMatch(new RegExp(`^Takt ${saved.bar + 1} von`)); // beginnt am gemerkten Takt
  await expect(page.locator('#play-variant')).toContainText('4321');
  await page.locator('#play-go').click();
  await page.locator('#play-back').click();
  await settled(page); // der Stopp ist getan (er merkt die Sitzung); was stehen bleibt, stünde auch vorher da
  await expect(page.locator('#style-btn')).toHaveText('Classic Rock');
  await expect(page.locator('#tempo-btn')).toHaveText('200 bpm');
});

test('Zuletzt gespielt: kaputter oder unvollständiger Speicher zeigt nichts und stört nicht', async ({ page, app }) => {
  for (const raw of ['{kaputt', '{"parts":{"tempo":{"bpm":100}},"bar":3}', '[]', '7']) {
    page = await app.restart({ 'session.json': raw });
    await expect(page.locator('#go')).toHaveText(/\S/);
    await expect(page.locator('#last'), raw).toBeHidden();
  }
});

test('Stopp, gleich Weitermachen und gleich wieder Stopp auf der Startseite: die Wiedergabe steht', async ({ page }) => {
  // die Web-App: Stopp hält an und merkt die Sitzung (stop() 159–169), Weitermachen spielt sie gleich wieder (resume 226–236, die Packs sind
  // geladen: start() im Klick), der dritte Klick findet sie spielend und hält an (go 316–320). Alle drei in einer Aufgabe der Seite: keine
  // Meldung der Engine kommt dazwischen
  await page.locator('#go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(1);
  await page.locator('#play-back').click();
  await settled(page);
  await page.evaluate(() => { for (const id of ['go', 'resume', 'go']) document.getElementById(id).click(); });
  await settled(page);
  expect((await fromSession(page, 'engine')).playing).toBe(false);
});
