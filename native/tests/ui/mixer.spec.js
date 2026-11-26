// Mischpult und Variantenwechsel auf der Spielseite (echte Seite der App, Echtzeit).
// Portiert aus tests/e2e/mixer.spec.js: die App lädt ihre Seite; die Folge einer Variante (progressionFor) aus dem Kern der App (core.js);
// gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts zählt count-helpers.js; die Sprache wählt die Leiste der App.
// Das Mischpult merkt die App in ihrem Speicher (mix.json, geschrieben von setLevel und setPan, PROTOKOLL.md Abschnitte 3 und 3a), nicht im
// localStorage: gelesen wird die Datei im Ordner der App, ein vorbereiteter (auch ein kaputter) Text kommt mit app.restart in den Ordner, und ein
// Neuladen, das das Merken beweist, ist ein Neustart der App. Die Web-App sah an den Audioknoten, wie die Pegel ankommen (setTargetAtTime live,
// AudioParam.value beim Start); die App hat kein Web Audio: hier zählt, was die Seite der Sitzung schickt, was die Sitzung daraus macht und dass
// ihre Antwort den Merker mix trägt (auf ihn gibt die Hülle der Engine Pegel und Panorama, PROTOKOLL.md Abschnitt 7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { openSetup } from './style-helpers.js';
import { contexts, countContexts, lastSent, record } from './count-helpers.js';
import { core } from './core.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const SYMBOLS = { maj: '', min: 'm', dim: 'dim' };
const LAYERS = ['drums', 'bass', 'chords', 'pad'];

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await expect(page.locator('#go')).toHaveText(/\S/);
  await countContexts(page);
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
const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);
const shownVariant = async (page) => Number((await page.locator('#play-variant').textContent()).match(/\d+/)[0]);
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
// die Folge, die die Variante in A-Moll erzeugt: eine frische Sitzung auf der Variante (progressionFor der Web-App)
const expectedChords = (seed) => core([{ action: 'start', variant: seed }]).at(-1).track.bars.map(({ chord }) => chord.root + SYMBOLS[chord.quality]);
// das gespeicherte Mischpult (die Web-App: localStorage backingtrack.mix)
const storedMix = (app) => readFileSync(join(app.folder, 'mix.json'), 'utf8');

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
  await answered(page); // Fader und Anzeige zeigen die Hand bis zur Antwort
  await expect(slider(page, 'master')).toHaveValue('99');
  await expect(outputs(page).last()).toHaveText('99 %');

  await chooseLanguage(page, 'en');
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
  await record(page);
  // live: die Seite schickt den Wert, die Sitzung hält ihn, und ihre Antwort trägt den Merker mix (auf ihn gibt die Hülle der Engine die Pegel;
  // die Web-App: Reglerstellung 0,5 -> Verstärkung 0,25, das Quadrat rechnet die Engine)
  await slider(page, 'bass').fill('50');
  await expect.poll(() => lastSent(page, 'setLevel', 'mix')).toEqual({ seq: expect.any(Number), action: 'setLevel', channel: 'bass', value: 50, mix: true });
  expect((await fromSession(page, 'state')).mix.bass).toBe(0.5);
  await slider(page, 'master').fill('30');
  await expect.poll(() => lastSent(page, 'setLevel', 'mix')).toEqual({ seq: expect.any(Number), action: 'setLevel', channel: 'master', value: 30, mix: true });
  expect((await fromSession(page, 'state')).mix.master).toBe(0.3);
  await slider(page, 'drums').fill('0');
  await expect.poll(() => lastSent(page, 'setLevel', 'mix')).toEqual({ seq: expect.any(Number), action: 'setLevel', channel: 'drums', value: 0, mix: true });
  expect((await fromSession(page, 'state')).mix.drums).toBe(0);
  await expect(outputs(page).nth(1)).toHaveText('50 %');
  await settled(page); // was die Engine mit den Pegeln tut (ein Neustart käme nach der Antwort): die Taktzeile zeigt es bis hier
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
  await answered(page); // schickte der Klick etwas, stünde die Antwort hier
  await same('pad', false);
  await mixMute(page, 'pad').click();
  await same('pad', true);
  // Stummschalten ändert die Reglerstellung nicht und startet nicht neu
  await expect(slider(page, 'pad')).toHaveValue('100');
  expect(await contexts(page)).toBe(1);
});

