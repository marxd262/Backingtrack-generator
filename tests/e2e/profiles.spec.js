// Profil-Fenster neben dem Mischpult: Baum (Aktuelle Sitzung, Werksprofile, Meine Profile), Sitzung speichern und laden, Teile-Auswahl,
// Werksprofile laden, Überschreiben, Umbenennen, Löschen, Ordner, Export/Import nach Auswahl, Alles sichern, Rückgängig, Tastatur, breit und schmal
// (echte Seite /ui/index.html).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

let problems;
test.use({ locale: 'de-DE' });

const watch = (page) => {
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
};
const openWindow = async (page) => {
  await page.locator('#profiles-btn').click();
  await expect(page.locator('#profiles-pop')).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  problems = [];
  watch(page);
  await page.goto('/ui/index.html');
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await openWindow(page);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const STYLES = ['Funk-Rock', 'Psychedelischer Indie', 'Träumerisch, langsam', 'Blues-Shuffle', 'Classic Rock', 'Hardrock', 'Reggae', 'Country', 'Pop-Punk'];
const tempo = (page) => page.locator('#tuning-tempo-out');
const message = (page) => page.locator('#profile-message');
const items = (page) => page.locator('#profile-tree [role="treeitem"]');
const item = (page, name) => page.getByRole('treeitem', { name, exact: true });
const setTempo = async (page, bpm) => {
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.locator('#tuning-tempo').fill(String(bpm));
  await openWindow(page);
};
const saveSession = async (page, name) => {
  await item(page, 'Aktuelle Sitzung').click();
  await page.getByLabel('Name des Profils').fill(name);
  await page.locator('#profile-save').click();
};
const load = async (page, name) => {
  await item(page, name).click();
  await page.locator('#profile-load').click();
};
// Teile eines gespeicherten Profils aus localStorage
const storedParts = (page, name) => page.evaluate((n) => {
  const walk = (list) => list.flatMap((x) => (x.type === 'folder' ? walk(x.items) : [x]));
  return Object.keys(walk(JSON.parse(localStorage.getItem('backingtrack.profiles')).items).find((x) => x.name === n).parts);
}, name);
const stored = (page) => page.evaluate(() => localStorage.getItem('backingtrack.profiles'));
const info = (page) => page.locator('#profile-panel-info');
const undo = (page) => page.locator('#profile-undo');
// Unterordner im gewählten Ordner anlegen (wählt den neuen Ordner)
// tiefe Zeilen am Namen anklicken: die Mitte der Zeile liegt dort schon auf dem Pfeil zum Auf-/Zuklappen
const pickRow = (page, name) => item(page, name).locator('.tree-label').click();
const newFolder = async (page, parent, name) => {
  await pickRow(page, parent);
  await page.locator('#profile-subfolder').click();
  await page.getByLabel('Name des Ordners').fill(name);
  await page.locator('#profile-folder-add').click();
};
// Sitzung in einem eigenen Ordner speichern (Ordner-Auswahl nach dem Text ohne Einrückung)
const saveIn = async (page, name, folderName) => {
  await item(page, 'Aktuelle Sitzung').click();
  await page.locator('#profile-folder').evaluate((s, n) => { s.value = [...s.options].find((o) => o.textContent.trim() === n).value; }, folderName);
  await page.getByLabel('Name des Profils').fill(name);
  await page.locator('#profile-save').click();
};
const downloadJson = async (page, button) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
};
const copied = async (page) => {
  await page.locator('#profile-copy').click();
  return JSON.parse(await page.locator('#profile-text').inputValue());
};
// gespeicherten Baum vorgeben und das Fenster neu öffnen (eigene Ordner sind dann zugeklappt); hoch genug, dass der Baum nicht scrollt
const seed = async (page, nodes, height = 1500) => {
  await page.setViewportSize({ width: 1280, height });
  await page.evaluate((v) => localStorage.setItem('backingtrack.profiles', v), JSON.stringify({ version: 2, items: nodes }));
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
};
const prof = (id, name) => ({ id, type: 'profile', name, parts: { tempo: { bpm: 90 } } });
const dir = (id, name, nodes = []) => ({ id, type: 'folder', name, items: nodes });
const deep = (i) => dir(`d${i}`, `D${i}`, i < 8 ? [deep(i + 1)] : []); // D1 … D8, D8 auf Ebene 8
// A > B > C (3 Ebenen hoch), D1 … D8, Z mit einem Profil P, P oben
const FIXTURE = [dir('a', 'A', [dir('b', 'B', [dir('c', 'C')])]), deep(1), dir('z', 'Z', [prof('zp', 'P')]), prof('p', 'P')];
const names = (list) => list.map((n) => n.name);
const storedTree = async (page) => JSON.parse(await stored(page));
const moveOptions = async (page) => (await page.locator('#profile-move-to option').allTextContents()).map((o) => o.trim());
const grip = (page, name) => item(page, name).locator('.drag-handle');
const center = async (locator) => { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
// Maus: am Griff drücken, in Schritten zum Ziel, dort (noch nicht) loslassen
const mouseTo = async (page, from, to) => {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const b = await center(to);
  await page.mouse.move(b.x, b.y, { steps: 8 });
};
// Touch: synthetische PointerEvents (pointerType touch) am Element unter dem Punkt, wie der Browser sie schickt
const pointer = (page, type, { x, y }, extra = {}) => page.evaluate(({ type, x, y, extra }) => {
  document.elementFromPoint(x, y).dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, ...extra,
  }));
}, { type, x, y, extra });
const touch = (page, type, at) => pointer(page, type, at);
const toBottom = (tree) => tree.evaluate((t) => { t.scrollTop = t.scrollHeight; return t.scrollTop; });
const markers = (page) => page.locator('#profile-tree [data-drop], #profile-tree [data-dragging]');
const buzz = (page) => page.evaluate(() => { window.__buzz = []; navigator.vibrate = (p) => { window.__buzz.push(p); return true; }; });

test('Fenster zeigt den Baum: Aktuelle Sitzung (gewählt), Werksprofile mit 9 Stilen, Meine Profile; englisch übersetzt', async ({ page }) => {
  await expect(page.locator('#profile-tree')).toHaveAttribute('role', 'tree');
  await expect(items(page)).toHaveText(['Aktuelle Sitzung', 'Werksprofile', ...STYLES, 'Meine Profile']);
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-level', '1');
  await expect(item(page, 'Werksprofile')).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'Reggae')).toHaveAttribute('aria-level', '2');
  await expect(item(page, 'Meine Profile')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#profile-tree [tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('#profile-session-summary')).toContainText('100 bpm');
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.getByRole('button', { name: /^EN/i }).click();
  await openWindow(page);
  await expect(items(page).first()).toHaveText('Current session');
  await expect(item(page, 'My profiles')).toBeVisible();
});

