// Oberfläche: Startsatz, Auswahl-Popover, Los/Stopp, Variante, Sprachumschalter (echte Seite der App).
// Portiert aus tests/e2e/ui.spec.js: die App lädt ihre Seite; die Stile aus tables() der Sitzung; die erlaubten Akkorde einer Tonart
// (allowedChords) und die Grundtöne von G-Dorisch (chordOptions) als Werte, die Folge einer Variante (progressionFor) aus dem Kern der App
// (core.js); gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts zählt count-helpers.js, ein Start, der scheitert, ist
// das Ereignis der Hülle (failStarts); die Sprache wählt die Leiste der App, die eigenen Sprachtasten der Seite stehen dort verborgen; die Sprache
// merkt der Speicher der WebView (backingtrack.lang): ein Neuladen bleibt ein Neuladen.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { contexts, countContexts, failStarts } from './count-helpers.js';
import { core } from './core.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
// allowedChords({ root, mode }) der Web-App (src/core/music.js 101) als Namen
const ALLOWED = {
  'A minor': ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G', 'E'],
  'D minor': ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C', 'A'],
  'D major': ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim'],
  'Eb minor': ['Ebm', 'Fdim', 'Gb', 'Abm', 'Bbm', 'B', 'Db', 'Bb'],
  'A dorian': ['Am', 'Bm', 'C', 'D', 'Em', 'F#dim', 'G'],
  'G dorian': ['Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim', 'F'],
};
const namesIn = (root, mode) => ALLOWED[`${root} ${mode}`];
// chordOptions({ root: 'G', mode: 'dorian' }).map((o) => o.root) der Web-App (src/core/music.js 130)
const G_DORIAN_ROOTS = ['G', 'A', 'Bb', 'C', 'D', 'E', 'F'];
const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
});

// die Seite neu laden (die Web-App: goto): die Sprache merkt der Speicher der WebView
async function open(page) {
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
}

const sentence = (page) => page.locator('#sentence');
const go = (page) => page.locator('#go');
// Los startet und öffnet die Spielseite; zurück zur Startseite, die Wiedergabe läuft weiter
async function goAndBack(page) {
  await go(page).click();
  await expect(page.locator('#play')).toBeVisible();
  await page.locator('#play-back').click();
  await expect(page.locator('#start')).toBeVisible();
}
// angezeigte Folge "Am – Am – Dm – E" als Liste, gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const shownChords = async (page) => { await answered(page); return (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim()); };
const normalized = async (locator) => (await locator.textContent()).replace(/\s+/g, ' ').trim();

async function rawKeysIn(page) {
  return page.evaluate((source) => {
    const re = new RegExp(source);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
    for (const el of document.querySelectorAll('[aria-label], [title]')) {
      for (const attr of ['aria-label', 'title']) if (re.test(el.getAttribute(attr) ?? '')) found.push(`${attr}=${el.getAttribute(attr)}`);
    }
    if (re.test(document.title)) found.push(`title=${document.title}`);
    return found;
  }, RAW_KEY.source);
}

async function checkNoRawKeys(page) {
  expect(await rawKeysIn(page)).toEqual([]);
  for (const id of ['#key-btn', '#style-btn', '#tempo-btn']) {
    await page.locator(id).click();
    await expect(page.locator(`#${await page.locator(id).getAttribute('aria-controls')}`)).toBeVisible();
    expect(await rawKeysIn(page), id).toEqual([]);
    await page.keyboard.press('Escape');
  }
}

test('Startsatz auf Deutsch, Spielseite versteckt, kein AudioContext beim Laden', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  const text = await normalized(sentence(page));
  for (const part of ['A-Moll-Pentatonik', 'Funk-Rock', '100']) expect(text).toContain(part);
  expect(text).toBe('A-Moll-Pentatonik im Stil Funk-Rock bei 100 bpm');
  await expect(go(page)).toHaveText('Los');
  await expect(page.getByRole('spinbutton', { name: 'Variante', exact: true })).toHaveValue(/^\d{1,4}$/);
  expect(await shownChords(page)).toHaveLength(4);
  await expect(page.locator('#play')).toBeAttached();
  await expect(page.locator('#play')).toBeHidden();
  expect(await contexts(page)).toBe(0);
});

