// Stimmenwahl in der Hauptoberfläche (echte Seite der App): ein LCD-Select je Instrument für Stimme und Variante (Wert "id/variante"),
// Art-Kennung, Ladezustand im Display, deaktivierte Knöpfe, live ohne Neustart, Stilwechsel setzt die Stimmen des Stils, Sprachen, Tastatur, Tasten.
// Portiert aus tests/e2e/voices-ui.spec.js: die App lädt ihre Seite; das Register der Stimmen (VOICES) aus tables() der Sitzung; gelesen wird,
// wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts zählt count-helpers.js; was die Web-App von der Orgel an den Player gab
// (organTuning) und im Profil-Teil Klangregler festhielt, steht hier in den Antworten der Sitzung und in einem gespeicherten Profil der Sitzung;
// die Sprache wählt die Leiste der App.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { chooseStyle, openSetup } from './style-helpers.js';
import { contexts, countContexts } from './count-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|voice|variant|chord|groove|meter)\.[A-Za-z.]+$/;
const LAYERS = ['bass', 'chords', 'pad'];
const EFFECTS = ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']; // gelten für jede Stimme

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
  await openSetup(page);
});

const module = (page, id) => page.locator(`.instrument[data-layer="${id}"]`);
const voice = (page, layer) => page.locator(`#voice-${layer}`);
const kind = (page, layer) => page.locator(`#voice-kind-${layer}`);
const status = (page, layer) => page.locator(`#voice-status-${layer}`);
const hint = (page, layer) => page.locator(`#voice-hint-${layer}`);
const slider = (page, layer, field) => page.locator(`#timbre-${layer}-${field}`);
// eine Stimme wählen und warten, bis die Seite die Antwort zeigt (die Auswahl zeigt bis dahin die Hand, die Knöpfe die Stimme davor)
const choose = async (page, layer, value) => { await voice(page, layer).selectOption(value); await answered(page); };

test('je Instrument ein Select Stimme, nach Art gruppiert, eine Zeile je Variante; am Start die Stimmen des Stils Funk (sonst die erste Sample-Variante); kein eigenes Variantenfeld mehr', async ({ page }) => {
  const { VOICES } = await fromSession(page, 'tables');
  const groups = (layer) => voice(page, layer).locator('optgroup').evaluateAll((els) => els.map((e) => e.label));
  // Saitenmodelle sind aus der Auswahl genommen (hidden im Register); das E-Piano gehört zur Synthese
  expect(await groups('bass')).toEqual(['Synthese', 'Samples']);
  expect(await groups('chords')).toEqual(['Synthese', 'Samples']);
  expect(await groups('pad')).toEqual(['Synthese', 'Samples']);
  const START = { chords: 'funk' }; // Vorschlag des Startstils Funk-Rock; Bass (finger) und Pad sind die erste Sample-Variante
  for (const layer of LAYERS) {
    await expect(voice(page, layer)).toHaveValue(`sample/${START[layer] ?? VOICES[layer].sample.variants[0]}`);
    await expect(kind(page, layer)).toHaveText('SMP');
    await expect(page.locator(`#variant-${layer}`)).toHaveCount(0);
    await expect(page.locator(`label[for="voice-${layer}"]`)).toHaveText('Stimme');
  }
  const values = (layer) => voice(page, layer).locator('option').evaluateAll((els) => els.map((e) => e.value).sort());
  const expected = (layer) => Object.entries(VOICES[layer]).filter(([, v]) => !v.hidden).flatMap(([id, v]) => v.variants.map((variant) => `${id}/${variant}`)).sort();
  for (const layer of [...LAYERS, 'drums', 'lead', 'percussion']) expect(await values(layer), layer).toEqual(expected(layer));
  await expect(voice(page, 'bass').locator('option[value="sample/finger"]')).toHaveText('E-Bass Finger (Sample)');
  await expect(voice(page, 'chords').locator('option[value="epiano/rhodes"]')).toHaveText('Rhodes');
});

test('Sample-Stimme wählen: Kennung SMP, Ladezustand bereit im Display; Variante in derselben Liste; zurück zu Synth leert den Zustand', async ({ page }) => {
  await choose(page, 'bass', 'sample/finger'); // die Stimme des Starts: Kennung und Zustand stünden auch vor der Antwort da
  await expect(kind(page, 'bass')).toHaveText('SMP');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await choose(page, 'bass', 'sample/pick');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await choose(page, 'bass', 'synth/classic');
  await expect(kind(page, 'bass')).toHaveText('SYN');
  await expect(status(page, 'bass')).toHaveText('');
  await choose(page, 'chords', 'epiano/rhodes'); // E-Piano ist Synthese
  await expect(kind(page, 'chords')).toHaveText('SYN');
});

