// Streifen der Songform und Einstellungen des gewählten Teils auf der Spielseite (echte Seite /ui/index.html).
import { test, expect } from '@playwright/test';
import { countingScript, recordPositions, positionsSince, shownBar, expectContinuous, sets, contexts } from './count-helpers.js';

const RAW_KEY = /\b(ui|form|group)\.[A-Za-z.]+\b/;
const BAR_TIMEOUT = 10_000;

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(countingScript);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await expect(page.locator('#side-left')).toBeVisible();
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const strip = (page) => page.locator('#form-strip');
const parts = (page) => page.locator('#form-strip [role="option"]');
const position = (page) => page.locator('#play-position');
const form = (page) => page.evaluate(async () => structuredClone((await import('/ui/state.js')).state.track.form ?? null));
const trackLength = (page) => page.evaluate(async () => (await import('/ui/state.js')).state.track.length);
const sum = (f) => f.sections.reduce((s, x) => s + x.bars, 0);
const types = (f) => f.sections.map((s) => s.type);
const rerender = (page) => page.locator('[data-lang="de"]').first().click();
// Form direkt in den Zustand schreiben (Teile als [Typ, Takte, Zusatz]) und neu zeichnen lassen
async function setForm(page, list) {
  await page.evaluate(async (items) => {
    const { state } = await import('/ui/state.js');
    const sections = items.map(([type, bars, extra]) => ({ type, bars, ...extra }));
    state.track.form = { template: 'pop', auto: false, feel: { ...state.formFeel }, sections };
    state.track.length = sections.reduce((n, s) => n + s.bars, 0);
    state.formTarget = 96;
  }, list);
  await rerender(page);
}
const FORM96 = [['intro', 4], ['verse', 12], ['build', 8], ['chorus', 16], ['verse', 16], ['break', 8], ['chorus', 24], ['outro', 8]];
const pick = (page, i) => parts(page).nth(i).click();
const setVariant = (page, n) => page.evaluate((seed) => {
  const input = document.getElementById('variant');
  input.value = String(seed);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, n);
const slider = (page, id) => page.locator(`#${id}`);

test('Streifen zeigt die Teile der Form der Reihe nach, Breite proportional zu den Takten, Höhe nach Pegel, Farbe nach Typ', async ({ page }) => {
  await setForm(page, FORM96);
  await expect(strip(page)).toBeVisible();
  await expect(parts(page)).toHaveCount(8);
  expect(await parts(page).locator('.form-part-name').allTextContents()).toEqual(['Intro', 'Strophe', 'Aufbau', 'Refrain', 'Strophe', 'Break', 'Refrain', 'Outro']);
  expect(await parts(page).locator('.form-part-bars').allTextContents()).toEqual(['4', '12', '8', '16', '16', '8', '24', '8']);
  const boxes = await parts(page).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }));
  const total = boxes.reduce((s, b) => s + b.w, 0);
  const bars = [4, 12, 8, 16, 16, 8, 24, 8];
  boxes.forEach((b, i) => expect(Math.abs(b.w - (bars[i] / 96) * total), `Teil ${i}`).toBeLessThanOrEqual(2));
  // lückenlos nebeneinander in Reihenfolge
  for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i].x - (boxes[i - 1].x + boxes[i - 1].w))).toBeLessThanOrEqual(2);
  // Refrain am höchsten (0 dB), Break, Intro niedriger
  expect(boxes[3].h).toBeGreaterThan(boxes[1].h);
  expect(boxes[1].h).toBeGreaterThan(boxes[5].h);
  expect(boxes[1].h).toBeGreaterThan(boxes[0].h);
  // Farbe nach Typ: Refrain, Strophe, Aufbau, Break, Intro, Outro verschieden
  const colors = await parts(page).evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(new Set([colors[0], colors[1], colors[2], colors[3], colors[5], colors[7]]).size).toBe(6);
  expect(colors[1]).toBe(colors[4]);
});

test('Streifen liegt auf derselben Takt-Achse wie die Leinwand der Spuren (linke und rechte Kante)', async ({ page }) => {
  await setForm(page, FORM96);
  const edges = await page.evaluate(() => {
    const e = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { left: r.left, right: r.right }; };
    const first = document.querySelector('#form-strip [role="option"]').getBoundingClientRect();
    const last = document.querySelector('#form-strip [role="option"]:last-child').getBoundingClientRect();
    return { strip: e('#form-strip'), canvas: e('#lanes'), first: first.left, last: last.right };
  });
  expect(Math.abs(edges.strip.left - edges.canvas.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.strip.right - edges.canvas.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.first - edges.canvas.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(edges.last - edges.canvas.right)).toBeLessThanOrEqual(1);
});