test('Los startet mit aktuellem Akkord und Taktzeile, Stopp hält an; ein AudioContext für alle Starts', async ({ page }) => {
  const chords = await shownChords(page);
  expect(await contexts(page)).toBe(0);
  await goAndBack(page);
  await expect(go(page)).toHaveText('Stopp');
  const now = page.locator('#now-chord');
  await expect(now).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  expect(chords).toContain(await now.textContent());
  const position = page.locator('#position');
  await expect(position).toHaveText(/^Takt 1 von 96$/, { timeout: BAR_TIMEOUT });
  await expect(position).toHaveText(/^Takt 2 von 96$/, { timeout: BAR_TIMEOUT });
  await go(page).click();
  await expect(go(page)).toHaveText('Los');
  await expect(now).toHaveText('');
  await expect(position).toHaveText('');
  // die Web-App baut ihren AudioContext beim ersten Start und spielt jeden weiteren darauf; die Engine der App gibt es einmal, contexts() zählt
  // die Starts: jeder Los ist genau ein Start, gezählt je Start
  expect(await contexts(page)).toBe(1);
  await countContexts(page);
  await goAndBack(page);
  await expect(now).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  await go(page).click();
  await expect(go(page)).toHaveText('Los');
  expect(await contexts(page)).toBe(1);
});

test('Stil-Popover: Träumerisch ändert Satz und Tempo, schließt und gibt den Fokus zurück', async ({ page }) => {
  const { STYLE_PRESETS } = await fromSession(page, 'tables');
  const button = page.locator('#style-btn');
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const pop = page.locator('#style-pop');
  await expect(pop).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(pop.getByRole('button')).toHaveCount(STYLE_PRESETS.length);
  await pop.getByRole('button', { name: /Träumerisch/ }).click();
  await expect(pop).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await answered(page);
  await expect(sentence(page)).toContainText('Träumerisch');
  await expect(page.locator('#tempo-btn')).toHaveText('80 bpm');
  await button.click();
  await expect(pop.getByRole('button', { name: /Träumerisch/ })).toHaveAttribute('aria-pressed', 'true');
});

test('Popover: Escape schließt und fokussiert den Knopf, nur eines offen, Klick daneben schließt', async ({ page }) => {
  const keyButton = page.locator('#key-btn');
  const keyPop = page.locator('#key-pop');
  await keyButton.click();
  await expect(keyPop).toBeVisible();
  // Fokus liegt im Popover, Inhalt per Tastatur erreichbar
  await expect.poll(() => keyPop.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => keyPop.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(keyPop).toBeHidden();
  await expect(keyButton).toBeFocused();
  await expect(keyButton).toHaveAttribute('aria-expanded', 'false');

  await keyButton.click();
  await page.locator('#style-btn').click();
  await expect(page.locator('#style-pop')).toBeVisible();
  await expect(keyPop).toBeHidden();
  await page.mouse.click(5, 5);
  await expect(page.locator('#style-pop')).toBeHidden();

  // Tastatur: Enter öffnet, Tempo-Regler bekommt den Fokus
  await page.locator('#tempo-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tempo-pop')).toBeVisible();
  await expect(page.locator('#tempo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tempo-btn')).toBeFocused();
});

