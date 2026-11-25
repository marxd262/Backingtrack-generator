// Klangknöpfe der Spielseite (echte Seite der App): ein Knopf je Klangfeld in den Instrument-Modulen (Gesamt im Mixer), live ohne Neustart.
// Portiert aus tests/e2e/timbre.spec.js: die App lädt ihre Seite; die Knöpfe je Gruppe (DEFAULT_TIMBRE) und die Schichten aus tables() der
// Sitzung; was der Test mit resolveTimbre und resolveTrackTimbre aus src/core rechnete, steht als Werte da (für die Schlagworte der Stile und für
// eine feste Variante); gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts zählt count-helpers.js. Die Web-App
// sah an den Zielen der Audioknoten (setTargetAtTime), dass ein Regler live ankommt; die App hat kein Web Audio: hier zählt, was die Seite der
// Sitzung schickt, was die Sitzung daraus macht und dass ihre Antwort den Merker sound trägt (auf ihn gibt die Hülle der Engine den Klang;
// was die Engine damit tut, sieht der Test nicht); die Zahlen der Audioknoten aus dem Klang
// (masterParams) hält btg_logic_tests gegen die Web-App.
import { test, expect, answered, fromSession, settled } from './fixture.js';
import { chooseStyle, currentStyle, openSetup, openTags } from './style-helpers.js';
import { contexts, countContexts, lastSent, record } from './count-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre)\.[A-Za-z.]+$/;
const BAR_TIMEOUT = 10_000;

// resolveTrackTimbre({ tags: Funk, seed: 1234, variety: true }) der Web-App (src/core/timbre.js 63) in Prozent, je Feld: die Startwerte der Knöpfe
// für Funk-Rock auf der Variante 1234 (gedriftet: drums.snareTone, drums.hatBright, bass.cutoff, chords.brightness, pad.lfoSpeed, master.echo)
// shortcut: one fixed variant instead of the one the run starts on (the web test met a new seed each run), upgrade: when btg_session (core.js)
// also gives derived() or sound(), compute the values for the run's own variant there.
const SEED = 1234;
const FUNK_1234 = {
  'drums.kickPunch': 85, 'drums.kickLength': 35, 'drums.snareTone': 73, 'drums.snareSnap': 100, 'drums.hatBright': 43, 'drums.hatLength': 50, 'drums.room': 0,
  'bass.sub': 0, 'bass.fuzz': 0, 'bass.overdrive': 0, 'bass.distortion': 0, 'bass.pluck': 90, 'bass.cutoff': 55, 'bass.resonance': 50, 'bass.roundness': 0, 'bass.vibrato': 0, 'bass.chorus': 0,
  'chords.brightness': 74, 'chords.length': 30, 'chords.vibrato': 0, 'chords.chorus': 0, 'chords.tremolo': 0, 'chords.fuzz': 0, 'chords.overdrive': 0, 'chords.distortion': 0,
  'pad.attack': 50, 'pad.cutoff': 50, 'pad.lfoSpeed': 52, 'pad.lfoDepth': 50, 'pad.shimmer': 0, 'pad.thickness': 50, 'pad.fuzz': 0, 'pad.overdrive': 0, 'pad.distortion': 0, 'pad.vibrato': 0, 'pad.chorus': 0,
  'lead.fuzz': 0, 'lead.overdrive': 0, 'lead.distortion': 0, 'lead.vibrato': 0, 'lead.chorus': 0,
  'master.brightness': 50, 'master.echo': 49, 'master.reverb': 50, 'master.width': 50, 'master.roomSize': 50, 'master.roomWet': 50,
};
// resolveTimbre der Web-App (src/core/timbre.js 40) in Prozent: Funk (bass.fuzz 0), Funk mit bass "gritty" und bassSound "sub" (bass.sub 60,
// bass.fuzz 30), Psych (bass.fuzz 60); Funk mit mood "bright": master.brightness 0,85 (masterParams gibt daraus shelfDb 6,3, nicht 0)
const FUNK_FUZZ = 0;
const GRITTY_SUB = { sub: 60, fuzz: 30 };
const PSYCH_FUZZ = 60;
const BRIGHT_MASTER = 0.85;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
  await openSetup(page);
});