test('Sitzung speichern legt das Profil in „Meine Profile“ an und wählt es; Laden stellt das Tempo wieder her; bleibt nach dem Neuladen', async ({ page }) => {
  await page.getByLabel('Name des Profils').fill('Test A');
  await page.getByLabel('Ordner', { exact: true }).selectOption({ label: 'Meine Profile' });
  await page.locator('#profile-save').click();
  await expect(message(page)).toContainText('Test A');
  await expect(item(page, 'Test A')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Test A')).toHaveAttribute('aria-level', '2');
  await expect(item(page, 'Test A')).toBeFocused();
  await setTempo(page, 77);
  await expect(tempo(page)).toHaveText('77');
  await load(page, 'Test A');
  await expect(tempo(page)).toHaveText('100');
  await expect(message(page)).toHaveText('Profil übernommen.');
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
  await expect(items(page).last()).toHaveText('Test A');
});

test('Teile-Auswahl: eingeklappt, 9 Kästchen, „Nur Klang“ speichert nur die Klang-Teile, Laden lässt das Tempo unberührt', async ({ page }) => {
  const picker = page.locator('#profile-save-parts');
  await expect(picker).not.toHaveAttribute('open');
  await expect(picker.locator('summary')).toHaveText('Inhalt: Alles');
  await expect(picker.locator('input[type="checkbox"]').first()).toBeHidden();
  await picker.locator('summary').click();
  await expect(picker.locator('input[type="checkbox"]')).toHaveCount(9);
  for (const box of await picker.locator('input[type="checkbox"]').all()) await expect(box).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Tempo', exact: true })).toBeChecked();
  await picker.getByRole('button', { name: 'Nur Klang' }).click();
  await expect(picker.locator('summary')).toHaveText('Inhalt: 3 von 9');
  await expect(page.getByRole('checkbox', { name: 'Tempo', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Mischpult', exact: true })).toBeChecked();
  await page.getByLabel('Name des Profils').fill('Klang');
  await page.locator('#profile-save').click();
  await expect(item(page, 'Klang')).toHaveAttribute('aria-selected', 'true');
  expect(await storedParts(page, 'Klang')).toEqual(['sound', 'voices', 'mixer']);
  await setTempo(page, 77);
  await load(page, 'Klang');
  await expect(message(page)).toHaveText('Profil übernommen.');
  await expect(tempo(page)).toHaveText('77');
  // „Nichts“ speichert nichts
  await item(page, 'Aktuelle Sitzung').click();
  await picker.getByRole('button', { name: 'Nichts' }).click();
  await expect(picker.locator('summary')).toHaveText('Inhalt: 0 von 9');
  await page.getByLabel('Name des Profils').fill('Leer');
  await page.locator('#profile-save').click();
  await expect(message(page)).toContainText('mindestens einen Teil');
  await expect(item(page, 'Leer')).toHaveCount(0);
});

test('„Nur Rhythmus“ in 4/4 gespeichert, in 6/8 geladen: das Tempo wird umgerechnet wie beim Taktartwechsel', async ({ page }) => {
  await page.locator('#profile-save-parts summary').click();
  await page.locator('#profile-save-parts').getByRole('button', { name: 'Nur Rhythmus' }).click();
  await saveSession(page, 'Rh'); // 4/4, 100 bpm
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  if (!(await page.locator('#side-left').isVisible())) await page.locator('#toggle-left').click();
  await page.locator('#meter-chips [data-meter="6/8"]').click();
  await page.locator('#tuning-tempo').fill('50');
  await openWindow(page);
  await load(page, 'Rh');
  await expect(tempo(page)).toHaveText('67'); // dieselbe Achtelgeschwindigkeit wie 100 in 4/4
  await expect(page.locator('#meter-chips [aria-pressed="true"]')).toHaveAttribute('data-meter', '6/8');
});

test('Werksprofil laden: Stil, Tempo und Kurzbeschreibung wie früher der Stil-Chip', async ({ page }) => {
  await load(page, 'Reggae');
  await expect(tempo(page)).toHaveText('76');
  await item(page, 'Aktuelle Sitzung').click();
  await expect(page.locator('#profile-session-summary')).toContainText('Stil: Reggae');
  await load(page, 'Funk-Rock');
  await expect(tempo(page)).toHaveText('100');
  await item(page, 'Aktuelle Sitzung').click();
  await expect(page.locator('#profile-session-summary')).toContainText('Stil: Funk');
});

test('Werksprofil: Kopie in „Meine Profile“, gleichnamig mit „ (2)“; Austausch kopiert die Stil-Teile', async ({ page }) => {
  await item(page, 'Blues-Shuffle').click();
  await page.locator('#profile-factory-copy').click();
  await expect(item(page, 'Blues-Shuffle').last()).toHaveAttribute('aria-selected', 'true'); // die Kopie ist gewählt
  await item(page, 'Blues-Shuffle').first().click();
  await page.locator('#profile-factory-copy').click();
  await expect(items(page).filter({ hasText: 'Blues-Shuffle' })).toHaveText(['Blues-Shuffle', 'Blues-Shuffle', 'Blues-Shuffle (2)']);
  expect(await storedParts(page, 'Blues-Shuffle')).toEqual(['tempo', 'style', 'sound']);
  await item(page, 'Blues-Shuffle').first().click(); // Austausch des Werksprofils
  await page.locator('#profile-copy').click();
  const file = JSON.parse(await page.locator('#profile-text').inputValue());
  expect(file.format).toBe('backingtrack-profile');
  expect(file.parts.style.style).toBe('blues');
  expect(file.parts.tempo.bpm).toBe(88);
  expect(file.parts.sound).toEqual({ timbre: {} });
});

test('Gleichnamig speichern und ohne Namen: Meldung, nichts ersetzt, die Liste bleibt bei einem Eintrag', async ({ page }) => {
  await page.locator('#profile-save').click();
  await expect(message(page)).toHaveText('Bitte einen Namen eingeben.');
  await saveSession(page, 'A');
  await setTempo(page, 66);
  await saveSession(page, 'a');
  await expect(message(page)).toContainText('Mit Sitzung überschreiben');
  await expect(items(page).filter({ hasText: /^a$/i })).toHaveCount(1);
  await load(page, 'A');
  await expect(tempo(page)).toHaveText('100');
});

test('Tastatur: ein Tabstopp, Pfeil ab/auf, Rechts/Links klappt Ordner und springt, Pos1/Ende, Enter wählt', async ({ page }) => {
  const focused = (name) => expect(item(page, name)).toBeFocused();
  await focused('Aktuelle Sitzung');
  await page.keyboard.press('ArrowDown');
  await focused('Werksprofile');
  await page.keyboard.press('ArrowRight');
  await focused('Funk-Rock');
  await page.keyboard.press('ArrowLeft');
  await focused('Werksprofile');
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'Werksprofile')).toHaveAttribute('aria-expanded', 'false');
  await expect(items(page)).toHaveCount(3);
  await focused('Werksprofile');
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'Werksprofile')).toHaveAttribute('aria-expanded', 'true');
  await expect(items(page)).toHaveCount(12);
  await page.keyboard.press('End');
  await focused('Meine Profile');
  await page.keyboard.press('ArrowUp');
  await focused('Pop-Punk');
  await page.keyboard.press('Enter');
  await expect(item(page, 'Pop-Punk')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#profile-load')).toBeVisible();
  await focused('Pop-Punk');
  await expect(page.locator('#profile-tree [tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Home');
  await focused('Aktuelle Sitzung');
  await page.keyboard.press(' ');
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#profile-save')).toBeVisible();
});

test('Namen mit HTML erscheinen als Text', async ({ page }) => {
  await saveSession(page, '<b>x</b>');
  await expect(item(page, '<b>x</b>')).toHaveText('<b>x</b>');
  await expect(page.locator('#profile-tree b, #profile-panel b')).toHaveCount(0);
  await expect(page.locator('#profile-panel-title')).toHaveText('<b>x</b>');
});

test('Import: ein kopiertes Profil mit anderem Tempo wird in „Meine Profile“ aufgenommen und gewählt, Laden setzt das Tempo', async ({ page }) => {
  await page.locator('#profile-copy').click();
  const p = JSON.parse(await page.locator('#profile-text').inputValue());
  expect(p.format).toBe('backingtrack-profile');
  expect(Object.keys(p.parts)).toHaveLength(9);
  p.name = 'Von Freund';
  p.parts.tempo.bpm = 77;
  p.parts.extra = { zukunft: 1 };
  await page.locator('#profile-text').fill(JSON.stringify(p));
  await page.locator('#profile-import-text').click();
  await expect(message(page)).toContainText('Von Freund');
  await expect(item(page, 'Von Freund')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Von Freund')).toHaveAttribute('aria-level', '2');
  await expect(tempo(page)).toHaveText('100'); // aufgenommen, nicht geladen
  await page.locator('#profile-load').click();
  await expect(tempo(page)).toHaveText('77');
});

test('Import aus einer Datei; zu große Datei und kein JSON werden abgelehnt, ohne etwas zu ändern', async ({ page }) => {
  await page.locator('#profile-copy').click();
  const p = JSON.parse(await page.locator('#profile-text').inputValue());
  p.name = 'Datei';
  p.parts.tempo.bpm = 91;
  await page.locator('#profile-import-file').setInputFiles({ name: 'profil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(p)) });
  await expect(item(page, 'Datei')).toHaveAttribute('aria-selected', 'true');
  await item(page, 'Aktuelle Sitzung').click();
  await page.locator('#profile-text').fill('kein json');
  await page.locator('#profile-import-text').click();
  await expect(message(page)).toContainText('kein gültiges Profil');
  await page.locator('#profile-import-file').setInputFiles({ name: 'gross.json', mimeType: 'application/json', buffer: Buffer.alloc(5_000_001, 32) });
  await expect(message(page)).toContainText('kein gültiges Profil');
  await expect(items(page)).toHaveCount(13);
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-selected', 'true');
  await expect(tempo(page)).toHaveText('100');
});

test('Laden während der Wiedergabe: sie läuft mit den neuen Werten weiter', async ({ page }) => {
  test.slow(); // je beobachtetem Zustand ein ganzer Takt
  await setTempo(page, 120);
  await saveSession(page, 'Live');
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.locator('#play-go').click();
  await expect(page.locator('#play-position')).toHaveText(/Takt \d+ von/);
  await setTempo(page, 150);
  await load(page, 'Live');
  await expect(tempo(page)).toHaveText('120');
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await load(page, 'Funk-Rock');
  await expect(tempo(page)).toHaveText('100');
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  // render() läuft je Takt: im Fenster ändert sich dabei nichts am DOM, auch nicht mit offener Teile-Auswahl und „Rückgängig“
  await saveSession(page, 'Weg');
  await page.locator('#profile-delete').click();
  await expect(undo(page)).toBeVisible();
  await item(page, 'Live').click();
  await page.locator('#profile-overwrite').click();
  await expect(page.locator('#profile-overwrite-parts')).toHaveAttribute('open', '');
  // je Zustand: einen Taktwechsel lang beobachten, kein einziger Eingriff ins DOM des Fensters
  const quiet = async (what) => {
    await page.evaluate(() => {
      window.__observer?.disconnect();
      window.__mutations = 0;
      window.__observer = new MutationObserver((list) => { window.__mutations += list.length; });
      window.__observer.observe(document.getElementById('profiles'), { subtree: true, childList: true, attributes: true, characterData: true });
    });
    const bar = await page.locator('#play-position').textContent();
    await expect(page.locator('#play-position')).not.toHaveText(bar, { timeout: 10_000 });
    expect(await page.evaluate(() => window.__mutations), what).toBe(0);
  };
  await quiet('Profil mit Teile-Auswahl und Rückgängig');
  await newFolder(page, 'Meine Profile', 'Box');
  await saveIn(page, 'Drin', 'Box');
  await item(page, 'Box').click();
  await quiet('Ordner');
  await page.locator('#profile-delete').click();
  await expect(page.locator('#profile-delete-ask')).toBeVisible();
  await quiet('Rückfrage beim Löschen');
  await page.locator('#profile-subfolder').click();
  await expect(page.getByLabel('Name des Ordners')).toBeVisible();
  await quiet('Feld für den Unterordner');
  await pickRow(page, 'Drin'); // Box selbst hat kein Ziel (oben liegt es schon)
  await page.locator('#profile-move').click();
  await expect(page.locator('#profile-move-to')).toBeVisible();
  await quiet('Verschieben nach');
  await item(page, 'Meine Profile').click();
  await quiet('Meine Profile');
});

test('1280 px: zwei Spalten, Baum links, Feld rechts und deutlich breiter, Fenster höchstens 56 rem und im Bild', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const pop = await page.locator('#profiles-pop').boundingBox();
  const tree = await page.locator('#profile-tree').boundingBox();
  const panel = await page.locator('#profile-panel').boundingBox();
  expect(pop.width).toBeLessThanOrEqual(56 * 16);
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(1280);
  expect(tree.x + tree.width).toBeLessThanOrEqual(panel.x);
  expect(Math.abs(tree.y - panel.y)).toBeLessThan(2);
  expect(tree.width).toBeGreaterThanOrEqual(15 * 16 - 1);
  expect(tree.width).toBeLessThanOrEqual(20 * 16 + 1);
  expect(panel.width).toBeGreaterThan(tree.width * 1.3);
});

test('360 px: kein waagerechtes Scrollen, Baum über dem Feld, Knöpfe und Zeilen mindestens 44 px hoch', async ({ browser }) => {
  // eigener Kontext: sonst ist die Leiste, die beforeEach geöffnet hat, gemerkt und macht die Kopfzeile bei 360 px inert
  const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 360, height: 740 } });
  const page = await context.newPage();
  watch(page);
  await page.goto('/ui/index.html');
  await page.locator('#go').click(); // über Los: Feintuning öffnet hier die Klang-Schublade
  await expect(page.locator('#play')).toBeVisible();
  await openWindow(page);
  await page.locator('#profile-save-parts summary').click();
  await saveSession(page, 'Ein sehr langer Profilname der umbrechen muss weil er nicht passt');
  await item(page, 'Aktuelle Sitzung').click();
  const noScrollX = () => page.evaluate(() => {
    const pop = document.getElementById('profiles-pop');
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth && pop.scrollWidth <= pop.clientWidth;
  });
  expect(await noScrollX()).toBe(true);
  const tree = await page.locator('#profile-tree').boundingBox();
  const panel = await page.locator('#profile-panel').boundingBox();
  expect(tree.y + tree.height).toBeLessThanOrEqual(panel.y);
  for (const sel of ['#profile-save', '#profile-file', '#profile-copy', '#profile-import-text', '#profile-save-parts summary', '#profile-save-parts [data-preset="sound"]']) {
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  }
  for (const row of await items(page).all()) expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Teile: die ganze Zeile (Beschriftung samt Kästchen) ist die Trefferfläche, nicht nur das 1,5-rem-Kästchen
  const list = await page.locator('#profile-save-parts .profile-part-list').boundingBox();
  for (const label of await page.locator('#profile-save-parts .profile-part label').all()) {
    const b = await label.boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThan(list.width * 0.9);
  }
  const tempoBox = page.getByRole('checkbox', { name: 'Tempo', exact: true });
  await page.locator('#profile-save-parts .profile-part label').nth(1).click({ position: { x: 200, y: 10 } });
  await expect(tempoBox).not.toBeChecked();
  await load(page, 'Country');
  expect(await noScrollX()).toBe(true);
  expect((await page.locator('#profile-load').boundingBox()).height).toBeGreaterThanOrEqual(44);
  // eigenes Profil und Ordner: alle Knöpfe 44 px, kein waagerechtes Scrollen, auch mit offenen Feldern
  await items(page).filter({ hasText: 'Ein sehr langer Profilname' }).click(); // auf 60 Zeichen gekürzt
  await page.locator('#profile-overwrite').click();
  expect(await noScrollX()).toBe(true);
  for (const sel of ['#profile-load', '#profile-overwrite', '#profile-overwrite-go', '#profile-rename', '#profile-delete', '#profile-file', '#profile-copy', '#profile-backup']) {
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#profile-rename').click();
  expect((await page.locator('#profile-rename-go').boundingBox()).height).toBeGreaterThanOrEqual(44);
  const handle = await items(page).filter({ hasText: 'Ein sehr langer Profilname' }).locator('.drag-handle').boundingBox();
  expect(handle.width).toBeGreaterThanOrEqual(44);
  expect(handle.height).toBeGreaterThanOrEqual(44);
  await page.locator('#profile-delete').click();
  expect(await noScrollX()).toBe(true);
  expect((await undo(page).boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.locator('#profile-subfolder').click();
  await page.getByLabel('Name des Ordners').fill('Ordner mit einem ebenfalls sehr langen Namen, der umbricht');
  await page.locator('#profile-folder-add').click();
  await expect(item(page, 'Ordner mit einem ebenfalls sehr langen Namen, der umbricht')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#profile-subfolder').click();
  expect(await noScrollX()).toBe(true);
  for (const sel of ['#profile-subfolder', '#profile-folder-add', '#profile-rename', '#profile-delete', '#profile-import-text', '#profile-backup']) {
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  }
  // Unterordner darin: „Verschieben nach …“ mit offener Auswahl
  await page.getByLabel('Name des Ordners').fill('U');
  await page.locator('#profile-folder-add').click();
  await page.locator('#profile-move').click();
  expect(await noScrollX()).toBe(true);
  for (const sel of ['#profile-move', '#profile-move-to', '#profile-move-go']) {
    expect((await page.locator(sel).boundingBox()).height, sel).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

test('defekter gespeicherter Baum: leerer Baum, keine Konsolenfehler', async ({ page }) => {
  for (const garbage of ['{kaputt', '{"version":2,"items":[null,5,{"type":"profile"},{"type":"folder","name":"ohne items"}]}', '"x"']) {
    await page.evaluate((g) => localStorage.setItem('backingtrack.profiles', g), garbage);
    await page.reload();
    await page.locator('#tune-btn').click();
    await openWindow(page);
    await expect(items(page), garbage).toHaveCount(12);
    await expect(items(page).last()).toHaveText('Meine Profile');
  }
});

test('gespeicherte Ids wie die festen Schlüssel (session, mine, factory, factory:…) verdrängen keine Zeile; Ordner-Auswahl zeigt die Verschachtelung', async ({ page }) => {
  const p = (id, name) => ({ id, type: 'profile', name, parts: { tempo: { bpm: 90 } } });
  const nodes = [p('session', 'P1'), p('factory:reggae', 'P2'), p('factory:zzz', 'P3'),
    { id: 'mine', type: 'folder', name: 'Ordner', items: [p('session', 'Innen'), { id: 'factory', type: 'folder', name: 'Unter', items: [] }] }];
  await page.evaluate((v) => localStorage.setItem('backingtrack.profiles', v), JSON.stringify({ version: 2, items: nodes }));
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
  await expect(page.locator('#profile-tree [role="treeitem"]')).toHaveText(['Aktuelle Sitzung', 'Werksprofile', ...STYLES, 'Meine Profile', 'Ordner', 'P1', 'P2', 'P3']);
  await item(page, 'Ordner').locator('.tree-twisty').click();
  await expect(item(page, 'Innen')).toHaveAttribute('aria-level', '3');
  await expect(item(page, 'Unter')).toHaveAttribute('aria-level', '3');
  for (const name of ['P1', 'P2', 'P3']) {
    await item(page, name).click();
    await expect(item(page, name)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#profile-tree [aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('#profile-panel-title')).toHaveText(name);
  }
  await setTempo(page, 120);
  await load(page, 'P3'); // eigenes Profil, nicht applyStyle('zzz')
  await expect(tempo(page)).toHaveText('90');
  await expect(message(page)).toHaveText('Profil übernommen.');
  await item(page, 'Aktuelle Sitzung').click();
  await expect(page.locator('#profile-save')).toBeVisible();
  // Ordner-Auswahl: jede Ebene ist weiter eingerückt (geschützte Leerzeichen, die <option> nicht zusammenzieht)
  const options = await page.locator('#profile-folder option').allTextContents();
  expect(options.map((o) => o.trim())).toEqual(['Meine Profile', 'Ordner', 'Unter']);
  const indent = (o) => o.length - o.trimStart().length;
  expect(indent(options[1])).toBeGreaterThan(indent(options[0]));
  expect(indent(options[2])).toBeGreaterThan(indent(options[1]));
  expect(options[2].startsWith(' ')).toBe(true);
});

test('Mit Sitzung überschreiben: Haken beginnen mit den Teilen des Profils, „Nur Rhythmus“ ändert nur diese, der Rest bleibt; Rückgängig', async ({ page }) => {
  await page.locator('#profile-save-parts summary').click();
  await page.locator('#profile-save-parts').getByRole('button', { name: 'Nur Klang' }).click();
  await saveSession(page, 'Teil');
  await expect(info(page)).toHaveText('Inhalt: Klangregler, Stimmen & Aufgaben, Mischpult');
  await expect(page.locator('#profile-overwrite-parts')).toBeHidden(); // erst auf Knopfdruck
  await setTempo(page, 77);
  await item(page, 'Teil').click();
  await page.locator('#profile-overwrite').click();
  const picker = page.locator('#profile-overwrite-parts');
  await expect(picker).toHaveAttribute('open', '');
  await expect(picker.locator('summary')).toHaveText('Inhalt: 3 von 9');
  await expect(picker.getByRole('checkbox', { name: 'Mischpult', exact: true })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: 'Tempo', exact: true })).not.toBeChecked();
  await picker.getByRole('button', { name: 'Nur Rhythmus' }).click();
  await page.locator('#profile-overwrite-go').click();
  await expect(message(page)).toHaveText('Profil Teil überschrieben.');
  await expect(picker).toBeHidden();
  await expect(info(page)).toHaveText('Inhalt: Tempo, Rhythmus & Länge, Klangregler, Stimmen & Aufgaben, Mischpult');
  expect(await storedParts(page, 'Teil')).toEqual(['tempo', 'rhythm', 'sound', 'voices', 'mixer']);
  await setTempo(page, 120);
  await load(page, 'Teil');
  await expect(tempo(page)).toHaveText('77');
  // ohne Haken: Meldung; mit „Variante“ dazu, dann Rückgängig: nur der Baum, die Sitzung bleibt
  await page.locator('#profile-overwrite').click();
  await picker.getByRole('button', { name: 'Nichts' }).click();
  await page.locator('#profile-overwrite-go').click();
  await expect(message(page)).toContainText('mindestens einen Teil');
  await picker.getByRole('checkbox', { name: 'Variante', exact: true }).check();
  await page.locator('#profile-overwrite-go').click();
  await expect(info(page)).toContainText('Variante');
  await undo(page).click();
  await expect(info(page)).toHaveText('Inhalt: Tempo, Rhythmus & Länge, Klangregler, Stimmen & Aufgaben, Mischpult');
  await expect(item(page, 'Teil')).toHaveAttribute('aria-selected', 'true');
  await expect(tempo(page)).toHaveText('77');
  expect(await storedParts(page, 'Teil')).toEqual(['tempo', 'rhythm', 'sound', 'voices', 'mixer']);
});

test('Umbenennen: Feld mit dem alten Namen, vergebener und leerer Name mit Meldung, nichts ersetzt; kein Rückgängig', async ({ page }) => {
  await saveSession(page, 'Eins');
  await saveSession(page, 'Zwei');
  await page.locator('#profile-rename').click();
  const field = page.getByLabel('Neuer Name');
  await expect(field).toHaveValue('Zwei');
  await expect(field).toBeFocused();
  await field.fill('eins');
  await page.locator('#profile-rename-go').click();
  await expect(message(page)).toHaveText('Im Ordner gibt es schon „eins“. Bitte einen anderen Namen wählen.');
  await expect(items(page).filter({ hasText: /^(eins|zwei)$/i })).toHaveText(['Eins', 'Zwei']);
  await field.fill('   ');
  await field.press('Enter');
  await expect(message(page)).toHaveText('Bitte einen Namen eingeben.');
  await field.fill('Drei');
  await field.press('Enter');
  await expect(message(page)).toHaveText('Umbenannt in Drei.');
  await expect(item(page, 'Drei')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Drei')).toBeFocused();
  await expect(item(page, 'Zwei')).toHaveCount(0);
  await expect(page.locator('#profile-panel-title')).toHaveText('Drei');
  await expect(field).toBeHidden();
  await expect(undo(page)).toBeHidden();
  expect(JSON.parse(await stored(page)).items.map((n) => n.name)).toEqual(['Drei', 'Eins']);
});

test('Profil löschen: sofort weg, Auswahl beim Ordner; „Rückgängig“ stellt es samt Auswahl her und speichert', async ({ page }) => {
  await saveSession(page, 'Weg');
  await expect(undo(page)).toBeHidden();
  await page.locator('#profile-delete').click();
  await expect(item(page, 'Weg')).toHaveCount(0);
  await expect(message(page)).toHaveText('„Weg“ gelöscht.');
  await expect(item(page, 'Meine Profile')).toHaveAttribute('aria-selected', 'true');
  await expect(undo(page)).toHaveText('Rückgängig');
  expect(JSON.parse(await stored(page)).items).toEqual([]);
  await undo(page).click();
  await expect(item(page, 'Weg')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Weg')).toBeFocused();
  await expect(message(page)).toHaveText('Rückgängig gemacht.');
  await expect(undo(page)).toBeHidden();
  expect(await storedParts(page, 'Weg')).toHaveLength(9);
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
  await expect(item(page, 'Weg')).toBeVisible();
});

test('Die Meldung einer Aktion mit „Rückgängig“ bleibt beim Wechseln der Auswahl; beide gehen erst zusammen', async ({ page }) => {
  await saveSession(page, 'Weg');
  await saveSession(page, 'Bleibt');
  await item(page, 'Weg').click();
  await page.locator('#profile-delete').click();
  await expect(message(page)).toHaveText('„Weg“ gelöscht.');
  for (const name of ['Aktuelle Sitzung', 'Reggae', 'Bleibt']) {
    await item(page, name).click();
    await expect(message(page), name).toHaveText('„Weg“ gelöscht.');
    await expect(undo(page), name).toBeVisible();
  }
  // Umbenennen hat kein Rückgängig: es verwirft das alte samt seiner Meldung
  await page.locator('#profile-rename').click();
  await page.getByLabel('Neuer Name').fill('Neu');
  await page.locator('#profile-rename-go').click();
  await expect(message(page)).toHaveText('Umbenannt in Neu.');
  await expect(undo(page)).toBeHidden();
  await item(page, 'Aktuelle Sitzung').click();
  await expect(message(page)).toHaveText('');
});

test('Leerer Ordner und leeres „Alles sichern“: „Nichts zu sichern.“, keine Datei, nichts im Textfeld', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#profile-backup').click();
  await expect(message(page)).toHaveText('Nichts zu sichern.');
  const nothing = async (name) => {
    for (const button of ['#profile-file', '#profile-copy']) {
      await item(page, 'Aktuelle Sitzung').click(); // Meldung leeren
      await pickRow(page, name);
      await expect(message(page)).toHaveText('');
      await page.locator(button).click();
      await expect(message(page), `${name} ${button}`).toHaveText('Nichts zu sichern.');
    }
  };
  await nothing('Meine Profile'); // leerer Baum
  await newFolder(page, 'Meine Profile', 'Leer');
  await nothing('Leer');
  await expect(page.locator('#profile-text')).toHaveValue('');
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  // mit Inhalt wieder wie gewohnt
  await saveIn(page, 'P', 'Leer');
  await item(page, 'Leer').click();
  expect((await copied(page)).items.map((n) => n.name)).toEqual(['P']);
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.getByRole('button', { name: /^EN/i }).click();
  await openWindow(page);
  await pickRow(page, 'My profiles');
  await page.locator('#profile-subfolder').click();
  await page.locator('#profile-folder-name').fill('Empty');
  await page.locator('#profile-folder-add').click();
  await expect(item(page, 'Empty')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#profile-file').click();
  await expect(message(page)).toHaveText('Nothing to back up.');
});

test('Ordner: anlegen, bis Tiefe 8 verschachteln (9. Ebene abgelehnt), Löschen mit Inhalt fragt nach, Rückgängig stellt den genauen Teilbaum her', async ({ page }) => {
  await item(page, 'Meine Profile').click();
  await expect(page.locator('#profile-panel-title')).toHaveText('Meine Profile');
  await expect(info(page)).toHaveText('0 Profile, 0 Unterordner');
  await expect(page.locator('#profile-subfolder')).toBeVisible();
  await expect(page.locator('#profile-rename')).toBeHidden();
  await expect(page.locator('#profile-delete')).toBeHidden();
  let parent = 'Meine Profile';
  for (let i = 1; i <= 8; i++) {
    await newFolder(page, parent, `E${i}`);
    await expect(message(page)).toHaveText(`Ordner E${i} angelegt.`);
    await expect(item(page, `E${i}`)).toHaveAttribute('aria-selected', 'true');
    await expect(item(page, `E${i}`)).toHaveAttribute('aria-level', String(i + 1));
    parent = `E${i}`;
  }
  await newFolder(page, 'E8', 'E9');
  await expect(message(page)).toHaveText('So tief lassen sich Ordner nicht verschachteln (höchstens 8 Ebenen).');
  await expect(item(page, 'E9')).toHaveCount(0);
  // vergebener und leerer Name beim Unterordner
  await newFolder(page, 'E1', 'e2');
  await expect(message(page)).toHaveText('Im Ordner gibt es schon „e2“. Bitte einen anderen Namen wählen.');
  await page.getByLabel('Name des Ordners').fill('');
  await page.locator('#profile-folder-add').click();
  await expect(message(page)).toHaveText('Bitte einen Namen eingeben.');
  await saveIn(page, 'P', 'E2');
  await item(page, 'E2').click();
  await expect(info(page)).toHaveText('1 Profil, 6 Unterordner');
  await item(page, 'Meine Profile').click();
  await expect(info(page)).toHaveText('1 Profil, 8 Unterordner');
  // Löschen mit Inhalt: Rückfrage, Abbrechen ändert nichts
  await item(page, 'E2').click();
  const before = await stored(page);
  await page.locator('#profile-delete').click();
  await expect(page.locator('#profile-delete-ask')).toHaveText('Ordner mit 7 Einträgen löschen?');
  await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  for (const name of ['Ja, löschen', 'Abbrechen']) await expect(page.getByRole('button', { name })).toHaveAccessibleDescription('Ordner mit 7 Einträgen löschen?');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.locator('#profile-delete-ask')).toBeHidden();
  await expect(item(page, 'E2')).toHaveAttribute('aria-selected', 'true');
  expect(await stored(page)).toBe(before);
  await page.locator('#profile-delete').click();
  await page.getByRole('button', { name: 'Ja, löschen' }).click();
  await expect(item(page, 'E2')).toHaveCount(0);
  await expect(item(page, 'P')).toHaveCount(0);
  await expect(item(page, 'E1')).toHaveAttribute('aria-selected', 'true');
  await expect(message(page)).toHaveText('„E2“ gelöscht.');
  await undo(page).click();
  await expect(item(page, 'E2')).toHaveAttribute('aria-selected', 'true');
  expect(await stored(page)).toBe(before);
  // leerer Ordner: sofort gelöscht, Auswahl beim Elternordner
  await pickRow(page, 'E8');
  await page.locator('#profile-delete').click();
  await expect(page.locator('#profile-delete-ask')).toBeHidden();
  await expect(item(page, 'E8')).toHaveCount(0);
  await expect(item(page, 'E7')).toHaveAttribute('aria-selected', 'true');
  // Ordner umbenennen
  await item(page, 'E1').click();
  await page.locator('#profile-rename').click();
  await page.getByLabel('Neuer Name').fill('Erste');
  await page.locator('#profile-rename-go').click();
  await expect(item(page, 'Erste')).toHaveAttribute('aria-selected', 'true');
});

test('Export folgt der Auswahl: Sitzung mit 9 Teilen, Profil nur mit seinen Teilen, Ordner samt Unterordnern ohne Ids', async ({ page }) => {
  let file = await copied(page);
  expect(file.format).toBe('backingtrack-profile');
  expect(file.name).toBe('Aktuelle Sitzung');
  expect(Object.keys(file.parts)).toHaveLength(9);
  await newFolder(page, 'Meine Profile', 'Ordner');
  await newFolder(page, 'Ordner', 'Unter');
  await item(page, 'Aktuelle Sitzung').click();
  await page.locator('#profile-save-parts summary').click();
  await page.locator('#profile-save-parts').getByRole('button', { name: 'Nur Rhythmus' }).click();
  await saveIn(page, 'Rh', 'Ordner');
  await expect(item(page, 'Rh')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#profile-file')).toHaveText('Als Datei');
  file = await copied(page);
  expect(file.format).toBe('backingtrack-profile');
  expect(file.name).toBe('Rh');
  expect(Object.keys(file.parts)).toEqual(['tempo', 'rhythm']);
  await item(page, 'Ordner').click();
  await expect(page.locator('#profile-file')).toHaveText('Ordner als Datei');
  await expect(page.locator('#profile-copy')).toHaveText('Ordner kopieren');
  file = await copied(page);
  expect(file.format).toBe('backingtrack-folder');
  expect(file.name).toBe('Ordner');
  expect(file.items.map((n) => [n.type, n.name])).toEqual([['folder', 'Unter'], ['profile', 'Rh']]);
  expect(file.items[0].items).toEqual([]);
  expect(Object.keys(file.items[1].parts)).toEqual(['tempo', 'rhythm']);
  expect(JSON.stringify(file)).not.toContain('"id"');
  await item(page, 'Meine Profile').click();
  file = await copied(page);
  expect(file.name).toBe('Meine Profile');
  expect(file.items.map((n) => n.name)).toEqual(['Ordner']);
  // als Datei: Werksprofil
  await item(page, 'Reggae').click();
  const { name, text } = await downloadJson(page, '#profile-file');
  expect(name).toMatch(/\.json$/);
  expect(JSON.parse(text).parts.style.style).toBe('reggae');
});

test('„Alles sichern“ ist bei jeder Auswahl sichtbar und lädt „Meine Profile“ als Ordner-Datei mit allen Einträgen herunter', async ({ page }) => {
  await saveSession(page, 'A1');
  await newFolder(page, 'Meine Profile', 'F');
  await saveIn(page, 'B1', 'F');
  for (const name of ['Aktuelle Sitzung', 'Werksprofile', 'Reggae', 'F', 'B1', 'Meine Profile']) {
    await item(page, name).click();
    await expect(page.locator('#profile-backup')).toHaveText('Alles sichern');
    await expect(page.locator('#profile-backup')).toBeVisible();
  }
  await item(page, 'B1').click();
  const { name, text } = await downloadJson(page, '#profile-backup');
  expect(name).toMatch(/\.json$/);
  const file = JSON.parse(text);
  expect(file.format).toBe('backingtrack-folder');
  expect(file.name).toBe('Meine Profile');
  expect(file.items.map((n) => [n.type, n.name])).toEqual([['folder', 'F'], ['profile', 'A1']]);
  expect(file.items[0].items.map((n) => n.name)).toEqual(['B1']);
  expect(Object.keys(file.items[1].parts)).toHaveLength(9);
  await expect(item(page, 'B1')).toHaveAttribute('aria-selected', 'true');
});

test('„Alles sichern“ und wieder einlesen: derselbe Baum samt Profil auf Ebene 8, kein neuer Ordner „Meine Profile“, nichts „ungültig“', async ({ page }) => {
  const chain = (i) => (i < 8 ? dir(`r${i}`, `R${i}`, [chain(i + 1)]) : prof('r8', 'R8')); // R1 … R7, Profil R8 auf Ebene 8
  await seed(page, [chain(1), dir('z', 'Z', [prof('zp', 'P')]), prof('p', 'P')]);
  const before = await storedTree(page);
  const { text } = await downloadJson(page, '#profile-backup');
  expect(JSON.parse(text).backup).toBe(true);
  await seed(page, []);
  await item(page, 'Meine Profile').click();
  await page.locator('#profile-import-file').setInputFiles({ name: 'sicherung.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(message(page)).toHaveText('Sicherung mit 3 Profilen aufgenommen.');
  const strip = (list) => list.map(({ id, ...n }) => (n.type === 'folder' ? { ...n, items: strip(n.items) } : n));
  expect(strip((await storedTree(page)).items)).toEqual(strip(before.items));
});

test('Import in einen tiefen Ordner: was tiefer als 8 Ebenen läge, wird übersprungen und gemeldet (nicht als „ungültig“)', async ({ page }) => {
  await seed(page, FIXTURE);
  for (let i = 1; i <= 5; i++) await item(page, `D${i}`).locator('.tree-twisty').click();
  await pickRow(page, 'D6');
  const leaf = { type: 'profile', name: 'V4', parts: { tempo: { bpm: 90 } } };
  await page.locator('#profile-text').fill(JSON.stringify({ format: 'backingtrack-folder', version: 1, name: 'V1', items: [{ type: 'folder', name: 'V2', items: [{ type: 'folder', name: 'V3', items: [leaf] }] }] }));
  await page.locator('#profile-import-text').click();
  await expect(message(page)).toHaveText('Ordner V1 mit 0 Profilen aufgenommen. 2 Einträge wurden übersprungen (zu tief verschachtelt oder zu viele Einträge).');
  await expect(item(page, 'V1')).toHaveAttribute('aria-level', '8'); // Ebene 7 unter „Meine Profile“
});

test('Import einer Ordner-Datei in einen anderen Ordner: Struktur, „ (2)“ bei gleichem Namen, Auswahl bleibt, Meldung nennt die Zahl; Rückgängig', async ({ page }) => {
  await newFolder(page, 'Meine Profile', 'Quelle');
  await saveIn(page, 'P1', 'Quelle');
  await newFolder(page, 'Quelle', 'Innen');
  await saveIn(page, 'P2', 'Innen');
  await newFolder(page, 'Meine Profile', 'Ziel');
  await newFolder(page, 'Ziel', 'Quelle');
  await item(page, 'Quelle').first().click();
  const { text } = await downloadJson(page, '#profile-file');
  await item(page, 'Ziel').click();
  await expect(page.locator('#profile-import-text')).toHaveText('In den Ordner importieren');
  await page.locator('#profile-import-file').setInputFiles({ name: 'quelle.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(message(page)).toHaveText('Ordner Quelle (2) mit 2 Profilen aufgenommen.');
  await expect(item(page, 'Ziel')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Quelle (2)')).toHaveAttribute('aria-level', '3');
  const ziel = JSON.parse(await stored(page)).items.find((n) => n.name === 'Ziel');
  expect(ziel.items.map((n) => n.name)).toEqual(['Quelle', 'Quelle (2)']);
  const copy = ziel.items[1];
  expect(copy.items.map((n) => [n.type, n.name])).toEqual([['folder', 'Innen'], ['profile', 'P1']]);
  expect(copy.items[0].items.map((n) => n.name)).toEqual(['P2']);
  await undo(page).click();
  await expect(item(page, 'Quelle (2)')).toHaveCount(0);
  await expect(item(page, 'Ziel')).toHaveAttribute('aria-selected', 'true');
});

test('Import in einen Ordner: ein einzelnes Profil wird dort aufgenommen und gewählt; unbekannte Zusatzfelder auf jeder Ebene stören nicht', async ({ page }) => {
  await newFolder(page, 'Meine Profile', 'Ziel');
  await page.locator('#profile-text').fill(JSON.stringify({ format: 'backingtrack-profile', version: 9, name: 'Fremd', neu: 1, parts: { tempo: { bpm: 81, zukunft: true }, kommt: { a: 1 } } }));
  await page.locator('#profile-import-text').click();
  await expect(message(page)).toContainText('Profil Fremd aufgenommen.');
  await expect(item(page, 'Fremd')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Fremd')).toHaveAttribute('aria-level', '3');
  await expect(info(page)).toHaveText('Inhalt: Tempo');
  await expect(undo(page)).toBeVisible();
  await item(page, 'Ziel').click();
  await page.locator('#profile-text').fill(JSON.stringify({
    format: 'backingtrack-folder', version: 7, name: 'Paket', farbe: 'rot',
    items: [{ type: 'profile', name: 'X', stern: 5, parts: { tempo: { bpm: 90 }, neu: {} } }, { type: 'folder', name: 'U', icon: 'x', items: [] }],
  }));
  await page.locator('#profile-import-text').click();
  await expect(message(page)).toContainText('Ordner Paket mit 1 Profil aufgenommen.');
  await expect(item(page, 'Ziel')).toHaveAttribute('aria-selected', 'true');
  const ziel = JSON.parse(await stored(page)).items.find((n) => n.name === 'Ziel');
  const paket = ziel.items.find((n) => n.name === 'Paket');
  expect(paket.items.map((n) => [n.type, n.name])).toEqual([['folder', 'U'], ['profile', 'X']]);
  expect(paket.items[1].parts).toEqual({ tempo: { bpm: 90 } });
});

test('Werksprofil kopieren: „Funk-Rock“, beim zweiten Mal „Funk-Rock (2)“, mit den Teilen Tempo, Stil, Klangregler', async ({ page }) => {
  await item(page, 'Funk-Rock').click();
  await page.locator('#profile-factory-copy').click();
  await item(page, 'Funk-Rock').first().click();
  await page.locator('#profile-factory-copy').click();
  await expect(items(page).filter({ hasText: 'Funk-Rock' })).toHaveText(['Funk-Rock', 'Funk-Rock', 'Funk-Rock (2)']);
  expect(await storedParts(page, 'Funk-Rock (2)')).toEqual(['tempo', 'style', 'sound']);
  await expect(item(page, 'Funk-Rock (2)')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Funk-Rock (2)')).toBeFocused();
  await expect(info(page)).toHaveText('Inhalt: Tempo, Stil & Schlagworte, Klangregler');
  await expect(page.locator('#profile-overwrite')).toBeVisible();
});

test('Werksprofil kopieren bei zugeklapptem „Meine Profile“: der Ordner geht auf, die Kopie ist gewählt', async ({ page }) => {
  await item(page, 'Meine Profile').locator('.tree-twisty').click();
  await expect(item(page, 'Meine Profile')).toHaveAttribute('aria-expanded', 'false');
  await item(page, 'Reggae').click();
  await page.locator('#profile-factory-copy').click();
  await expect(item(page, 'Meine Profile')).toHaveAttribute('aria-expanded', 'true');
  await expect(item(page, 'Reggae')).toHaveCount(2);
  await expect(item(page, 'Reggae').last()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#profile-overwrite')).toBeVisible();
});

test('Dateinamen folgen der Sprache: profil/ordner auf Deutsch, profile/folder auf Englisch, mit Datum', async ({ page }) => {
  await saveSession(page, 'A');
  const named = async (button, kind) => expect((await downloadJson(page, button)).name).toMatch(new RegExp(`^backingtrack-${kind}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  await named('#profile-file', 'profil');
  await named('#profile-backup', 'ordner');
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.getByRole('button', { name: /^EN/i }).click();
  await openWindow(page);
  await named('#profile-file', 'profile');
  await named('#profile-backup', 'folder');
});

test('englisch: Felder für eigene Profile und Ordner übersetzt', async ({ page }) => {
  await saveSession(page, 'E');
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.getByRole('button', { name: /^EN/i }).click();
  await openWindow(page);
  await item(page, 'E').click();
  await expect(info(page)).toHaveText(/^Contents: /);
  await expect(page.locator('#profile-overwrite')).toHaveText('Overwrite with session …');
  await item(page, 'My profiles').click();
  await expect(info(page)).toHaveText('1 profile, 0 subfolders');
  await expect(page.locator('#profile-backup')).toHaveText('Back up everything');
});

// --- Verschieben ---

test('Verschieben nach …: nur bei eigenen Einträgen; die Auswahl lässt sich selbst, Nachfahren, zu tiefe Ziele und den eigenen Ordner weg', async ({ page }) => {
  await seed(page, FIXTURE);
  for (const name of ['Aktuelle Sitzung', 'Werksprofile', 'Reggae', 'Meine Profile']) {
    await item(page, name).click();
    await expect(page.locator('#profile-move'), name).toBeHidden();
  }
  // Ordner A (3 Ebenen hoch): ohne A, B, C, ohne „Meine Profile“ (liegt schon dort), ohne D6 … D8 (wäre tiefer als 8)
  await item(page, 'A').click();
  await expect(page.locator('#profile-move')).toHaveText('Verschieben nach …');
  await expect(page.locator('#profile-move-to')).toBeHidden();
  await page.locator('#profile-move').click();
  await expect(page.locator('#profile-move')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Verschieben nach', { exact: true })).toBeFocused();
  expect(await moveOptions(page)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'Z']);
  await expect(page.locator('#profile-move-go')).toHaveText('Verschieben');
  // Profil P oben: alle Ordner außer D8 (Profil wäre auf Ebene 9); Einrückung je Ebene
  await item(page, 'P').click();
  await expect(page.locator('#profile-move-to')).toBeHidden(); // Auswahl wechseln schließt das Feld
  await page.locator('#profile-move').click();
  expect(await moveOptions(page)).toEqual(['A', 'B', 'C', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'Z']);
  const raw = await page.locator('#profile-move-to option').allTextContents();
  const indent = (o) => o.length - o.trimStart().length;
  expect(indent(raw[1])).toBeGreaterThan(indent(raw[0]));
  // Profil in Z (dort liegt ein P): „Meine Profile“ ist Ziel, Z nicht
  await item(page, 'Z').locator('.tree-twisty').click();
  await page.locator('[data-key="zp"] .tree-label').click();
  await page.locator('#profile-move').click();
  expect(await moveOptions(page)).toContain('Meine Profile');
  expect(await moveOptions(page)).not.toContain('Z');
  await page.locator('#profiles-pop').evaluate((el) => el.hidePopover());
  await page.getByRole('button', { name: /^EN/i }).click();
  await openWindow(page);
  await expect(page.locator('#profile-move')).toHaveText('Move to …');
  await expect(page.locator('#profile-move-go')).toHaveText('Move');
  expect(await moveOptions(page)).toContain('My profiles');
});

test('Verschieben nach …: Profil mit Namenskonflikt „ (2)“ und Ordner samt Inhalt; Auswahl folgt, Ziel offen; Rückgängig stellt Baum und Auswahl her', async ({ page }) => {
  await seed(page, FIXTURE);
  const before = await stored(page);
  await item(page, 'P').click();
  await page.locator('#profile-move').click();
  await page.locator('#profile-move-to').selectOption('z');
  await page.locator('#profile-move-go').click();
  await expect(message(page)).toHaveText('„P“ nach „Z“ verschoben, dort heißt es „P (2)“ (der Name war vergeben).');
  await expect(item(page, 'P (2)')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'P (2)')).toHaveAttribute('aria-level', '3');
  await expect(item(page, 'P (2)')).toBeFocused();
  await expect(item(page, 'Z')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#profile-move-to')).toBeHidden();
  let tree = await storedTree(page);
  expect(names(tree.items)).toEqual(['A', 'D1', 'Z']);
  expect(names(tree.items[2].items)).toEqual(['P', 'P (2)']);
  await undo(page).click();
  await expect(message(page)).toHaveText('Rückgängig gemacht.');
  await expect(page.locator('[data-key="p"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-key="p"]')).toHaveAttribute('aria-level', '2');
  await expect(page.locator('[data-key="p"]')).toHaveText('P');
  expect(await stored(page)).toBe(before);
  // Ordner B (mit C) aus A nach D1
  await item(page, 'A').locator('.tree-twisty').click();
  await pickRow(page, 'B');
  await page.locator('#profile-move').click();
  await page.locator('#profile-move-to').selectOption('d1');
  await page.locator('#profile-move-go').click();
  await expect(message(page)).toHaveText('„B“ nach „D1“ verschoben.');
  await expect(item(page, 'B')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'D1')).toHaveAttribute('aria-expanded', 'true');
  tree = await storedTree(page);
  expect(tree.items[0].items).toEqual([]);
  expect(names(tree.items[1].items)).toEqual(['B', 'D2']);
  expect(names(tree.items[1].items[0].items)).toEqual(['C']);
  await undo(page).click();
  await expect(item(page, 'B')).toHaveAttribute('aria-selected', 'true');
  expect(await stored(page)).toBe(before);
});

test('Tastatur: Verschieben ohne Griff; der Griff ist kein Tabstopp, die Zeile behält ihren Namen', async ({ page }) => {
  await seed(page, FIXTURE);
  await expect(item(page, 'Aktuelle Sitzung')).toBeFocused();
  await page.keyboard.press('End');
  await expect(item(page, 'P')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(item(page, 'P')).toHaveAttribute('aria-selected', 'true');
  await expect(grip(page, 'P')).toHaveCount(1);
  await expect(grip(page, 'P')).not.toHaveAttribute('tabindex');
  await expect(grip(page, 'P')).toHaveAttribute('aria-hidden', 'true'); // Bildschirmleser nehmen „Verschieben nach …“
  expect(await grip(page, 'P').evaluate((g) => getComputedStyle(g).touchAction)).toBe('none');
  for (const part of ['.tree-label', '.tree-twisty']) {
    expect(await item(page, 'P').locator(part).evaluate((g) => getComputedStyle(g).touchAction), part).not.toBe('none'); // der Finger scrollt dort wie gewohnt
  }
  expect(await item(page, 'P').evaluate((g) => getComputedStyle(g).touchAction)).not.toBe('none');
  await expect(item(page, 'P')).toHaveAccessibleName('P');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('profile-tree').contains(document.activeElement))).toBe(false);
  await page.locator('#profile-move').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#profile-move-to')).toBeFocused();
  await page.locator('#profile-move-to').selectOption('a');
  await page.keyboard.press('Tab');
  await expect(page.locator('#profile-move-go')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(message(page)).toHaveText('„P“ nach „A“ verschoben.');
  await expect(item(page, 'P')).toBeFocused();
  await expect(item(page, 'P')).toHaveAttribute('aria-level', '3');
});

test('Ziehen mit der Maus: Griff nur an eigenen Einträgen; auf einen Ordner ablegen verschiebt, Auswahl folgt, Ordner offen, „ (2)“; Rückgängig', async ({ page }) => {
  await seed(page, FIXTURE);
  for (const name of ['Aktuelle Sitzung', 'Werksprofile', 'Reggae', 'Meine Profile']) await expect(grip(page, name), name).toHaveCount(0);
  for (const name of ['A', 'D1', 'Z', 'P']) await expect(grip(page, name), name).toHaveCount(1);
  await expect(items(page)).toHaveText(['Aktuelle Sitzung', 'Werksprofile', ...STYLES, 'Meine Profile', 'A', 'D1', 'Z', 'P']); // der Griff hat keinen Text
  const before = await stored(page);
  await mouseTo(page, grip(page, 'A'), item(page, 'D1'));
  await expect(item(page, 'A')).toHaveAttribute('data-dragging', 'true');
  await expect(item(page, 'D1')).toHaveAttribute('data-drop', 'ok');
  await page.mouse.up();
  await expect(message(page)).toHaveText('„A“ nach „D1“ verschoben.');
  await expect(item(page, 'A')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'A')).toHaveAttribute('aria-level', '3');
  await expect(item(page, 'D1')).toHaveAttribute('aria-expanded', 'true');
  await expect(markers(page)).toHaveCount(0);
  expect(names((await storedTree(page)).items[0].items)).toEqual(['A', 'D2']);
  await undo(page).click();
  expect(await stored(page)).toBe(before);
  // Namenskonflikt
  await mouseTo(page, grip(page, 'P'), item(page, 'Z'));
  await page.mouse.up();
  await expect(message(page)).toHaveText('„P“ nach „Z“ verschoben, dort heißt es „P (2)“ (der Name war vergeben).');
  await expect(item(page, 'P (2)')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Z')).toHaveAttribute('aria-expanded', 'true');
});

test('Ziehen auf ungültige Ziele (selbst, Nachfahren, eigener Ordner, Werksprofil, Sitzung): data-drop="no", Loslassen ändert nichts; Esc bricht ab', async ({ page }) => {
  await seed(page, FIXTURE);
  await item(page, 'A').locator('.tree-twisty').click();
  await item(page, 'B').locator('.tree-twisty').click();
  const before = await stored(page);
  const a = await center(grip(page, 'A'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const name of ['A', 'B', 'C', 'Meine Profile', 'Reggae', 'Werksprofile', 'Aktuelle Sitzung']) {
    const b = await center(item(page, name).locator('.tree-label'));
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(item(page, name), name).toHaveAttribute('data-drop', 'no');
    await expect(page.locator('#profile-tree [data-drop]')).toHaveCount(1); // nur die Zeile unter dem Zeiger
  }
  const c = await center(item(page, 'C').locator('.tree-label'));
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.up();
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  await expect(item(page, 'Aktuelle Sitzung')).toHaveAttribute('aria-selected', 'true');
  await expect(message(page)).toHaveText('');
  // Esc mitten im Ziehen: Markierung weg, Loslassen (auch auf dem gültigen Ziel) tut nichts: Auswahl, offenes Feld, Meldung
  // bleiben, das Fenster bleibt offen
  await pickRow(page, 'B');
  await page.locator('#profile-rename').click();
  await page.getByLabel('Neuer Name').fill('');
  await page.locator('#profile-rename-go').click();
  await expect(message(page)).toHaveText('Bitte einen Namen eingeben.');
  await mouseTo(page, grip(page, 'P'), item(page, 'Z'));
  await expect(item(page, 'Z')).toHaveAttribute('data-drop', 'ok');
  await page.keyboard.press('Escape');
  await expect(markers(page)).toHaveCount(0);
  const z = await center(item(page, 'Z'));
  await page.mouse.move(z.x, z.y + 3);
  await page.mouse.up();
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  await expect(page.locator('#profiles-pop')).toBeVisible();
  await expect(item(page, 'B')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#profile-tree [aria-selected="true"]')).toHaveCount(1);
  await expect(page.getByLabel('Neuer Name')).toBeVisible();
  await expect(message(page)).toHaveText('Bitte einen Namen eingeben.');
  // Esc ohne Loslassen danach: der nächste gewöhnliche Klick wählt wieder ganz normal
  await mouseTo(page, grip(page, 'P'), item(page, 'Z'));
  await page.keyboard.press('Escape');
  await page.mouse.up(); // der Klick danach gehört noch zum abgebrochenen Ziehen und wird geschluckt
  await page.waitForTimeout(50);
  await item(page, 'Z').locator('.tree-label').click();
  await expect(item(page, 'Z')).toHaveAttribute('aria-selected', 'true');
});

test('Maus: ein verlorenes Loslassen (Taste schon oben, etwa nach Fensterwechsel) beendet den Druck, statt beim Überfahren zu ziehen', async ({ page }) => {
  await seed(page, FIXTURE);
  const before = await stored(page);
  const at = await center(grip(page, 'P'));
  await pointer(page, 'pointerdown', at, { pointerType: 'mouse', buttons: 1 });
  const z = await center(item(page, 'Z').locator('.tree-label'));
  await pointer(page, 'pointermove', z, { pointerType: 'mouse', buttons: 0 }); // Taste schon oben
  await expect(markers(page)).toHaveCount(0);
  await pointer(page, 'pointermove', { x: z.x + 20, y: z.y }, { pointerType: 'mouse', buttons: 0 });
  await pointer(page, 'pointerup', z, { pointerType: 'mouse', buttons: 0 });
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  // Fenster verliert den Fokus mitten im Ziehen: Abbruch
  await pointer(page, 'pointerdown', at, { pointerType: 'mouse', buttons: 1 });
  await pointer(page, 'pointermove', z, { pointerType: 'mouse', buttons: 1 });
  await expect(item(page, 'Z')).toHaveAttribute('data-drop', 'ok');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(markers(page)).toHaveCount(0);
  await pointer(page, 'pointerup', z, { pointerType: 'mouse', buttons: 0 });
  expect(await stored(page)).toBe(before);
});

test('Ziehen am Rand: der Baum scrollt mit', async ({ page }) => {
  await seed(page, FIXTURE, 560);
  const tree = page.locator('#profile-tree');
  await expect.poll(() => toBottom(tree)).toBeGreaterThan(100); // erst wenn das Fenster steht
  const bottom = await toBottom(tree);
  const box = await tree.boundingBox();
  const a = await center(grip(page, 'P'));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, box.y + 6, { steps: 6 });
  await expect.poll(() => tree.evaluate((t) => t.scrollTop)).toBeLessThan(bottom - 60);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('Touch: Bewegen vor 400 ms scrollt den Baum und zieht nie, auch nicht nach längerem Halten', async ({ page }) => {
  await seed(page, FIXTURE, 560);
  await buzz(page);
  const tree = page.locator('#profile-tree');
  await expect.poll(() => toBottom(tree)).toBeGreaterThan(100); // erst wenn das Fenster steht
  const bottom = await toBottom(tree);
  const before = await stored(page);
  const at = await center(grip(page, 'A')); // drei Zeilen über dem Ende: der Finger bleibt im Bild
  await touch(page, 'pointerdown', at);
  await touch(page, 'pointermove', { x: at.x, y: at.y + 5 }); // innerhalb der Toleranz
  await touch(page, 'pointermove', { x: at.x, y: at.y + 30 });
  await touch(page, 'pointermove', { x: at.x, y: at.y + 60 });
  expect(await tree.evaluate((t) => t.scrollTop)).toBeLessThan(bottom - 40);
  await page.waitForTimeout(550);
  await touch(page, 'pointermove', { x: at.x, y: at.y + 80 });
  await expect(markers(page)).toHaveCount(0);
  await touch(page, 'pointerup', { x: at.x, y: at.y + 80 });
  await page.waitForTimeout(450);
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  expect(await page.evaluate(() => window.__buzz)).toEqual([]);
});

test('Touch: 400 ms Halten ohne Bewegung, dann Ziehen legt auf einem Ordner ab (mit Vibrieren); Loslassen außerhalb und pointercancel brechen ab', async ({ page }) => {
  await seed(page, FIXTURE);
  await buzz(page);
  const before = await stored(page);
  // Loslassen außerhalb des Baums
  let at = await center(grip(page, 'P'));
  await touch(page, 'pointerdown', at);
  await page.waitForTimeout(250);
  await expect(markers(page)).toHaveCount(0); // noch kein Ziehen
  await page.waitForTimeout(300);
  await expect(item(page, 'P')).toHaveAttribute('data-dragging', 'true');
  expect((await page.evaluate(() => window.__buzz)).length).toBe(1);
  const outside = await center(page.locator('#profile-panel-title'));
  await touch(page, 'pointermove', outside);
  await touch(page, 'pointerup', outside);
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  // pointercancel mitten im Ziehen
  await touch(page, 'pointerdown', at);
  await page.waitForTimeout(500);
  const z = await center(item(page, 'Z').locator('.tree-label'));
  await touch(page, 'pointermove', z);
  await expect(item(page, 'Z')).toHaveAttribute('data-drop', 'ok');
  await touch(page, 'pointercancel', z);
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  // Halten, Ziehen, Ablegen auf D1
  at = await center(grip(page, 'P'));
  await touch(page, 'pointerdown', at);
  await page.waitForTimeout(500);
  const d1 = await center(item(page, 'D1').locator('.tree-label'));
  await touch(page, 'pointermove', { x: at.x, y: (at.y + d1.y) / 2 });
  await touch(page, 'pointermove', d1);
  await expect(item(page, 'D1')).toHaveAttribute('data-drop', 'ok');
  await touch(page, 'pointerup', d1);
  await expect(message(page)).toHaveText('„P“ nach „D1“ verschoben.');
  await expect(item(page, 'P')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'D1')).toHaveAttribute('aria-expanded', 'true');
  expect(names((await storedTree(page)).items[1].items)).toEqual(['D2', 'P']);
});

test('Touch: leichtes Zittern innerhalb von 8 px während des Haltens zieht trotzdem', async ({ page }) => {
  await seed(page, FIXTURE);
  const at = await center(grip(page, 'P'));
  await touch(page, 'pointerdown', at);
  for (const [dx, dy] of [[3, 2], [-4, 5], [6, -5], [-2, -7]]) { // alle innerhalb von 8 px um den Startpunkt
    await page.waitForTimeout(100);
    await touch(page, 'pointermove', { x: at.x + dx, y: at.y + dy });
  }
  await page.waitForTimeout(150);
  await expect(item(page, 'P')).toHaveAttribute('data-dragging', 'true');
  const z = await center(item(page, 'Z').locator('.tree-label'));
  await touch(page, 'pointermove', z);
  await touch(page, 'pointerup', z);
  await expect(message(page)).toHaveText('„P“ nach „Z“ verschoben, dort heißt es „P (2)“ (der Name war vergeben).');
});

test('Touch über Chromes echte Eingabe (CDP): langes Drücken und Ziehen legt ab, schnelles Wischen am Griff scrollt nur', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE', hasTouch: true, viewport: { width: 1280, height: 1500 } });
  const page = await context.newPage();
  watch(page);
  await page.goto('/ui/index.html');
  const many = Array.from({ length: 14 }, (_, i) => prof(`q${i}`, `Q${String(i).padStart(2, '0')}`));
  await page.evaluate((v) => localStorage.setItem('backingtrack.profiles', v), JSON.stringify({ version: 2, items: [...FIXTURE, ...many] }));
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
  const cdp = await context.newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  // schnelles Wischen nach oben am Griff: der Baum scrollt, nichts wird gezogen
  await page.setViewportSize({ width: 1280, height: 560 });
  const tree = page.locator('#profile-tree');
  await item(page, 'Q05').evaluate((r) => r.scrollIntoView({ block: 'end' }));
  const top0 = await tree.evaluate((t) => t.scrollTop);
  const q = await center(grip(page, 'Q05'));
  await send('touchStart', [q]);
  for (let i = 1; i <= 10; i++) { await send('touchMove', [{ x: q.x, y: q.y - i * 15 }]); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  await expect(markers(page)).toHaveCount(0);
  await send('touchEnd', []);
  expect(await tree.evaluate((t) => t.scrollTop)).toBeGreaterThan(top0 + 100);
  // langes Drücken auf P, dann zu D1
  await page.setViewportSize({ width: 1280, height: 1500 });
  await tree.evaluate((t) => { t.scrollTop = 0; });
  const before = await stored(page);
  const a = await center(grip(page, 'P'));
  const d = await center(item(page, 'D1').locator('.tree-label'));
  await send('touchStart', [a]);
  await page.waitForTimeout(550);
  await expect(item(page, 'P')).toHaveAttribute('data-dragging', 'true');
  for (let i = 1; i <= 10; i++) { await send('touchMove', [{ x: a.x + (d.x - a.x) * i / 10, y: a.y + (d.y - a.y) * i / 10 }]); await page.waitForTimeout(16); }
  await expect(item(page, 'D1')).toHaveAttribute('data-drop', 'ok');
  await send('touchEnd', []);
  await expect(message(page)).toHaveText('„P“ nach „D1“ verschoben.');
  expect(await stored(page)).not.toBe(before);
  await expect(item(page, 'P')).toHaveAttribute('aria-selected', 'true');
  await context.close();
});

test('Touch (CDP), 360 px: ist der Baum zu kurz zum Scrollen, schiebt ein Wischen am Griff das Fenster', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE', hasTouch: true, viewport: { width: 360, height: 640 } });
  const page = await context.newPage();
  watch(page);
  await page.goto('/ui/index.html');
  await page.evaluate((v) => localStorage.setItem('backingtrack.profiles', v), JSON.stringify({ version: 2, items: FIXTURE }));
  await page.reload();
  await page.locator('#go').click(); // über Los: Feintuning öffnet hier die Klang-Schublade
  await expect(page.locator('#play')).toBeVisible();
  await openWindow(page);
  await item(page, 'Werksprofile').locator('.tree-twisty').click();
  const tree = page.locator('#profile-tree');
  const pop = page.locator('#profiles-pop');
  expect(await tree.evaluate((t) => t.scrollHeight <= t.clientHeight)).toBe(true); // der Baum selbst scrollt nicht
  expect(await pop.evaluate((p) => p.scrollHeight - p.clientHeight)).toBeGreaterThan(150);
  const before = await stored(page);
  const cdp = await context.newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const q = await center(grip(page, 'P'));
  await send('touchStart', [q]);
  for (let i = 1; i <= 8; i++) { await send('touchMove', [{ x: q.x, y: q.y - i * 15 }]); await page.waitForTimeout(16); }
  await send('touchEnd', []);
  expect(await pop.evaluate((p) => p.scrollTop)).toBeGreaterThan(80);
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  await context.close();
});

test('Touch: kurzes Tippen auf den Griff wählt nur die Zeile', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE', hasTouch: true });
  const page = await context.newPage();
  watch(page);
  await page.goto('/ui/index.html');
  await page.evaluate((v) => localStorage.setItem('backingtrack.profiles', v), JSON.stringify({ version: 2, items: FIXTURE }));
  await page.reload();
  await page.locator('#tune-btn').click();
  await openWindow(page);
  await page.evaluate(() => { window.__types = []; document.addEventListener('pointerdown', (e) => window.__types.push(e.pointerType)); });
  const before = await stored(page);
  await grip(page, 'Z').tap();
  await expect(item(page, 'Z')).toHaveAttribute('aria-selected', 'true');
  await expect(item(page, 'Z')).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(450);
  await expect(markers(page)).toHaveCount(0);
  expect(await stored(page)).toBe(before);
  expect(await page.evaluate(() => window.__types)).toEqual(['touch']);
  await context.close();
});
