// Gruppe "Songform" der Spielseite (echte Seite der App): Vorlage, Zielgröße, vier Regler, Zustand der Form.
// Portiert aus tests/e2e/form-panel.spec.js: die App lädt ihre Seite; den Zustand liest der Test aus state() der Sitzung, wenn die Seite die
// Antworten auf ihre Aktionen zeigt, und ändert ihn mit den Aktionen der Seite (die Web-App schrieb in ihren Zustand); was die Taktzeile einer
// Form zeigen muss, steht als Werte da; AudioContexts und Instrumentensätze zählt count-helpers.js; ein altes Profil liegt im Speicher der App;
// die Sprache wählt die Leiste der App.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { recordPositions, positionsSince, shownBar, expectContinuous, sets, contexts, countContexts } from './count-helpers.js';

const FEEL = ['structure', 'dynamics', 'pauses', 'randomness'];
const RAW_KEY = /\b(ui|form|group)\.[A-Za-z.]+\b/;
const BAR_TIMEOUT = 10_000;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
});

const template = (page) => page.locator('#form-template');
const target = (page) => page.locator('#length');
const slider = (page, name) => page.locator(`#form-${name}`);
const position = (page) => page.locator('#play-position');
// Zustand der Sitzung lesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Web-App las ihr eigenes Modul, das sofort galt)
const state = async (page) => { await answered(page); return fromSession(page, 'state'); };
const form = async (page) => (await state(page)).track.form ?? null;
const trackLength = async (page) => (await state(page)).track.length;
const sum = (f) => f.sections.reduce((s, x) => s + x.bars, 0);
// feste Variantennummer über das Eingabefeld der Startseite (wie Eingabe und Enter)
const setVariant = (page, n) => page.evaluate((seed) => {
  const input = document.getElementById('variant');
  input.value = String(seed);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, n);
// Aktionen, wie die Seite sie schickt (session.js), der Reihe nach, jede nach der Antwort auf die vorige
const sendAll = (page, actions) => page.evaluate(async (list) => {
  const { send } = await import('./session.js');
  for (const a of list) await send(a);
}, actions);

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
  await answered(page); // die Hand zeigt 51 % bis zur Antwort
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
  // gesperrt wie mit der Taste Sperren des gewählten Teils (am Anfang der erste; die Web-App setzte das Feld in ihrem Zustand)
  await page.locator('#part-lock').click();
  const first = (await form(page)).sections[0];
  expect(first.locked).toBe(true);
  await setVariant(page, 21);
  expect((await form(page)).sections[0]).toEqual(first);
  await template(page).selectOption('pop');
  expect((await form(page)).sections.some((s) => s.locked)).toBe(false);
  await page.locator('#part-lock').click();
  expect((await form(page)).sections[0].locked).toBe(true);
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
  await answered(page); // der Zufall stünde auch vor der Antwort auf 80
  for (const name of FEEL) await expect(slider(page, name)).toBeEnabled();
  await expect(slider(page, 'randomness')).toHaveValue('80');
  expect((await form(page)).feel.randomness).toBeCloseTo(0.8);
});