test('Mix überlebt das Neuladen, Stummschaltungen nicht; kaputter Speicher wird ignoriert; Anfangspegel gehen mit dem Start', async ({ page, app }) => {
  await openPlayPage(page);
  await showMixer(page);
  await slider(page, 'bass').fill('40');
  await slider(page, 'master').fill('70');
  await mixMute(page, 'chords').click();
  await answered(page); // die Sitzung hat geschrieben, was die Antworten sagen
  expect(JSON.parse(storedMix(app))).toEqual({ drums: 1, bass: 0.4, chords: 1, pad: 1, lead: 1, percussion: 1, master: 0.7, pan: { drums: 0, bass: 0, chords: 0.3, pad: -0.2, lead: 0, percussion: -0.4 } });
  page = await app.restart(); // das Mischpult merkt der Speicher der App: ein Neustart
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openPlayPage(page);
  await showMixer(page);
  await expect(slider(page, 'bass')).toHaveValue('40');
  await expect(slider(page, 'master')).toHaveValue('70');
  await expect(slider(page, 'drums')).toHaveValue('100');
  await expect(mixMute(page, 'chords')).toHaveAttribute('aria-pressed', 'false');
  // Start: die gespeicherten Pegel gehen mit dem Start an die Engine (die Hülle gibt ihr beim Start die Pegel aus state().mix), nicht erst
  // danach (die Web-App: gleich beim Bau der Instrumente, nicht erst per Rampe)
  await record(page);
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  await settled(page); // der Start ist getan: was die Seite dabei schickte, ist aufgezeichnet
  const { mix } = await fromSession(page, 'state');
  expect(mix.bass).toBe(0.4);
  expect(mix.master).toBe(0.7);
  expect(await lastSent(page, 'setLevel', 'mix')).toBeUndefined();
  await playGo(page).click();

  for (const garbage of ['{kaputt', '[1,2]', '{"bass":5,"drums":"laut","pad":-1,"master":null}']) {
    page = await app.restart({ 'mix.json': garbage });
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

  // gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
  const focusId = async () => { await answered(page); return page.evaluate(() => document.activeElement.id); };
  const chords = async () => { await answered(page); return page.locator('#chords').textContent(); };
  await page.locator('#variant-next').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  expect(await focusId()).toBe('variant-next');
  expect(await chords()).toBe(expectedChords(1).join(' – '));
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
  expect(await focusId()).toBe('variant-prev');
  expect(await chords()).toBe(expectedChords(9999).join(' – '));
  await page.keyboard.press('Enter'); // per Tastatur ebenso
  await expect(page.locator('#play-variant')).toHaveText('Variante 9998');
  await page.locator('#variant-prev').click();
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9996');
  let rolled = 9996;
  for (let i = 0; i < 3 && rolled === 9996; i++) {
    await page.locator('#variant-random').click();
    await answered(page); // "Variante <Zahl>" stünde auch vor der Antwort da
    await expect(page.locator('#play-variant')).toHaveText(/^Variante \d+$/);
    rolled = await shownVariant(page);
  }
  expect(rolled).not.toBe(9996);
  expect(rolled).toBeGreaterThanOrEqual(1);
  expect(rolled).toBeLessThanOrEqual(9999);
  expect(await focusId()).toBe('variant-random');
  expect(await chords()).toBe(expectedChords(rolled).join(' – '));
  // Wrap von 1 nach 9999 mit dem Zurück-Knopf
  await field.evaluate((el, n) => { el.value = n; el.dispatchEvent(new Event('change')); }, '1');
  await expect(page.locator('#play-variant')).toHaveText('Variante 1');
  await page.locator('#variant-prev').click();
  await expect(page.locator('#play-variant')).toHaveText('Variante 9999');
});

test('Variante während der Wiedergabe: Neustart im laufenden Takt, Tags, Tempo, Mix und Stummschaltungen bleiben, ein AudioContext', async ({ page, app }) => {
  test.setTimeout(60_000);
  await openPlayPage(page);
  await showMixer(page);
  await slider(page, 'bass').fill('60');
  await mixMute(page, 'pad').click();
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von/, { timeout: BAR_TIMEOUT });
  const tagsOf = () => page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());
  const tags = await tagsOf();
  const settings = async () => ({
    ...(await page.evaluate(() => ({
      tempo: document.getElementById('tuning-tempo').value,
      length: document.getElementById('length').value,
      pad: document.querySelector('#lane-buttons [data-layer="pad"]').getAttribute('data-muted'),
    }))),
    mix: storedMix(app),
  });
  await answered(page);
  const settingsBefore = await settings();
  expect(settingsBefore.pad).toBe('true');
  await recordPositions(page);
  for (const id of ['variant-next', 'variant-prev', 'variant-random', 'variant-next']) {
    // erst leeren, dann den Takt lesen (die Web-App in umgekehrter Folge): ein Taktwechsel dazwischen fehlte sonst der Aufzeichnung, und eine
    // leere Aufzeichnung ließe expectKeepsCounting scheitern
    await positionsSince(page);
    const before = await shownBar(page);
    const seed = await shownVariant(page);
    await page.locator(`#${id}`).click();
    if (id === 'variant-random') await expect.poll(() => shownVariant(page)).not.toBe(seed);
    else await expect(page.locator('#play-variant')).toHaveText(`Variante ${id === 'variant-next' ? (seed % 9999) + 1 : ((seed + 9997) % 9999) + 1}`);
    await settled(page); // der Neustart am Takt kommt nach der Antwort: die Taktzeile zeigt ihn bis hier, und was bleibt, stünde auch vorher da
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

test('Alle Samples: Standard sind Samples; schaltet jede Schicht auf Synth und zurück; ein Instrument auf Synth ergibt gemischt', async ({ page }) => {
  await openPlayPage(page);
  await showMixer(page);
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(allVoices(page)).toContainText('SMP');
  for (const layer of ['drums', 'bass', 'chords', 'pad']) await expect(page.locator(`#voice-${layer}`)).toHaveValue(/^sample\//);
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(allVoices(page)).toContainText('SYN');
  for (const layer of ['drums', 'bass', 'chords', 'pad']) await expect(page.locator(`#voice-${layer}`)).toHaveValue('synth/classic');
  // ein Instrument auf Sample
  await page.locator('#voice-bass').selectOption('sample/finger');
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'mixed');
  await expect(allVoices(page)).toContainText('Gemischt');
  // bei gemischt schaltet der Klick auf Samples
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true');
  for (const layer of ['drums', 'bass', 'chords', 'pad']) await expect(page.locator(`#voice-${layer}`)).toHaveValue(/^sample\//);
});

// Die Web-App ließ das Pack des Fingerbasses mit page.route scheitern oder warten. Die Engine der App liest ihre Packs von der Platte, aus einem
// Ordner, der beim Bau feststeht (native/app/PluginProcessor.cpp, packsPath): nichts lässt sich umleiten. Beide Zustände gibt es in der App ("nicht
// verfügbar" einer Stimme, "lädt …" an der Taste, solange Packs laden); herbeigeführt werden sie hier mit den Ereignissen der Hülle in der Seite,
// wie failStarts einen Start, der scheitert (Entscheidung des Controllers, Task 33c).

// Ab dem nächsten Laden meldet die Hülle den Fingerbass, als ließe sich sein Pack nicht lesen (der Text der Engine, engine.cpp 506), solange die
// Sitzung ihn gewählt hat (derived().voices.bass); alle anderen Meldungen gehen, wie sie kommen.
// shortcut: the shell's report is faked, so the test proves the page's part only, not the engine's and the shell's (a pack that cannot be read
// leaves its layer silent, names the pack, the others play: btg_engine_tests, test_engine.cpp 1489-1508; the shell sends that report), upgrade:
// Task 34, when the packs have their place: a folder of the test with a broken pack.
const packFails = (page) => page.addInitScript(() => {
  const backend = window.__JUCE__.backend;
  let bass = null;
  backend.addEventListener('derived', (m) => { bass = JSON.parse(m.json).voices.bass; });
  const emit = backend.emitByBackend.bind(backend);
  backend.emitByBackend = (id, text) => {
    if (id !== 'voices' || bass?.id !== 'sample' || bass?.variant !== 'finger') return emit(id, text);
    return emit(id, JSON.stringify({ ...JSON.parse(text), bass: 'error: bass-finger: pack: cannot open bass-finger.json' }));
  };
});

test('Pack lädt nicht: Fehler im Display des Instruments, die übrigen werden bereit, Los wartet und spielt, Seite bleibt bedienbar', async ({ page }) => {
  await packFails(page);
  await page.reload(); // die Packs der Startwahl meldet die Hülle beim Laden: erst mit dem nachgestellten Fehler
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openPlayPage(page);
  await showMixer(page);
  await expect(page.locator('#voice-status-bass')).toHaveText('nicht verfügbar', { timeout: BAR_TIMEOUT });
  for (const layer of ['drums', 'chords', 'pad']) await expect(page.locator(`#voice-status-${layer}`)).toHaveText('bereit', { timeout: 30_000 });
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'true'); // die Wahl steht, nur das Pack fehlt
  // Los versucht das fehlende Pack noch einmal und spielt dann (der Bass als Synth)
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  await playGo(page).click();
  await allVoices(page).click();
  await expect(allVoices(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#voice-status-bass')).toHaveText('');
  // die Web-App erwartete die Konsolenmeldung des Browsers zum 500 der Pack-Datei und nahm sie aus ihrer Liste: die Seite der App lädt kein Pack,
  // eine solche Meldung gibt es nicht; die Prüfung des Fixtures auf Konsolenfehler bleibt
});

// Ab jetzt hält die Seite die Meldungen `voices` der Hülle und ihre eigenen playSession zurück, bis window.__release() sie der Reihe nach
// weitergibt: so lädt eine gewählte Stimme für die Seite, bis release() kommt.
// shortcut: the load is faked, so the test proves the page's part only (the key's "lädt …" and aria-busy while a chosen voice has no report,
// the second click), not that the shell's start waits for the load of a voice chosen before it (held by no check), upgrade: Task 34, when the
// packs have their place: a folder of the test with a pack whose load the test holds.
const holdLoads = (page) => page.evaluate(() => {
  const backend = window.__JUCE__.backend;
  const held = [];
  const emitEvent = backend.emitEvent.bind(backend), emitByBackend = backend.emitByBackend.bind(backend);
  backend.emitByBackend = (id, text) => (id === 'voices' ? held.push(() => emitByBackend(id, text)) : emitByBackend(id, text));
  backend.emitEvent = (name, data) => (data?.type === 'playSession' ? held.push(() => emitEvent(name, data)) : emitEvent(name, data));
  window.__release = () => {
    backend.emitByBackend = emitByBackend;
    backend.emitEvent = emitEvent;
    for (const go of held.splice(0)) go();
  };
});

test('Los wartet auf die Sample-Packs: der Knopf zeigt lädt …, ein AudioContext, danach spielt es', async ({ page }) => {
  await openPlayPage(page);
  // die Packs der Startwahl hat die App vor der Seite geladen: geladen wird hier eine Stimme, die die Seite noch nicht bereit sah (die Web-App:
  // das Pack der Startwahl, dessen Antwort page.route zurückhält)
  await holdLoads(page);
  await page.locator('#voice-bass').selectOption('sample/pick');
  await answered(page);
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('lädt …');
  await expect(playGo(page)).toHaveAttribute('aria-busy', 'true');
  await playGo(page).click(); // zweiter Klick während des Ladens: nichts
  await page.evaluate(() => window.__release());
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  await expect(playGo(page)).toHaveAttribute('aria-busy', 'false');
  expect(await contexts(page)).toBe(1);
  await playGo(page).click();
});

test('Fader springt während der Wiedergabe nicht: kein Schreiben ins Eingabefeld, weder nach Tastatur noch beim Ziehen', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 960 }); // Maßstab des Racks; bei 1280 x 720 ist es für die Maus zu niedrig
  // zählt jedes Schreiben des Werts eines Faders (die Web-App: im Init-Skript vor dem Laden; hier ab jetzt, gezählt wird erst unten)
  await page.evaluate(() => {
    window.__valueWrites = {};
    const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      ...valueDesc,
      set(v) {
        if (this.id.startsWith('mix-')) window.__valueWrites[this.id] = (window.__valueWrites[this.id] ?? 0) + 1;
        valueDesc.set.call(this, v);
      },
    });
  });
  await openPlayPage(page);
  await playFast(page);
  await showMixer(page);
  const writes = () => page.evaluate(() => window.__valueWrites['mix-drums'] ?? 0);
  // per Tastatur auf 40: 6 x Bild-ab (je 10)
  await slider(page, 'drums').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('PageDown');
  await answered(page); // Fader und Anzeige zeigen die Hand bis zur Antwort
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
  // gezählt wird ab hier, auch was die Antworten auf das Ziehen schreiben (die Seite der App zeigt bis zur letzten die Hand, dann die Sitzung)
  await page.evaluate(() => { window.__valueWrites = {}; });
  const bar = await shownBar(page);
  await expect.poll(() => shownBar(page), { timeout: BAR_TIMEOUT * 2 }).toBeGreaterThanOrEqual(bar + 2);
  expect(Number(await slider(page, 'drums').inputValue())).toBe(held);
  expect(await writes(), 'gezogener Fader wird nicht neu gesetzt').toBe(0);
  await page.mouse.up();
  await expect(playGo(page)).toHaveText('Stopp');
});

