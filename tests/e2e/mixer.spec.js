// Mischpult und Variantenwechsel auf der Spielseite (echte Seite /ui/index.html, Echtzeit).
import { test, expect } from '@playwright/test';
import { progressionFor } from '../../src/core/progressions.js';
import { openSetup } from './style-helpers.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const AM = { root: 'A', mode: 'minor' };
const LAYERS = ['drums', 'bass', 'chords', 'pad'];

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  // zählt AudioContexts und zeichnet auf, wie die Pegel ans Audiosystem gehen: Zielwerte von setTargetAtTime (Live-Rampe)
  // und direkt gesetzte Parameterwerte (Anfangspegel beim Start)
  await page.addInitScript(() => {
    window.__audioContexts = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args);
        window.__audioContexts++;
      }
    };
    window.__valueWrites = {};
    const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...valueDesc,
      set(v) {
        if (this.id.startsWith('mix-')) window.__valueWrites[this.id] = (window.__valueWrites[this.id] ?? 0) + 1;
        valueDesc.set.call(this, v);
      },
    });
    window.__targets = [];
    window.__assigned = [];
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function (value, ...rest) {
      window.__targets.push(value);
      return target.call(this, value, ...rest);
    };
    const desc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
    Object.defineProperty(AudioParam.prototype, 'value', {
      ...desc,
      set(v) {
        window.__assigned.push(v);
        desc.set.call(this, v);
      },
    });
  });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const playGo = (page) => page.locator('#play-go');
const position = (page) => page.locator('#play-position');
const pop = (page) => page.locator('#mod-mixer');
// Mixer im Rack zeigen: Zustand Einstellen (falls im Fokus) und ins Bild scrollen
async function showMixer(page) {
  await pop(page).scrollIntoViewIfNeeded();
  await expect(pop(page)).toBeVisible();
}
const slider = (page, name) => page.locator(`#mix-${name}`);
const mixMute = (page, name) => page.locator(`#mixer button[data-mute="${name}"]`);
const outputs = (page) => page.locator('#mixer .mix-ch output');
const laneBtn = (page, name) => page.locator(`#lane-buttons [data-layer="${name}"]`);
const contexts = (page) => page.evaluate(() => window.__audioContexts);
const targets = (page) => page.evaluate(() => window.__targets);
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const shownVariant = async (page) => Number((await page.locator('#play-variant').textContent()).match(/\d+/)[0]);
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const expectedChords = (seed) => progressionFor(AM, seed).map((c) => c.root + SYMBOLS[c.quality]);

const openPlayPage = openSetup; // Rack und Mixer sind im Zustand Einstellen sichtbar

// Wiedergabe bei 200 bpm (1,2 s je Takt)
async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von \d+$/, { timeout: BAR_TIMEOUT });
}

const recordPositions = (page) => page.evaluate(() => {
  window.__positions = [];
  const el = document.querySelector('#play-position');
  new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
});
const positionsSince = (page) => page.evaluate(() => window.__positions.splice(0));