test('Streifen ist eine Listbox: Optionen, genau eine ausgewählt und im Tab-Stopp (roving tabindex), Beschriftung nennt Name, Takte, Bereich', async ({ page }) => {
  await setForm(page, FORM96);
  await expect(strip(page)).toHaveAttribute('role', 'listbox');
  await expect(strip(page)).toHaveAttribute('aria-label', 'Teile des Songs');
  expect(await parts(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-selected')))).toEqual(['true', ...Array(7).fill('false')]);
  expect(await parts(page).evaluateAll((els) => els.map((el) => el.tabIndex))).toEqual([0, ...Array(7).fill(-1)]);
  await expect(parts(page).nth(3)).toHaveAttribute('aria-label', 'Refrain, 16 Takte, Takte 25 bis 40');
  await expect(page.getByRole('option', { name: 'Intro, 4 Takte, Takte 1 bis 4' })).toHaveCount(1);
});

test('Tastatur: Pfeile, Pos1, Ende wählen den Teil, Enter und Leertaste wählen den fokussierten, Tab führt zu den Einstellungen', async ({ page }) => {
  await setForm(page, FORM96);
  const selected = () => parts(page).evaluateAll((els) => els.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
  await parts(page).nth(0).focus();
  await page.keyboard.press('ArrowRight');
  expect(await selected()).toBe(1);
  await expect(parts(page).nth(1)).toBeFocused();
  await expect(page.locator('#form-insp-title')).toHaveText('Strophe, Takte 5 bis 16');
  await page.keyboard.press('End');
  expect(await selected()).toBe(7);
  await page.keyboard.press('ArrowRight'); // am Ende bleibt es
  expect(await selected()).toBe(7);
  await page.keyboard.press('ArrowLeft');
  expect(await selected()).toBe(6);
  await page.keyboard.press('Home');
  expect(await selected()).toBe(0);
  await parts(page).nth(4).focus(); // programmatisch fokussiert, nicht gewählt
  expect(await selected()).toBe(0);
  await page.keyboard.press('Enter');
  expect(await selected()).toBe(4);
  await parts(page).nth(5).focus();
  await page.keyboard.press(' ');
  expect(await selected()).toBe(5);
  await expect(page.locator('#form-insp-title')).toHaveText('Break, Takte 57 bis 64');
  // nach dem Streifen kommen die Einstellungen
  await page.keyboard.press('Tab');
  await expect(page.locator('#part-type')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#part-shorter')).toBeFocused();
});

test('Auswahl per Klick hebt den Teil hervor und zeigt dessen Einstellungen', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 3);
  await expect(parts(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(parts(page).nth(3)).toHaveCSS('outline-style', 'solid');
  await expect(parts(page).nth(0)).toHaveCSS('outline-style', 'none');
  await expect(page.locator('#part-type')).toHaveValue('chorus');
  await expect(page.locator('#part-len-out')).toHaveText('16 Takte');
  await expect(page.locator('#part-crash')).toBeChecked(); // Refrain: Crash als Standard
  await pick(page, 1);
  await expect(page.locator('#part-crash')).not.toBeChecked();
  expect((await form(page)).sections.every((s) => !s.locked), 'Auswahl allein sperrt nichts').toBe(true);
});

test('Typ ändern sperrt den Teil und nur ihn; die Typ-Auswahl enthält nur die feste Liste', async ({ page }) => {
  await setForm(page, FORM96);
  expect(await page.locator('#part-type option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['intro', 'verse', 'build', 'chorus', 'break', 'outro']);
  await pick(page, 1);
  await page.locator('#part-type').selectOption('chorus');
  const f = await form(page);
  expect(f.sections[1]).toMatchObject({ type: 'chorus', bars: 12, locked: true });
  expect(f.sections.filter((s) => s.locked)).toHaveLength(1);
  await expect(parts(page).nth(1).locator('.form-part-name')).toHaveText('Refrain');
  await expect(parts(page).nth(1)).toHaveClass(/\blocked\b/);
  await expect(parts(page).nth(1)).toHaveAttribute('aria-label', /gesperrt$/);
  await expect(page.locator('#part-lock')).toHaveAttribute('aria-pressed', 'true');
  expect(await trackLength(page)).toBe(96);
});

test('Sperren schaltet nur die Sperre um', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 2);
  await page.locator('#part-lock').click();
  expect((await form(page)).sections[2]).toEqual({ type: 'build', bars: 8, locked: true });
  await page.locator('#part-lock').click();
  expect((await form(page)).sections[2].locked).toBe(false);
  await expect(page.locator('#part-lock')).toHaveAttribute('aria-pressed', 'false');
});

test('Länge ändern passt die Gesamtlänge, die Beschriftung des Teils und "Takt n von …" an', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 1);
  await page.locator('#part-longer').click();
  expect(await trackLength(page)).toBe(97);
  expect(sum(await form(page))).toBe(97);
  await expect(page.locator('#part-len-out')).toHaveText('13 Takte');
  await expect(parts(page).nth(1).locator('.form-part-bars')).toHaveText('13');
  await expect(parts(page).nth(1)).toHaveAttribute('aria-label', /^Strophe, 13 Takte, Takte 5 bis 17/);
  await expect(page.locator('#form-insp-title')).toHaveText('Strophe, Takte 5 bis 17');
  expect((await form(page)).sections[1].locked).toBe(true);
  await page.locator('#part-shorter').click();
  await page.locator('#part-shorter').click();
  expect(await trackLength(page)).toBe(95);
  // laufende Wiedergabe: genau ein Neustart an gleicher Stelle, die Zeile nennt die neue Länge
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(2);
  await recordPositions(page);
  const before = await shownBar(page);
  await positionsSince(page);
  await page.locator('#part-longer').click();
  await expect(position(page)).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  await expectContinuous(page, before, 'Länge');
  expect(await sets(page)).toBe(2);
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Länge: Stepper endet bei 1 und 64 Takten', async ({ page }) => {
  await setForm(page, [['verse', 2], ['chorus', 63]]);
  await pick(page, 0);
  await page.locator('#part-shorter').click();
  await expect(page.locator('#part-len-out')).toHaveText('1 Takt');
  await expect(page.locator('#part-shorter')).toBeDisabled();
  await pick(page, 1);
  await page.locator('#part-longer').click();
  await expect(page.locator('#part-len-out')).toHaveText('64 Takte');
  await expect(page.locator('#part-longer')).toBeDisabled();
  await expect(page.locator('#form-note')).toHaveText('Ein Teil hat höchstens 64 Takte.');
});

test('Pegel, Dichte, Übergang und Crash wirken live ohne Neustart; "Standard" bis zum Setzen, Zurücksetzen holt ihn zurück', async ({ page }) => {
  test.setTimeout(90_000);
  await setForm(page, [['intro', 4], ['verse', 44], ['chorus', 48]]);
  await pick(page, 1);
  await expect(page.locator('#part-level-out')).toHaveText('Standard (−3 dB)');
  await expect(page.locator('#part-level')).toHaveValue('-3');
  await expect(page.locator('#part-level-reset')).toBeDisabled();
  await expect(page.locator('#part-density-out')).toHaveText('Standard (−15 %)');
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(2);
  await recordPositions(page);
  expect(await sets(page)).toBe(1);

  const live = async (label, change) => {
    const before = await shownBar(page);
    await positionsSince(page);
    await change();
    await expectContinuous(page, before, label);
    expect(await sets(page), `${label}: kein neuer Instrumentensatz`).toBe(1);
    expect(await contexts(page), label).toBe(1);
    await expect(page.locator('#play-go')).toHaveText('Stopp');
  };
  await live('Pegel', () => slider(page, 'part-level').fill('-12'));
  let f = await form(page);
  expect(f.sections[1]).toMatchObject({ level: -12, locked: true });
  await expect(page.locator('#part-level-out')).toHaveText('−12 dB');
  await expect(page.locator('#part-level-reset')).toBeEnabled();
  await live('Dichte', () => slider(page, 'part-density').fill('40'));
  f = await form(page);
  expect(f.sections[1].density).toBeCloseTo(0.4);
  await expect(page.locator('#part-density-out')).toHaveText('40 %');
  await live('Übergang', () => page.locator('#part-transition').selectOption('stop'));
  expect((await form(page)).sections[1].transition).toBe('stop');
  await live('Crash', () => page.locator('#part-crash').check());
  expect((await form(page)).sections[1].crash).toBe(true);
  await live('Zurücksetzen', () => page.locator('#part-level-reset').click());
  f = await form(page);
  expect(f.sections[1]).not.toHaveProperty('level');
  expect(f.sections[1].locked).toBe(true);
  await expect(page.locator('#part-level-out')).toHaveText('Standard (−3 dB)');
  // Höhe des Blocks folgt dem Pegel
  const height = () => parts(page).nth(1).evaluate((el) => el.getBoundingClientRect().height);
  const standard = await height();
  await slider(page, 'part-level').fill('-24');
  expect(await height()).toBeLessThan(standard);
  await page.locator('#play-go').click();
});

test('Neu würfeln lässt gesperrte Teile unverändert und ändert die anderen', async ({ page }) => {
  await setVariant(page, 5);
  await pick(page, 0);
  await page.locator('#part-lock').click();
  const locked = (await form(page)).sections[0];
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    await page.locator('#form-roll').click();
    const f = await form(page);
    expect(f.sections[0], `Wurf ${i}`).toEqual(locked);
    expect(sum(f)).toBe(await trackLength(page));
    seen.add(JSON.stringify(f.sections.slice(1)));
  }
  expect(seen.size, 'andere Teile ändern sich').toBeGreaterThan(1);
  await expect(parts(page).first()).toHaveClass(/\blocked\b/);
});

test('Neu würfeln bei laufender Wiedergabe: derselbe Takt läuft weiter, ein AudioContext', async ({ page }) => {
  test.setTimeout(90_000);
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(2);
  await recordPositions(page);
  const before = await shownBar(page);
  await positionsSince(page);
  await page.locator('#form-roll').click();
  await expectContinuous(page, before, 'Neu würfeln');
  expect(await contexts(page)).toBe(1);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('Der letzte verbleibende Teil lässt sich nicht löschen', async ({ page }) => {
  await setForm(page, [['verse', 8], ['chorus', 8]]);
  await pick(page, 1);
  await expect(page.locator('#part-delete')).toBeEnabled();
  await page.locator('#part-delete').click();
  expect(types(await form(page))).toEqual(['verse']);
  expect(await trackLength(page)).toBe(8);
  await expect(parts(page)).toHaveCount(1);
  await expect(page.locator('#part-delete')).toBeDisabled();
  await expect(page.locator('#form-note')).toHaveText('Der letzte Teil bleibt stehen.');
  await page.locator('#part-delete').click({ force: true });
  expect(types(await form(page))).toEqual(['verse']);
});

test('Löschen entfernt den gewählten Teil, die Auswahl rückt nach und die Länge folgt', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 7);
  await page.locator('#part-delete').click();
  expect(await trackLength(page)).toBe(88);
  await expect(parts(page)).toHaveCount(7);
  await expect(parts(page).nth(6)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#form-insp-title')).toHaveText('Refrain, Takte 65 bis 88');
});

test('Nach links und nach rechts: Teil und Auswahl wandern, an den Rändern gesperrt', async ({ page }) => {
  await setForm(page, [['intro', 4], ['verse', 8], ['chorus', 8]]);
  await expect(page.locator('#part-left')).toBeDisabled();
  await pick(page, 1);
  await page.locator('#part-left').click();
  expect(types(await form(page))).toEqual(['verse', 'intro', 'chorus']);
  await expect(parts(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  expect((await form(page)).sections.map((x) => x.locked ?? false), 'der verschobene Teil ist gesperrt, die anderen nicht').toEqual([true, false, false]);
  await expect(page.locator('#part-left')).toBeDisabled();
  await page.locator('#part-right').click();
  await page.locator('#part-right').click();
  expect(types(await form(page))).toEqual(['intro', 'chorus', 'verse']);
  await expect(parts(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#part-right')).toBeDisabled();
  await expect(page.locator('#part-right')).not.toBeFocused(); // der Fokus ging nicht verloren: auf den gewählten Teil
  await expect(parts(page).nth(2)).toBeFocused();
  expect(await trackLength(page)).toBe(20);
});

test('Kopie: gleicher Teil direkt dahinter, gesperrt, gewählt; Länge wächst', async ({ page }) => {
  await setForm(page, [['intro', 4], ['verse', 8], ['chorus', 8]]);
  await pick(page, 1);
  await page.locator('#part-copy').click();
  const f = await form(page);
  expect(f.sections).toEqual([{ type: 'intro', bars: 4 }, { type: 'verse', bars: 8 }, { type: 'verse', bars: 8, locked: true }, { type: 'chorus', bars: 8 }]);
  expect(await trackLength(page)).toBe(28);
  await expect(parts(page).nth(2)).toHaveAttribute('aria-selected', 'true');
});

test('Teil hinzufügen: Strophe mit 8 Takten am Ende, gesperrt und gewählt', async ({ page }) => {
  await setForm(page, [['intro', 4], ['chorus', 8]]);
  await page.locator('#form-add').click();
  const f = await form(page);
  expect(f.sections.at(-1)).toEqual({ type: 'verse', bars: 8, locked: true });
  expect(await trackLength(page)).toBe(20);
  await expect(parts(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#form-insp-title')).toHaveText('Strophe, Takte 13 bis 20');
});

test('Grenzen: bei 64 Teilen sind Hinzufügen und Kopie gesperrt, der Grund steht da; bei 512 Takten ebenso', async ({ page }) => {
  await setForm(page, Array.from({ length: 64 }, () => ['verse', 1]));
  await expect(parts(page)).toHaveCount(64);
  await expect(page.locator('#form-add')).toBeDisabled();
  await expect(page.locator('#part-copy')).toBeDisabled();
  await expect(page.locator('#form-note')).toContainText('Höchstens 64 Teile.');
  await setForm(page, Array.from({ length: 8 }, () => ['verse', 64]));
  await expect(page.locator('#form-add')).toBeDisabled();
  await expect(page.locator('#part-copy')).toBeDisabled();
  await expect(page.locator('#part-longer')).toBeDisabled();
  await expect(page.locator('#form-note')).toContainText('Höchstens 512 Takte insgesamt.');
});

test('Ohne Form: Streifen und Einstellungen weg, ein Hinweis steht da; mit Vorlage kommt der Streifen zurück', async ({ page }) => {
  await page.locator('#form-template').selectOption('off');
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#form-insp')).toBeHidden();
  await expect(page.locator('#form-bar')).toBeHidden();
  await expect(page.locator('#form-hint')).toBeVisible();
  await expect(page.locator('#form-hint')).toContainText('Ohne Form läuft der Song als Schleife.');
  await page.locator('#form-template').selectOption('pop');
  await expect(strip(page)).toBeVisible();
  await expect(page.locator('#form-hint')).toBeHidden();
  await expect(page.locator('#form-bar')).toBeVisible();
});

test('defekte Form im Zustand: kein Fehler, kein Streifen, Hinweis; Neu würfeln legt eine gültige an; Typnamen werden nie als HTML gelesen', async ({ page }) => {
  await page.evaluate(async () => {
    const { state } = await import('/ui/state.js');
    state.track.form = { template: 'pop', feel: {}, sections: [{ type: '<b>x</b>', bars: 4 }] };
  });
  await rerender(page);
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#form-insp')).toBeHidden();
  await expect(page.locator('#form-hint')).toContainText('ungültig');
  expect(await page.locator('#form-strip b, #form-insp b, #form-hint b').count()).toBe(0);
  await page.locator('#form-roll').click();
  await expect(strip(page)).toBeVisible();
  expect((await form(page)).sections.length).toBeGreaterThan(0);
  expect(sum(await form(page))).toBe(await trackLength(page));
  // völlig kaputt (kein Objekt)
  await page.evaluate(async () => { (await import('/ui/state.js')).state.track.form = 42; });
  await rerender(page);
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#form-hint')).toContainText('ungültig');
});

test('Sprachwechsel beschriftet Streifen, Teilnamen, Einstellungen und Knöpfe neu', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 3);
  await page.locator('[data-lang="en"]').first().click();
  await expect(page.locator('#form-roll')).toHaveText('Roll again');
  await expect(page.locator('#form-add')).toHaveText('Add part');
  await expect(strip(page)).toHaveAttribute('aria-label', 'Song parts');
  expect(await parts(page).locator('.form-part-name').allTextContents()).toEqual(['Intro', 'Verse', 'Build', 'Chorus', 'Verse', 'Break', 'Chorus', 'Outro']);
  await expect(parts(page).nth(3)).toHaveAttribute('aria-label', 'Chorus, 16 bars, bars 25 to 40');
  await expect(page.locator('#form-insp-title')).toHaveText('Chorus, bars 25 to 40');
  await expect(page.locator('label[for="part-type"]')).toHaveText('Type');
  await expect(page.locator('#part-len-out')).toHaveText('16 bars');
  await expect(page.locator('#part-level-out')).toHaveText('Default (0 dB)');
  await expect(page.locator('#part-density-out')).toHaveText('Default (20%)');
  await expect(page.locator('#part-lock')).toHaveText('Lock');
  expect(await page.locator('#part-transition option').allTextContents()).toEqual(['none', 'Fill', 'Roll', 'Stop']);
  expect(await page.locator('#part-type option').allTextContents()).toEqual(['Intro', 'Verse', 'Build', 'Chorus', 'Break', 'Outro']);
  for (const id of ['part-delete', 'part-left', 'part-right', 'part-copy']) await expect(page.locator(`#${id}`)).toHaveText(/^(Delete|Move left|Move right|Duplicate)$/);
  expect(await page.locator('.lanes').innerText()).not.toMatch(RAW_KEY);
  await page.locator('[data-lang="de"]').first().click();
  await expect(page.locator('#form-roll')).toHaveText('Neu würfeln');
  await expect(parts(page).nth(3).locator('.form-part-name')).toHaveText('Refrain');
});

test('Wiedergabe: der spielende Teil trägt aria-current, wechselt mit der Position und der Streifen schreibt sonst nichts ins DOM', async ({ page }) => {
  test.setTimeout(90_000);
  await setForm(page, [['intro', 3], ['verse', 3], ['chorus', 50]]);
  await expect(page.locator('#form-strip [aria-current]')).toHaveCount(0);
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  const playing = () => page.evaluate(async () => {
    const { state } = await import('/ui/state.js');
    const { sectionAt } = await import('/core/form.js');
    const current = [...document.querySelectorAll('#form-strip [role="option"]')].findIndex((el) => el.getAttribute('aria-current') === 'true');
    const bar = state.current?.bar ?? null;
    return { current, want: bar === null ? -1 : sectionAt(state.track.form, bar % 56).index, bar };
  });
  const seen = new Set();
  await expect.poll(async () => { const r = await playing(); if (r.bar !== null) { expect(r.current).toBe(r.want); seen.add(r.current); } return seen.size; }, { timeout: 30_000, intervals: [150] }).toBeGreaterThanOrEqual(3);
  // im Refrain (50 Takte) ändert sich am Streifen und an den Einstellungen nichts mehr
  await page.evaluate(() => {
    window.__mutations = 0;
    new MutationObserver((list) => { window.__mutations += list.length; }).observe(document.querySelector('#form-strip'), { subtree: true, attributes: true, childList: true, characterData: true });
    new MutationObserver((list) => { window.__mutations += list.length; }).observe(document.querySelector('#form-insp'), { subtree: true, attributes: true, childList: true, characterData: true });
  });
  const before = await shownBar(page);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(before + 2);
  expect(await page.evaluate(() => window.__mutations)).toBe(0);
  await page.locator('#play-go').click();
  await expect(page.locator('#form-strip [aria-current]')).toHaveCount(0);
});

test('Verlauf: graue Linien folgen den Teilgrenzen statt alle 8 Takte, ohne Form wieder alle 8', async ({ page }) => {
  await setForm(page, [['intro', 6], ['verse', 10], ['build', 12], ['chorus', 14], ['verse', 18], ['outro', 36]]);
  const bounds = [6, 16, 28, 42, 60];
  // Pixelprobe in der untersten Zeile (frei von Spuren und Dreiecken): Alpha an den Linien, nicht an 8-Takt-Marken
  const alphaAt = (bar) => page.locator('#lanes').evaluate((c, b) => {
    const bw = c.clientWidth / 96;
    const x = Math.round(b * bw);
    const g = c.getContext('2d');
    const a = (px) => g.getImageData(px, c.height - 2, 1, 1).data[3];
    return Math.max(a(x - 1), a(x));
  }, bar);
  for (const b of bounds) expect(await alphaAt(b), `Teilgrenze bei Takt ${b}`).toBeGreaterThan(0);
  for (const b of [8, 24, 32, 40, 48, 56, 64]) expect(await alphaAt(b), `keine Linie bei Takt ${b}`).toBe(0);
  await page.locator('#form-template').selectOption('off');
  expect(await alphaAt(8)).toBeGreaterThan(0);
  expect(await alphaAt(24)).toBeGreaterThan(0);
  expect(await alphaAt(6)).toBe(0);
});

test('Verlauf: nur Fill-Marker sind Dreiecke, die Teilanfänge zeichnen keine', async ({ page }) => {
  await setForm(page, [['intro', 6], ['verse', 10], ['build', 12], ['chorus', 14], ['verse', 18], ['outro', 36]]);
  const probe = await page.evaluate(async () => {
    const { state, ALL_LAYERS } = await import('/ui/state.js');
    const { buildEvents } = await import('/index.js');
    const events = buildEvents({ ...state.track, layers: ALL_LAYERS });
    const fills = new Set(events.filter((e) => e.type === 'marker' && e.name === 'fill').map((e) => e.bar));
    const starts = events.filter((e) => e.type === 'marker' && e.name === 'section').map((e) => e.bar);
    const c = document.querySelector('#lanes');
    const bw = c.clientWidth / 96;
    const g = c.getContext('2d');
    // oberste Pixelzeile 2 px links vom Ende eines Takts: Alpha nur, wenn dort ein Dreieck sitzt
    const alpha = (bar) => g.getImageData(Math.floor((bar + 1) * bw) - 2, 1, 1, 1).data[3];
    return { starts, rows: starts.filter((p) => p > 0).map((p) => ({ p, fillBefore: fills.has(p - 1), triBefore: alpha(p - 1) > 0, triAtStart: alpha(p) > 0 })) };
  });
  expect(probe.starts).toEqual([0, 6, 16, 28, 42, 60]);
  expect(probe.rows.some((r) => r.fillBefore)).toBe(true);
  for (const r of probe.rows) {
    expect(r.triBefore, `Takt ${r.p}: Dreieck genau dort, wo ein Fill endet`).toBe(r.fillBefore);
    expect(r.triAtStart, `Takt ${r.p}: der Teilanfang selbst zeichnet kein Dreieck`).toBe(false);
  }
});

test('360 px: kein waagerechtes Scrollen der Seite, Streifen scrollt in seinem Kasten, Bedienelemente mindestens 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  while (await page.locator('.side-close:visible').count()) await page.locator('.side-close:visible').first().click();
  await setForm(page, FORM96);
  await expect(strip(page)).toBeVisible();
  await strip(page).scrollIntoViewIfNeeded();
  const m = await page.evaluate(() => {
    const s = document.querySelector('#form-strip');
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, strip: s.scrollWidth, box: s.clientWidth, right: s.getBoundingClientRect().right, canvas: document.querySelector('#lanes').getBoundingClientRect().right };
  });
  expect(m.page).toBe(0);
  expect(m.strip).toBeGreaterThan(m.box); // 96 Takte brauchen mehr als die Breite: scrollt im Kasten
  expect(m.right).toBeLessThanOrEqual(360);
  expect(Math.abs(m.right - m.canvas)).toBeLessThanOrEqual(1);
  const widths = await parts(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  [4, 12, 8, 16, 16, 8, 24, 8].forEach((bars, i) => expect(widths[i], `Teil ${i} mindestens 11 px je Takt`).toBeGreaterThanOrEqual(bars * 11 - 1));
  for (const loc of [parts(page).first(), page.locator('#form-roll'), page.locator('#form-add'), page.locator('#part-type'), page.locator('#part-transition'), page.locator('#part-shorter'), page.locator('#part-longer'),
    page.locator('#part-level'), page.locator('#part-density'), page.locator('#part-level-reset'), page.locator('#part-density-reset'), page.locator('#part-lock'), page.locator('#part-left'), page.locator('#part-right'), page.locator('#part-copy'), page.locator('#part-delete'), page.locator('#part-crash')]) {
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    expect(box.height, await loc.evaluate((el) => el.id || el.className)).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  // ein Teil im scrollenden Streifen per Tastatur erreichbar
  await parts(page).first().focus();
  await page.keyboard.press('End');
  await expect(parts(page).last()).toBeInViewport();
});

const selectedIndexes = (page) => parts(page).evaluateAll((els) => ({
  selected: els.flatMap((el, i) => (el.getAttribute('aria-selected') === 'true' ? [i] : [])),
  tab: els.flatMap((el, i) => (el.tabIndex === 0 ? [i] : [])),
}));

test('Auswahl bleibt gültig: nach Würfeln, kürzerer Form und Ohne Form genau ein gewählter Teil, Einstellungen passen dazu', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 7);
  await page.locator('#form-roll').click();
  const after = await selectedIndexes(page);
  const count = await parts(page).count();
  expect(after.selected).toHaveLength(1);
  expect(after.tab).toEqual(after.selected);
  expect(after.selected[0]).toBeLessThan(count);
  // kürzere Form im Zustand: die Auswahl klemmt auf den letzten Teil
  await pick(page, count - 1);
  await setForm(page, [['intro', 4], ['verse', 8], ['chorus', 8]]);
  expect(await selectedIndexes(page)).toEqual({ selected: [2], tab: [2] });
  await expect(page.locator('#form-insp-title')).toHaveText('Refrain, Takte 13 bis 20');
  // Länge ändern ändert die Auswahl nicht
  await page.locator('#part-longer').click();
  expect(await selectedIndexes(page)).toEqual({ selected: [2], tab: [2] });
  // Ohne Form und zurück
  await page.locator('#form-template').selectOption('off');
  await page.locator('#form-template').selectOption('pop');
  const back = await selectedIndexes(page);
  expect(back.selected).toHaveLength(1);
  expect(back.tab).toEqual(back.selected);
  await expect(page.locator('#form-insp-title')).toContainText('Takte');
});

test('Ausrichtung auch bei einer schiefen Form (1/1/1/64/1/3/25 Takte) bei 1280 und 601 px', async ({ page }) => {
  const odd = [['intro', 1], ['verse', 1], ['build', 1], ['chorus', 64], ['break', 1], ['verse', 3], ['outro', 25]];
  const bars = odd.map(([, n]) => n);
  for (const width of [1280, 601]) {
    await page.setViewportSize({ width, height: 900 });
    while (await page.locator('.side-close:visible').count()) await page.locator('.side-close:visible').first().click();
    await setForm(page, odd);
    const m = await page.evaluate(() => {
      const c = document.querySelector('#lanes').getBoundingClientRect();
      const strip = document.querySelector('#form-strip');
      const s = strip.getBoundingClientRect();
      const boxes = [...document.querySelectorAll('#form-strip [role="option"]')].map((el) => el.getBoundingClientRect());
      return { cl: c.left, cr: c.right, sl: s.left, sr: s.right, boxes: boxes.map((b) => ({ x: b.x, w: b.width })), scroll: strip.scrollWidth - strip.clientWidth };
    });
    expect(Math.abs(m.sl - m.cl), `${width}: links`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.sr - m.cr), `${width}: rechts`).toBeLessThanOrEqual(1);
    expect(m.scroll, `${width}: kein Scrollen im Streifen`).toBeLessThanOrEqual(0);
    const total = m.boxes.reduce((n, b) => n + b.w, 0);
    m.boxes.forEach((b, i) => expect(Math.abs(b.w - (bars[i] / 96) * total), `${width}: Teil ${i}`).toBeLessThanOrEqual(2));
  }
});

test('Tastatur: Alt, Strg und Meta mit Pfeilen und Pos1 werden nicht verschluckt, ohne Taste schon', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 3);
  const results = await parts(page).nth(3).evaluate((el) => {
    const send = (key, mods) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }));
    const selected = () => [...document.querySelectorAll('#form-strip [role="option"]')].findIndex((o) => o.getAttribute('aria-selected') === 'true');
    const out = { free: [], selected: [] };
    for (const mods of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      out.free.push(send('ArrowLeft', mods), send('Home', mods));
      out.selected.push(selected());
    }
    out.plain = send('ArrowLeft', {}); // false: der Streifen hat die Taste behandelt
    return out;
  });
  expect(results.free).toEqual(Array(6).fill(true));
  expect(results.selected).toEqual([3, 3, 3]);
  expect(results.plain).toBe(false);
  expect((await selectedIndexes(page)).selected).toEqual([2]);
});