// Pan je Kanal und Pegelanzeige (UI-Schritt 2)
const pan = (page, name) => page.locator(`#pan-${name}`);
const meterLevel = (page, name) => page.locator(`#mixer .mix-ch:has(#mix-${name}) .meter`).evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--level') || 0));

test('Pan je Kanal: Standard ist die Lage im Panorama, wirkt live ohne Neustart, wird gemerkt, Doppelklick stellt den Standard wieder her', async ({ page, app }) => {
  await openPlayPage(page);
  await showMixer(page);
  await expect(page.locator('#mixer input[id^="pan-"]')).toHaveCount(6); // der Gesamtkanal hat keinen
  for (const [name, value] of [['drums', '0'], ['bass', '0'], ['chords', '30'], ['pad', '-20'], ['lead', '0'], ['percussion', '-40']]) await expect(pan(page, name), name).toHaveValue(value);
  await expect(pop(page).getByRole('slider', { name: 'Pan Akkorde', exact: true })).toHaveAttribute('aria-valuetext', '30 % rechts');
  await expect(pan(page, 'pad')).toHaveAttribute('aria-valuetext', '20 % links');
  await expect(pan(page, 'bass')).toHaveAttribute('aria-valuetext', 'Mitte');

  await playFast(page);
  expect(await contexts(page)).toBe(1);
  await recordPositions(page); // erst aufzeichnen, dann den Takt lesen (wie oben)
  const before = await shownBar(page);
  await record(page);
  await pan(page, 'bass').fill('50');
  // live: die Seite schickt die Lage, die Sitzung hält sie, die Antwort trägt den Merker mix (die Web-App: Balance links 1 - pan, rechts 1 + pan,
  // also 0,5 und 1,5; die Balance rechnet die Engine)
  await expect.poll(() => lastSent(page, 'setPan', 'mix')).toEqual({ seq: expect.any(Number), action: 'setPan', layer: 'bass', value: 50, mix: true });
  expect((await fromSession(page, 'state')).pan.bass).toBe(0.5);
  await expect(pan(page, 'bass')).toHaveAttribute('aria-valuetext', '50 % rechts');
  await settled(page); // was die Engine mit der Lage tut (ein Neustart käme nach der Antwort): die Taktzeile zeigt es bis hier
  await expectKeepsCounting(page, before, 'Pan');
  expect(await contexts(page)).toBe(1);
  expect(JSON.parse(storedMix(app)).pan.bass).toBe(0.5);
  await playGo(page).click();

  // Tastatur und Doppelklick
  await pan(page, 'chords').focus();
  await page.keyboard.press('ArrowLeft');
  await answered(page); // der Knopf zeigt die Hand bis zur Antwort
  await expect(pan(page, 'chords')).toHaveValue('29');
  await page.locator('.knob:has(#pan-chords)').dblclick();
  await answered(page);
  await expect(pan(page, 'chords')).toHaveValue('30');

  page = await app.restart(); // das Panorama merkt der Speicher der App (mix.json): ein Neustart
  await expect(page.locator('#go')).toHaveText(/\S/);
  await openPlayPage(page);
  await expect(pan(page, 'bass')).toHaveValue('50');
  await expect(pan(page, 'chords')).toHaveValue('30');
});

