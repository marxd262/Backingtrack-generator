// Spielseite (über Feintuning geöffnet): Schlagworte, Tempo, Länge, Schichten, Verlauf, Akkordfolge, Akkordrad.
// Portiert aus tests/e2e/tuning.spec.js: die App lädt ihre Seite; die Stile aus tables() der Sitzung, die Schlagworte, die ein Stil wählt
// (STYLE_PRESETS[].tags), als Werte; wo ein Akkord im Rad liegt, sagen die Geometrie der Seite
// (native/app/ui/wheel-geometry.js) und derived().wheel; gelesen wird, wenn die Seite die Antworten auf ihre Aktionen zeigt; AudioContexts und
// Instrumentensätze zählt count-helpers.js an den Meldungen der Hülle; die Sprache wählt die Leiste der App.
import { test, expect, answered, chooseLanguage, fromSession, settled } from './fixture.js';
import { addChordByName, openAddPop, wheelPoint } from './chord-helpers.js';
import { chooseStyle, currentStyle, openTags } from './style-helpers.js';
import { contexts, countContexts, recordPositions, positionsSince, sets, shownBar, expectContinuous } from './count-helpers.js';

const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const BAR_TIMEOUT = 10_000; // ein Takt bei 100 bpm dauert 2,4 s; unter Last großzügig

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  await expect(page.locator('#go')).toHaveText(/\S/);
});

const tuneBtn = (page) => page.locator('#tune-btn');
const playPage = (page) => page.locator('#play');
const start = (page) => page.locator('#start');
const playGo = (page) => page.locator('#play-go');
const position = (page) => page.locator('#play-position');
const progression = (page) => page.locator('#progression button');
// gelesen, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const count = async (page) => { await answered(page); return progression(page).count(); };
const shownChords = async (page) => { await answered(page); return (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim()); };
const pressedTags = async (page) => {
  await answered(page);
  return page.locator('#tags button[aria-pressed="true"]').evaluateAll((els) => els.map((el) => `${el.dataset.category}.${el.dataset.tag}`).sort());
};

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
const focusState = async (page) => {
  await answered(page);
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      inPlay: document.querySelector('#play').contains(el),
      body: el === document.body,
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    };
  });
};
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

test('Feintuning öffnet die Spielseite, zurück zur Startseite: Navigation ohne aria-expanded, hidden, Fokus', async ({ page }) => {
  await expect(tuneBtn(page)).toHaveText('Einstellen');
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
  await answered(page); // "Halbzeit bleibt gewählt" stünde auch vor der Antwort da
  await expect(drums.getByRole('button', { name: 'treibend' })).toHaveAttribute('aria-pressed', 'false');
  await expect(drums.getByRole('button', { name: 'Halbzeit' })).toHaveAttribute('aria-pressed', 'true');
});

