// Feintuning-Ansicht: Schnellauswahl, Schlagworte, Tempo, Länge, Schichten, Verlauf, Akkordfolge, Akkordrad.
import { test, expect } from '@playwright/test';
import { layoutWheel } from '../../src/ui/wheel-geometry.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category)\.[A-Za-z.]+$/;
const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const AM = { root: 'A', mode: 'minor' };

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

const tuneBtn = (page) => page.locator('#tune-btn');
const tuning = (page) => page.locator('#tuning');
const tuningGo = (page) => page.locator('#tuning-go');
const position = (page) => page.locator('#position');
const progression = (page) => page.locator('#progression button');
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const pressedTags = (page) => page.locator('#tags button[aria-pressed="true"]')
  .evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());

async function openTuning(page) {
  await tuneBtn(page).click();
  await expect(tuning(page)).toBeVisible();
}

// Wiedergabe bei 200 bpm (1,2 s je Takt), damit Taktwechsel schnell kommen
async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await tuningGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von \d+$/, { timeout: BAR_TIMEOUT });
}

// Fokus bleibt in der Ansicht auf einem bedienbaren Element
const focusState = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return {
    inTuning: document.querySelector('#tuning').contains(el),
    body: el === document.body,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
  };
});
const usableFocus = { inTuning: true, body: false, disabled: false };

async function rawKeysIn(page) {
  return page.evaluate((source) => {
    const re = new RegExp(source);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
    for (const el of document.querySelectorAll('[aria-label], [title]')) {
      for (const attr of ['aria-label', 'title']) if (re.test(el.getAttribute(attr) ?? '')) found.push(`${attr}=${el.getAttribute(attr)}`);
    }
    for (const el of document.querySelectorAll('option')) if (re.test(el.textContent.trim())) found.push(`option=${el.textContent}`);
    return found;
  }, RAW_KEY.source);
}

// Knotenmitte im Canvas (CSS-Pixel relativ zur linken oberen Ecke)
async function wheelPoint(page, root, quality, ring = 'outer') {
  const canvas = page.locator('#wheel');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const node = layoutWheel(box.width, AM).nodes.find((n) => n.ring === ring && n.chord.root === root && n.chord.quality === quality);
  return { x: node.x, y: node.y };
}