test('Pegelanzeige: leuchtet bei laufender Wiedergabe je Kanal und am Gesamtkanal, stumme Schicht bleibt dunkel, nach dem Stopp läuft sie zurück', async ({ page }) => {
  await openPlayPage(page);
  await showMixer(page);
  await expect(page.locator('#mixer .meter')).toHaveCount(7);
  for (const name of ['drums', 'master']) expect(await meterLevel(page, name), name).toBe(0);
  await mixMute(page, 'bass').click();
  await page.locator('#form-template').selectOption('off'); // ohne Form spielt das Schlagzeug vom ersten Takt an (ein gewürfeltes Intro ließe es schweigen)
  await playFast(page);
  for (const name of ['drums', 'master']) await expect.poll(() => meterLevel(page, name), { message: name, timeout: BAR_TIMEOUT }).toBeGreaterThan(0);
  expect(await meterLevel(page, 'bass')).toBe(0); // gemessen wird hinter Fader und Stumm
  await playGo(page).click();
  for (const name of ['drums', 'master']) await expect.poll(() => meterLevel(page, name), { message: name, timeout: BAR_TIMEOUT }).toBe(0);
});

test('Modul Gesamtklang: eigenes Modul neben dem Mixer mit dem Schalter Alle Samples und den sechs Gesamt-Knöpfen', async ({ page }) => {
  await openPlayPage(page);
  await expect(page.getByRole('region', { name: 'Gesamtklang' })).toBeVisible();
  await expect(page.locator('#mod-master #all-voices')).toHaveCount(1);
  await expect(page.locator('#mod-master #mixer-master input[type="range"]')).toHaveCount(6);
  await expect(page.locator('#mod-mixer #mixer-master, #mod-mixer #all-voices')).toHaveCount(0);
  await chooseLanguage(page, 'en');
  await expect(page.locator('#mod-master-title')).toHaveText('Master sound');
  await expect(page.locator('#mod-mixer').getByRole('slider', { name: 'Pan Bass', exact: true })).toHaveAttribute('aria-valuetext', 'centre');
});