test('Schlagworte greifbar: Kennbuchstaben für Spiel, Klang und Form, die Anzeige erklärt das berührte Wort, wirkungslose Wörter sind blass', async ({ page }) => {
  await openPlayPage(page);
  await openTags(page);
  const tag = (id) => page.locator(`#tags [data-tag="${id}"]`);
  const fx = page.locator('#tag-fx');
  const marks = (id) => tag(id).getAttribute('data-marks');
  // beim Öffnen liegt der Fokus auf dem ersten gewählten Wort: die Anzeige erklärt es sofort
  await expect(fx).toHaveText('treibend\nSpiel, sofort: Antrieb +30 %');
  await expect(page.locator('.tag-legend')).toHaveText(/S ändert das Spiel, K den Klang, F das Würfeln der Form/);
  // Kennbuchstaben stehen nicht im Text des Worts (Name bleibt der Name)
  expect(await marks('driving')).toBe('S');
  expect(await marks('punchy')).toBe('K');
  expect(await marks('dreamy')).toBe('S K');
  expect(await marks('buildsSlowly')).toBe('F'); // mit Songform
  expect(await marks('withBreakouts')).toBe('F');
  await expect(tag('driving')).toHaveText('treibend');
  await expect(tag('withBreakouts')).toHaveAccessibleName('mit Ausbrüchen');
  await expect(tag('driving')).toHaveAttribute('aria-describedby', 'tag-fx');

  // Spiel-Wort
  await tag('driving').hover();
  await expect(fx).toHaveText('treibend\nSpiel, sofort: Antrieb +30 %');
  await expect(tag('driving')).not.toHaveClass(/\binert\b/);
  // Form-Wort: wirkt beim nächsten Würfeln, ist also nicht wirkungslos
  await tag('withBreakouts').hover();
  await expect(fx).toHaveText('mit Ausbrüchen\nForm, beim nächsten Würfeln: öfter Break');
  await expect(tag('withBreakouts')).not.toHaveClass(/\binert\b/);
  // Klang-Wort am Sample-Kit (Standard): bewirkt nichts, blass (auch gewählt, im Stil Funk), die Anzeige sagt warum
  await tag('punchy').hover();
  await expect(fx).toHaveText('kräftig\nOhne Wirkung bei der gewählten Stimme: Schlagzeug: Kick-Punch +35 %, Kick-Länge −15 %, Snare-Knack +20 %');
  await expect(tag('punchy')).toHaveClass(/\binert\b/);
  await expect(tag('punchy')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#char-words .word-tag.inert')).toHaveText(['kräftig', 'knackig']);
  // weiter wählbar, per Tastatur erklärt die Anzeige das fokussierte Wort
  await tag('boomy').focus();
  await expect(fx).toHaveText(/^dröhnend\nOhne Wirkung/);
  await page.keyboard.press('Enter');
  await expect(tag('boomy')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // mit dem Synth-Kit wirkt das Wort: nicht mehr blass, die Anzeige nennt die Regler; ein von Hand gestellter Knopf gewinnt
  await page.locator('#voice-drums').selectOption('synth/classic');
  await answered(page); // "nicht blass" stünde auch vor der Antwort da, solange das Wort blass ist, nur im Text der Anzeige nicht
  await openTags(page);
  await tag('punchy').hover();
  await expect(fx).toHaveText('kräftig\nKlang, sofort: Schlagzeug: Kick-Punch +35 %, Kick-Länge −15 %, Snare-Knack +20 %');
  await expect(tag('punchy')).not.toHaveClass(/\binert\b/);
  await expect(page.locator('#char-words .word-tag.inert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('#timbre-drums-kickPunch').fill('90');
  await answered(page);
  await openTags(page);
  await tag('punchy').hover();
  await expect(fx).toHaveText('kräftig\nKlang, sofort: Schlagzeug: Kick-Länge −15 %, Snare-Knack +20 %\nVom Knopf überstimmt (Zurücksetzen gibt ihn frei): Schlagzeug: Kick-Punch +35 %');

  // ohne Songform: „baut langsam auf“ wirkt sofort aufs Spiel, „mit Ausbrüchen“ bewirkt nichts
  await page.keyboard.press('Escape');
  await page.locator('#form-template').selectOption('off');
  await answered(page);
  await openTags(page);
  expect(await marks('buildsSlowly')).toBe('S');
  await tag('buildsSlowly').hover();
  await expect(fx).toHaveText('baut langsam auf\nSpiel, sofort: Schichten setzen nach und nach ein');
  await tag('withBreakouts').hover();
  await expect(fx).toHaveText('mit Ausbrüchen\nBewirkt zurzeit nichts.');
  await expect(tag('withBreakouts')).toHaveClass(/\binert\b/);

  // Englisch: eigene Kennbuchstaben und Texte, keine rohen Schlüssel (die Web-App schloss das Fenster mit dem Klick auf die Sprachtaste daneben;
  // die Leiste der App liegt außerhalb der Seite: das Fenster bleibt offen, openTags lässt es so)
  await chooseLanguage(page, 'en');
  await openTags(page);
  expect(await marks('driving')).toBe('P');
  expect(await marks('punchy')).toBe('S');
  await tag('driving').hover();
  await expect(fx).toHaveText('driving\nPlaying, at once: drive +30%'.replace('+30%', '+30 %'));
  expect(await rawKeysIn(page)).toEqual([]);
});

test('Schlagwort während der Wiedergabe: wirkt live ohne Neustart und Fehler, Taktzeile läuft weiter', async ({ page }) => {
  await countContexts(page);
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  await recordPositions(page);
  // erst leeren, dann den Takt lesen (die Web-App in umgekehrter Folge): ein Taktwechsel dazwischen fehlte sonst der Aufzeichnung, und eine leere
  // Aufzeichnung ließe expectContinuous scheitern
  await positionsSince(page);
  const before = await shownBar(page);
  await openTags(page);
  await page.locator('#tags [data-tag="swing"]').click();
  await expect(page.locator('#tags [data-tag="swing"]')).toHaveAttribute('aria-pressed', 'true');
  // kein Neustart: die Taktzeile springt nicht auf Takt 1 zurück und es entsteht kein neuer Instrumentensatz
  await settled(page); // die Engine hat getan, was das Schlagwort auslöst (es kommt nach der Antwort): die Taktzeile zeigt es bis hier
  await expectContinuous(page, before, 'swing');
  expect(await sets(page)).toBe(1);
  await expect(playGo(page)).toHaveText('Stopp');
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#go')).toHaveText('Los');
});

test('Tempo im Modul Rhythmus ändert das Tempo im Satz', async ({ page }) => {
  await openPlayPage(page);
  await page.locator('#tuning-tempo').fill('150');
  await answered(page); // die Anzeige am Regler zeigt die Hand bis zur Antwort
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
  await positionsSince(page); // erst leeren, dann den Takt lesen (wie oben)
  const before = await shownBar(page);
  expect(await sets(page)).toBe(1);
  await length.selectOption('24');
  // Längenänderung startet an der gleichen Position neu (neuer Instrumentensatz, gleicher AudioContext), nicht ab Takt 1
  await expect(position(page)).toHaveText(/^Takt \d+ von 24$/, { timeout: BAR_TIMEOUT });
  await settled(page); // der Neustart kommt nach der Antwort, die "von 24" zeigt: die Taktzeile zeigt ihn bis hier
  await expectContinuous(page, before, 'Zielgröße 24');
  expect(await sets(page)).toBe(2);
  expect(await contexts(page)).toBe(1);
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
  await settled(page); // ein Neustart käme nach der Antwort
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
  await settled(page); // ein Neustart käme nach der Antwort
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
  while (await count(page) > 1) {
    const n = await count(page);
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
    await answered(page); // der Fokus stünde auch vor der Antwort dort
    await expect(add.filter({ hasText: /^Am$/ })).toBeFocused();
  }
  await expect(progression(page).first()).toBeEnabled();
  const message = page.locator('#tuning-message');
  await expect(message).toHaveAttribute('aria-live', 'polite');
  await expect(message).toHaveText('');
  await page.keyboard.press('Enter');
  await expect(message).toHaveText(/8/);
  await answered(page); // acht Akkorde und der Fokus stünden auch vor der Antwort da
  await expect(progression(page)).toHaveCount(8);
  await expect(add.filter({ hasText: /^Am$/ })).toBeFocused();
  // Rad ebenfalls gesperrt
  await page.locator('#wheel').click({ position: await wheelPoint(page, 'C', 'maj') });
  await answered(page);
  await expect(progression(page)).toHaveCount(8);
  // Entfernen in der Mitte räumt die Meldung, Fokus bleibt an derselben Stelle (nächster Akkord)
  await progression(page).nth(3).focus();
  await page.keyboard.press('Enter');
  await expect(progression(page)).toHaveCount(7);
  await expect(message).toHaveText('');
  await answered(page); // der Fokus stünde auch vor der Antwort dort
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
  while ((await count(page)) > 1) await progression(page).first().click();
  for (const name of ['Am', 'Am', 'Dm', 'E']) await addChordByName(page, name);
  await progression(page).first().click(); // der übrig gebliebene Akkord der Ausgangsfolge
  await answered(page);
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
  while ((await count(page)) < 8) await add.first().click();
  await playFast(page);
  const message = page.locator('#tuning-message');
  await openAddPop(page);
  await add.first().click();
  await expect(message).toHaveText(/8/);
  await answered(page); // die Antwort ist gezeichnet: gezählt wird nur, was die Taktwechsel schreiben
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
  await settled(page); // ein Neustart käme nach der Antwort
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
  await answered(page);
  expect(await page.locator('#add-roots button').allTextContents()).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
});

test('keine rohen Schlüssel in beiden Sprachen auf der Spielseite', async ({ page }) => {
  await openPlayPage(page);
  expect(await rawKeysIn(page)).toEqual([]);
  await chooseLanguage(page, 'en');
  await expect(tuneBtn(page)).toHaveText('Set up');
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
  await chooseLanguage(page, 'de');
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

// presetPressed(preset) der Web-App je Stil: die Schlagworte von STYLE_PRESETS[].tags (src/core/tags.js) in allen Gruppen von TAG_CATEGORIES,
// als `Gruppe.Wort`, sortiert
const presetPressed = {
  funk: ['bass.bouncy', 'bassSound.plucky', 'chordSound.biting', 'development.buildsSlowly', 'drumSound.punchy', 'drumSound.snappy', 'drums.driving', 'drums.dry', 'rhythm.funky', 'rhythm.syncopated'],
  psych: ['bass.deepFat', 'bassSound.fuzz', 'chordSound.chorused', 'development.buildsSlowly', 'drums.driving', 'mood.psychedelic', 'padSound.glassy', 'padSound.swelling', 'rhythm.straight', 'synths.arpeggio', 'synths.shimmering', 'synths.widePad'],
  dreamy: ['bass.calm', 'bassSound.round', 'chordSound.mellow', 'development.buildsSlowly', 'drumSound.roomy', 'drums.halftime', 'drums.loose', 'mood.dreamy', 'padSound.airy', 'padSound.swelling', 'synths.warm', 'synths.widePad'],
  blues: ['bass.bouncy', 'bassSound.round', 'chordSound.mellow', 'development.fullFromStart', 'drumSound.roomy', 'drums.loose', 'rhythm.swing', 'synths.warm'],
  rock: ['bass.gritty', 'bassSound.resonant', 'chordSound.biting', 'development.fullFromStart', 'drumSound.punchy', 'drumSound.snappy', 'drums.driving', 'drums.heavy', 'mood.bright', 'padSound.thick', 'rhythm.straight'],
  hardrock: ['bass.deepFat', 'bass.gritty', 'bassSound.fuzz', 'chordSound.biting', 'chordSound.ringing', 'development.fullFromStart', 'drumSound.boomy', 'drums.driving', 'drums.heavy', 'mood.dark', 'rhythm.straight', 'synths.deepSynths'],
  reggae: ['bass.calm', 'bass.deepFat', 'bassSound.round', 'bassSound.sub', 'chordSound.biting', 'development.fullFromStart', 'drumSound.roomy', 'drums.halftime', 'drums.loose', 'rhythm.syncopated', 'synths.warm'],
  country: ['bass.bouncy', 'bassSound.plucky', 'chordSound.ringing', 'development.fullFromStart', 'drumSound.crisp', 'drums.dry', 'mood.bright', 'padSound.airy', 'rhythm.straight'],
  poppunk: ['bass.bouncy', 'bassSound.plucky', 'chordSound.biting', 'development.fullFromStart', 'drumSound.crisp', 'drumSound.snappy', 'drums.driving', 'drums.heavy', 'mood.bright', 'padSound.thick', 'rhythm.straight'],
};

test('Schlagworte: die vier Klang-Gruppen stehen in beiden Sprachen übersetzt im Modul Charakter, ohne rohe Schlüssel', async ({ page }) => {
  await openPlayPage(page);
  const labels = {
    de: { drumSound: 'Schlagzeugklang', bassSound: 'Bassklang', chordSound: 'Akkordklang', padSound: 'Padklang' },
    en: { drumSound: 'Drum sound', bassSound: 'Bass sound', chordSound: 'Chord sound', padSound: 'Pad sound' },
  };
  for (const lang of ['de', 'en']) {
    await chooseLanguage(page, lang);
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
  const { STYLE_PRESETS } = await fromSession(page, 'tables');
  for (const preset of STYLE_PRESETS) {
    await chooseStyle(page, preset.id);
    expect(await currentStyle(page), preset.id).toBe(preset.id);
    expect(await pressedTags(page), preset.id).toEqual(presetPressed[preset.id]);
  }
});

test('Klang-Schlagwort während der Wiedergabe: läuft ohne Neustart weiter, genau ein Player, kein neuer AudioContext', async ({ page }) => {
  await countContexts(page);
  await openPlayPage(page);
  await playFast(page);
  await expect(position(page)).toHaveText('Takt 2 von 96', { timeout: BAR_TIMEOUT });
  expect(await contexts(page)).toBe(1);
  expect(await sets(page)).toBe(1);
  await recordPositions(page);
  // nacheinander aus jeder der vier Klang-Kategorien; jeder Klick wirkt live, die Taktzeile läuft ohne Unterbrechung weiter
  for (const [category, tag] of [['drumSound', 'boomy'], ['bassSound', 'sub'], ['chordSound', 'tremolo'], ['padSound', 'moving']]) {
    await positionsSince(page); // erst leeren, dann den Takt lesen (wie oben)
    const before = await shownBar(page);
    await openTags(page);
    await page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`).click();
    await expect(page.locator(`#tags [data-tag="${tag}"]`)).toHaveAttribute('aria-pressed', 'true');
    await settled(page); // (wie oben)
    await expectContinuous(page, before, tag);
    expect(await contexts(page), tag).toBe(1);
    expect(await sets(page), `${tag}: kein neuer Instrumentensatz`).toBe(1);
    await expect(playGo(page)).toHaveText('Stopp');
  }
  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  expect(await contexts(page)).toBe(1);
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
  for (const [category, tag] of [['padSound', 'glassy'], ['chordSound', 'tremolo']]) {
    await positionsSince(page); // erst leeren, dann den Takt lesen (wie oben)
    const before = await shownBar(page);
    await openTags(page);
    await page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`).click();
    await expect(page.locator(`#tags [data-category="${category}"][data-tag="${tag}"]`)).toHaveAttribute('aria-pressed', 'true');
    await settled(page); // (wie oben)
    await expectContinuous(page, before, tag);
    expect(await contexts(page), tag).toBe(1);
    expect(await sets(page), `${tag}: kein neuer Instrumentensatz`).toBe(1);
  }
  // Muster-Schlagwort: der Ereignisstrom ändert sich und wird live getauscht, ohne Neustart und ohne neuen Instrumentensatz
  await positionsSince(page);
  let before = await shownBar(page);
  await openTags(page);
  await page.locator('#tags [data-category="drums"][data-tag="driving"]').click();
  await expect(page.locator('#tags [data-category="drums"][data-tag="driving"]')).toHaveAttribute('aria-pressed', 'false');
  await settled(page); // (wie oben)
  await expectContinuous(page, before, 'driving');
  expect(await sets(page), 'driving: kein neuer Instrumentensatz').toBe(1);
  // Stil aus den Werksprofilen: Tempo, Schlagworte und Klang werden live übernommen
  await positionsSince(page);
  before = await shownBar(page);
  await chooseStyle(page, 'funk');
  // der Stil war schon funk: den Beweis tragen die Schlagworte (driving war abgewählt) und das Tempo (vorher 200)
  expect(await pressedTags(page)).toEqual(presetPressed.funk);
  await settled(page); // (wie oben)
  await expectContinuous(page, before, 'funk');
  expect(await sets(page), 'funk: kein neuer Instrumentensatz').toBe(1);
  await expect(page.locator('#tuning-tempo')).toHaveValue('100');
  expect(await contexts(page)).toBe(1);
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
  expect(await sets(page), 'kein neuer Instrumentensatz').toBe(1);
  expect(await contexts(page)).toBe(1);
});
