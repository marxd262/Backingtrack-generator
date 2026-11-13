// Spielseite (über Feintuning geöffnet): Schlagworte, Tempo, Länge, Schichten, Verlauf, Akkordfolge, Akkordrad.
import { test, expect } from '@playwright/test';
import { addChordByName, openAddPop } from './chord-helpers.js';
import { chooseStyle, currentStyle, openTags } from './style-helpers.js';
import { layoutWheel } from '../../src/ui/wheel-geometry.js';
import { countContexts, recordPositions, positionsSince, shownBar, expectContinuous } from './count-helpers.js';
import { STYLE_PRESETS, TAG_CATEGORIES } from '../../src/core/tags.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
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
const playPage = (page) => page.locator('#play');
const start = (page) => page.locator('#start');
const playGo = (page) => page.locator('#play-go');
const position = (page) => page.locator('#play-position');
const progression = (page) => page.locator('#progression button');
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const pressedTags = (page) => page.locator('#tags button[aria-pressed="true"]')
  .evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());

async function openPlayPage(page) {
  await tuneBtn(page).click();
  await expect(playPage(page)).toBeVisible();
}

// Wiedergabe bei 200 bpm (1,2 s je Takt), damit Taktwechsel schnell kommen
async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von \d+$/, { timeout: BAR_TIMEOUT });
}

// Fokus bleibt auf der Spielseite auf einem bedienbaren Element
const focusState = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return {
    inPlay: document.querySelector('#play').contains(el),
    body: el === document.body,
    disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
  };
});
const usableFocus = { inPlay: true, body: false, disabled: false };

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

test('Feintuning öffnet die Spielseite, zurück zur Startseite: Navigation ohne aria-expanded, hidden, Fokus', async ({ page }) => {
  await expect(tuneBtn(page)).toHaveText('Feintuning');
  // Feintuning navigiert und klappt nichts auf: kein aria-expanded, kein aria-controls
  await expect(tuneBtn(page)).not.toHaveAttribute('aria-expanded');
  await expect(tuneBtn(page)).not.toHaveAttribute('aria-controls');
  await expect(playPage(page)).toBeHidden();
  await tuneBtn(page).click();
  await expect(playPage(page)).toBeVisible();
  await expect(start(page)).toBeHidden();
  await expect(page.locator('#play-title')).toBeFocused();
  await expect(page.locator('#play-title')).toHaveAttribute('tabindex', '-1');
  // Startsatz und Variantenwahl gehören nur zur Startseite; die Variante steht als Anzeige in der Kopfzeile
  await expect(page.locator('#style-btn')).toBeHidden();
  await expect(page.locator('#new-variant')).toBeHidden();
  await expect(page.locator('#play-variant')).toHaveText(`Variante ${await page.locator('#variant').inputValue()}`);
  await page.locator('#play-back').click();
  await expect(playPage(page)).toBeHidden();
  await expect(start(page)).toBeVisible();
  await expect(tuneBtn(page)).not.toHaveAttribute('aria-expanded');
  await expect(tuneBtn(page)).toBeFocused();
  // Startsatz und Variante wieder erreichbar
  await expect(page.locator('#style-btn')).toBeVisible();
  await expect(page.locator('#new-variant')).toBeVisible();
  // per Tastatur hin und zurück
  await page.keyboard.press('Enter');
  await expect(playPage(page)).toBeVisible();
  await expect(page.locator('#play-title')).toBeFocused();
  await page.locator('#play-back').focus();
  await page.keyboard.press('Enter');
  await expect(playPage(page)).toBeHidden();
  await expect(tuneBtn(page)).toBeFocused();
});