test('Ohne Form: Beschriftung abgeblendet, ein Hinweis nennt den Grund; mit Form wieder weg', async ({ page }) => {
  const hint = page.locator('#form-feel-hint');
  await expect(hint).toBeHidden();
  await template(page).selectOption('off');
  await answered(page);
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Die Regler wirken nur mit einer Vorlage.');
  for (const name of FEEL) await expect(page.locator(`label[for="form-${name}"]`)).toHaveClass(/\boff\b/);
  await chooseLanguage(page, 'en');
  await expect(hint).toHaveText('The knobs only work with a template.');
  await chooseLanguage(page, 'de');
  await template(page).selectOption('pop');
  await answered(page); // "Auto" ohne Zusatz stünde auch vorher (ohne Form) da
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
    await settled(page); // die Engine hat getan, was die Änderung auslöst (ein Neustart käme nach der Antwort): die Taktzeile zeigt es bis hier
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
  await settled(page); // der Neustart ist getan: wo er beginnt, steht bis hier in der Taktzeile
  await expectContinuous(page, before, 'Zielgröße 48');
  expect(await sets(page)).toBe(2);
  expect(await contexts(page)).toBe(1);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('mit Form läuft die Akkordfolge in jedem Teil neu: Anzeige, aria-current und nächster Akkord stimmen an jedem Takt, auch an der Naht', async ({ page }) => {
  test.setTimeout(120_000);
  // fünf Akkorde und eine kleine Form 8 + 8 + 8 mit den Aktionen der Seite (die Web-App schrieb sie in ihren Zustand): fünf Akkorde passen in
  // keinen Teil glatt, jede Teilgrenze bricht den Kreis
  const names = ['Am', 'Dm', 'E', 'F', 'G'];
  const chords = [['A', 'min'], ['D', 'min'], ['E', 'maj'], ['F', 'maj'], ['G', 'maj']];
  const count = (await state(page)).track.bars.length;
  await sendAll(page, [
    ...Array.from({ length: count - 1 }, () => ({ action: 'removeChord', index: 0 })),
    ...chords.map(([root, quality]) => ({ action: 'addChord', root, quality })),
    { action: 'removeChord', index: 0 },
    { action: 'setFormTemplate', template: 'pop' },
    { action: 'setFormTarget', bars: 24 },
  ]);
  while ((await form(page)).sections.length > 1) await sendAll(page, [{ action: 'deletePart' }]);
  await sendAll(page, [{ action: 'editPart', field: 'bars', value: 8 }, { action: 'addPart' }, { action: 'addPart' }]);
  const f = await form(page);
  expect(f.sections.map((s) => s.bars)).toEqual([8, 8, 8]);
  expect((await state(page)).track.bars.map((b) => [b.chord.root, b.chord.quality])).toEqual(chords);
  // chordIndex der Web-App (src/core/form.js 47–53) für diese Form: in jedem Teil von vorn, der Takt im Teil modulo fünf; als Werte
  const INDEX = [0, 1, 2, 3, 4, 0, 1, 2, 0, 1, 2, 3, 4, 0, 1, 2, 0, 1, 2, 3, 4, 0, 1, 2];
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  const rows = new Map();
  let loops = 0, last = -1; // die Taktzeile zählt im Durchlauf (1 bis 24), die Web-App über die Durchläufe: Takt 25 ist der zweite Durchlauf
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const r = await page.evaluate(() => {
      const shown = document.getElementById('play-position').textContent.match(/^Takt (\d+) von 24$/);
      if (!shown) return null;
      return {
        inLoop: Number(shown[1]) - 1,
        now: document.getElementById('play-now').textContent,
        next: document.getElementById('play-next').textContent,
        aria: [...document.querySelectorAll('#progression button')].findIndex((b) => b.getAttribute('aria-current') === 'true'),
      };
    });
    if (r) {
      if (r.inLoop < last) loops++;
      last = r.inLoop;
      const bar = loops * 24 + r.inLoop;
      const idx = INDEX[r.inLoop];
      rows.set(bar, { ...r, bar, idx, wantNow: names[idx], wantNext: names[INDEX[(r.inLoop + 1) % 24]] });
      if (bar >= 26) break;
    }
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
const shown = async (page) => {
  const s = await state(page);
  const f = s.track.form;
  return { length: s.track.length, sum: f ? f.sections.reduce((n, x) => n + x.bars, 0) : null, target: s.formTarget };
};

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
  await settled(page); // der Neustart, den das Laden während der Wiedergabe auslöst, ist getan; "Stopp" stünde auch vorher da
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await expect(position(page)).toHaveText(new RegExp(`^Takt \\d+ von ${after.sum}$`), { timeout: BAR_TIMEOUT });
  await page.locator('#play-go').click();
});

test('altes Profil mit rhythm.length 48 in die Standardform (96) geladen: stimmige Anzeige, kein RangeError, Wiedergabe startet', async ({ page, app }) => {
  // das alte Profil liegt im Speicher der App und wird über das Profil-Fenster geladen (die Web-App wandte seine Teile direkt auf ihren Zustand an)
  const old = { id: 'alt', type: 'profile', name: 'Alt', parts: { rhythm: { length: 48 } } };
  page = await app.restart({ 'profiles.json': JSON.stringify({ version: 2, items: [old] }) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#tune-btn').click();
  await expect(page.locator('#rack')).toBeVisible();
  await page.locator('#profiles-btn').click();
  await page.getByRole('treeitem', { name: 'Alt', exact: true }).click();
  await page.locator('#profile-load').click();
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
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
  await chooseLanguage(page, 'en');
  await expect(page.locator('#form-song-title')).toHaveText('Whole song');
  await expect(page.locator('label[for="form-template"]')).toHaveText('Template');
  await expect(page.locator('#length-label')).toHaveText('Target size');
  expect(await template(page).locator('option').allTextContents()).toEqual(['Auto (Jam)', 'Jam', 'Pop', 'Build & Drop', 'Blues', 'Rock', 'No form']);
  await expect(target(page).locator('option').first()).toHaveText('24 bars');
  await expect(page.locator('label[for="form-randomness"]')).toHaveText('Randomness');
  await expect(page.locator('#form-structure-out')).toHaveText('60%');
  await expect(slider(page, 'structure')).toHaveAttribute('aria-valuetext', '60% (default 60%)');
  expect(await page.locator('#form-song').innerText()).not.toMatch(RAW_KEY);
  await chooseLanguage(page, 'de');
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
  // gezeichnet, wenn die Hülle alles getan hat, was die Seite schickte: der neue Verlauf kommt nach den Aufrufen der Engine, vor der Antwort auf settled
  const lanes = async () => { await settled(page); return page.locator('#lanes').evaluate((c) => c.toDataURL()); };
  await setVariant(page, 3);
  await template(page).selectOption('jam');
  const jam = await lanes();
  await template(page).selectOption('blues');
  const blues = await lanes();
  expect(blues).not.toBe(jam);
  await template(page).selectOption('jam');
  expect(await lanes()).toBe(jam);
});