test('andere Tonart und Skala: Satz und Akkorde folgen, auch während der Wiedergabe', async ({ page }) => {
  await page.locator('#key-btn').click();
  const pop = page.locator('#key-pop');
  await pop.getByRole('button', { name: 'D', exact: true }).click();
  await expect(sentence(page)).toContainText('D-Moll-Pentatonik');
  await expect(pop.getByRole('button', { name: 'D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const c of await shownChords(page)) expect(namesIn('D', 'minor')).toContain(c);

  await pop.getByRole('button', { name: 'Dur-Pentatonik' }).click();
  await expect(sentence(page)).toContainText('D-Dur-Pentatonik');
  for (const c of await shownChords(page)) expect(namesIn('D', 'major')).toContain(c);

  await page.keyboard.press('Escape');
  await goAndBack(page);
  await expect(page.locator('#now-chord')).toHaveText(/\S/, { timeout: BAR_TIMEOUT });
  await page.locator('#key-btn').click();
  await pop.getByRole('button', { name: 'Eb', exact: true }).click();
  await pop.getByRole('button', { name: 'Blues', exact: true }).click();
  await expect(sentence(page)).toContainText('Eb-Blues');
  await settled(page); // die Hülle hat getan, was die Tonart auslöst (ein Neustart käme nach der Antwort): "Stopp" stünde auch vorher da
  await expect(go(page)).toHaveText('Stopp');
  const ebMinor = namesIn('Eb', 'minor');
  await expect.poll(async () => ebMinor.includes(await page.locator('#now-chord').textContent()), { timeout: BAR_TIMEOUT }).toBe(true);
  await page.keyboard.press('Escape');
  await go(page).click();
  expect(await contexts(page)).toBe(1);
});

test('Dorisch: Satz, Akkorde der dorischen Tonart (mit Dur-IV), Feintuning und Englisch folgen', async ({ page }) => {
  await page.locator('#key-btn').click();
  const pop = page.locator('#key-pop');
  await pop.getByRole('button', { name: 'Dorisch' }).click();
  await expect(sentence(page)).toContainText('A-Dorisch');
  const chords = await shownChords(page);
  expect(chords).toHaveLength(4);
  for (const c of chords) expect(namesIn('A', 'dorian')).toContain(c);
  expect(chords).toContain('D'); // jede dorische Vorlage hat die Dur-IV, die es in A-Moll nicht gibt
  await pop.getByRole('button', { name: 'G', exact: true }).click();
  await expect(sentence(page)).toContainText('G-Dorisch');
  for (const c of await shownChords(page)) expect(namesIn('G', 'dorian')).toContain(c);
  await page.keyboard.press('Escape');
  await page.locator('#tune-btn').click();
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(G_DORIAN_ROOTS);
  await chooseLanguage(page, 'en');
  await expect(sentence(page)).toContainText('G dorian');
  expect(await rawKeysIn(page)).toEqual([]);
});

test('andere Variante ändert die Nummer und zeigt vier gültige Akkorde', async ({ page }) => {
  const variant = page.locator('#variant');
  const before = await variant.inputValue();
  let after = before;
  for (let i = 0; i < 5 && after === before; i++) {
    await page.locator('#new-variant').click();
    await answered(page);
    after = await variant.inputValue();
  }
  expect(after).not.toBe(before);
  const n = Number(after.match(/\d+/)[0]);
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(9999);
  const chords = await shownChords(page);
  expect(chords).toHaveLength(4);
  for (const c of chords) expect(namesIn('A', 'minor')).toContain(c);
});

// die Folge, die die Variante in der Tonart erzeugt: eine frische Sitzung auf der Variante in der Tonart (progressionFor der Web-App)
const expectedChords = (key, seed) => core([{ action: 'start', variant: seed }, ...(key.root === 'A' ? [] : [{ action: 'setRoot', root: key.root, from: 'start' }])])
  .at(-1).track.bars.map(({ chord }) => chord.root + SYMBOLS[chord.quality]);

test('Variantennummer eingeben: gleiche Nummer, gleiche Folge; Feld mit Name, Grenzen und Fokusrahmen', async ({ page }) => {
  const field = page.getByRole('spinbutton', { name: 'Variante', exact: true });
  await expect(field).toHaveAttribute('min', '1');
  await expect(field).toHaveAttribute('max', '9999');
  await field.fill('4711');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  await field.focus();
  expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  // andere Variante würfelt und schreibt die Nummer ins Feld, dieselbe Nummer bringt die Folge zurück
  await page.locator('#new-variant').click();
  await answered(page);
  const rolled = Number(await field.inputValue());
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, rolled));
  await field.fill('4711');
  await field.blur();
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  // andere Tonart: Nummer bleibt, Folge der neuen Tonart
  await page.locator('#key-btn').click();
  await page.locator('#key-pop').getByRole('button', { name: 'D', exact: true }).click();
  await page.keyboard.press('Escape');
  await answered(page); // die Nummer stünde auch vor der Antwort da
  await expect(field).toHaveValue('4711');
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'D', mode: 'minor' }, 4711));
  await field.fill('12');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'D', mode: 'minor' }, 12));
});