test('Werksprofil Träumerisch belegt Schlagworte und 80 bpm vor', async ({ page }) => {
  await openPlayPage(page);
  expect(await currentStyle(page)).toBe('funk');
  await chooseStyle(page, 'dreamy');
  // Klang-Schlagworte des Stils (drumSound, bassSound, chordSound, padSound) gehören seit der Klangformung zur Vorlage
  expect(await pressedTags(page)).toEqual([
    'bass.calm', 'bassSound.round', 'chordSound.mellow', 'development.buildsSlowly', 'drumSound.roomy', 'drums.halftime', 'drums.loose',
    'mood.dreamy', 'padSound.airy', 'padSound.swelling', 'synths.warm', 'synths.widePad',
  ]);
  await expect(page.locator('#tuning-tempo-out')).toHaveText('80 bpm');
  await expect(page.locator('#tempo-btn')).toHaveText('80 bpm');
  expect(await currentStyle(page)).toBe('dreamy');
});

test('Schlagworte nach Kategorien, mehrere pro Kategorie wählbar', async ({ page }) => {
  await openPlayPage(page);
  await openTags(page);
  const groups = page.locator('#tags [role="group"]');
  await expect(groups).toHaveCount(10);
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
  await openPlayPage(page);
  await openTags(page);
  const withBreakouts = page.locator('#tags [data-tag="withBreakouts"]');
  await expect(withBreakouts).toHaveClass(/\binert\b/);
  await expect(withBreakouts).toHaveAttribute('title', 'noch ohne Wirkung');
  await expect(withBreakouts).toHaveAttribute('aria-description', 'noch ohne Wirkung');
  await expect(withBreakouts).toHaveAccessibleName('mit Ausbrüchen');
  await expect(page.locator('#tags .inert')).toHaveCount(1);
  // Schlagworte mit Wirkung tragen keinen Hinweis
  const driving = page.locator('#tags [data-tag="driving"]');
  await expect(driving).not.toHaveClass(/\binert\b/);
  await expect(driving).not.toHaveAttribute('title', /./);
  await withBreakouts.click();
  await expect(withBreakouts).toHaveAttribute('aria-pressed', 'true');
  await withBreakouts.click();
  await expect(withBreakouts).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-lang="en"]').click();
  await expect(withBreakouts).toHaveAttribute('title', 'no effect yet');
  await expect(withBreakouts).toHaveAttribute('aria-description', 'no effect yet');
  expect(await rawKeysIn(page)).toEqual([]);
});

