// Gruppe "Songform" der Spielseite (echte Seite /ui/index.html): Vorlage, Zielgröße, vier Regler, Zustand der Form.
import { test, expect } from '@playwright/test';
import { countingScript, recordPositions, positionsSince, shownBar, expectContinuous, sets, contexts } from './count-helpers.js';

const FEEL = ['structure', 'dynamics', 'pauses', 'randomness'];
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
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const template = (page) => page.locator('#form-template');
const target = (page) => page.locator('#length');
const slider = (page, name) => page.locator(`#form-${name}`);
const position = (page) => page.locator('#play-position');
// Zustand der App lesen (dasselbe Modul wie die Seite) und verändern
const form = (page) => page.evaluate(async () => structuredClone((await import('/ui/state.js')).state.track.form ?? null));
const trackLength = (page) => page.evaluate(async () => (await import('/ui/state.js')).state.track.length);
const sum = (f) => f.sections.reduce((s, x) => s + x.bars, 0);
// feste Variantennummer über das Eingabefeld der Startseite (wie Eingabe und Enter)
const setVariant = (page, n) => page.evaluate((seed) => {
  const input = document.getElementById('variant');
  input.value = String(seed);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, n);

test('beim Laden hat der Track eine Form: Summe gleich Länge, Vorlage Auto, Ziel 96', async ({ page }) => {
  const f = await form(page);
  expect(f).not.toBeNull();
  expect(f.auto).toBe(true);
  expect(sum(f)).toBe(await trackLength(page));
  await expect(template(page)).toHaveValue('auto');
  await expect(target(page)).toHaveValue('96');
  expect(await target(page).locator('option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['24', '32', '48', '64', '96', '128', '192']);
  await expect(page.locator('#length-label')).toHaveText('Zielgröße');
  // Auto nennt die gewürfelte Vorlage dazu (Funk würfelt Jam)
  expect(await template(page).locator('option').allTextContents()).toEqual(['Auto (Jam)', 'Jam', 'Pop', 'Build & Drop', 'Blues', 'Rock', 'Ohne Form']);
});

test('Feld Ganzes Lied: links im Modul Form & Spuren, nach dem Griffbrett per Tastatur erreichbar; Knöpfe zeigen Prozentwerte', async ({ page }) => {
  await expect(page.locator('#mod-song #form-song')).toBeVisible();
  await page.locator('#fretboard').focus(); // letzter Tab-Halt davor (der Akkordkreis hat keinen)
  // die LCD-Auswahlen bringen ‹ und › ohne Kennung mit; gezählt werden die Stationen mit Kennung
  const seen = [];
  for (let i = 0; i < 12 && seen.at(-1) !== 'form-randomness'; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement.id);
    if (id) seen.push(id);
  }
  expect(seen).toEqual(['form-template', 'length', 'form-structure', 'form-dynamics', 'form-pauses', 'form-randomness']);
  const expected = { structure: 60, dynamics: 60, pauses: 40, randomness: 50 };
  const labels = { structure: 'Struktur', dynamics: 'Dynamik', pauses: 'Pausen', randomness: 'Zufall' };
  for (const name of FEEL) {
    await expect(slider(page, name)).toHaveValue(String(expected[name]));
    await expect(page.locator(`#form-${name}-out`)).toHaveText(`${expected[name]} %`);
    await expect(slider(page, name)).toHaveAttribute('aria-valuetext', new RegExp(`^${expected[name]} %`));
    await expect(page.locator(`label[for="form-${name}"]`)).toHaveText(labels[name]);
  }
  await slider(page, 'randomness').press('ArrowRight');
  await expect(page.locator('#form-randomness-out')).toHaveText('51 %');
  expect((await form(page)).feel.randomness).toBeCloseTo(0.51);
});

test('Variante: gleiche Eingaben gleiche Form, neue Variante neue Form', async ({ page }) => {
  await setVariant(page, 7);
  const a = await form(page);
  const seen = new Set();
  for (const n of [8, 9, 10, 11, 12]) {
    await setVariant(page, n);
    seen.add(JSON.stringify((await form(page)).sections));
  }
  expect(seen.size).toBeGreaterThan(1);
  await setVariant(page, 7);
  expect(await form(page)).toEqual(a);
});

test('Blues: alle Teile 12 Takte; Zielgröße 48: Summe nahe 48 und die Taktzeile zeigt sie', async ({ page }) => {
  await template(page).selectOption('blues');
  let f = await form(page);
  expect(f.auto).toBe(false);
  expect(f.template).toBe('blues');
  expect(f.sections.every((s) => s.bars === 12)).toBe(true);
  expect(sum(f)).toBe(await trackLength(page));
  await template(page).selectOption('auto');
  await target(page).selectOption('48');
  f = await form(page);
  expect(Math.abs(sum(f) - 48)).toBeLessThanOrEqual(4);
  expect(sum(f)).toBe(await trackLength(page));
  await page.locator('#play-go').click();
  await expect(position(page)).toHaveText(`Takt 1 von ${sum(f)}`, { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('Wechsel von Vorlage oder Zielgröße hebt Sperren auf, die Variante lässt sie stehen', async ({ page }) => {
  await page.evaluate(async () => { (await import('/ui/state.js')).state.track.form.sections[0].locked = true; });
  const first = (await form(page)).sections[0];
  await setVariant(page, 21);
  expect((await form(page)).sections[0]).toEqual(first);
  await template(page).selectOption('pop');
  expect((await form(page)).sections.some((s) => s.locked)).toBe(false);
  await page.evaluate(async () => { (await import('/ui/state.js')).state.track.form.sections[0].locked = true; });
  await target(page).selectOption('48');
  expect((await form(page)).sections.some((s) => s.locked)).toBe(false);
});

test('Ohne Form: Regler ausgegraut, Länge gleich Zielgröße, Reglerwerte kehren mit der Form zurück', async ({ page }) => {
  await slider(page, 'randomness').fill('80');
  await target(page).selectOption('48');
  await template(page).selectOption('off');
  expect(await form(page)).toBeNull();
  expect(await trackLength(page)).toBe(48);
  await expect(page.locator('#length-label')).toHaveText('Länge');
  for (const name of FEEL) await expect(slider(page, name)).toBeDisabled();
  await expect(slider(page, 'randomness')).toHaveValue('80');
  await target(page).selectOption('24');
  expect(await trackLength(page)).toBe(24);
  await template(page).selectOption('auto');
  for (const name of FEEL) await expect(slider(page, name)).toBeEnabled();
  await expect(slider(page, 'randomness')).toHaveValue('80');
  expect((await form(page)).feel.randomness).toBeCloseTo(0.8);
});

test('Ohne Form: Beschriftung abgeblendet, ein Hinweis nennt den Grund; mit Form wieder weg', async ({ page }) => {
  const hint = page.locator('#form-feel-hint');
  await expect(hint).toBeHidden();
  await template(page).selectOption('off');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Die Regler wirken nur mit einer Vorlage.');
  for (const name of FEEL) await expect(page.locator(`label[for="form-${name}"]`)).toHaveClass(/\boff\b/);
  await page.locator('[data-lang="en"]').first().click();
  await expect(hint).toHaveText('The knobs only work with a template.');
  await page.locator('[data-lang="de"]').first().click();
  await template(page).selectOption('pop');
  await expect(hint).toBeHidden();
  await expect(template(page).locator('option').first()).toHaveText('Auto');
  for (const name of FEEL) await expect(page.locator(`label[for="form-${name}"]`)).not.toHaveClass(/\boff\b/);
});

test('Regler und gleich lange Form während der Wiedergabe: kein Neustart; neue Zielgröße: ein Neustart an gleicher Stelle', async ({ page }) => {
  await setVariant(page, 1); // fest: Funk gibt in Jam und Pop genau 96 Takte
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(3);
  await recordPositions(page);
  expect(await sets(page)).toBe(1);
  expect(await contexts(page)).toBe(1);

  const live = async (label, change) => {
    const before = await shownBar(page);
    await positionsSince(page);
    await change();
    await expectContinuous(page, before, label);
    expect(await sets(page), `${label}: kein neuer Instrumentensatz`).toBe(1);
    expect(await contexts(page), label).toBe(1);
    await expect(page.locator('#play-go')).toHaveText('Stopp');
  };
  await live('Zufall', () => slider(page, 'randomness').fill('90'));
  await live('Pausen', () => slider(page, 'pauses').fill('10'));
  await live('Dynamik', () => slider(page, 'dynamics').fill('100'));
  await live('Struktur', () => slider(page, 'structure').fill('20')); // Loslassen würfelt neu, die Summe bleibt 96
  expect((await form(page)).feel).toMatchObject({ structure: 0.2, dynamics: 1, pauses: 0.1, randomness: 0.9 });
  await live('Vorlage Pop', async () => {
    await template(page).selectOption('pop');
    expect(sum(await form(page))).toBe(96);
  });

  // neue Zielgröße: andere Länge, also genau ein Neustart (ein Instrumentensatz mehr), an der gleichen Stelle
  const before = await shownBar(page);
  await positionsSince(page);
  await target(page).selectOption('48');
  await expect(position(page)).toHaveText(/^Takt \d+ von 48$/, { timeout: BAR_TIMEOUT });
  await expectContinuous(page, before, 'Zielgröße 48');
  expect(await sets(page)).toBe(2);
  expect(await contexts(page)).toBe(1);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('mit Form läuft die Akkordfolge in jedem Teil neu: Anzeige, aria-current und nächster Akkord stimmen an jedem Takt, auch an der Naht', async ({ page }) => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    const { state } = await import('/ui/state.js');
    const names = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['F', 'maj'], ['G', 'maj']];
    state.track.bars = names.map(([root, quality]) => ({ chord: { root, quality }, beats: 4 }));
    // kleine Form 8 + 8 + 8: fünf Akkorde passen in keinen Teil glatt, jede Teilgrenze bricht den Kreis
    state.track.form = { template: 'pop', auto: false, feel: { ...state.formFeel }, sections: [8, 8, 8].map((bars, i) => ({ type: i === 1 ? 'chorus' : 'verse', bars })) };
    state.track.length = 24;
    state.formTarget = 24;
  });
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  const rows = new Map();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const r = await page.evaluate(async () => {
      const { state, chordName } = await import('/ui/state.js');
      const { chordIndex } = await import('/core/form.js');
      const c = state.current;
      if (!c) return null;
      const bars = state.track.bars;
      const idx = chordIndex(state.track, c.bar);
      return {
        bar: c.bar,
        now: document.getElementById('play-now').textContent,
        wantNow: chordName(bars[idx].chord),
        next: document.getElementById('play-next').textContent,
        wantNext: chordName(bars[chordIndex(state.track, c.bar + 1)].chord),
        aria: [...document.querySelectorAll('#progression button')].findIndex((b) => b.getAttribute('aria-current') === 'true'),
        idx,
      };
    });
    if (r) rows.set(r.bar, r);
    if (r && r.bar >= 26) break;
    await page.waitForTimeout(80);
  }
  await page.locator('#play-go').click();
  const seen = [...rows.keys()];
  for (const bar of [7, 8, 15, 16, 23, 24, 25]) expect(seen, `Takt ${bar} gesehen`).toContain(bar);
  for (const r of rows.values()) {
    expect(r.now, `Takt ${r.bar}: Akkord`).toBe(r.wantNow);
    expect(r.next, `Takt ${r.bar}: nächster Akkord`).toBe(r.wantNext);
    expect(r.aria, `Takt ${r.bar}: aria-current`).toBe(r.idx);
  }
});

// Länge, Summe der Form und Zielgröße im Zustand (Profile mit Teil `form` bringen die Form mit, solche mit nur `rhythm.length` würfeln sie neu)
const shown = (page) => page.evaluate(async () => {
  const { state } = await import('/ui/state.js');
  const f = state.track.form;
  return { length: state.track.length, sum: f ? f.sections.reduce((n, x) => n + x.bars, 0) : null, target: state.formTarget };
});

test('Profil mit Form bei Länge 96 gespeichert, Zielgröße 48, Profil laden: die gespeicherte Form kommt zurück, Länge folgt der Form, Wiedergabe läuft ohne Fehler', async ({ page }) => {
  await page.locator('#profiles-btn').click();
  await page.getByRole('treeitem', { name: 'Aktuelle Sitzung', exact: true }).click();
  await page.getByLabel('Name des Profils').fill('P96');
  await page.locator('#profile-save').click();
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await target(page).selectOption('48');
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(3);
  await page.locator('#profiles-btn').click();
  await page.getByRole('treeitem', { name: 'P96', exact: true }).click();
  await page.locator('#profile-load').click();
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  const after = await shown(page);
  expect(after.length).toBe(after.sum);
  expect(Math.abs(after.sum - 96)).toBeLessThanOrEqual(8);
  await expect(target(page)).toHaveValue('96');
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect(position(page)).toHaveText(new RegExp(`^Takt \\d+ von ${after.sum}$`), { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('altes Profil mit rhythm.length 48 in die Standardform (96) geladen: stimmige Anzeige, kein RangeError, Wiedergabe startet', async ({ page }) => {
  await page.evaluate(async () => {
    const { state } = await import('/ui/state.js');
    const { applyParts } = await import('/core/profile-parts.js');
    const { readSession, writeSession } = await import('/ui/profile-session.js');
    const r = applyParts(readSession(state), { rhythm: { length: 48 } });
    if (!r.ok) throw new Error('Profil nicht anwendbar');
    writeSession(state, r.session);
  });
  await page.locator('[data-lang="de"]').first().click(); // neu zeichnen (die Seite zeichnet nur bei Änderungen oder je Takt)
  const after = await shown(page);
  expect(Math.abs(after.sum - 48)).toBeLessThanOrEqual(8); // die Form wurde für die nächste Zielgröße neu gewürfelt
  expect(after.target).toBe(48);
  expect(after.length).toBe(after.sum);
  await expect(target(page)).toHaveValue(String(after.target));
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect(position(page)).toHaveText(new RegExp(`^Takt \\d+ von ${after.sum}$`), { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('Sprachwechsel beschriftet Gruppe, Auswahl und Regler neu', async ({ page }) => {
  await page.locator('[data-lang="en"]').first().click();
  await expect(page.locator('#form-song-title')).toHaveText('Whole song');
  await expect(page.locator('label[for="form-template"]')).toHaveText('Template');
  await expect(page.locator('#length-label')).toHaveText('Target size');
  expect(await template(page).locator('option').allTextContents()).toEqual(['Auto (Jam)', 'Jam', 'Pop', 'Build & Drop', 'Blues', 'Rock', 'No form']);
  await expect(target(page).locator('option').first()).toHaveText('24 bars');
  await expect(page.locator('label[for="form-randomness"]')).toHaveText('Randomness');
  await expect(page.locator('#form-structure-out')).toHaveText('60%');
  await expect(slider(page, 'structure')).toHaveAttribute('aria-valuetext', '60% (default 60%)');
  expect(await page.locator('#form-song').innerText()).not.toMatch(RAW_KEY);
  await page.locator('[data-lang="de"]').first().click();
  await expect(page.locator('#form-song-title')).toHaveText('Ganzes Lied');
});

test('360 px: kein waagerechtes Scrollen, Bedienelemente mindestens 44 px hoch', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('#form-template')).toBeVisible();
  await page.locator('#form-template').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => [document.documentElement, document.querySelector('#form-song')].map((el) => el.scrollWidth - el.clientWidth));
  expect(overflow).toEqual([0, 0]);
  for (const id of ['form-template', 'length', ...FEEL.map((n) => `form-${n}`)]) {
    const box = await page.locator(`#${id}`).boundingBox();
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, id).toBeLessThanOrEqual(360);
  }
});

test('der Verlauf zeichnet nach einem Wechsel der Form neu', async ({ page }) => {
  const lanes = () => page.locator('#lanes').evaluate((c) => c.toDataURL());
  await setVariant(page, 3);
  await template(page).selectOption('jam');
  const jam = await lanes();
  await template(page).selectOption('blues');
  const blues = await lanes();
  expect(blues).not.toBe(jam);
  await template(page).selectOption('jam');
  expect(await lanes()).toBe(jam);
});