test('Feintuning öffnet und schließt: aria-expanded, hidden, Fokus', async ({ page }) => {
  await expect(tuneBtn(page)).toHaveText('Feintuning');
  await expect(tuneBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(tuneBtn(page)).toHaveAttribute('aria-controls', 'tuning');
  await expect(tuning(page)).toBeHidden();
  await tuneBtn(page).click();
  await expect(tuning(page)).toBeVisible();
  await expect(tuneBtn(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#tuning-title')).toBeFocused();
  await expect(page.locator('#tuning-title')).toHaveAttribute('tabindex', '-1');
  // Startsatz und Variante bleiben erreichbar
  await expect(page.locator('#style-btn')).toBeVisible();
  await expect(page.locator('#new-variant')).toBeVisible();
  await page.locator('#back').click();
  await expect(tuning(page)).toBeHidden();
  await expect(tuneBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(tuneBtn(page)).toBeFocused();
  // der Knopf schaltet auch wieder zu
  await tuneBtn(page).click();
  await expect(tuning(page)).toBeVisible();
  await tuneBtn(page).click();
  await expect(tuning(page)).toBeHidden();
  await expect(tuneBtn(page)).toBeFocused();
});

test('Schnellauswahl Träumerisch belegt Schlagworte und 80 bpm vor', async ({ page }) => {
  await openTuning(page);
  const pick = page.locator('#quick-pick button');
  await expect(pick).toHaveCount(3);
  await expect(page.locator('#quick-pick [data-style="funk"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#quick-pick').getByRole('button', { name: /Träumerisch/ }).click();
  expect(await pressedTags(page)).toEqual([
    'bass.calm', 'development.buildsSlowly', 'drums.halftime', 'drums.loose', 'mood.dreamy', 'synths.warm', 'synths.widePad',
  ]);
  await expect(page.locator('#tuning-tempo-out')).toHaveText('80');
  await expect(page.locator('#tempo-btn')).toHaveText('80 bpm');
  await expect(page.locator('#quick-pick [data-style="dreamy"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#quick-pick [aria-pressed="true"]')).toHaveCount(1);
  // eigene Änderung: keine Vorlage passt mehr
  await page.locator('#tags [data-tag="bright"]').click();
  await expect(page.locator('#quick-pick [aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#tags [data-tag="bright"]').click();
  await expect(page.locator('#quick-pick [data-style="dreamy"]')).toHaveAttribute('aria-pressed', 'true');
  // Tempo weicht ab: ebenfalls keine Vorlage
  await page.locator('#tuning-tempo').fill('81');
  await expect(page.locator('#quick-pick [aria-pressed="true"]')).toHaveCount(0);
});

test('Schlagworte nach Kategorien, mehrere pro Kategorie wählbar', async ({ page }) => {
  await openTuning(page);
  const groups = page.locator('#tags [role="group"]');
  await expect(groups).toHaveCount(6);
  await expect(page.getByRole('group', { name: 'Entwicklung' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Schlagzeug', exact: true })).toBeVisible();
  const drums = page.getByRole('group', { name: 'Schlagzeug', exact: true });
  await drums.getByRole('button', { name: 'Halbzeit' }).click();
  await drums.getByRole('button', { name: 'wuchtig' }).click();
  expect((await pressedTags(page)).filter((t) => t.startsWith('drums.'))).toEqual(['drums.driving', 'drums.dry', 'drums.halftime', 'drums.heavy']);
  await drums.getByRole('button', { name: 'treibend' }).click();
  await expect(drums.getByRole('button', { name: 'treibend' })).toHaveAttribute('aria-pressed', 'false');
  await expect(drums.getByRole('button', { name: 'Halbzeit' })).toHaveAttribute('aria-pressed', 'true');
});

test('Schlagworte ohne Wirkung: gedämpft, mit Hinweis in beiden Sprachen, weiter wählbar', async ({ page }) => {
  await openTuning(page);
  const gritty = page.locator('#tags [data-tag="gritty"]');
  await expect(gritty).toHaveClass(/\binert\b/);
  await expect(gritty).toHaveAttribute('title', 'noch ohne Wirkung');
  await expect(gritty).toHaveAttribute('aria-description', 'noch ohne Wirkung');
  await expect(gritty).toHaveAccessibleName('angezerrt');
  await expect(page.locator('#tags .inert')).toHaveCount(6);
  // Schlagworte mit Wirkung tragen keinen Hinweis
  const driving = page.locator('#tags [data-tag="driving"]');
  await expect(driving).not.toHaveClass(/\binert\b/);
  await expect(driving).not.toHaveAttribute('title', /./);
  await gritty.click();
  await expect(gritty).toHaveAttribute('aria-pressed', 'true');
  await gritty.click();
  await expect(gritty).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-lang="en"]').click();
  await expect(gritty).toHaveAttribute('title', 'no effect yet');
  await expect(gritty).toHaveAttribute('aria-description', 'no effect yet');
  expect(await rawKeysIn(page)).toEqual([]);
});

test('Schlagwort während der Wiedergabe: Neustart ohne Fehler, Taktzeile läuft weiter', async ({ page }) => {
  await openTuning(page);
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await page.locator('#tags [data-tag="swing"]').click();
  await expect(page.locator('#tags [data-tag="swing"]')).toHaveAttribute('aria-pressed', 'true');
  // Neustart beginnt wieder bei Takt 1, ohne Neustart käme Takt 1 erst nach 96 Takten
  await expect(position(page)).toHaveText('Takt 1 von 96', { timeout: BAR_TIMEOUT });
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await expect(tuningGo(page)).toHaveText('Stopp');
  await tuningGo(page).click();
  await expect(tuningGo(page)).toHaveText('Los');
  await expect(page.locator('#go')).toHaveText('Los');
});

test('Tempo im Feintuning ändert das Tempo im Satz', async ({ page }) => {
  await openTuning(page);
  await page.locator('#tuning-tempo').fill('150');
  await expect(page.locator('#tempo-btn')).toHaveText('150 bpm');
  await expect(page.locator('#tuning-tempo-out')).toHaveText('150');
  await expect(page.locator('#tempo')).toHaveValue('150');
});

test('Länge ändert die Gesamtzahl in der Taktzeile, auch während der Wiedergabe', async ({ page }) => {
  await openTuning(page);
  const length = page.locator('#length');
  await expect(length).toHaveValue('96');
  expect(await length.locator('option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['24', '48', '96', '192']);
  await length.selectOption('48');
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 1 von 48');
  await length.selectOption('24');
  await expect(position(page)).toHaveText('Takt 1 von 24', { timeout: BAR_TIMEOUT });
  await tuningGo(page).click();
});

test('Schichten: Knöpfe schalten live, alle aus läuft weiter', async ({ page }) => {
  await openTuning(page);
  const layers = page.locator('#lane-buttons button');
  await expect(layers).toHaveCount(4);
  expect(await layers.allTextContents()).toEqual(['Schlagzeug', 'Bass', 'Akkorde', 'Pad']);
  for (const b of await layers.all()) await expect(b).toHaveAttribute('aria-pressed', 'true');
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await layers.nth(0).click();
  await expect(layers.nth(0)).toHaveAttribute('aria-pressed', 'false');
  // live, kein Neustart: ein Neustart leert die Taktzeile sofort und beginnt bei Takt 1
  expect(await position(page).textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position(page)).toHaveText('Takt 3 von 96', { timeout: BAR_TIMEOUT });
  await layers.nth(0).click();
  await expect(layers.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await tuningGo(page).click();

  for (const b of await layers.all()) await b.click();
  for (const b of await layers.all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
  await tuningGo(page).click();
  await expect(tuningGo(page)).toHaveText('Stopp');
  await expect(position(page)).toHaveText('Takt 1 von 96', { timeout: BAR_TIMEOUT });
  const first = await page.locator('#now-chord').textContent();
  expect(await shownChords(page)).toContain(first);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  // einschalten während der Wiedergabe geht ohne Neustart
  await layers.nth(2).click();
  expect(await position(page).textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position(page)).toHaveText('Takt 3 von 96', { timeout: BAR_TIMEOUT });
  await tuningGo(page).click();
});

test('Verlauf: Canvas zeichnet, Zeiger wandert beim Spielen', async ({ page }) => {
  await openTuning(page);
  const lanes = page.locator('#lanes');
  await expect(lanes).toHaveAttribute('role', 'img');
  await expect(lanes).toHaveAttribute('aria-label', /\S/);
  const painted = () => lanes.evaluate((c) => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  await expect.poll(painted).toBe(true);
  // gedimmte Spur ändert das Bild
  const stopped = await lanes.evaluate((c) => c.toDataURL());
  await page.locator('#lane-buttons [data-layer="bass"]').click();
  await expect.poll(() => lanes.evaluate((c) => c.toDataURL())).not.toBe(stopped);
  await page.locator('#lane-buttons [data-layer="bass"]').click();

  await playFast(page);
  const firstBar = await lanes.evaluate((c) => c.toDataURL());
  await expect(position(page)).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  await expect.poll(() => lanes.evaluate((c) => c.toDataURL()), { timeout: BAR_TIMEOUT }).not.toBe(firstBar);
  await tuningGo(page).click();
});

test('Akkordrad: Canvas mit Beschriftung, Klick auf passenden Akkord fügt an, auf fremden nicht', async ({ page }) => {
  await openTuning(page);
  const wheel = page.locator('#wheel');
  await expect(wheel).toHaveAttribute('role', 'img');
  await expect(wheel).toHaveAttribute('aria-label', /\S/);
  const before = await shownChords(page);
  await expect(progression(page)).toHaveCount(before.length);

  await wheel.click({ position: await wheelPoint(page, 'F', 'maj') });
  await expect.poll(() => shownChords(page)).toEqual([...before, 'F']);
  await expect(progression(page)).toHaveCount(before.length + 1);

  await wheel.click({ position: await wheelPoint(page, 'D', 'maj') }); // D-Dur gehört nicht zu A-Moll
  await wheel.click({ position: await wheelPoint(page, 'F#', 'min', 'inner') });
  await wheel.click({ position: { x: 5, y: 5 } }); // daneben
  await wheel.click({ position: await wheelPoint(page, 'E', 'min', 'inner') });
  await expect.poll(() => shownChords(page)).toEqual([...before, 'F', 'Em']);
  // verminderter Akkord außen und die Dur-Dominante
  await wheel.click({ position: await wheelPoint(page, 'B', 'dim') });
  await wheel.click({ position: await wheelPoint(page, 'E', 'maj') });
  await expect.poll(() => shownChords(page)).toEqual([...before, 'F', 'Em', 'Bdim', 'E']);
});

test('Tastatur: Akkord-Knöpfe fügen an und entfernen, nie leer, höchstens 8', async ({ page }) => {
  await openTuning(page);
  const add = page.locator('#add-chords button');
  await expect(add).toHaveCount(8); // A-Moll: sieben leitereigene plus E-Dur
  expect(await add.allTextContents()).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G', 'E']);
  await expect(page.getByRole('heading', { name: 'Akkord hinzufügen' })).toBeVisible();

  // per Tastatur entfernen bis einer übrig ist
  while (await progression(page).count() > 1) {
    const n = await progression(page).count();
    await progression(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(progression(page)).toHaveCount(n - 1);
  }
  await expect(progression(page).first()).toBeDisabled();
  expect(await shownChords(page)).toHaveLength(1);
  // der letzte Akkord ist gesperrt: Fokus darf nicht auf ihm oder auf body landen
  expect(await focusState(page)).toEqual(usableFocus);

  // per Tastatur anfügen bis 8
  await add.filter({ hasText: /^Dm$/ }).focus();
  for (let n = 2; n <= 8; n++) {
    await page.keyboard.press('Enter');
    await expect(progression(page)).toHaveCount(n);
    await expect(add.filter({ hasText: /^Dm$/ })).toBeFocused();
  }
  await expect(progression(page).first()).toBeEnabled();
  const message = page.locator('#tuning-message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  await expect(message).toHaveText('');
  await page.keyboard.press('Enter');
  await expect(message).toHaveText(/8/);
  await expect(progression(page)).toHaveCount(8);
  await expect(add.filter({ hasText: /^Dm$/ })).toBeFocused();
  // Rad ebenfalls gesperrt
  await page.locator('#wheel').click({ position: await wheelPoint(page, 'C', 'maj') });
  await expect(progression(page)).toHaveCount(8);
  // Entfernen in der Mitte räumt die Meldung, Fokus bleibt an derselben Stelle (nächster Akkord)
  await progression(page).nth(3).focus();
  await page.keyboard.press('Enter');
  await expect(progression(page)).toHaveCount(7);
  await expect(message).toHaveText('');
  await expect(progression(page).nth(3)).toBeFocused();
  // Entfernen am Ende: Fokus auf den neuen letzten Akkord
  await progression(page).last().focus();
  await page.keyboard.press('Enter');
  await expect(progression(page)).toHaveCount(6);
  await expect(progression(page).last()).toBeFocused();
  expect(await focusState(page)).toEqual(usableFocus);
  await expect(progression(page).first()).toHaveAccessibleName(/entfernen/);
});

test('Live-Region: Hinweis bleibt bei Taktwechseln still, zweite Ablehnung meldet sich neu', async ({ page }) => {
  await openTuning(page);
  const add = page.locator('#add-chords button');
  while ((await progression(page).count()) < 8) await add.first().click();
  await playFast(page);
  const message = page.locator('#tuning-message');
  await add.first().click();
  await expect(message).toHaveText(/8/);
  await page.evaluate(() => {
    window.__region = 0;
    window.__controls = 0;
    new MutationObserver((list) => { window.__region += list.length; })
      .observe(document.querySelector('#tuning-message'), { childList: true, characterData: true, subtree: true });
    // Bedienelemente, die sich beim Taktwechsel nicht ändern: nichts neu schreiben
    const quiet = new MutationObserver((list) => { window.__controls += list.length; });
    for (const id of ['#tags', '#quick-pick', '#lane-buttons', '#length', '#add-chords', '#tuning-title', '#back']) {
      quiet.observe(document.querySelector(id), { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
  await expect(position(page)).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  const bar = Number((await position(page).textContent()).match(/\d+/)[0]);
  await expect(position(page)).toHaveText(`Takt ${bar + 2} von 96`, { timeout: BAR_TIMEOUT });
  expect(await page.evaluate(() => [window.__region, window.__controls])).toEqual([0, 0]);
  // zweite Ablehnung: Region ändert sich (leeren und neu setzen), Text bleibt die Meldung
  await add.first().click();
  await expect.poll(() => page.evaluate(() => window.__region)).toBeGreaterThan(0);
  await expect(message).toHaveText(/8/);
  // Ablehnung startet die Wiedergabe nicht neu
  expect(await position(page).textContent()).toMatch(/^Takt \d+ von 96$/);
  await tuningGo(page).click();
});

test('eigene Folge übersteht Stilwahl, Variante und Tonart leiten neu ab', async ({ page }) => {
  await openTuning(page);
  await page.locator('#add-chords button', { hasText: /^G$/ }).click();
  await page.locator('#add-chords button', { hasText: /^C$/ }).click();
  const edited = await shownChords(page);
  expect(edited).toHaveLength(6);
  await page.locator('#quick-pick [data-style="psych"]').click();
  await expect(page.locator('#style-btn')).toHaveText('Psychedelischer Indie');
  expect(await shownChords(page)).toEqual(edited);
  await page.locator('#new-variant').click();
  await expect.poll(async () => (await shownChords(page)).length).toBe(4);
  await expect(progression(page)).toHaveCount(4);

  await page.locator('#add-chords button', { hasText: /^G$/ }).click();
  expect(await shownChords(page)).toHaveLength(5);
  await page.locator('#key-btn').click();
  await page.locator('#key-pop').getByRole('button', { name: 'D', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await shownChords(page)).length).toBe(4);
  // Akkord-Knöpfe folgen der Tonart
  expect(await page.locator('#add-chords button').allTextContents()).toEqual(['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C', 'A']);
});

test('keine rohen Schlüssel in beiden Sprachen mit offenem Feintuning', async ({ page }) => {
  await openTuning(page);
  expect(await rawKeysIn(page)).toEqual([]);
  await page.locator('[data-lang="en"]').click();
  await expect(tuneBtn(page)).toHaveText('Fine-tune');
  await expect(page.locator('#back')).toHaveText('back');
  expect(await rawKeysIn(page)).toEqual([]);
  for (const id of ['#lanes', '#wheel']) {
    const label = await page.locator(id).getAttribute('aria-label');
    expect(label).toMatch(/\S/);
    expect(label).not.toMatch(RAW_KEY);
  }
  await expect(page.getByRole('group', { name: 'Development' })).toBeVisible();
  await page.locator('[data-lang="de"]').click();
  await expect(page.getByRole('group', { name: 'Entwicklung' })).toBeVisible();
});

test('360 px breit mit offenem Feintuning: kein waagerechtes Scrollen, Knöpfe mindestens 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openTuning(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll('#tuning button, #tuning input, #tuning select')]
    .filter((el) => el.checkVisibility())
    .map((el) => ({ el: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small).toEqual([]);
  const wheel = await page.locator('#wheel').boundingBox();
  expect(wheel.x).toBeGreaterThanOrEqual(0);
  expect(wheel.x + wheel.width).toBeLessThanOrEqual(360);
});

test('Wiedergabe: Rad färbt den aktuellen Akkord, große Akkordanzeige ist im Feintuning versteckt', async ({ page }) => {
  await openTuning(page);
  await expect(page.locator('#now-chord')).toBeHidden();
  const wheel = page.locator('#wheel');
  const still = await wheel.evaluate((c) => c.toDataURL());
  await playFast(page);
  await expect.poll(() => wheel.evaluate((c) => c.toDataURL())).not.toBe(still);
  await expect(page.locator('#progression [aria-current="true"]')).toHaveCount(1);
  await tuningGo(page).click();
  await expect(page.locator('#progression [aria-current="true"]')).toHaveCount(0);
  await expect.poll(() => wheel.evaluate((c) => c.toDataURL())).toBe(still);
  await page.locator('#back').click();
  await expect(page.locator('#now-chord')).toBeAttached();
});