test('Gespeicherte Pegel beim Start: die Engine spielt mit ihnen, das Schlagzeug auf 0 bleibt unter −60 dB, der Bass klingt', async ({ app }) => {
  // die Web-App: die Pegel gehen mit dem Bau der Instrumente an die Knoten (start(), app.js 123–131); die App: die Hülle gibt der Engine bei jedem
  // Start die Pegel der Sitzung (PROTOKOLL.md Abschnitt 7, „Mit allem“), und die Engine meldet je Schicht den Pegel hinter dem Fader (`peaks`).
  // Nicht genau 0: eine Engine, die still steht, führt ihre Fader nicht nach (engine.cpp, `quiet`); bekam sie den Pegel, als sie schon bereit
  // war, gleitet er beim ersten Spielen von 1 auf 0 (Zeitkonstante 20 ms, auf 1e-3 nach etwa 0,14 s), und der erste Schlag des Schlagzeugs nach
  // dem Vorlauf von 0,15 s hat noch etwa 2e-4 (gesehen 1,8e-4, −75 dB).
  // Die Grenze 1e-3 (−60 dB) trennt das von einem Pegel, der nicht ankam (dann 0,1 bis 0,7)
  const page = await app.restart({ 'mix.json': JSON.stringify({ drums: 0, bass: 1, chords: 1, pad: 1, lead: 1, percussion: 1, master: 1, pan: { drums: 0, bass: 0, chords: 0.3, pad: -0.2, lead: 0, percussion: -0.4 } }) });
  await openPlayPage(page);
  await showMixer(page);
  await expect(slider(page, 'drums')).toHaveValue('0');
  await page.locator('#form-template').selectOption('off'); // ohne Form spielt das Schlagzeug vom ersten Takt an
  await answered(page);
  await page.evaluate(async () => {
    const { on } = await import('./session.js');
    window.__peaks = [];
    on('engine', (m) => { if (m.playing && !m.standing) window.__peaks.push(m.peaks); });
  });
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von/, { timeout: BAR_TIMEOUT });
  await settled(page);
  await expect.poll(() => page.evaluate(() => window.__peaks.filter((p) => p.bass > 0).length), { message: 'Meldungen mit Pegel am Bass', timeout: BAR_TIMEOUT }).toBeGreaterThan(30);
  expect(await page.evaluate(() => window.__peaks.filter((p) => p.drums >= 1e-3).map((p) => p.drums)), 'Pegel am Schlagzeug ab 1e-3').toEqual([]);
  await playGo(page).click();
});