test('deaktivierte Knöpfe: Synth alle aktiv; je Stimme nur die von ihr benutzten, Verzerrer, Vibrato und Chorus immer; Hinweis nur dann', async ({ page }) => {
  for (const layer of LAYERS) {
    await choose(page, layer, 'synth/classic');
    await expect(module(page, layer).locator('input[type="range"]:disabled')).toHaveCount(0);
    await expect(hint(page, layer)).toBeHidden();
  }
  await choose(page, 'chords', 'sample/guitar');
  await expect(slider(page, 'chords', 'tremolo')).toBeDisabled();
  for (const field of ['brightness', 'length', ...EFFECTS]) await expect(slider(page, 'chords', field)).toBeEnabled();
  await choose(page, 'chords', 'organ/jazz'); // die Orgel hat eigene Feinwerte, aber Vibrato, Chorus und die Verzerrer wirken auch auf sie
  for (const field of ['brightness', 'length', 'tremolo']) await expect(slider(page, 'chords', field)).toBeDisabled();
  for (const field of EFFECTS) await expect(slider(page, 'chords', field)).toBeEnabled();
  await expect(hint(page, 'chords')).toBeVisible();
  await choose(page, 'bass', 'sample/finger');
  for (const field of ['sub', 'pluck', 'resonance', 'roundness']) await expect(slider(page, 'bass', field)).toBeDisabled();
  for (const field of ['cutoff', ...EFFECTS]) await expect(slider(page, 'bass', field)).toBeEnabled();
  await choose(page, 'pad', 'sample/strings');
  for (const field of ['lfoSpeed', 'lfoDepth', 'shimmer', 'thickness']) await expect(slider(page, 'pad', field)).toBeDisabled();
  for (const field of ['attack', 'cutoff', ...EFFECTS]) await expect(slider(page, 'pad', field)).toBeEnabled();
  await choose(page, 'chords', 'synth/classic');
  await expect(module(page, 'chords').locator('input[type="range"]:disabled')).toHaveCount(0);
  await expect(hint(page, 'chords')).toBeHidden();
});

test('während der Wiedergabe wechseln: ohne Fehler, ohne neuen AudioContext, die Wiedergabe läuft weiter', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await voice(page, 'chords').selectOption('sample/guitar');
  await voice(page, 'bass').selectOption('sample/finger');
  await answered(page); // die Akkorde (Funk) waren schon bereit: erst nach der Antwort zeigt der Zustand das neue Pack
  await expect(status(page, 'chords')).toHaveText('bereit', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await voice(page, 'chords').selectOption('epiano/rhodes');
  await page.waitForTimeout(300);
  await settled(page); // die Antworten und was die Engine mit ihnen tut; "Stopp" stünde auch vorher da
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Schlagzeug, Lead und Percussion: Select Stimme (Synth, Samples), bei Samples alle Varianten in derselben Liste', async ({ page }) => {
  const VARIANTS = { drums: ['standard', 'brushes', 'rimshot', 'jazz', 'electronic', '808', 'muldjord', 'legacy'], lead: ['flute', 'sax', 'synth', 'guitar'], percussion: ['studio'] };
  for (const [layer, list] of Object.entries(VARIANTS)) {
    expect(await voice(page, layer).locator('optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual(['Synthese', 'Samples']);
    await expect(voice(page, layer)).toHaveValue(`sample/${list[0]}`);
    expect(await voice(page, layer).locator('optgroup').last().locator('option').evaluateAll((els) => els.map((e) => e.value))).toEqual(list.map((v) => `sample/${v}`));
    await choose(page, layer, `sample/${list[0]}`); // die Stimme des Starts: der Zustand stünde auch vor der Antwort da
    await expect(status(page, layer)).toHaveText('bereit', { timeout: 20_000 });
  }
  // Sample-Kits benutzen nur den Raum; die übrigen Schlagzeugknöpfe sind ausgegraut
  await expect(slider(page, 'drums', 'kickPunch')).toBeDisabled();
  await expect(slider(page, 'drums', 'room')).toBeEnabled();
  await choose(page, 'drums', 'sample/rimshot'); // Rimshot lädt das Standard-Kit
  await expect(status(page, 'drums')).toHaveText('bereit', { timeout: 20_000 });
});

test('während der Wiedergabe Schlagzeug auf Samples, Kit TR-808: läuft weiter, ein AudioContext, keine Fehler', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await voice(page, 'drums').selectOption('sample/808');
  await answered(page); // das Kit des Starts war schon bereit: erst nach der Antwort zeigt der Zustand das neue Kit
  await expect(status(page, 'drums')).toHaveText('bereit', { timeout: 20_000 });
  await page.waitForTimeout(800);
  await settled(page); // "Stopp" stünde auch vorher da
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await contexts(page)).toBe(1);
  await page.locator('#play-go').click();
});