test('ungültige Variantennummer (0, 10000, Buchstaben, leer) wird ignoriert, Feld springt zurück', async ({ page }) => {
  const field = page.locator('#variant');
  await field.fill('4711');
  await field.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 4711));
  const chords = await shownChords(page);
  for (const bad of ['0', '10000', '-3', '2.5', '']) {
    await field.fill(bad);
    await field.press('Enter');
    await field.blur();
    await answered(page); // schickte die Seite etwas, stünde die Antwort hier
    await expect(field).toHaveValue('4711');
    expect(await shownChords(page), bad).toEqual(chords);
  }
  await field.fill('');
  await field.pressSequentially('abc');
  await field.blur();
  await answered(page);
  await expect(field).toHaveValue('4711');
  expect(await shownChords(page)).toEqual(chords);
});

test('Variantennummer während der Wiedergabe startet im laufenden Takt neu; auf Englisch ohne rohe Schlüssel', async ({ page }) => {
  await goAndBack(page);
  const position = page.locator('#position');
  await expect(position).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  const field = page.locator('#variant');
  // Absichtliche Verhaltensänderung: kein Sprung mehr auf Takt 1, die Taktzeile läuft weiter (Aufbau schon voll)
  await page.evaluate(() => {
    window.__positions = [];
    const el = document.querySelector('#position');
    new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  await field.fill('321');
  await field.press('Enter');
  await expect(position).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  await settled(page); // der Neustart am Takt kommt nach der Antwort: die Taktzeile zeigt ihn bis hier
  expect((await page.evaluate(() => window.__positions)).filter(Boolean)).not.toContain('Takt 1 von 96');
  await expect(go(page)).toHaveText('Stopp');
  expect(await shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 321));
  await go(page).click();

  await chooseLanguage(page, 'en');
  const en = page.getByRole('spinbutton', { name: 'Variant', exact: true });
  await expect(en).toHaveValue('321');
  await en.fill('9999');
  await en.press('Enter');
  await expect.poll(() => shownChords(page)).toEqual(expectedChords({ root: 'A', mode: 'minor' }, 9999));
  expect(await rawKeysIn(page)).toEqual([]);
  expect(await contexts(page)).toBe(1);
});

test('Tempo-Regler während der Wiedergabe: kein Neustart, kein Fehler', async ({ page }) => {
  await goAndBack(page);
  const position = page.locator('#position');
  await expect(position).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await page.locator('#tempo-btn').click();
  await page.locator('#tempo').fill('160');
  await settled(page); // die Taste und die Anzeige zeigen die Hand des Reglers bis zur Antwort; ein Neustart käme nach ihr
  await expect(page.locator('#tempo-out')).toHaveText('160');
  await expect(page.locator('#tempo-btn')).toHaveText('160 bpm');
  // ein Neustart würde die Taktzeile leeren und bei Takt 1 beginnen
  expect(await position.textContent()).toMatch(/^Takt [2-9] von 96$/);
  await expect(position).toHaveText(/^Takt [3-9] von 96$/, { timeout: BAR_TIMEOUT });
  await expect(go(page)).toHaveText('Stopp');
  await page.locator('#tempo').fill('40');
  await answered(page);
  await expect(page.locator('#tempo-btn')).toHaveText('40 bpm');
  await page.keyboard.press('Escape');
  await go(page).click();
  expect(await contexts(page)).toBe(1);
});

test('Sprachumschalter: Englisch ohne Neuladen, bleibt nach Neuladen, keine rohen Schlüssel', async ({ page }) => {
  await checkNoRawKeys(page);
  const en = page.locator('[data-lang="en"]');
  // die Sprachtasten der Seite stehen in der App verborgen (die Leiste der App wählt die Sprache): die Seite führt ihre Gruppe weiter
  await expect(page.locator('[role="group"][aria-label="Sprache"]')).toBeAttached();
  await chooseLanguage(page, 'en');
  await expect(en).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  expect(await normalized(sentence(page))).toMatch(/^A minor pentatonic in Funk rock at 100 bpm$/i);
  await expect(go(page)).toHaveText('Go');
  await expect(page.locator('#new-variant')).toHaveText('another variant');
  await expect(page.getByRole('spinbutton', { name: 'Variant', exact: true })).toHaveValue(/^\d+$/);
  await checkNoRawKeys(page);
  await goAndBack(page);
  await expect(page.locator('#position')).toHaveText(/^Bar \d+ of 96$/, { timeout: BAR_TIMEOUT });
  await go(page).click();

  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  await chooseLanguage(page, 'de');
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  await open(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('genau eine h1 mit übersetztem Titel, nur für Screenreader sichtbar', async ({ page }) => {
  for (const [lang, title] of [['de', 'Backingtrack-Generator'], ['en', 'Backing track generator']]) {
    await chooseLanguage(page, lang);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    // versteckt per Clip, nicht per display:none (sonst fehlt sie im Barrierefreiheitsbaum)
    expect(await page.locator('h1').evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
  }
});

test.describe('englischer Browser', () => {
  test.use({ locale: 'en-US' });
  test('erster Besuch folgt navigator.language', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#tonight')).toHaveText('Tonight:');
    await expect(go(page)).toHaveText('Go');
  });
});

// Was die Seite der App noch aus dem localStorage liest: die Sprache (backingtrack.lang), Fokus/Einstellen und das Griffbrett (backingtrack.layout)
// und die Einträge der alten Seite für die einmalige Übernahme (backingtrack.profiles, .session, .mix, .imported); alles andere hält die App.
test('ohne localStorage (Zugriff wirft) läuft die Seite weiter', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await open(page);
  await expect(page.locator('#tonight')).toHaveText('Heute Abend:');
  await chooseLanguage(page, 'en');
  await expect(page.locator('#tonight')).toHaveText('Tonight:');
  await goAndBack(page);
  await expect(go(page)).toHaveText('Stop');
  await go(page).click();
  await expect(go(page)).toHaveText('Go');
  // Feintuning merkt den Zustand Einstellen: ohne Speicher nur bis zum Neuladen, ohne Fehler
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
});

test('Startfehler stürzt nicht ab: Meldung in der gewählten Sprache', async ({ page }) => {
  await failStarts(page);
  await open(page);
  const message = page.locator('#message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  // Live-Region muss schon leer gerendert sein, sonst kündigen Screenreader den ersten Text oft nicht an
  await expect(message).toHaveText('');
  expect(await message.evaluate((el) => {
    const s = getComputedStyle(el);
    return { display: s.display !== 'none', visibility: s.visibility, ancestorsShown: el.checkVisibility({ visibilityProperty: true }) };
  })).toEqual({ display: true, visibility: 'visible', ancestorsShown: true });
  await go(page).click();
  await expect(message).toHaveText('Die Wiedergabe konnte nicht starten.');
  await expect(message).toBeVisible();
  await expect(go(page)).toHaveText('Los');
  const german = await message.textContent();
  await chooseLanguage(page, 'en');
  await expect(message).not.toHaveText(german);
  await expect(message).toHaveText(/\S/);
  expect(await rawKeysIn(page)).toEqual([]);
});

test('360 px breit: kein waagerechtes Scrollen, Popover im Bild, Knöpfe mindestens 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noScroll()).toBe(true);
  const small = () => page.evaluate(() => [...document.querySelectorAll('button, input')]
    .filter((el) => el.checkVisibility())
    .map((el) => ({ el: el.id || el.textContent.trim(), r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => `${el} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(await small()).toEqual([]);
  for (const id of ['key', 'style', 'tempo']) {
    await page.locator(`#${id}-btn`).click();
    const box = await page.locator(`#${id}-pop`).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(344);
    expect(await noScroll()).toBe(true);
    expect(await small(), id).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

test('Stil-Karten: jeder Stil hat Name, Tempo, Hinweis und ein 16er-Rhythmusbild, ohne rohe Schlüsselnamen', async ({ page }) => {
  const { STYLE_PRESETS } = await fromSession(page, 'tables');
  await page.locator('#style-btn').click();
  const cards = page.locator('#style-cards .card');
  await expect(cards).toHaveCount(STYLE_PRESETS.length);
  for (const { id, bpm } of STYLE_PRESETS) {
    const card = page.locator(`#style-cards [data-style="${id}"]`);
    await expect(card.locator('.card-name'), id).toHaveText(/\S/);
    await expect(card.locator('.card-hint'), id).toHaveText(/\S/);
    await expect(card.locator('.card-bpm'), id).toContainText(String(bpm));
    await expect(card.locator('.rhythm i'), id).toHaveCount(16);
    for (const part of ['.card-name', '.card-hint']) expect(RAW_KEY.test((await card.locator(part).textContent()).trim()), `${id} ${part}`).toBe(false);
  }
});

test('jeder neue Stil: Auswahl setzt Tempo und Namen, Los startet ohne Fehler', async ({ page }) => {
  test.setTimeout(60_000);
  const { STYLE_PRESETS } = await fromSession(page, 'tables');
  for (const { id, bpm } of STYLE_PRESETS.filter((p) => !['funk', 'psych', 'dreamy'].includes(p.id))) {
    await page.locator('#style-btn').click();
    await page.locator(`#style-cards [data-style="${id}"]`).click();
    await answered(page);
    await expect(page.locator(`#style-cards [data-style="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#tempo-btn'), id).toContainText(String(bpm));
  }
  await go(page).click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
});

// Spielseite im Zustand Einstellen (mit offenem Profil-Fenster) in beiden Sprachen: keine rohen Schlüssel, nirgends Text unter 11 px
const RAW_KEY_PLAY = /^(ui|tag|style|err|layer|scale|mode|category|view|form|voice|job|timbre|groove|chordColor)\.[A-Za-z.]+$/;
for (const lang of ['de', 'en']) {
  test(`Spielseite (${lang}, Einstellen): keine rohen Schlüssel, kein sichtbarer Text unter 11 px`, async ({ page }) => {
    await chooseLanguage(page, lang);
    await page.locator('#tune-btn').click();
    await expect(page.locator('#rack')).toBeVisible();
    await page.locator('#profiles-btn').click();
    await expect(page.locator('#profiles-pop')).toBeVisible();
    const found = await page.evaluate((source) => {
      const re = new RegExp(source);
      const raw = [];
      const small = [];
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      for (const el of document.querySelectorAll('#play *, #play ~ *')) {
        if (el.closest('[hidden]') || el.tagName === 'OPTION' || el.tagName === 'STYLE' || el.tagName === 'SCRIPT' || !visible(el)) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim());
        if (own.length && Number.parseFloat(getComputedStyle(el).fontSize) < 11) small.push(`${el.id || el.className || el.tagName}: ${own.join(' ')}`);
        for (const text of own) if (re.test(text)) raw.push(text);
        for (const attr of ['aria-label', 'title']) if (re.test(el.getAttribute(attr) ?? '')) raw.push(`${attr}=${el.getAttribute(attr)}`);
      }
      return { raw, small };
    }, RAW_KEY_PLAY.source);
    expect(found.raw).toEqual([]);
    expect(found.small).toEqual([]);
  });
}