// Die Taktzeile springt nie zurück und läuft weiter
async function expectKeepsCounting(page, before, label) {
  await expect.poll(() => shownBar(page), { message: label, timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  const shown = (await positionsSince(page)).filter(Boolean).map((text) => Number(text.match(/^Takt (\d+) von/)[1]));
  expect(shown.length, label).toBeGreaterThan(0);
  for (const bar of shown) expect(bar, `${label}: ${shown}`).toBeGreaterThanOrEqual(before);
}

test('Modul Mixer im Rack: 7 Fader, 6 Tasten, Schalter Alle Samples, Namen deutsch und englisch, per Tastatur bedienbar', async ({ page }) => {
  await openPlayPage(page);
  await expect(page.getByRole('region', { name: 'Mixer' })).toBeVisible();
  await expect(page.locator('#mixer-btn')).toHaveCount(0); // kein Popover mehr
  await showMixer(page);
  // die Kanäle (Gesamt und 6 Schichten) im Mischpult; die Gesamt-Klangknöpfe daneben gehören zum Modul, aber nicht zu den Kanälen
  await expect(page.locator('#mixer input.fader')).toHaveCount(7);
  await expect(page.locator('#mixer button[data-mute]')).toHaveCount(6);
  await expect(page.locator('#all-voices')).not.toHaveAttribute('role', /./); // Taste mit aria-pressed, kein Schalter (mixed ist bei role=switch ungültig)
  await expect(page.locator('#all-voices')).toContainText('Alle Samples'); // sichtbare Beschriftung
  for (const [name, label] of [['master', 'Gesamt'], ['drums', 'Schlagzeug'], ['bass', 'Bass'], ['chords', 'Akkorde'], ['pad', 'Pad'], ['lead', 'Lead'], ['percussion', 'Percussion']]) {
    await expect(pop(page).getByRole('slider', { name: label, exact: true })).toHaveValue('100');
    await expect(slider(page, name)).toHaveAttribute('min', '0');
    await expect(slider(page, name)).toHaveAttribute('max', '100');
  }
  await expect(pop(page).getByRole('button', { name: 'Bass stumm', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(outputs(page)).toHaveText(Array(7).fill('100 %'));

  // Pfeiltasten ändern den Wert
  await slider(page, 'master').focus();
  await page.keyboard.press('ArrowDown');
  await expect(slider(page, 'master')).toHaveValue('99');
  await expect(outputs(page).last()).toHaveText('99 %');

  await page.getByRole('button', { name: /^EN/i }).click();
  await expect(page.locator('#mod-mixer-title')).toHaveText('Mixer');
  for (const [label, value] of [['Overall', '99'], ['Drums', '100'], ['Bass', '100'], ['Chords', '100'], ['Pad', '100']]) {
    await expect(pop(page).getByRole('slider', { name: label, exact: true })).toHaveValue(value);
  }
  await expect(pop(page).getByRole('button', { name: 'Drums muted', exact: true })).toBeVisible();
  await expect(outputs(page).last()).toHaveText('99%');
  const texts = await page.locator('#mixer, #variant-prev, #variant-next, #variant-random').evaluateAll((els) => els.flatMap((el) => [el.textContent, el.getAttribute('aria-label')]).filter(Boolean));
  for (const text of texts) expect(text).not.toMatch(RAW_KEY);
});

test('Regler während der Wiedergabe: setLevel/setMaster wirken live, kein Neustart, ein AudioContext', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von/, { timeout: BAR_TIMEOUT });
  expect(await contexts(page)).toBe(1);
  await recordPositions(page);
  const before = await shownBar(page);
  await showMixer(page);
  await page.evaluate(() => { window.__targets.length = 0; });
  await slider(page, 'bass').fill('50');
  await expect.poll(() => targets(page)).toContain(0.25); // Reglerstellung 0.5 -> Verstärkung 0.25
  await slider(page, 'master').fill('30');
  await expect.poll(() => targets(page)).toContain(0.3 * 0.3);
  await slider(page, 'drums').fill('0');
  await expect.poll(() => targets(page)).toContain(0);
  await expect(outputs(page).nth(1)).toHaveText('50 %');
  await expectKeepsCounting(page, before, 'Regler');
  expect(await contexts(page)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
});

test('Stummtaste im Mischpult und Spurname zeigen immer denselben Zustand; stumm schaltet nur das Mischpult', async ({ page }) => {
  await openPlayPage(page);
  await playFast(page);
  const same = async (name, expected) => {
    await expect(laneBtn(page, name), `Spurname ${name}`).toHaveAttribute('data-muted', String(!expected));
    await expect(mixMute(page, name), `Taste ${name}`).toHaveAttribute('aria-pressed', String(!expected)); // Stummtaste: gedrückt = stumm
  };
  for (const name of LAYERS) await same(name, true);
  await showMixer(page);
  await mixMute(page, 'bass').click();
  await same('bass', false);
  await same('chords', true);
  await mixMute(page, 'bass').click();
  await same('bass', true);
  await mixMute(page, 'pad').click();
  await same('pad', false);
  await laneBtn(page, 'pad').click({ force: true }); // der Spurname ist nur Anzeige: Klick ohne Wirkung
  await same('pad', false);
  await mixMute(page, 'pad').click();
  await same('pad', true);
  // Stummschalten ändert die Reglerstellung nicht und startet nicht neu
  await expect(slider(page, 'pad')).toHaveValue('100');
  expect(await contexts(page)).toBe(1);
});

test('Mix überlebt das Neuladen, Stummschaltungen nicht; kaputter Speicher wird ignoriert; Anfangspegel gehen mit dem Start', async ({ page }) => {
  await openPlayPage(page);
  await showMixer(page);
  await slider(page, 'bass').fill('40');
  await slider(page, 'master').fill('70');
  await mixMute(page, 'chords').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.mix')))).toEqual({ drums: 1, bass: 0.4, chords: 1, pad: 1, lead: 1, percussion: 1, master: 0.7 });
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openPlayPage(page);
  await showMixer(page);
  await expect(slider(page, 'bass')).toHaveValue('40');
  await expect(slider(page, 'master')).toHaveValue('70');
  await expect(slider(page, 'drums')).toHaveValue('100');
  await expect(mixMute(page, 'chords')).toHaveAttribute('aria-pressed', 'false');
  // Start: die gespeicherten Pegel werden gleich beim Bau der Instrumente gesetzt (nicht erst per Rampe danach)
  await page.evaluate(() => { window.__assigned.length = 0; window.__targets.length = 0; });
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  const assigned = await page.evaluate(() => window.__assigned);
  expect(assigned).toContain(0.4 * 0.4);
  expect(assigned).toContain(0.7 * 0.7);
  expect(await targets(page)).not.toContain(0.4 * 0.4);
  await playGo(page).click();

  for (const garbage of ['{kaputt', '[1,2]', '{"bass":5,"drums":"laut","pad":-1,"master":null}']) {
    await page.evaluate((g) => localStorage.setItem('backingtrack.mix', g), garbage);
    await page.reload();
    await expect(page.locator('#go')).toHaveText(/\S/);
    await openPlayPage(page);
    await showMixer(page);
    for (const name of ['master', ...LAYERS]) await expect(slider(page, name), `${garbage} ${name}`).toHaveValue('100');
  }
});

test('Variantenknöpfe: vor, zurück, neu, Umbruch 9999 und 1, Fokus bleibt, nichts anderes ändert sich', async ({ page }) => {
  const field = page.locator('#variant');
  await field.fill('9999');
  await field.press('Enter');
  await openPlayPage(page);
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
  for (const id of ['variant-prev', 'variant-next', 'variant-random']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nächste Variante', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vorherige Variante', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zufällige Variante', exact: true })).toBeVisible();

  const focusId = () => page.evaluate(() => document.activeElement.id);
  await page.locator('#variant-next').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  expect(await focusId()).toBe('variant-next');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(1).join(' – '));
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
  expect(await focusId()).toBe('variant-prev');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(9999).join(' – '));
  await page.keyboard.press('Enter'); // per Tastatur ebenso
  await expect(page.locator('#play-variant')).toHaveText('Variante 9998');
  await page.locator('#variant-prev').click();
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9996');
  let rolled = 9996;
  for (let i = 0; i < 3 && rolled === 9996; i++) {
    await page.locator('#variant-random').click();
    await expect(page.locator('#play-variant')).toHaveText(/^Variante \d+$/);
    rolled = await shownVariant(page);
  }
  expect(rolled).not.toBe(9996);
  expect(rolled).toBeGreaterThanOrEqual(1);
  expect(rolled).toBeLessThanOrEqual(9999);
  expect(await focusId()).toBe('variant-random');
  expect(await page.locator('#chords').textContent()).toBe(expectedChords(rolled).join(' – '));
  // Wrap von 1 nach 9999 mit dem Zurück-Knopf
  await field.evaluate((el, n) => { el.value = n; el.dispatchEvent(new Event('change')); }, '1');
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
});

test('Variante während der Wiedergabe: Neustart im laufenden Takt, Tags, Tempo, Mix und Stummschaltungen bleiben, ein AudioContext', async ({ page }) => {
  test.setTimeout(60_000);
  await openPlayPage(page);
  await showMixer(page);
  await slider(page, 'bass').fill('60');
  await mixMute(page, 'pad').click();
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von/, { timeout: BAR_TIMEOUT });
  const tagsOf = () => page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());
  const tags = await tagsOf();
  const settings = () => page.evaluate(() => ({
    tempo: document.getElementById('tuning-tempo').value,
    length: document.getElementById('length').value,
    mix: localStorage.getItem('backingtrack.mix'),
    pad: document.querySelector('#lane-buttons [data-layer="pad"]').getAttribute('data-muted'),
  }));
  const settingsBefore = await settings();
  expect(settingsBefore.pad).toBe('true');
  await recordPositions(page);
  for (const id of ['variant-next', 'variant-prev', 'variant-random', 'variant-next']) {
    const before = await shownBar(page);
    const seed = await shownVariant(page);
    await positionsSince(page);
    await page.locator(`#${id}`).click();
    if (id === 'variant-random') await expect.poll(() => shownVariant(page)).not.toBe(seed);
    else await expect(page.locator('#play-variant')).toHaveText(`Variante ${id === 'variant-next' ? (seed % 9999) + 1 : ((seed + 9997) % 9999) + 1}`);
    await expectKeepsCounting(page, before, id);
    expect(await tagsOf(), id).toEqual(tags);
    expect(await settings(), id).toEqual(settingsBefore);
    expect(await contexts(page), id).toBe(1);
    await expect(playGo(page), id).toHaveText('Stopp');
    expect(await page.evaluate(() => document.activeElement.id), id).toBe(id);
  }
  await expect(page.locator('#chords')).toHaveText(expectedChords(await shownVariant(page)).join(' – '));
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
});

test('390 px: Fader und Stummtasten im Rack bleiben groß genug zum Bedienen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#go').click();
  await expect(page.locator('#play')).toBeVisible();
  await playGo(page).click();
  expect(await noScrollX(page)).toBe(true);
  await page.locator('#mode-switch').click();
  await expect(page.locator('#rack')).toBeVisible();
  await showMixer(page);
  for (const name of ['master', ...LAYERS]) {
    await slider(page, name).scrollIntoViewIfNeeded();
    const s = await slider(page, name).boundingBox();
    expect(s.height, name).toBeGreaterThanOrEqual(100);
    expect(s.width, name).toBeGreaterThanOrEqual(24);
  }
  for (const name of LAYERS) {
    await mixMute(page, name).scrollIntoViewIfNeeded();
    const b = await mixMute(page, name).boundingBox();
    expect(b.width, name).toBeGreaterThanOrEqual(44);
    expect(b.height, name).toBeGreaterThanOrEqual(44);
  }
  for (const id of ['variant-prev', 'variant-next', 'variant-random', 'mode-switch']) {
    const b = await page.locator(`#${id}`).boundingBox();
    expect(b.x, id).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, id).toBeLessThanOrEqual(390);
    expect(b.width, id).toBeGreaterThanOrEqual(44);
    expect(b.height, id).toBeGreaterThanOrEqual(44);
  }
});