const fields = async (page) => Object.entries((await fromSession(page, 'tables')).DEFAULT_TIMBRE).flatMap(([group, fs]) => Object.keys(fs).map((field) => [group, field]));
// Knöpfe der Schichten liegen im Instrument-Modul, die Gesamt-Knöpfe (master) im Mixer
const group = (page, id) => (id === 'master' ? page.locator('#mixer-master') : page.locator(`.instrument[data-layer="${id}"]`));
const slider = (page, g, f) => page.locator(`#timbre-${g}-${f}`);
const position = (page) => page.locator('#play-position');
const playGo = (page) => page.locator('#play-go');
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const value = async (page, g, f) => { await answered(page); return slider(page, g, f).inputValue(); };

async function playFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Stopp');
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
}

test('47 Knöpfe in 5 Modulen und im Mixer, alle beschriftet ohne rohen Schlüsselnamen; ein Modul je Schicht in Reihenfolge', async ({ page }) => {
  const { DEFAULT_TIMBRE, LAYER_IDS } = await fromSession(page, 'tables');
  const FIELDS = await fields(page);
  expect(FIELDS).toHaveLength(47);
  expect(await page.locator('.instrument').evaluateAll((els) => els.map((e) => e.dataset.layer))).toEqual(LAYER_IDS);
  for (const [g, fs] of Object.entries(DEFAULT_TIMBRE)) {
    await expect(group(page, g), g).toHaveCount(1);
    // gezählt werden die Klangfelder (timbre-…); das Akkord-Modul hat dazu die zwei Orgel-Knöpfe (voices-ui.spec.js)
    await expect(group(page, g).locator('input[type="range"][id^="timbre-"]'), g).toHaveCount(Object.keys(fs).length);
    await expect(group(page, g).locator('.knob:has([id^="timbre-"])'), g).toHaveCount(Object.keys(fs).length);
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
  for (const [g, f] of await fields(page)) {
    const size = await page.locator(`label[for="timbre-${g}-${f}"]`).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${g}.${f}`).toBeGreaterThanOrEqual(11);
  }
  // bass.fuzz startet bei 0 (Ursprung links): der Bogen ist pink (rechts); bass.cutoff (Standard 0,5) hat den Ursprung in der Mitte: unter 50 türkis (links)
  const knobOf = (g, f) => page.locator('.knob', { has: slider(page, g, f) });
  await slider(page, 'bass', 'fuzz').fill('30');
  await answered(page); // der Bogen zeigt die Hand bis zur Antwort
  await expect(knobOf('bass', 'fuzz').locator('.knob-arc')).toHaveAttribute('data-side', 'right');
  await slider(page, 'bass', 'cutoff').fill('20');
  await answered(page);
  await expect(knobOf('bass', 'cutoff').locator('.knob-arc')).toHaveAttribute('data-side', 'left');
});

test('Startwerte der Knöpfe kommen aus den Schlagworten der Vorlage und dem leichten Klang-Drift der Variante', async ({ page }) => {
  // eine feste Variante über das Eingabefeld der Startseite, wie Eingabe und Enter (die Hülle würfelt die des Starts; die Werte stehen für diese da)
  await page.evaluate((seed) => {
    const input = document.getElementById('variant');
    input.value = String(seed);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, SEED);
  await answered(page);
  const seed = Number(await page.locator('#variant').inputValue());
  expect(seed).toBe(SEED);
  for (const [g, f] of await fields(page)) {
    await expect(slider(page, g, f), `${g}.${f}`).toHaveValue(String(FUNK_1234[`${g}.${f}`]));
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
  await record(page);
  const before = await shownBar(page);
  await slider(page, 'master', 'reverb').fill('100');
  // live: die Seite schickt den Wert, die Sitzung hält ihn, und ihre Antwort trägt den Merker sound (auf ihn gibt die Hülle der Engine den Klang)
  await expect.poll(() => lastSent(page, 'setTimbre')).toEqual({ seq: expect.any(Number), action: 'setTimbre', group: 'master', field: 'reverb', value: 100, sound: true });
  expect((await fromSession(page, 'state')).track.timbre.master.reverb).toBe(1);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  await settled(page); // die Engine hat getan, was die Änderung auslöst (ein Neustart käme nach der Antwort): die Taktzeile zeigt es bis hier
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
  await answered(page); // der Knopf stünde auch vor der Antwort auf 80
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  // ein nicht überschriebenes Feld folgt dem Schlagwort: 'sub' (bassSound) hebt bass.sub
  await openTags(page);
  await page.locator('#tags [data-category="bassSound"][data-tag="sub"]').click();
  await answered(page);
  await expect(slider(page, 'bass', 'sub')).toHaveValue(String(GRITTY_SUB.sub));
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue('80');
  await group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' }).click();
  await answered(page);
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(String(GRITTY_SUB.fuzz));
  expect(String(GRITTY_SUB.fuzz)).not.toBe(startFuzz); // gritty ist noch gewählt: der Wert ist ein anderer als am Anfang
});

test('Zurücksetzen ist nur aktiv, wenn das Modul Überschreibungen hat', async ({ page }) => {
  const reset = group(page, 'drums').getByRole('button', { name: 'Zurücksetzen' });
  await expect(reset).toBeDisabled();
  await slider(page, 'drums', 'room').fill('70');
  await answered(page);
  await expect(reset).toBeEnabled();
  await reset.click();
  await answered(page);
  await expect(reset).toBeDisabled();
});

test('Stilwahl (Werksprofil) leert die Überschreibungen', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').fill('80');
  await chooseStyle(page, 'psych');
  expect(await currentStyle(page)).toBe('psych');
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(String(PSYCH_FUZZ));
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

test('Rack mit allen Modulen (1366 × 768): scrollt nur senkrecht in sich, letzter Knopf erreichbar, die Seite scrollt nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
  const rack = await page.locator('#rack').evaluate((el) => ({ down: el.scrollHeight > el.clientHeight, across: el.scrollWidth > el.clientWidth }));
  expect(rack).toEqual({ down: true, across: false });
  const last = slider(page, 'master', 'reverb');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await last.fill('40');
  await answered(page); // der Knopf zeigt die Hand bis zur Antwort
  await expect(last).toHaveValue('40');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('Klang-Schlagwort während der Wiedergabe erreicht die Audioknoten (Helligkeit), ohne neuen Instrumentensatz', async ({ page }) => {
  await playFast(page);
  const chip = page.locator('#tags [data-category="mood"][data-tag="bright"]');
  await openTags(page);
  await record(page);
  await chip.click();
  await settled(page); // die Antwort und was die Engine mit ihr tut
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // die Helligkeit der Summe im Klang der Sitzung (derived().timbre ist sound(), PROTOKOLL.md Abschnitt 4): die des Schlagworts, nicht der Standard
  const expected = (await fromSession(page, 'derived')).timbre.master.brightness;
  expect(expected).not.toBe(0.5);
  expect(expected).toBe(BRIGHT_MASTER);
  expect(await lastSent(page, 'toggleTag')).toEqual({ seq: expect.any(Number), action: 'toggleTag', category: 'mood', tag: 'bright', sound: true });
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
  await answered(page); // der Knopf zeigt die Hand bis zur Antwort
  await expect(slider(page, 'bass', 'fuzz')).toHaveValue(String(FUNK_FUZZ + 2));
  await expect(slider(page, 'bass', 'fuzz')).toHaveAttribute('aria-valuetext', /^\d+\s?%$/);
  await expect(group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' })).toBeEnabled();
});

test('Zurücksetzen per Tastatur behält den Fokus im Modul (nicht auf body)', async ({ page }) => {
  await slider(page, 'bass', 'fuzz').fill('80');
  await answered(page);
  const reset = group(page, 'bass').getByRole('button', { name: 'Zurücksetzen' });
  await expect(reset).toBeEnabled();
  await reset.focus();
  await page.keyboard.press('Enter');
  await answered(page);
  await expect(reset).toBeDisabled();
  // Chromium korrigiert den Fokus eines deaktivierten Knopfs erst beim nächsten Rendern
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
  expect(await page.evaluate(() => document.activeElement.closest('.instrument')?.dataset.layer)).toBe('bass');
});

test('Variantenwechsel verschiebt den Klang leicht (Knöpfe zeigen den hörbaren Wert), eigene Knöpfe bleiben', async ({ page }) => {
  const values = new Set();
  for (let i = 0; i < 12; i++) {
    values.add(await value(page, 'master', 'echo'));
    await page.locator('#variant-next').click();
  }
  expect(values.size, `verschiedene Echo-Werte: ${[...values]}`).toBeGreaterThan(1);
  // nicht gedriftet: Felder außerhalb der Drift-Liste bleiben gleich
  const reverb = new Set();
  for (let i = 0; i < 6; i++) {
    reverb.add(await value(page, 'master', 'reverb'));
    await page.locator('#variant-next').click();
  }
  expect(reverb.size).toBe(1);
  // ein eigener Knopf gewinnt über alle Varianten
  await slider(page, 'master', 'echo').fill('90');
  for (let i = 0; i < 6; i++) {
    await page.locator('#variant-next').click();
    await answered(page); // der Knopf stünde auch vor der Antwort auf 90
    await expect(slider(page, 'master', 'echo')).toHaveValue('90');
  }
});

test('Tab-Reihenfolge im Modul: Stimme, Aufgabe, Detailknöpfe in Lesereihenfolge, Zurücksetzen', async ({ page }) => {
  const { DEFAULT_TIMBRE } = await fromSession(page, 'tables');
  await slider(page, 'lead', 'fuzz').fill('50'); // sonst ist Zurücksetzen aus und nicht erreichbar
  await answered(page);
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
  expect(seen).toEqual(['voice-lead', 'job-lead', ...Object.keys(DEFAULT_TIMBRE.lead).map((f) => `timbre-lead-${f}`), 'push timbre-reset']);
});

test('Aktivitäts-LED: bei laufender Wiedergabe leuchtet das Schlagzeug-Modul samt Spur, das stumme Percussion-Modul nicht', async ({ page }) => {
  const led = (layer) => page.locator(`.instrument[data-layer="${layer}"] .led`);
  const lane = (layer) => page.locator(`#lane-buttons [data-layer="${layer}"]`);
  await expect(led('drums')).not.toHaveClass(/\bon\b/); // Stand: aus
  await page.locator('#form-template').selectOption('off'); // ohne Form: die Songform lässt das Schlagzeug im Intro schweigen
  await answered(page);
  await playFast(page);
  await expect(led('drums')).toHaveClass(/\bon\b/, { timeout: BAR_TIMEOUT }); // spielt es in diesem Takt, leuchtet es
  await expect(lane('drums')).toHaveClass(/\bon\b/);
  await expect(led('percussion')).not.toHaveClass(/\bon\b/);
  await expect(lane('percussion')).not.toHaveClass(/\bon\b/);
  await page.locator('#mixer button[data-mute="drums"]').click(); // stumm: die LED geht aus, ohne Neustart
  await settled(page); // die Antwort und was die Engine mit ihr tut
  await expect(led('drums')).not.toHaveClass(/\bon\b/);
  await playGo(page).click();
  await settled(page); // der Stopp ist getan
  await expect(led('bass')).not.toHaveClass(/\bon\b/);
});

test('Knopfraster und Anzeige: Verzerrer, Vibrato, Chorus und Zurücksetzen in jedem Instrument am selben Platz; beim Überfahren steht der Wert oder "ohne Wirkung" über dem Knopf', async ({ page }) => {
  // Mittelpunkt eines Knopfs relativ zu seinem Modul (auf 2 px gerundet)
  const spot = (layer, id) => page.locator(`.instrument[data-layer="${layer}"]`).evaluate((mod, sel) => {
    const [m, k] = [mod.getBoundingClientRect(), mod.querySelector(sel).getBoundingClientRect()];
    return [Math.round((k.x + k.width / 2 - m.x) / 2), Math.round((k.y + k.height / 2 - m.y) / 2)];
  }, id);
  for (const field of ['fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']) {
    const places = await Promise.all(['bass', 'chords', 'pad', 'lead'].map((layer) => spot(layer, `.knob:has(#timbre-${layer}-${field})`)));
    expect(new Set(places.map(String)).size, field).toBe(1);
  }
  // Zurücksetzen: in jedem Modul mit Knöpfen am selben Platz, rechts unten (rechte Spalte, unterste Knopfzeile)
  const resets = await Promise.all(['drums', 'bass', 'chords', 'pad', 'lead'].map((layer) => spot(layer, '.timbre-reset')));
  expect(new Set(resets.map(String)).size).toBe(1);
  const [chorus, distortion] = await Promise.all([spot('bass', '.knob:has(#timbre-bass-chorus)'), spot('bass', '.knob:has(#timbre-bass-distortion)')]);
  expect(Math.abs(resets[0][1] - chorus[1])).toBeLessThanOrEqual(1); // gleiche Zeile wie Chorus
  expect(Math.abs(resets[0][0] - distortion[0])).toBeLessThanOrEqual(1); // gleiche Spalte wie Distortion
  // Tab-Reihenfolge = Leserichtung im Raster
  const order = await page.locator('.instrument[data-layer="bass"] .inst-knobs input').evaluateAll((els) => els.map((el) => el.id.replace('timbre-bass-', '')));
  expect(order).toEqual(['sub', 'pluck', 'roundness', 'cutoff', 'resonance', 'fuzz', 'overdrive', 'distortion', 'vibrato', 'chorus']);

  // Anzeige über dem Knopf: Wert bei bedienbaren, "ohne Wirkung" bei ausgegrauten (Sample-Bass benutzt Sub nicht)
  const hint = (id) => page.locator(`.knob-cell:has(#${id})`).evaluate((cell) => getComputedStyle(cell, '::after').content);
  expect(await hint('timbre-bass-fuzz')).toBe('none'); // ohne Maus nichts
  await page.locator('.knob-cell:has(#timbre-bass-fuzz)').hover();
  expect(await hint('timbre-bass-fuzz')).toBe('"0 %"');
  await slider(page, 'bass', 'fuzz').fill('35');
  await answered(page); // die Anzeige zeigt die Hand bis zur Antwort
  expect(await hint('timbre-bass-fuzz')).toBe('"35 %"');
  await expect(slider(page, 'bass', 'sub')).toBeDisabled();
  await page.locator('.knob-cell:has(#timbre-bass-sub)').hover();
  expect(await hint('timbre-bass-sub')).toBe('"ohne Wirkung"');
});

test('Lichter: LED an Modul und Spur blitzt bei jedem Anschlag der Schicht, die Schlag-LED auf jedem Schlag; stumm und im Stand blitzt nichts', async ({ page }) => {
  const led = (layer) => page.locator(`.instrument[data-layer="${layer}"] .led`);
  const lane = (layer) => page.locator(`#lane-buttons [data-layer="${layer}"]`);
  const beat = page.locator('#beat-led');
  // zählt, wie oft eine LED aufblitzt (Klasse hit kommt dazu)
  const countFlashes = (selector) => page.evaluate((sel) => {
    window.__flashes ??= {};
    window.__flashes[sel] = 0;
    const el = document.querySelector(sel);
    let was = el.classList.contains('hit');
    new MutationObserver(() => { const is = el.classList.contains('hit'); if (is && !was) window.__flashes[sel]++; was = is; }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }, selector);
  const flashes = (selector) => page.evaluate((sel) => window.__flashes[sel], selector);
  await expect(beat).not.toHaveClass(/\bhit\b/);
  await page.locator('#form-template').selectOption('off'); // ohne Form spielt das Schlagzeug von Anfang an
  await answered(page);
  for (const sel of ['#beat-led', '.instrument[data-layer="drums"] .led', '#lane-buttons [data-layer="drums"]', '.instrument[data-layer="percussion"] .led']) await countFlashes(sel);
  await playFast(page);
  // 200 bpm: mehrere Schläge je Sekunde, das Schlagzeug spielt mindestens auf jedem Schlag
  await expect.poll(() => flashes('#beat-led'), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => flashes('.instrument[data-layer="drums"] .led'), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(4);
  await expect.poll(() => flashes('#lane-buttons [data-layer="drums"]'), { timeout: BAR_TIMEOUT }).toBeGreaterThanOrEqual(4);
  expect(await flashes('.instrument[data-layer="percussion"] .led')).toBe(0); // Percussion ist im Standard stumm
  // klingender Ton: die LED der Schicht leuchtet für die Dauer des Tons voll (ohne Lichtschein), an Modul und Spur; stumm geht sie sofort aus
  await expect(led('bass')).toHaveClass(/\bsound\b/, { timeout: BAR_TIMEOUT });
  await expect(lane('bass')).toHaveClass(/\bsound\b/, { timeout: BAR_TIMEOUT });
  expect(await led('drums').evaluate((el) => el.classList.contains('sound'))).toBe(false); // Schläge haben keine Dauer
  await page.locator('#mixer button[data-mute="bass"]').click();
  await settled(page); // die Antwort und was die Engine mit ihr tut ("aus" stünde zwischen zwei Tönen auch vorher)
  await expect(led('bass')).not.toHaveClass(/\b(sound|hit)\b/);
  await page.waitForTimeout(700);
  await expect(led('bass')).not.toHaveClass(/\b(sound|hit)\b/);
  await playGo(page).click();
  await settled(page); // der Stopp ist getan
  for (const el of [beat, led('drums'), lane('drums'), led('chords'), lane('chords')]) await expect(el).not.toHaveClass(/\b(sound|hit)\b/);
  const after = await flashes('#beat-led');
  await page.waitForTimeout(600);
  expect(await flashes('#beat-led')).toBe(after); // im Stand blitzt nichts mehr
});

test.describe('Bewegung reduzieren', () => {
  test.use({ reducedMotion: 'reduce' });
  test('die LEDs blitzen nicht, die LED einer spielenden Schicht leuchtet voll', async ({ page }) => {
    const led = page.locator('.instrument[data-layer="drums"] .led');
    await page.locator('#form-template').selectOption('off');
    await answered(page);
    await page.evaluate(() => {
      window.__hits = 0;
      new MutationObserver((list) => { for (const m of list) if (m.target.classList.contains('hit') || m.target.classList.contains('sound')) window.__hits++; }).observe(document.querySelector('#play'), { attributes: true, attributeFilter: ['class'], subtree: true });
    });
    await playFast(page);
    await expect(led).toHaveClass(/\bon\b/, { timeout: BAR_TIMEOUT });
    expect(await led.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(227, 70, 94)');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__hits)).toBe(0);
    await playGo(page).click();
  });
});