test('Stile schlagen Stimmen vor: Start mit den Stimmen von Funk, ein Stilwechsel setzt Bass, Akkorde und Schlagzeug des Stils und lässt die übrigen Schichten stehen', async ({ page }) => {
  // Start: Funk-Rock
  await expect(voice(page, 'bass')).toHaveValue('sample/finger');
  await expect(voice(page, 'chords')).toHaveValue('sample/funk');
  await expect(voice(page, 'drums')).toHaveValue('sample/standard');
  // eigene Wahl: Akkorde und Lead
  await voice(page, 'chords').selectOption('epiano/rhodes');
  await voice(page, 'lead').selectOption('sample/sax');
  await chooseStyle(page, 'country');
  await expect(voice(page, 'bass')).toHaveValue('sample/upright');
  await expect(voice(page, 'chords')).toHaveValue('sample/steel'); // der Stil setzt seine Stimme wie seine Schlagworte
  await expect(voice(page, 'drums')).toHaveValue('sample/brushes');
  await expect(voice(page, 'lead')).toHaveValue('sample/sax'); // kein Vorschlag für Lead: die Wahl bleibt
  // die neuen Packs laden und melden sich im Display
  await expect(page.locator('#voice-status-bass')).toHaveText('bereit', { timeout: 15_000 });
  await expect(page.locator('#voice-status-chords')).toHaveText('bereit', { timeout: 15_000 });
  // danach bleibt jede Stimme einzeln änderbar
  await choose(page, 'bass', 'sample/pick');
  await expect(voice(page, 'bass')).toHaveValue('sample/pick');
  await expect(voice(page, 'chords')).toHaveValue('sample/steel');
});

