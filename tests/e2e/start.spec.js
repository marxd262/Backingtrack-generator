// Startseite im Rack: zwei Module (Satz, Spielen), Überrasch mich, Zuletzt gespielt mit Weitermachen (gemerkte Sitzung).
import { test, expect } from '@playwright/test';

const BAR_TIMEOUT = 15_000;
let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const sentence = (page) => Promise.all(['#key-btn', '#style-btn', '#tempo-btn'].map((id) => page.locator(id).textContent()));
const variant = (page) => page.locator('#variant').inputValue();
const position = (page) => page.locator('#play-position');
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);

async function chooseStyle(page, name) {
  await page.locator('#style-btn').click();
  await page.locator('#style-cards').getByRole('button', { name }).click();
  await expect(page.locator('#style-btn')).toHaveText(name);
}
async function chooseTempo(page, bpm) {
  await page.locator('#tempo-btn').click();
  await page.locator('#tempo').fill(String(bpm));
  await page.keyboard.press('Escape');
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
  await page.getByRole('button', { name: /^EN/i }).click();
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

test('Weitermachen: die Sitzung wird beim Stopp gemerkt, übersteht das Neuladen und spielt am gemerkten Takt weiter', async ({ page }) => {
  await chooseStyle(page, 'Classic Rock');
  await chooseTempo(page, 200);
  await page.locator('#variant').fill('4321');
  await page.locator('#variant').press('Enter');
  await page.locator('#go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(3);
  await page.locator('#play-go').click(); // Stopp merkt die Sitzung
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.session')));
  expect(saved.bar).toBeGreaterThanOrEqual(2);
  expect(saved.parts.variant.seed).toBe(4321);
  await page.locator('#play-back').click();
  await expect(page.locator('#last')).toBeVisible();
  const summary = await page.locator('#last-summary').textContent();
  expect(summary).toContain('Classic Rock');
  expect(summary).toContain('200 bpm');
  expect(summary).toContain('Variante 4321');
  expect(summary).toContain(`Takt ${saved.bar + 1}`);

  await page.reload();
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
  await expect(page.locator('#style-btn')).toHaveText('Classic Rock');
  await expect(page.locator('#tempo-btn')).toHaveText('200 bpm');
});

test('Zuletzt gespielt: kaputter oder unvollständiger Speicher zeigt nichts und stört nicht', async ({ page }) => {
  for (const raw of ['{kaputt', '{"parts":{"tempo":{"bpm":100}},"bar":3}', '[]', '7']) {
    await page.evaluate((value) => localStorage.setItem('backingtrack.session', value), raw);
    await page.reload();
    await expect(page.locator('#go')).toHaveText(/\S/);
    await expect(page.locator('#last'), raw).toBeHidden();
  }
});