test('Fokus: wird der fokussierte Teil entfernt oder der Knopf gesperrt, geht er auf den gewählten Teil; verschwinden die Einstellungen, auf Neu würfeln', async ({ page }) => {
  await setForm(page, [['intro', 4], ['verse', 8], ['chorus', 8]]);
  await pick(page, 2);
  // Fokus liegt auf dem letzten Teil, der Teil wird gelöscht (Auslösen ohne Fokuswechsel)
  await parts(page).nth(2).focus();
  await page.evaluate(() => document.getElementById('part-delete').click());
  await expect(parts(page)).toHaveCount(2);
  await expect(parts(page).nth(1)).toBeFocused();
  // per Tastatur bis zum letzten Teil löschen: der gesperrte Löschen-Knopf gibt den Fokus ab
  await page.locator('#part-delete').focus();
  await page.keyboard.press('Enter');
  await expect(parts(page)).toHaveCount(1);
  await expect(page.locator('#part-delete')).toBeDisabled();
  await expect(parts(page).first()).toBeFocused();
  // Einstellungen verschwinden (defekte Form), während der Fokus darin liegt
  await page.locator('#part-type').focus();
  await page.evaluate(async () => {
    (await import('/ui/state.js')).state.track.form = { template: 'pop', feel: {}, sections: [{ type: 'oops', bars: 4 }] };
    document.querySelector('[data-lang="de"]').click(); // ohne Fokuswechsel neu zeichnen
  });
  await expect(page.locator('#form-insp')).toBeHidden();
  await expect(page.locator('#form-roll')).toBeFocused();
});

