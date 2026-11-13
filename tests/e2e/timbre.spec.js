// Klangknöpfe der Spielseite (echte Seite /ui/index.html): ein Knopf je Klangfeld in den Instrument-Modulen (Gesamt im Mixer), live ohne Neustart.
import { test, expect } from '@playwright/test';
import { STYLE_PRESETS } from '../../src/core/tags.js';
import { DEFAULT_TIMBRE, resolveTimbre, resolveTrackTimbre } from '../../src/core/timbre.js';
import { LAYER_IDS } from '../../src/core/layers.js';
import { masterParams } from '../../src/audio/voice-params.js';
import { chooseStyle, currentStyle, openSetup, openTags } from './style-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre)\.[A-Za-z.]+$/;
const BAR_TIMEOUT = 10_000;
const FIELDS = Object.entries(DEFAULT_TIMBRE).flatMap(([group, fields]) => Object.keys(fields).map((field) => [group, field]));
const funk = STYLE_PRESETS.find((p) => p.id === 'funk');

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
    // Ziele der weichen Rampen (setTargetAtTime): so sieht man, dass ein Regler die Audioknoten live erreicht
    window.__targets = [];
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, ...rest) {
      window.__targets.push(value);
      return target.call(this, value, ...rest);
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

// Knöpfe der Schichten liegen im Instrument-Modul, die Gesamt-Knöpfe (master) im Mixer
const group = (page, id) => (id === 'master' ? page.locator('#mixer-master') : page.locator(`.instrument[data-layer="${id}"]`));
const slider = (page, g, f) => page.locator(`#timbre-${g}-${f}`);
const position = (page) => page.locator('#play-position');
const playGo = (page) => page.locator('#play-go');
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const targets = (page) => page.evaluate(() => window.__targets);
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const percent = (value) => String(Math.round(value * 100));

async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Stopp');
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
}

// Auswahl nach einem Klick auf ein Schlagwort: aus den Chips der Seite gelesen, damit der Test den Umschalter nicht nachbaut
const currentTags = (page) => page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => {
  const tags = {};
  for (const el of els) (tags[el.dataset.category] ??= []).push(el.dataset.tag);
  return tags;
});

test('37 Knöpfe in 5 Modulen und im Mixer, alle beschriftet ohne rohen Schlüsselnamen; ein Modul je Schicht in Reihenfolge', async ({ page }) => {
  expect(FIELDS).toHaveLength(37);
  expect(await page.locator('.instrument').evaluateAll((els) => els.map((e) => e.dataset.layer))).toEqual(LAYER_IDS);
  for (const [g, fields] of Object.entries(DEFAULT_TIMBRE)) {
    await expect(group(page, g), g).toHaveCount(1);
    await expect(group(page, g).locator('input[type="range"]'), g).toHaveCount(Object.keys(fields).length);
    await expect(group(page, g).locator('.knob'), g).toHaveCount(Object.keys(fields).length);
  }
  for (const [g, f] of FIELDS) {
    const label = await page.locator(`label[for="timbre-${g}-${f}"]`).textContent();
    expect(label.trim().length, `${g}.${f}`).toBeGreaterThan(0);
    expect(RAW_KEY.test(label.trim()), `${g}.${f}: ${label}`).toBe(false);
  }
  const titles = await page.locator('.instrument .module-title').allTextContents();
  expect(titles).toEqual(['Schlagzeug', 'Bass', 'Akkorde', 'Pad', 'Lead', 'Percussion']);
  // Percussion hat keine Klangfelder, nur den Hinweis
  await expect(group(page, 'percussion').locator('input[type="range"]')).toHaveCount(0);
});

