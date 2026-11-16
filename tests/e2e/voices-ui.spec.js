// Stimmenwahl in der Hauptoberfläche (echte Seite /ui/index.html): ein LCD-Select je Instrument für Stimme und Variante (Wert "id/variante"),
// Art-Kennung, Ladezustand im Display, deaktivierte Knöpfe, live ohne Neustart, Stilwechsel setzt die Stimmen des Stils, Sprachen, Tastatur, Tasten.
import { test, expect } from '@playwright/test';
import { chooseStyle, openSetup } from './style-helpers.js';
import { VOICES } from '../../src/core/voices.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|voice|variant|chord|groove|meter)\.[A-Za-z.]+$/;
const LAYERS = ['bass', 'chords', 'pad'];
const EFFECTS = ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']; // gelten für jede Stimme

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openSetup(page);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const module = (page, id) => page.locator(`.instrument[data-layer="${id}"]`);
const voice = (page, layer) => page.locator(`#voice-${layer}`);
const kind = (page, layer) => page.locator(`#voice-kind-${layer}`);
const status = (page, layer) => page.locator(`#voice-status-${layer}`);
const hint = (page, layer) => page.locator(`#voice-hint-${layer}`);
const slider = (page, layer, field) => page.locator(`#timbre-${layer}-${field}`);
const contexts = (page) => page.evaluate(() => window.__audioContexts);

test('je Instrument ein Select Stimme, nach Art gruppiert, eine Zeile je Variante; am Start die Stimmen des Stils Funk (sonst die erste Sample-Variante); kein eigenes Variantenfeld mehr', async ({ page }) => {
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
  await voice(page, 'bass').selectOption('sample/finger');
  await expect(kind(page, 'bass')).toHaveText('SMP');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await voice(page, 'bass').selectOption('sample/pick');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await voice(page, 'bass').selectOption('synth/classic');
  await expect(kind(page, 'bass')).toHaveText('SYN');
  await expect(status(page, 'bass')).toHaveText('');
  await voice(page, 'chords').selectOption('epiano/rhodes'); // E-Piano ist Synthese
  await expect(kind(page, 'chords')).toHaveText('SYN');
});

test('deaktivierte Knöpfe: Synth alle aktiv; je Stimme nur die von ihr benutzten, Verzerrer, Vibrato und Chorus immer; Hinweis nur dann', async ({ page }) => {
  for (const layer of LAYERS) {
    await voice(page, layer).selectOption('synth/classic');
    await expect(module(page, layer).locator('input[type="range"]:disabled')).toHaveCount(0);
    await expect(hint(page, layer)).toBeHidden();
  }
  await voice(page, 'chords').selectOption('sample/guitar');
  await expect(slider(page, 'chords', 'tremolo')).toBeDisabled();
  for (const field of ['brightness', 'length', ...EFFECTS]) await expect(slider(page, 'chords', field)).toBeEnabled();
  await voice(page, 'chords').selectOption('organ/jazz'); // die Orgel hat eigene Feinwerte, aber Vibrato, Chorus und die Verzerrer wirken auch auf sie
  for (const field of ['brightness', 'length', 'tremolo']) await expect(slider(page, 'chords', field)).toBeDisabled();
  for (const field of EFFECTS) await expect(slider(page, 'chords', field)).toBeEnabled();
  await expect(hint(page, 'chords')).toBeVisible();
  await voice(page, 'bass').selectOption('sample/finger');
  for (const field of ['sub', 'pluck', 'resonance', 'roundness']) await expect(slider(page, 'bass', field)).toBeDisabled();
  for (const field of ['cutoff', ...EFFECTS]) await expect(slider(page, 'bass', field)).toBeEnabled();
  await voice(page, 'pad').selectOption('sample/strings');
  for (const field of ['lfoSpeed', 'lfoDepth', 'shimmer', 'thickness']) await expect(slider(page, 'pad', field)).toBeDisabled();
  for (const field of ['attack', 'cutoff', ...EFFECTS]) await expect(slider(page, 'pad', field)).toBeEnabled();
  await voice(page, 'chords').selectOption('synth/classic');
  await expect(module(page, 'chords').locator('input[type="range"]:disabled')).toHaveCount(0);
  await expect(hint(page, 'chords')).toBeHidden();
});