// Schalter "Alle Samples" (Task 4)
const allVoices = (page) => page.locator('#all-voices');

test('Alle Samples: schaltet jede Schicht auf Sample und zurück; ein Instrument zurück auf Synth ergibt gemischt', async ({ page }) => {
  await openPlayPage(page);
  await showMixer(page);
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(allVoices(page)).toContainText('SYN');
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(allVoices(page)).toContainText('SMP');
  for (const layer of ['drums', 'bass', 'chords', 'pad']) await expect(page.locator(`#voice-${layer}`)).toHaveValue(/^sample\//);
  // ein Instrument zurück auf Synth
  await page.locator('#voice-bass').selectOption('synth/classic');
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'mixed');
  await expect(allVoices(page)).toContainText('Gemischt');
  // bei gemischt schaltet der Klick auf Samples
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voice-bass')).toHaveValue('sample/finger');
  // und wieder alles auf Synth
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'false');
  for (const layer of ['drums', 'bass', 'chords', 'pad']) await expect(page.locator(`#voice-${layer}`)).toHaveValue('synth/classic');
});

test('Alle Samples, Pack lädt nicht: Fehler im Display des Instruments, die übrigen werden bereit, Seite bleibt bedienbar', async ({ page }) => {
  await page.route('**/assets/samples/bass-finger.*', (route) => route.fulfill({ status: 500, body: 'kaputt' }));
  await openPlayPage(page);
  await showMixer(page);
  await allVoices(page).click();
  await expect(page.locator('#voice-status-bass')).toHaveText('nicht verfügbar', { timeout: BAR_TIMEOUT });
  for (const layer of ['drums', 'chords', 'pad']) await expect(page.locator(`#voice-status-${layer}`)).toHaveText('bereit', { timeout: 30_000 });
  // Schalter bleibt bei Samples (die Wahl steht, nur das Pack fehlt) und ist bedienbar
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true');
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#voice-status-bass')).toHaveText('');
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  await playGo(page).click();
  // der 500er der Pack-Datei erscheint als Konsolenmeldung des Browsers: erwartet, aber nur dieser
  expect(problems.length).toBeGreaterThan(0);
  problems = problems.filter((p) => !/^console: Failed to load resource: .*status of 500/.test(p));
});