test('Neu würfeln: sind alle Teile gesperrt, steht ein Hinweis da und nichts ändert sich; er verschwindet mit der nächsten Aktion', async ({ page }) => {
  await setForm(page, [['verse', 8, { locked: true }], ['chorus', 8, { locked: true }]]);
  const before = await form(page);
  await page.locator('#form-roll').click();
  await expect(page.locator('#form-note')).toHaveText('Alle Teile sind gesperrt, es gibt nichts zu würfeln.');
  expect(await form(page)).toEqual(before);
  await pick(page, 1);
  await expect(page.locator('#form-note')).toHaveText('');
});

test('Neu würfeln bei defekter Form behält die gewählte Vorlage', async ({ page }) => {
  await page.evaluate(async () => {
    (await import('/ui/state.js')).state.track.form = { template: 'blues', auto: false, feel: {}, sections: [{ type: 'oops', bars: 4 }] };
  });
  await rerender(page);
  await page.locator('#form-roll').click();
  const f = await form(page);
  expect(f.template).toBe('blues');
  expect(f.sections.every((x) => x.bars === 12)).toBe(true);
});

test('Streifen und Einstellungen: Tooltip gleich Beschriftung, Pegel- und Dichte-Ausgabe sprechen nicht mit, ungesetzte Regler blass, Reihen kompakt', async ({ page }) => {
  await setForm(page, FORM96);
  await pick(page, 1);
  expect(await parts(page).evaluateAll((els) => els.every((el) => el.title && el.title === el.getAttribute('aria-label')))).toBe(true);
  await expect(page.locator('#part-level-out')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('#part-density-out')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('#part-len-out')).not.toHaveAttribute('aria-live', 'off');
  await expect(page.locator('#part-level')).toHaveClass(/\bunset\b/);
  await page.locator('#part-level').fill('-9');
  await expect(page.locator('#part-level')).not.toHaveClass(/\bunset\b/);
  await expect(page.locator('#part-level')).toHaveCSS('opacity', '1');
  // Zurücksetzen steht in der Reihe des Reglers, Sperren in der Reihe der Aktionen
  const rows = await page.evaluate(() => {
    const y = (id) => Math.round(document.getElementById(id).getBoundingClientRect().top);
    return { level: y('part-level'), reset: y('part-level-reset'), lock: y('part-lock'), del: y('part-delete'), copy: y('part-copy') };
  });
  expect(Math.abs(rows.reset - rows.level)).toBeLessThanOrEqual(30);
  expect(rows.lock).toBe(rows.del);
  expect(rows.lock).toBe(rows.copy);
});

test('Streifen: der spielende Teil trägt einen Balken in Tintenfarbe (genug Kontrast auf jedem Teil)', async ({ page }) => {
  await setForm(page, [['verse', 3], ['chorus', 50]]);
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#form-strip [aria-current="true"]')).toHaveCount(1, { timeout: BAR_TIMEOUT });
  const bar = await page.locator('#form-strip [aria-current="true"]').evaluate((el) => getComputedStyle(el, '::after').backgroundColor);
  expect(bar).toBe('rgb(42, 38, 34)');
  await page.locator('#play-go').click();
});