test('Stilwechsel während der Wiedergabe: die Stimmen des Stils gehen live an den Player, kein Neustart', async ({ page }) => {
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt 1 von/, { timeout: 15_000 });
  const before = await contexts(page);
  await page.locator('#style-select').selectOption('reggae');
  await settled(page); // die Antwort und was die Engine mit ihr tut
  await expect(voice(page, 'drums')).toHaveValue('sample/rimshot');
  await expect(voice(page, 'chords')).toHaveValue('sample/muted');
  await expect(page.locator('#play-position')).toHaveText(/^Takt [2-9] von/, { timeout: 15_000 });
  expect(await contexts(page)).toBe(before);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('Sprachwechsel: Beschriftungen und Auswahlgruppen in Englisch ohne rohe Schlüssel, danach wieder Deutsch', async ({ page }) => {
  await choose(page, 'bass', 'sample/finger');
  await chooseLanguage(page, 'en');
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Voice');
  expect(await voice(page, 'bass').locator('optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual(['Synthesis', 'Samples']);
  const texts = await page.locator('#rack-instruments').evaluate((el) => [...el.querySelectorAll('label, option, optgroup, p, span')].map((n) => (n.label || n.textContent).trim()).filter(Boolean));
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
  await chooseLanguage(page, 'de');
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Stimme');
});

test('Zurücksetzen im Bass-Modul mit Sample-Stimme: der Fokus bleibt im Modul (der erste Knopf Sub ist ausgegraut)', async ({ page }) => {
  await choose(page, 'bass', 'sample/finger');
  await expect(slider(page, 'bass', 'sub')).toBeDisabled();
  await slider(page, 'bass', 'cutoff').fill('80');
  await answered(page);
  const reset = module(page, 'bass').locator('.timbre-reset');
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await answered(page);
  await expect(reset).toBeDisabled();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  expect(await module(page, 'bass').evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test('Ein schon geladenes Pack zeigt direkt bereit, ohne zwischendurch lädt', async ({ page }) => {
  await choose(page, 'bass', 'sample/finger');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await choose(page, 'bass', 'synth/classic');
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => window.__seen.push(document.getElementById('voice-status-bass').textContent)).observe(document.getElementById('voice-status-bass'), { childList: true, characterData: true, subtree: true });
  });
  await choose(page, 'bass', 'sample/finger');
  await expect(status(page, 'bass')).toHaveText('bereit');
  expect(await page.evaluate(() => window.__seen)).not.toContain('lädt …');
});

test('Tastatur: das Select ist fokussierbar und mit den Pfeiltasten umschaltbar, die Tasten ‹ › gehen eine Zeile weiter', async ({ page }) => {
  await voice(page, 'bass').focus();
  await page.keyboard.press('ArrowUp');
  await answered(page); // die Auswahl zeigt die Hand bis zur Antwort
  await expect(voice(page, 'bass')).toHaveValue('synth/classic');
  await expect(kind(page, 'bass')).toHaveText('SYN');
  await page.keyboard.press('ArrowDown');
  await answered(page);
  await expect(voice(page, 'bass')).toHaveValue('sample/finger');
  await expect(kind(page, 'bass')).toHaveText('SMP');
  await page.keyboard.press('ArrowDown');
  await answered(page);
  await expect(voice(page, 'bass')).toHaveValue('sample/pick');
  const [prev, next] = await module(page, 'bass').locator('.inst-voice .lcd-btn').all();
  await next.click();
  await answered(page);
  await expect(voice(page, 'bass')).toHaveValue('sample/upright');
  await expect(next).toBeDisabled();
  await prev.click();
  await answered(page);
  await expect(voice(page, 'bass')).toHaveValue('sample/pick');
});

test('Tasten ‹ › haben eine 44-px-Trefferfläche und überlappen das Display nicht; das Display ist mindestens 44 px hoch', async ({ page }) => {
  for (const layer of LAYERS) {
    const [prev, next] = await module(page, layer).locator('.inst-voice .lcd-btn').all();
    const [p, n, s] = [await prev.boundingBox(), await next.boundingBox(), await voice(page, layer).boundingBox()];
    expect(p.width, layer).toBeGreaterThanOrEqual(43.5);
    expect(p.height, layer).toBeGreaterThanOrEqual(43.5);
    expect(n.width, layer).toBeGreaterThanOrEqual(43.5);
    expect(p.x + p.width, layer).toBeLessThanOrEqual(s.x + 0.5);
    expect(n.x, layer).toBeGreaterThanOrEqual(s.x + s.width - 0.5);
    expect(s.height, layer).toBeGreaterThanOrEqual(43.5);
  }
});

// Orgel: Leslie-Wähler und Zerre im Akkord-Modul
test('Orgel: Leslie und Orgel-Zerre erscheinen nur mit der Orgel, in Zeile 2 des Knopfrasters; der Standard ist automatisch und die Zerre des Presets', async ({ page }) => {
  const leslie = page.locator('#organ-leslie');
  const drive = page.locator('#organ-drive');
  await expect(leslie).toBeHidden(); // Start: Gitarre
  await expect(drive).toBeHidden();
  await choose(page, 'chords', 'organ/jazz');
  await expect(leslie).toBeVisible();
  await expect(page.locator('label[for="organ-leslie"]')).toHaveText('Leslie');
  await expect(page.locator('label[for="organ-drive"]')).toHaveText('Orgel-Zerre');
  await expect(leslie).toHaveValue('2');
  await expect(leslie).toHaveAttribute('aria-valuetext', 'automatisch');
  await expect(drive).toHaveValue('25'); // Preset Jazz
  await choose(page, 'chords', 'organ/rock');
  await expect(drive).toHaveValue('50'); // Preset Rock, solange nichts gewählt ist
  // Platz: dieselbe Zeile, unter Helligkeit und Länge, über Fuzz und Overdrive
  const y = (id) => page.locator(`.knob:has(#${id})`).evaluate((el) => Math.round(el.getBoundingClientRect().y));
  const x = (id) => page.locator(`.knob:has(#${id})`).evaluate((el) => Math.round(el.getBoundingClientRect().x));
  expect(await y('organ-leslie')).toBe(await y('organ-drive'));
  expect(await y('organ-leslie')).toBeGreaterThan(await y('timbre-chords-brightness'));
  expect(await y('organ-leslie')).toBeLessThan(await y('timbre-chords-fuzz'));
  expect(await x('organ-leslie')).toBe(await x('timbre-chords-fuzz'));
  expect(await x('organ-drive')).toBe(await x('timbre-chords-overdrive'));
  // Anzeige über dem Knopf
  await page.locator('.knob-cell:has(#organ-leslie)').hover();
  expect(await page.locator('.knob-cell:has(#organ-leslie)').evaluate((cell) => getComputedStyle(cell, '::after').content)).toBe('"automatisch"');
  // ohne Orgel wieder weg, die Wahl bleibt
  await choose(page, 'chords', 'sample/guitar');
  await expect(leslie).toBeHidden();
  await chooseLanguage(page, 'en');
  await choose(page, 'chords', 'organ/gospel');
  await expect(page.locator('label[for="organ-drive"]')).toHaveText('Organ drive');
  await expect(leslie).toHaveAttribute('aria-valuetext', 'automatic');
});

test('Orgel: Wähler und Zerre gehen als Feinwerte an den Player (beim Start und live), stehen im Profil-Teil Klangregler; Doppelklick stellt die Zerre des Presets wieder her', async ({ page }) => {
  await choose(page, 'chords', 'organ/jazz');
  const state = async () => (await fromSession(page, 'state')).organ;
  // die Merker der letzten Antwort: sound setzt der Kern, wenn sich organTuning(state.organ) ändert, und auf ihn gibt die Hülle der Engine die
  // Feinwerte (PROTOKOLL.md Abschnitt 1 und 7). organTuning selbst rechnet der Kern; btg_logic_tests hält es gegen die Web-App (Zeile organTuning,
  // mit der Orgel des Standards, für die die Web-App {} prüfte: die Presets gelten unverändert)
  const change = async () => (await fromSession(page, 'change')) ?? {};
  expect(await state()).toEqual({ leslie: 'auto', drive: null });
  await page.locator('#organ-leslie').fill('3');
  await answered(page);
  await expect(page.locator('#organ-leslie')).toHaveAttribute('aria-valuetext', 'schnell');
  await page.locator('#organ-drive').fill('80');
  await answered(page);
  expect(await state()).toEqual({ leslie: 'fast', drive: 0.8 });
  expect((await change()).sound).toBe(true); // neue Feinwerte für chords/organ/jazz: die Antwort trägt den Merker für die Engine

  // Wiedergabe: kein Neustart beim Drehen
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt 1 von/, { timeout: 15_000 });
  const before = await contexts(page);
  await page.locator('#organ-leslie').fill('1');
  await answered(page);
  await expect(page.locator('#organ-leslie')).toHaveAttribute('aria-valuetext', 'langsam');
  expect((await change()).sound).toBe(true); // auch live trägt die Antwort den Merker
  await expect(page.locator('#play-position')).toHaveText(/^Takt [2-9] von/, { timeout: 15_000 });
  expect(await contexts(page)).toBe(before);
  await page.locator('#play-go').click();

  // Profil-Teil Klangregler: festhalten (ein Profil nur mit dem Teil, wie das Profil-Fenster es speichert), prüfen (der Teil steht ganz im Profil,
  // die Datei seines Exports trägt die Orgel), anwenden (Laden auf eine Sitzung mit der Orgel des Standards)
  expect(await page.evaluate(async () => {
    const { session, send, exportFile } = await import('./session.js');
    await send({ action: 'saveProfile', name: 'Orgel', folder: null, parts: ['sound'], id: 'orgel' });
    const parts = session.profiles.items.find((x) => x.id === 'orgel').parts;
    const organ = JSON.parse(await exportFile('orgel', 'Orgel')).parts.sound.organ;
    await send({ action: 'setLeslie', mode: 'auto' });
    await send({ action: 'setOrganDrive', value: null });
    await send({ action: 'profileSelect', key: 'orgel' });
    const applied = (await send({ action: 'loadProfile' })).organ;
    return { parts, organ, applied };
  })).toEqual({ parts: ['sound'], organ: { leslie: 'slow', drive: 0.8 }, applied: { leslie: 'slow', drive: 0.8 } });

  // Doppelklick: zurück zur Zerre des Presets
  await page.locator('.knob:has(#organ-drive)').dblclick();
  await answered(page);
  await expect(page.locator('#organ-drive')).toHaveValue('25');
  expect((await state()).drive).toBeNull();
});