test('Fader springt während der Wiedergabe nicht: kein Schreiben ins Eingabefeld, weder nach Tastatur noch beim Ziehen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 }); // Maßstab des Racks; bei 1280 x 720 ist es für die Maus zu niedrig
  await openPlayPage(page);
  await playFast(page);
  await showMixer(page);
  const writes = () => page.evaluate(() => window.__valueWrites['mix-drums'] ?? 0);
  // per Tastatur auf 40: 6 x Bild-ab (je 10)
  await slider(page, 'drums').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('PageDown');
  await expect(slider(page, 'drums')).toHaveValue('40');
  await expect(outputs(page).first()).toHaveText('40 %');
  await page.evaluate(() => { window.__valueWrites = {}; });
  const before = await shownBar(page);
  // zwei Takte bei 200 bpm: render() läuft je Takt
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT * 2 }).toBeGreaterThanOrEqual(before + 2);
  await expect(slider(page, 'drums')).toHaveValue('40');
  expect(await writes(), 'Fader wird nur bei Änderung geschrieben').toBe(0);
  // ziehen: Maus halten, während Takte vergehen
  await slider(page, 'drums').scrollIntoViewIfNeeded(); // Maus braucht den Fader im Bild
  const box = await slider(page, 'drums').boundingBox();
  const thumbY = box.y + 6 + (1 - 0.4) * (box.height - 12); // Kappe bei Wert 40 (oben = 100)
  await page.mouse.move(box.x + box.width / 2, thumbY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.25, { steps: 5 });
  const held = Number(await slider(page, 'drums').inputValue());
  expect(held).toBeGreaterThan(55);
  await page.evaluate(() => { window.__valueWrites = {}; });
  const bar = await shownBar(page);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT * 2 }).toBeGreaterThanOrEqual(bar + 2);
  expect(Number(await slider(page, 'drums').inputValue())).toBe(held);
  expect(await writes(), 'gezogener Fader wird nicht neu gesetzt').toBe(0);
  await page.mouse.up();
  await expect(playGo(page)).toHaveText('Stopp');
});