test('Beschriftung unter dem Knopf ist mindestens 11 px; Bogen: Ursprung Mitte bei Standard 0,5, sonst linker Anschlag', async ({ page }) => {
  for (const [g, f] of FIELDS) {
    const size = await page.locator(`label[for="timbre-${g}-${f}"]`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${g}.${f}`).toBeGreaterThanOrEqual(11);
  }
  // bass.fuzz startet bei 0 (Ursprung links): der Bogen ist pink (rechts); bass.cutoff (Standard 0,5) hat den Ursprung in der Mitte: unter 50 türkis (links)
  const knobOf = (g, f) => page.locator('.knob', { has: slider(page, g, f) });
  await slider(page, 'bass', 'fuzz').fill('30');
  await expect(knobOf('bass', 'fuzz').locator('.knob-arc')).toHaveAttribute('data-side', 'right');
  await slider(page, 'bass', 'cutoff').fill('20');
  await expect(knobOf('bass', 'cutoff').locator('.knob-arc')).toHaveAttribute('data-side', 'left');
});

test('Startwerte der Knöpfe kommen aus den Schlagworten der Vorlage und dem leichten Klang-Drift der Variante', async ({ page }) => {
  const seed = Number(await page.locator('#variant').inputValue());
  const timbre = resolveTrackTimbre({ tags: funk.tags, seed, variety: true });
  for (const [g, f] of FIELDS) {
    await expect(slider(page, g, f), `${g}.${f}`).toHaveValue(percent(timbre[g][f]));
  }
});

test('Knopf während der Wiedergabe: wirkt live auf die Audioknoten, kein Neustart, ein AudioContext', async ({ page }) => {
  await playFast(page);
  expect(await contexts(page)).toBe(1);
  await page.evaluate(() => {
    window.__positions = [];
    const el = document.querySelector('#play-position');
    new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const before = await shownBar(page);
  await slider(page, 'master', 'reverb').fill('100');
  const expected = masterParams({ ...resolveTimbre(funk.tags).master, reverb: 1 }).reverbWet;
  await expect.poll(() => targets(page)).toContain(expected);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  const shown = (await page.evaluate(() => window.__positions));
  for (const text of shown) expect(text, 'Taktzeile nie leer (kein Neustart)').not.toBe('');
  expect(await contexts(page)).toBe(1);
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
});

test('Überschreibung gewinnt gegen Schlagwörter, Zurücksetzen holt den Schlagwortwert zurück', async ({ page }) => {
  const startFuzz = await slider(page, 'bass', 'fuzz').inputValue();
  await slider(page, 'bass', 'fuzz').fill('80');
  // 'gritty' schiebt bass.fuzz um +0,3; der Knopf bleibt auf 80
  await openTags(page);
  await page.locator('#tags [data-category="bass"][data-tag="gritty"]').click();
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  // ein nicht überschriebenes Feld folgt dem Schlagwort: 'sub' (bassSound) hebt bass.sub
  await openTags(page);
  await page.locator('#tags [data-category="bassSound"][data-tag="sub"]').click();
  const tags = await currentTags(page);
  await expect(slider(page, 'bass', 'sub')).toHaveValue(percent(resolveTimbre(tags).bass.sub));
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  await group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' }).click();
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(percent(resolveTimbre(tags).bass.fuzz));
  expect(percent(resolveTimbre(tags).bass.fuzz)).not.toBe(startFuzz); // gritty ist noch gewählt: der Wert ist ein anderer als am Anfang
});

test('Zurücksetzen ist nur aktiv, wenn das Modul Überschreibungen hat', async ({ page }) => {
  const reset = group(page, 'drums').getByRole('button', { name: 'Zurücksetzen' });
  await expect(reset).toBeDisabled();
  await slider(page, 'drums', 'room').fill('70');
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
});

test('Stilwahl (Werksprofil) leert die Überschreibungen', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').fill('80');
  const psych = STYLE_PRESETS.find((p) => p.id === 'psych');
  await chooseStyle(page, 'psych');
  expect(await currentStyle(page)).toBe('psych');
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(percent(resolveTimbre(psych.tags).bass.fuzz));
});

test('Knopf vor dem Start bewegen: kein AudioContext, der Start läuft ohne Fehler', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').fill('90');
  expect(await contexts(page)).toBe(0);
  await playFast(page);
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('90');
  await playGo(page).click();
});

test('Fuzz schnell von 0 bis 100 ziehen während der Wiedergabe: keine Fehler, ein AudioContext', async ({ page }) => {
  await playFast(page);
  for (let v = 0; v <= 100; v += 5) await slider(page, 'bass', 'fuzz').fill(String(v));
  for (let v = 100; v >= 0; v -= 5) await slider(page, 'bass', 'fuzz').fill(String(v));
  expect(await contexts(page)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
});

test('Rack mit allen Modulen (1366 × 768): scrollt in sich, letzter Knopf erreichbar, die Seite scrollt nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
  const rack = await page.locator('#rack').evaluate((el) => ({ down: el.scrollHeight > el.clientHeight, across: el.scrollWidth > el.clientWidth }));
  expect(rack).toEqual({ down: true, across: true });
  const last = slider(page, 'master', 'reverb');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.fill('40');
  await expect(last).toHaveValue('40');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('Klang-Schlagwort während der Wiedergabe erreicht die Audioknoten (Helligkeit), ohne neuen Instrumentensatz', async ({ page }) => {
  await playFast(page);
  const chip = page.locator('#tags [data-category="mood"][data-tag="bright"]');
  await openTags(page);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const expected = masterParams(resolveTimbre(await currentTags(page)).master).shelfDb;
  expect(expected).not.toBe(0);
  await expect.poll(() => targets(page)).toContain(expected);
  expect(await contexts(page)).toBe(1);
  await playGo(page).click();
});

test('Knöpfe sind auch bei 1200 px bedienbar: klein 28 px in den Modulen, mittel 44 px im Mixer', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  const small = await page.locator('.knob', { has: slider(page, 'bass', 'fuzz') }).boundingBox();
  expect([small.width, small.height]).toEqual([28, 28]);
  const medium = await page.locator('.knob', { has: slider(page, 'master', 'reverb') }).boundingBox();
  expect([medium.width, medium.height]).toEqual([44, 44]);
});

test('Pfeiltasten am Knopf: ±1 Punkt, wirkt wie ein Zug und schaltet Zurücksetzen frei', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(String(Number(percent(resolveTimbre(funk.tags).bass.fuzz)) + 2));
  await expect(slider(page, 'bass', 'fuzz')).toHaveAttribute('aria-valuetext', /^\d+\s?%$/);
  await expect(group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' })).toBeEnabled();
});

test('Zurücksetzen per Tastatur behält den Fokus im Modul (nicht auf body)', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').fill('80');
  const reset = group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' });
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(reset).toBeDisabled();
  // Chromium korrigiert den Fokus eines deaktivierten Knopfs erst beim nächsten Rendern
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
  expect(await page.evaluate(() => document.activeElement.closest('.instrument')?.dataset.layer)).toBe('bass');
});

test('Variantenwechsel verschiebt den Klang leicht (Knöpfe zeigen den hörbaren Wert), eigene Knöpfe bleiben', async ({ page }) => {
  const values = new Set();
  for (let i = 0; i < 12; i++) {
    values.add(await slider(page, 'master', 'echo').inputValue());
    await page.locator('#variant-next').click();
  }
  expect(values.size, `verschiedene Echo-Werte: ${[...values]}`).toBeGreaterThan(1);
  // nicht gedriftet: Felder außerhalb der Drift-Liste bleiben gleich
  const reverb = new Set();
  for (let i = 0; i < 6; i++) {
    reverb.add(await slider(page, 'master', 'reverb').inputValue());
    await page.locator('#variant-next').click();
  }
  expect(reverb.size).toBe(1);
  // ein eigener Knopf gewinnt über alle Varianten
  await slider(page, 'master', 'echo').fill('90');
  for (let i = 0; i < 6; i++) {
    await page.locator('#variant-next').click();
    await expect(slider(page, 'master', 'echo')).toHaveValue('90');
  }
});

test('Tab-Reihenfolge im Modul: Stimme, Aufgabe, Detailknöpfe in Lesereihenfolge, Zurücksetzen', async ({ page }) => {
  await slider(page, 'lead', 'fuzz').fill('50'); // sonst ist Zurücksetzen aus und nicht erreichbar
  await page.locator('#voice-lead').focus();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const at = await page.evaluate(() => {
      const el = document.activeElement;
      return { inModule: !!el.closest('.instrument[data-layer="lead"]'), key: el.id || el.className };
    });
    if (!at.inModule) break;
    if (!/lcd-btn/.test(at.key)) seen.push(at.key); // die Tasten ‹ › am Display sind Teil von Stimme und Aufgabe
    await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(['voice-lead', 'job-lead', ...Object.keys(DEFAULT_TIMBRE.lead).map((f) => `timbre-lead-${f}`), 'chip timbre-reset']);
});

test('Aktivitäts-LED: bei laufender Wiedergabe leuchtet das Schlagzeug-Modul samt Spur, das stumme Percussion-Modul nicht', async ({ page }) => {
  const led = (layer) => page.locator(`.instrument[data-layer="${layer}"] .led`);
  const lane = (layer) => page.locator(`#lane-buttons [data-layer="${layer}"]`);
  await expect(led('drums')).not.toHaveClass(/\bon\b/); // Stand: aus
  await page.locator('#form-template').selectOption('off'); // ohne Form: die Songform lässt das Schlagzeug im Intro schweigen
  await playFast(page);
  await expect(led('drums')).toHaveClass(/\bon\b/, { timeout: BAR_TIMEOUT }); // spielt es in diesem Takt, leuchtet es
  await expect(lane('drums')).toHaveClass(/\bon\b/);
  await expect(led('percussion')).not.toHaveClass(/\bon\b/);
  await expect(lane('percussion')).not.toHaveClass(/\bon\b/);
  await page.locator('#mixer button[data-mute="drums"]').click(); // stumm: die LED geht aus, ohne Neustart
  await expect(led('drums')).not.toHaveClass(/\bon\b/);
  await playGo(page).click();
  await expect(led('bass')).not.toHaveClass(/\bon\b/);
});