test('während der Wiedergabe wechseln: ohne Fehler, ohne neuen AudioContext, die Wiedergabe läuft weiter', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await voice(page, 'chords').selectOption('sample/guitar');
  await voice(page, 'bass').selectOption('sample/finger');
  await expect(status(page, 'chords')).toHaveText('bereit', { timeout: 20_000 });
  await page.waitForTimeout(500);
  await voice(page, 'chords').selectOption('epiano/rhodes');
  await page.waitForTimeout(300);
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
    await voice(page, layer).selectOption(`sample/${list[0]}`);
    await expect(status(page, layer)).toHaveText('bereit', { timeout: 20_000 });
  }
  // Sample-Kits benutzen nur den Raum; die übrigen Schlagzeugknöpfe sind ausgegraut
  await expect(slider(page, 'drums', 'kickPunch')).toBeDisabled();
  await expect(slider(page, 'drums', 'room')).toBeEnabled();
  await voice(page, 'drums').selectOption('sample/rimshot'); // Rimshot lädt das Standard-Kit
  await expect(status(page, 'drums')).toHaveText('bereit', { timeout: 20_000 });
});

test('während der Wiedergabe Schlagzeug auf Samples, Kit TR-808: läuft weiter, ein AudioContext, keine Fehler', async ({ page }) => {
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await voice(page, 'drums').selectOption('sample/808');
  await expect(status(page, 'drums')).toHaveText('bereit', { timeout: 20_000 });
  await page.waitForTimeout(800);
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
  await voice(page, 'bass').selectOption('sample/pick');
  await expect(voice(page, 'bass')).toHaveValue('sample/pick');
  await expect(voice(page, 'chords')).toHaveValue('sample/steel');
});

test('Stilwechsel während der Wiedergabe: die Stimmen des Stils gehen live an den Player, kein Neustart', async ({ page }) => {
  await page.evaluate(() => { window.__voiceSets = []; });
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt 1 von/, { timeout: 15_000 });
  const before = await contexts(page);
  await page.locator('#style-select').selectOption('reggae');
  await expect(voice(page, 'drums')).toHaveValue('sample/rimshot');
  await expect(voice(page, 'chords')).toHaveValue('sample/muted');
  await expect(page.locator('#play-position')).toHaveText(/^Takt [2-9] von/, { timeout: 15_000 });
  expect(await contexts(page)).toBe(before);
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  await page.locator('#play-go').click();
});

test('Sprachwechsel: Beschriftungen und Auswahlgruppen in Englisch ohne rohe Schlüssel, danach wieder Deutsch', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample/finger');
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Voice');
  expect(await voice(page, 'bass').locator('optgroup').evaluateAll((els) => els.map((e) => e.label))).toEqual(['Synthesis', 'Samples']);
  const texts = await page.locator('#rack-instruments').evaluate((el) => [...el.querySelectorAll('label, option, optgroup, p, span')].map((n) => (n.label || n.textContent).trim()).filter(Boolean));
  for (const text of texts) expect(RAW_KEY.test(text), text).toBe(false);
  await page.locator('[data-lang="de"]').click();
  await expect(page.locator('label[for="voice-bass"]')).toHaveText('Stimme');
});

test('Zurücksetzen im Bass-Modul mit Sample-Stimme: der Fokus bleibt im Modul (der erste Knopf Sub ist ausgegraut)', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample/finger');
  await expect(slider(page, 'bass', 'sub')).toBeDisabled();
  await slider(page, 'bass', 'cutoff').fill('80');
  const reset = module(page, 'bass').locator('.timbre-reset');
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(reset).toBeDisabled();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  expect(await module(page, 'bass').evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test('Ein schon geladenes Pack zeigt direkt bereit, ohne zwischendurch lädt', async ({ page }) => {
  await voice(page, 'bass').selectOption('sample/finger');
  await expect(status(page, 'bass')).toHaveText('bereit', { timeout: 20_000 });
  await voice(page, 'bass').selectOption('synth/classic');
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => window.__seen.push(document.getElementById('voice-status-bass').textContent)).observe(document.getElementById('voice-status-bass'), { childList: true, characterData: true, subtree: true });
  });
  await voice(page, 'bass').selectOption('sample/finger');
  await expect(status(page, 'bass')).toHaveText('bereit');
  expect(await page.evaluate(() => window.__seen)).not.toContain('lädt …');
});