test('Schlagwort während der Wiedergabe: wirkt live ohne Neustart und Fehler, Taktzeile läuft weiter', async ({ page }) => {
  await countContexts(page);
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await recordPositions(page);
  const before = await shownBar(page);
  await positionsSince(page);
  await openTags(page);
  await page.locator('#tags [data-tag="swing"]').click();
  await expect(page.locator('#tags [data-tag="swing"]')).toHaveAttribute('aria-pressed', 'true');
  // kein Neustart: die Taktzeile springt nicht auf Takt 1 zurück und es entsteht kein neuer Instrumentensatz
  await expectContinuous(page, before, 'swing');
  expect(await page.evaluate(() => window.__instrumentSets)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#go')).toHaveText('Los');
});

test('Tempo im Modul Rhythmus ändert das Tempo im Satz', async ({ page }) => {
  await openPlayPage(page);
  await page.locator('#tuning-tempo').fill('150');
  await expect(page.locator('#tempo-btn')).toHaveText('150 bpm');
  await expect(page.locator('#tuning-tempo-out')).toHaveText('150 bpm');
  await expect(page.locator('#tempo')).toHaveValue('150');
});

test('Zielgröße ändert die Gesamtzahl in der Taktzeile, auch während der Wiedergabe', async ({ page }) => {
  await countContexts(page);
  await openPlayPage(page);
  const length = page.locator('#length');
  await expect(length).toHaveValue('96');
  expect(await length.locator('option').evaluateAll((os) => os.map((o) => o.value))).toEqual(['24', '32', '48', '64', '96', '128', '192']); // Zielgrößen der Songform
  await length.selectOption('48');
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 1 von 48');
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(3);
  await recordPositions(page);
  const before = await shownBar(page);
  await positionsSince(page);
  expect(await page.evaluate(() => window.__instrumentSets)).toBe(1);
  await length.selectOption('24');
  // Längenänderung startet an der gleichen Position neu (neuer Instrumentensatz, gleicher AudioContext), nicht ab Takt 1
  await expect(position(page)).toHaveText(/^Takt \d+ von 24$/, { timeout: BAR_TIMEOUT });
  await expectContinuous(page, before, 'Zielgröße 24');
  expect(await page.evaluate(() => window.__instrumentSets)).toBe(2);
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
  await playGo(page).click();
});

test('Schichten: Stummtasten im Mischpult schalten live, die Spurnamen zeigen es, alle aus läuft weiter', async ({ page }) => {
  await openPlayPage(page);
  const layers = page.locator('#lane-buttons [data-layer]');
  const mutes = page.locator('#mixer button[data-mute]');
  await expect(layers).toHaveCount(6);
  await expect(mutes).toHaveCount(6);
  expect(await layers.allTextContents()).toEqual(['Schlagzeug', 'Bass', 'Akkorde', 'Pad', 'Lead', 'Percussion']);
  // Percussion startet aus, alle anderen an
  for (const [i, b] of (await layers.all()).entries()) await expect(b).toHaveAttribute('data-muted', String(i === 5));
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await mutes.nth(0).click();
  await expect(layers.nth(0)).toHaveAttribute('data-muted', 'true');
  // live, kein Neustart: ein Neustart leert die Taktzeile sofort und beginnt bei Takt 1
  expect(await position(page).textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position(page)).toHaveText('Takt 3 von 96', { timeout: BAR_TIMEOUT });
  await mutes.nth(0).click();
  await expect(layers.nth(0)).toHaveAttribute('data-muted', 'false');
  await playGo(page).click();

  for (const b of (await mutes.all()).slice(0, 5)) await b.click();
  for (const b of await layers.all()) await expect(b).toHaveAttribute('data-muted', 'true');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Stopp');
  await expect(position(page)).toHaveText('Takt 1 von 96', { timeout: BAR_TIMEOUT });
  const first = await page.locator('#play-now').textContent();
  expect(await shownChords(page)).toContain(first);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  // einschalten während der Wiedergabe geht ohne Neustart
  await mutes.nth(2).click();
  expect(await position(page).textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position(page)).toHaveText('Takt 3 von 96', { timeout: BAR_TIMEOUT });
  await playGo(page).click();
});

test('Verlauf: Canvas zeichnet, Zeiger wandert beim Spielen', async ({ page }) => {
  await openPlayPage(page);
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
  await page.locator('#mixer button[data-mute="bass"]').click();
  await expect.poll(() => lanes.evaluate((c) => c.toDataURL())).not.toBe(stopped);
  await page.locator('#mixer button[data-mute="bass"]').click();

  await playFast(page);
  const firstBar = await lanes.evaluate((c) => c.toDataURL());
  await expect(position(page)).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  await expect.poll(() => lanes.evaluate((c) => c.toDataURL()), { timeout: BAR_TIMEOUT }).not.toBe(firstBar);
  await playGo(page).click();
});

test('Akkordrad: Canvas mit Beschriftung, Klick auf passenden Akkord fügt an, auf fremden nicht', async ({ page }) => {
  await openPlayPage(page);
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
  await openPlayPage(page);
  const add = page.locator('#add-qualities button'); // Akkordart-Chips; mit dem vorgewählten Grundton A ist Am der erste aktive
  const roots = page.locator('#add-roots button');
  await expect(roots).toHaveCount(7); // A-Moll: sieben Grundtöne, die Dur-Dominante E teilt sich den Chip mit Em
  expect(await roots.allTextContents()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  // + öffnet die Auswahl als Popover; Tastaturbedienung der Folge schließt es nicht
  await expect(page.locator('#add-btn')).toHaveAccessibleName('Akkord hinzufügen');
  await expect(page.locator('#add-pop')).toBeHidden();
  await openAddPop(page);
  await expect(page.locator('#add-btn')).toHaveAttribute('aria-expanded', 'true');
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
  await add.filter({ hasText: /^Am$/ }).focus();
  for (let n = 2; n <= 8; n++) {
    await page.keyboard.press('Enter');
    await expect(progression(page)).toHaveCount(n);
    await expect(add.filter({ hasText: /^Am$/ })).toBeFocused();
  }
  await expect(progression(page).first()).toBeEnabled();
  const message = page.locator('#tuning-message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  await expect(message).toHaveText('');
  await page.keyboard.press('Enter');
  await expect(message).toHaveText(/8/);
  await expect(progression(page)).toHaveCount(8);
  await expect(add.filter({ hasText: /^Am$/ })).toBeFocused();
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

test('Akkordfolge: Rollen als Klassen und römische Stufe darunter, gestoppt bei Takt 1 für Am Am Dm E', async ({ page }) => {
  await openPlayPage(page);
  while ((await progression(page).count()) > 1) await progression(page).first().click();
  for (const name of ['Am', 'Am', 'Dm', 'E']) await addChordByName(page, name);
  await progression(page).first().click(); // der übrig gebliebene Akkord der Ausgangsfolge
  expect(await progression(page).allTextContents()).toEqual(['Am', 'Am', 'Dm', 'E']);
  expect(await progression(page).evaluateAll((els) => els.map((el) => el.className.match(/role-\w+/)[0])))
    .toEqual(['role-now', 'role-hold', 'role-next', 'role-later']);
  // Hold trägt den pinken Rand (nicht von der allgemeinen Chip-Regel überstimmt)
  expect(await progression(page).nth(1).evaluate((el) => getComputedStyle(el).boxShadow)).toContain('rgb(227, 70, 94)');
  expect(await progression(page).evaluateAll((els) => els.map((el) => el.dataset.degree))).toEqual(['i', 'i', 'iv', 'V']);
  // Stufe steht nicht im Namen der Taste
  await expect(progression(page).nth(2)).toHaveAccessibleName(/Dm.*entfernen/);
});

test('Live-Region: Hinweis bleibt bei Taktwechseln still, zweite Ablehnung meldet sich neu', async ({ page }) => {
  await openPlayPage(page);
  const add = page.locator('#add-qualities button:not([disabled])'); // erster aktiver Chip: Am
  await openAddPop(page);
  while ((await progression(page).count()) < 8) await add.first().click();
  await playFast(page);
  const message = page.locator('#tuning-message');
  await openAddPop(page);
  await add.first().click();
  await expect(message).toHaveText(/8/);
  await page.evaluate(() => {
    window.__region = 0;
    window.__controls = 0;
    new MutationObserver((list) => { window.__region += list.length; })
      .observe(document.querySelector('#tuning-message'), { childList: true, characterData: true, subtree: true });
    // Bedienelemente, die sich beim Taktwechsel nicht ändern: nichts neu schreiben
    const quiet = new MutationObserver((list) => { window.__controls += list.length; });
    // die LED vor der Spur (Klasse "on") folgt den Ereignissen und wechselt, wo eine Schicht ein- oder aussteigt: Klasse ausgenommen
    quiet.observe(document.querySelector('#lane-buttons'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-muted', 'aria-label', 'disabled'] });
    for (const id of ['#tags', '#length', '#add-chords', '#play-title', '#play-back',
      '#play-variant', '#key-select', '#scale-select', '#mode-switch', '#mod-harmony-title']) {
      quiet.observe(document.querySelector(id), { childList: true, characterData: true, subtree: true, attributes: true });
    }
  });
  await expect(position(page)).toHaveText(/^Takt \d+ von 96$/, { timeout: BAR_TIMEOUT });
  const bar = Number((await position(page).textContent()).match(/\d+/)[0]);
  await expect(position(page)).toHaveText(`Takt ${bar + 2} von 96`, { timeout: BAR_TIMEOUT });
  expect(await page.evaluate(() => [window.__region, window.__controls])).toEqual([0, 0]);
  // zweite Ablehnung: Region ändert sich (leeren und neu setzen), Text bleibt die Meldung
  await openAddPop(page);
  await add.first().click();
  await expect.poll(() => page.evaluate(() => window.__region)).toBeGreaterThan(0);
  await expect(message).toHaveText(/8/);
  // Ablehnung startet die Wiedergabe nicht neu
  expect(await position(page).textContent()).toMatch(/^Takt \d+ von 96$/);
  await playGo(page).click();
});

test('eigene Folge übersteht Stilwahl, Variante und Tonart leiten neu ab', async ({ page }) => {
  await openPlayPage(page);
  await addChordByName(page, 'G');
  await addChordByName(page, 'C');
  const edited = await shownChords(page);
  expect(edited).toHaveLength(6);
  await chooseStyle(page, 'psych');
  await expect(page.locator('#style-btn')).toHaveText('Psychedelischer Indie');
  expect(await shownChords(page)).toEqual(edited);
  // Variante und Tonart im Startsatz wählen: zurück zur Startseite und wieder hin
  await page.locator('#play-back').click();
  await page.locator('#new-variant').click();
  await expect.poll(async () => (await shownChords(page)).length).toBe(4);
  await openPlayPage(page);
  await expect(progression(page)).toHaveCount(4);

  await addChordByName(page, 'G');
  expect(await shownChords(page)).toHaveLength(5);
  await page.locator('#play-back').click();
  await page.locator('#key-btn').click();
  await page.locator('#key-pop').getByRole('button', { name: 'D', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await shownChords(page)).length).toBe(4);
  await openPlayPage(page);
  // Akkord-Knöpfe folgen der Tonart
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
});

test('keine rohen Schlüssel in beiden Sprachen auf der Spielseite', async ({ page }) => {
  await openPlayPage(page);
  expect(await rawKeysIn(page)).toEqual([]);
  await page.locator('[data-lang="en"]').click();
  await expect(tuneBtn(page)).toHaveText('Fine-tune');
  await expect(page.locator('#play-back')).toHaveText('Backing track generator');
  await expect(page.locator('#play-back')).toHaveAttribute('title', 'To start page');
  expect(await rawKeysIn(page)).toEqual([]);
  for (const id of ['#lanes', '#wheel']) {
    const label = await page.locator(id).getAttribute('aria-label');
    expect(label).toMatch(/\S/);
    expect(label).not.toMatch(RAW_KEY);
  }
  await openTags(page);
  await expect(page.getByRole('group', { name: 'Development' })).toBeVisible();
  await page.locator('[data-lang="de"]').click();
  await openTags(page);
  await expect(page.getByRole('group', { name: 'Entwicklung' })).toBeVisible();
});

test('360 px breit auf der Spielseite: kein waagerechtes Scrollen, Knöpfe mindestens 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openPlayPage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const small = await page.evaluate(() => [...document.querySelectorAll('#play button, #play input, #play select')]
    .filter((el) => el.checkVisibility() && !el.closest('.instrument, #mod-mixer')) // kleine Klangknöpfe und Fader (28 px): Handy-Unterstützung folgt später (Spec, Nicht-Ziele)
    .map((el) => ({ el: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small).toEqual([]);
  const wheel = await page.locator('#wheel').boundingBox();
  expect(wheel.x).toBeGreaterThanOrEqual(0);
  expect(wheel.x + wheel.width).toBeLessThanOrEqual(360);
});

test('Wiedergabe: Rad färbt den aktuellen Akkord, große Akkordanzeige der Startseite ist auf der Spielseite versteckt', async ({ page }) => {
  await openPlayPage(page);
  await expect(page.locator('#now-chord')).toBeHidden();
  const wheel = page.locator('#wheel');
  await page.evaluate(() => document.fonts.load("14px 'Share Tech Mono'")); // die Mitte des Rads zeichnet mit der LCD-Schrift
  const still = await wheel.evaluate((c) => c.toDataURL());
  await playFast(page);
  await expect.poll(() => wheel.evaluate((c) => c.toDataURL())).not.toBe(still);
  await expect(page.locator('#progression [aria-current="true"]')).toHaveCount(1);
  await playGo(page).click();
  await expect(page.locator('#progression [aria-current="true"]')).toHaveCount(0);
  await expect.poll(() => wheel.evaluate((c) => c.toDataURL())).toBe(still);
  await page.locator('#play-back').click();
  await expect(page.locator('#now-chord')).toBeAttached();
});

const presetPressed = (preset) => TAG_CATEGORIES
  .flatMap(({ id }) => (preset.tags[id] ?? []).map((tag) => `${id}.${tag}`)).sort();

test('Schlagworte: die vier Klang-Gruppen stehen in beiden Sprachen übersetzt im Modul Charakter, ohne rohe Schlüssel', async ({ page }) => {
  await openPlayPage(page);
  const labels = {
    de: { drumSound: 'Schlagzeugklang', bassSound: 'Bassklang', chordSound: 'Akkordklang', padSound: 'Padklang' },
    en: { drumSound: 'Drum sound', bassSound: 'Bass sound', chordSound: 'Chord sound', padSound: 'Pad sound' },
  };
  for (const lang of ['de', 'en']) {
    await page.locator(`[data-lang="${lang}"]`).click();
    await openTags(page);
    for (const [id, label] of Object.entries(labels[lang])) {
      const group = page.locator('#tags-pop').getByRole('group', { name: label, exact: true });
      await expect(group, `${lang} ${id}`).toBeVisible();
      await expect(group.getByRole('button')).toHaveCount(5);
      for (const button of await group.getByRole('button').all()) expect(await button.textContent(), `${lang} ${id}`).toMatch(/\S/);
    }
    expect(await rawKeysIn(page), lang).toEqual([]);
    // auch Namen und Beschreibungen der Knöpfe (aria-label, title, aria-description) tragen keinen rohen Schlüssel
    const attrs = await page.locator('#tags button').evaluateAll((els) => els.flatMap((el) => ['aria-label', 'aria-description', 'title']
      .map((a) => el.getAttribute(a)).filter(Boolean)));
    for (const value of attrs) expect(value).not.toMatch(RAW_KEY);
  }
});

test('Werksprofile: jeder Stil wählt genau seine Schlagworte in allen zehn Gruppen', async ({ page }) => {
  await openPlayPage(page);
  for (const preset of STYLE_PRESETS) {
    await chooseStyle(page, preset.id);
    expect(await currentStyle(page), preset.id).toBe(preset.id);
    expect(await pressedTags(page), preset.id).toEqual(presetPressed(preset));
  }
});

test('Klang-Schlagwort während der Wiedergabe: läuft ohne Neustart weiter, genau ein Player, kein neuer AudioContext', async ({ page }) => {
  await countContexts(page);
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  const contexts = () => page.evaluate(() => window.__audioContexts);
  const sets = () => page.evaluate(() => window.__instrumentSets);
  expect(await contexts()).toBe(1);
  expect(await sets()).toBe(1);
  await recordPositions(page);
  // nacheinander aus jeder der vier Klang-Kategorien; jeder Klick wirkt live, die Taktzeile läuft ohne Unterbrechung weiter
  for (const [category, tag] of [['drumSound', 'boomy'], ['bassSound', 'sub'], ['chordSound', 'tremolo'], ['padSound', 'moving']]) {
    const before = await shownBar(page);
    await positionsSince(page);
    await openTags(page);
    await page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`).click();
    await expect(page.locator(`#tags [data-tag="${tag}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expectContinuous(page, before, tag);
    expect(await contexts(), tag).toBe(1);
    expect(await sets(), `${tag}: kein neuer Instrumentensatz`).toBe(1);
    await expect(playGo(page)).toHaveText('Stopp');
  }
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  expect(await contexts()).toBe(1);
});

test('Funk-Vorlage im zweiten Teil: Klang-Schlagwort, Muster-Schlagwort und Stil wirken live ohne Neustart', async ({ page }) => {
  test.setTimeout(60_000);
  await countContexts(page);
  await openPlayPage(page);
  expect(await currentStyle(page)).toBe('funk');
  await playFast(page);
  // funk baut langsam auf: Akkorde oder Pad setzen erst ab Takt 9 ein (200 bpm: 1,2 s je Takt)
  await expect.poll(() => shownBar(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(9);
  await recordPositions(page);
  const contexts = () => page.evaluate(() => window.__audioContexts);
  const sets = () => page.evaluate(() => window.__instrumentSets);
  for (const [category, tag] of [['padSound', 'glassy'], ['chordSound', 'tremolo']]) {
    const before = await shownBar(page);
    await positionsSince(page);
    await openTags(page);
    await page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`).click();
    await expect(page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expectContinuous(page, before, tag);
    expect(await contexts(), tag).toBe(1);
    expect(await sets(), `${tag}: kein neuer Instrumentensatz`).toBe(1);
  }
  // Muster-Schlagwort: der Ereignisstrom ändert sich und wird live getauscht, ohne Neustart und ohne neuen Instrumentensatz
  let before = await shownBar(page);
  await positionsSince(page);
  await openTags(page);
  await page.locator('#tags [data-category="drums"][data-tag="driving"]').click();
  await expect(page.locator('#tags [data-category="drums"][data-tag="driving"]')).toHaveAttribute('aria-pressed', 'false');
  await expectContinuous(page, before, 'driving');
  expect(await sets(), 'driving: kein neuer Instrumentensatz').toBe(1);
  // Stil aus den Werksprofilen: Tempo, Schlagworte und Klang werden live übernommen
  before = await shownBar(page);
  await positionsSince(page);
  await chooseStyle(page, 'funk');
  // der Stil war schon funk: den Beweis tragen die Schlagworte (driving war abgewählt) und das Tempo (vorher 200)
  expect(await pressedTags(page)).toEqual(presetPressed(STYLE_PRESETS.find((p) => p.id === 'funk')));
  await expectContinuous(page, before, 'funk');
  expect(await sets(), 'funk: kein neuer Instrumentensatz').toBe(1);
  await expect(page.locator('#tuning-tempo')).toHaveValue('100');
  expect(await contexts()).toBe(1);
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
});

test('Stil auf der Startseite während der Wiedergabe: wirkt live ohne Neustart', async ({ page }) => {
  await countContexts(page);
  // feste Variante: Funk und Psych müssen die Summe 96 behalten (Build & Drop trifft das Ziel bei wenigen Varianten um 4 Takte
  // verfehlt, dann gäbe es zu Recht einen Neustart); Variante 1 behält sie
  await page.locator('#variant').fill('1');
  await page.locator('#variant').press('Enter');
  await page.locator('#go').click();
  await expect(playPage(page)).toBeVisible();
  await expect(playGo(page)).toHaveText('Stopp');
  await page.locator('#play-back').click();
  await expect(start(page)).toBeVisible();
  await page.locator('#style-btn').click();
  await page.locator('#style-cards [data-style="psych"]').click();
  await expect(page.locator('#style-btn')).toHaveText('Psychedelischer Indie');
  expect(await page.evaluate(() => window.__instrumentSets), 'kein neuer Instrumentensatz').toBe(1);
  expect(await page.evaluate(() => window.__audioContexts)).toBe(1);
});