test('Tastatur: das Select ist fokussierbar und mit den Pfeiltasten umschaltbar, die Tasten ‹ › gehen eine Zeile weiter', async ({ page }) => {
  await voice(page, 'bass').focus();
  await page.keyboard.press('ArrowUp');
  await expect(voice(page, 'bass')).toHaveValue('synth/classic');
  await expect(kind(page, 'bass')).toHaveText('SYN');
  await page.keyboard.press('ArrowDown');
  await expect(voice(page, 'bass')).toHaveValue('sample/finger');
  await expect(kind(page, 'bass')).toHaveText('SMP');
  await page.keyboard.press('ArrowDown');
  await expect(voice(page, 'bass')).toHaveValue('sample/pick');
  const [prev, next] = await module(page, 'bass').locator('.inst-voice .lcd-btn').all();
  await next.click();
  await expect(voice(page, 'bass')).toHaveValue('sample/upright');
  await expect(next).toBeDisabled();
  await prev.click();
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
  await voice(page, 'chords').selectOption('organ/jazz');
  await expect(leslie).toBeVisible();
  await expect(page.locator('label[for="organ-leslie"]')).toHaveText('Leslie');
  await expect(page.locator('label[for="organ-drive"]')).toHaveText('Orgel-Zerre');
  await expect(leslie).toHaveValue('2');
  await expect(leslie).toHaveAttribute('aria-valuetext', 'automatisch');
  await expect(drive).toHaveValue('25'); // Preset Jazz
  await voice(page, 'chords').selectOption('organ/rock');
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
  await voice(page, 'chords').selectOption('sample/guitar');
  await expect(leslie).toBeHidden();
  await page.getByRole('button', { name: /^EN/i }).click();
  await voice(page, 'chords').selectOption('organ/gospel');
  await expect(page.locator('label[for="organ-drive"]')).toHaveText('Organ drive');
  await expect(leslie).toHaveAttribute('aria-valuetext', 'automatic');
});

test('Orgel: Wähler und Zerre gehen als Feinwerte an den Player (beim Start und live), stehen im Profil-Teil Klangregler; Doppelklick stellt die Zerre des Presets wieder her', async ({ page }) => {
  await voice(page, 'chords').selectOption('organ/jazz');
  const state = () => page.evaluate(async () => structuredClone((await import('/ui/state.js')).state.organ));
  const tuning = () => page.evaluate(async () => {
    const { state: s } = await import('/ui/state.js');
    return (await import('/ui/organ-tuning.js')).organTuning(s.organ);
  });
  expect(await state()).toEqual({ leslie: 'auto', drive: null });
  expect(await tuning()).toEqual({}); // Standard: die Presets gelten unverändert
  await page.locator('#organ-leslie').fill('3');
  await expect(page.locator('#organ-leslie')).toHaveAttribute('aria-valuetext', 'schnell');
  await page.locator('#organ-drive').fill('80');
  expect(await state()).toEqual({ leslie: 'fast', drive: 0.8 });
  expect((await tuning())['chords/organ/jazz']).toEqual({ leslie: 3, drive: 0.8 });

  // Wiedergabe: kein Neustart beim Drehen
  await page.locator('#tuning-tempo').fill('200');
  await page.locator('#play-go').click();
  await expect(page.locator('#play-position')).toHaveText(/^Takt 1 von/, { timeout: 15_000 });
  const before = await contexts(page);
  await page.locator('#organ-leslie').fill('1');
  await expect(page.locator('#organ-leslie')).toHaveAttribute('aria-valuetext', 'langsam');
  await expect(page.locator('#play-position')).toHaveText(/^Takt [2-9] von/, { timeout: 15_000 });
  expect(await contexts(page)).toBe(before);
  await page.locator('#play-go').click();

  // Profil-Teil Klangregler: festhalten, prüfen, anwenden
  expect(await page.evaluate(async () => {
    const { state: s } = await import('/ui/state.js');
    const { captureParts, sanitizeParts, applyParts } = await import('/core/profile-parts.js');
    const { readSession } = await import('/ui/profile-session.js');
    const kept = sanitizeParts(captureParts(readSession(s), ['sound']));
    const back = applyParts({ ...readSession(s), organ: { leslie: 'auto', drive: null } }, kept.parts);
    return { skipped: kept.skipped, organ: kept.parts.sound.organ, applied: back.session.organ };
  })).toEqual({ skipped: 0, organ: { leslie: 'slow', drive: 0.8 }, applied: { leslie: 'slow', drive: 0.8 } });

  // Doppelklick: zurück zur Zerre des Presets
  await page.locator('.knob:has(#organ-drive)').dblclick();
  await expect(page.locator('#organ-drive')).toHaveValue('25');
  expect((await state()).drive).toBeNull();
});
