// Gesamtdurchgang Start- und Spielseite in Deutsch und Englisch: Ablauf Los/Stopp über beide Seiten, Sprachwechsel bei
// offener Leiste und laufender Wiedergabe, 360 px, alle Stile und Leitern, Randfälle der Folge.
// Alles, was an einem laufenden Takt hängt, wird in einem einzigen evaluate gelesen (Schnappschuss) und nie mit Schlafzeiten
// abgepasst: Takte kommen aus #play-position.
import { test, expect } from '@playwright/test';
import { addChordByName } from './chord-helpers.js';
import { chooseStyle, currentStyle } from './style-helpers.js';
import de from '../../src/i18n/de.js';
import en from '../../src/i18n/en.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view|group|timbre|chord|chordGroup|chordColor|groove|meter)\.[A-Za-z.]+$/;
const PROGRESSION = ['Am', 'Am', 'Dm', 'E'];

const TEXT = {
  'de-DE': { lang: 'de', go: 'Los', stop: 'Stopp', toPlay: 'Zur Spielseite', now: 'Jetzt', next: 'Als Nächstes', bar: /^Takt (\d+) von (\d+)$/, other: 'en' },
  'en-US': { lang: 'en', go: 'Go', stop: 'Stop', toPlay: 'To play page', now: 'Now', next: 'Next', bar: /^Bar (\d+) of (\d+)$/, other: 'de' },
};

// Rollen der Töne je Akkord für Am Am Dm E in A-Moll-Pentatonik (feste Tabelle, nicht aus dem Code abgeleitet):
// D-Saite leer (3,0), tiefe E-Saite leer (5,0), F (5,1), G# (5,4), A (5,5); leer = Position nicht sichtbar
const TABLE = {
  Am: { next: 'Dm', d: ['next', 'scale'], e: ['current', 'scale'], f: ['next', 'outside'], gSharp: [], a: ['both', 'root', 'scale'] },
  Dm: { next: 'E', d: ['current', 'root', 'scale'], e: ['next', 'scale'], f: ['current', 'outside'], gSharp: ['next', 'outside'], a: ['current', 'scale'] },
  E: { next: 'Am', d: ['scale'], e: ['both', 'root', 'scale'], f: [], gSharp: ['current', 'outside'], a: ['next', 'scale'] },
};

let problems;

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const playGo = (page) => page.locator('#play-go');
const progression = (page) => page.locator('#progression button');
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// Feintuning: Spielseite mit beiden Leisten (1280 px: neben den Blöcken)
async function openPlayPage(page) {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
}

// Folge über die rechte Leiste setzen (bis auf einen entfernen, anfügen, den übrigen ersten entfernen); Tonart und Leiter bleiben
async function setProgression(page, names) {
  while (await progression(page).count() > 1) await progression(page).first().click();
  for (const name of names) await addChordByName(page, name);
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(names);
}

async function setTempoFast(page) {
  await page.locator('#tuning-tempo').fill('200');
  await expect(page.locator('#tuning-tempo-out')).toHaveText('200');
}

// Alles, was zu einem Takt gehört, in einem Zug gelesen: gehört garantiert zum selben render()
const snapshot = (page) => page.evaluate(() => {
  const role = (s, f) => document.querySelector(`#fretboard .fret-note[data-string="${s}"][data-fret="${f}"]`).getAttribute('data-role').split(' ').filter(Boolean).sort();
  const text = (id) => document.getElementById(id).textContent;
  const bar = Number(text('play-position').match(/\d+/)?.[0] ?? 0);
  return {
    bar, now: text('play-now'), next: text('play-next'), text: text('fretboard-text'),
    roles: { d: role(3, 0), e: role(5, 0), f: role(5, 1), gSharp: role(5, 4), a: role(5, 5) },
  };
});

// Schnappschüsse sammeln, bis done(seen) wahr ist (Takt 0 = noch kein Takt gemeldet, wird übergangen)
async function collect(page, done, timeout) {
  const seen = [];
  await expect.poll(async () => {
    const snap = await snapshot(page);
    if (snap.bar > 0) seen.push(snap);
    return done(seen);
  }, { timeout, intervals: [100] }).toBe(true);
  return seen;
}

// Sichtbare rohe Schlüsselnamen: alle Textknoten (auch SVG-Text, auch versteckte Seiten), alle aria-Attribute, title, Dokumenttitel
const rawKeys = (page) => page.evaluate((source) => {
  const re = new RegExp(source);
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
  for (const el of document.querySelectorAll('*')) {
    for (const { name, value } of el.attributes) if ((name.startsWith('aria-') || name === 'title') && re.test(value)) found.push(`${name}=${value}`);
  }
  if (re.test(document.title)) found.push(`title=${document.title}`);
  return found;
}, RAW_KEY.source);

// Gegenprobe zur Suche nach rohen Schlüsseln: eingeschleuste Schlüssel in aria-label, Textknoten und SVG-Text werden gemeldet
test.describe('Suche nach rohen Schlüsseln', () => {
  test.use({ locale: 'de-DE' });

  test('findet eingeschleuste Schlüssel in aria-label, Text und SVG-Text, danach wieder nichts', async ({ page }) => {
    await openPlayPage(page);
    expect(await rawKeys(page)).toEqual([]);
    await page.evaluate(() => {
      document.getElementById('play-back').setAttribute('aria-label', 'view.fretboard');
      document.getElementById('blocks').append(Object.assign(document.createElement('p'), { id: 'raw-probe', textContent: 'view.lanes' }));
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.id = 'raw-probe-svg';
      text.textContent = 'ui.legendBoth';
      document.querySelector('#fretboard svg').append(text);
    });
    expect((await rawKeys(page)).sort()).toEqual(['aria-label=view.fretboard', 'ui.legendBoth', 'view.lanes']);
    await page.evaluate(() => {
      document.getElementById('play-back').removeAttribute('aria-label');
      document.getElementById('raw-probe').remove();
      document.getElementById('raw-probe-svg').remove();
    });
    expect(await rawKeys(page)).toEqual([]);
  });
});

for (const [locale, L] of Object.entries(TEXT)) {
  test.describe(locale, () => {
    test.use({ locale, reducedMotion: 'reduce' });

    test('Start, Los, Spielseite mit laufendem Griffbrett; zurück: Stopp, Zur Spielseite, Stopp', async ({ page }) => {
      // Folge und Tempo vorab über Feintuning (beide Leisten gemerkt offen), dann der eigentliche Ablauf über Los
      await openPlayPage(page);
      await setProgression(page, PROGRESSION);
      await setTempoFast(page);
      await page.locator('#play-back').click();
      await expect(page.locator('#start')).toBeVisible();
      await expect(page.locator('#to-play')).toBeHidden();

      await page.locator('#go').click();
      await expect(page.locator('#play')).toBeVisible();
      await expect(playGo(page)).toHaveText(L.stop);

      // Rollen folgen dem Takt: jeder Schnappschuss muss zur Tabelle seines Akkords passen; gesehen werden alle vier Takte der Folge
      const wrong = [];
      const seen = await collect(page, (s) => new Set(s.map((x) => (x.bar - 1) % 4)).size === 4, 4 * BAR_TIMEOUT);
      for (const snap of seen) {
        const name = PROGRESSION[(snap.bar - 1) % 4];
        const row = TABLE[name];
        const want = { now: name, next: `${L.next}: ${row.next}`, roles: { d: row.d, e: row.e, f: row.f, gSharp: row.gSharp, a: row.a } };
        const got = { now: snap.now, next: snap.next, roles: snap.roles };
        if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ bar: snap.bar, got, want });
      }
      expect(wrong).toEqual([]);
      const dm = seen.find((s) => s.now === 'Dm');
      expect(dm.text).toBe(`${L.now}: Dm (D, F, A). ${L.next}: E (E, G#, B)`);

      // zurück zur Startseite: die Wiedergabe läuft weiter
      await page.locator('#play-back').click();
      await expect(page.locator('#start')).toBeVisible();
      await expect(page.locator('#go')).toHaveText(L.stop);
      await expect(page.locator('#to-play')).toBeVisible();
      await expect(page.locator('#to-play')).toHaveText(L.toPlay);
      await expect.poll(() => page.locator('#now-chord').textContent(), { timeout: BAR_TIMEOUT }).toMatch(/^(Am|Dm|E)$/);
      await expect(page.locator('#position')).toHaveText(L.bar);

      await page.locator('#to-play').click();
      await expect(page.locator('#play')).toBeVisible();
      await expect(playGo(page)).toHaveText(L.stop);
      await expect.poll(() => page.locator('#play-now').textContent(), { timeout: BAR_TIMEOUT }).toMatch(/^(Am|Dm|E)$/);

      // Stopp auf der Startseite: kein Akkord mehr, kein "Zur Spielseite"
      await page.locator('#play-back').click();
      await page.locator('#go').click();
      await expect(page.locator('#go')).toHaveText(L.go);
      await expect(page.locator('#now-chord')).toHaveText('');
      await expect(page.locator('#position')).toHaveText('');
      await expect(page.locator('#to-play')).toBeHidden();
      await expect(page.locator('#start')).toBeVisible();
    });

    test('Sprachwechsel bei offenen Leisten und laufender Wiedergabe: kein roher Schlüssel, Fokus bleibt auf dem Schalter', async ({ page }) => {
      await openPlayPage(page);
      await expect(page.locator('#side-left')).toBeVisible();
      await expect(page.locator('#side-right')).toBeVisible();
      await setProgression(page, PROGRESSION);
      await setTempoFast(page);
      await playGo(page).click();
      await expect(playGo(page)).toHaveText(L.stop);
      await expect(page.locator('#views input[type="checkbox"]')).toHaveCount(2);
      await expect(page.locator('#views')).toBeVisible();
      expect(await rawKeys(page), 'Ausgangssprache').toEqual([]);

      for (const lang of [L.other, L.lang]) {
        const button = page.locator(`[data-lang="${lang}"]`);
        await button.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        expect(await page.evaluate(() => document.activeElement?.dataset.lang ?? document.activeElement?.tagName), `Fokus nach Wechsel auf ${lang}`).toBe(lang);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(await rawKeys(page), `Spielseite ${lang}`).toEqual([]);
        // die Leisten sind weiter offen und gefüllt
        await expect(page.locator('#views')).toBeVisible();
        await expect(page.locator('#side-right #progression button')).toHaveCount(PROGRESSION.length);
      }

      // Wechsel mit der Maus auf der Startseite, während gespielt wird
      await page.locator('#play-back').click();
      await expect(page.locator('#to-play')).toBeVisible();
      for (const lang of [L.other, L.lang]) {
        await page.locator(`[data-lang="${lang}"]`).click();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        expect(await page.evaluate(() => document.activeElement?.dataset.lang), `Fokus Startseite ${lang}`).toBe(lang);
        expect(await rawKeys(page), `Startseite ${lang}`).toEqual([]);
        await expect(page.locator('#to-play')).toBeVisible();
      }
      await page.locator('#go').click();
      await expect(page.locator('#go')).toHaveText(L.go);
    });

    test('Akkordwechsel bei offenen Leisten schreiben keine Knoten in die Leisten (Takt 2 bis 4: Am, Dm, E)', async ({ page }) => {
      await openPlayPage(page);
      await setProgression(page, PROGRESSION);
      await setTempoFast(page);
      // Jede Veränderung wird mit dem Takt markiert, der beim Schreiben in der Kopfzeile steht (Beobachter laufen direkt nach
      // dem render() dieses Takts); aria-current der Folge wandert je Takt absichtlich und wird nur gezählt, nicht bemängelt.
      await page.evaluate(() => {
        window.__asideLog = [];
        window.__asideCurrent = 0;
        const watch = (target) => new MutationObserver((list) => {
          const bar = document.getElementById('play-position').textContent.match(/\d+/)?.[0] ?? '';
          for (const m of list) {
            if (m.type === 'attributes' && m.attributeName === 'aria-current') window.__asideCurrent++;
            else window.__asideLog.push({ target, bar, type: m.type, attribute: m.attributeName });
          }
        });
        const all = { attributes: true, childList: true, characterData: true, subtree: true };
        for (const id of ['side-left', 'side-right']) watch(id).observe(document.getElementById(id), all);
        window.__nextLog = [];
        new MutationObserver(() => window.__nextLog.push(document.getElementById('play-position').textContent.match(/\d+/)?.[0] ?? ''))
          .observe(document.getElementById('play-next'), { childList: true, characterData: true, subtree: true });
      });
      await playGo(page).click();
      await collect(page, (seen) => seen.at(-1)?.bar >= 5, 3 * BAR_TIMEOUT);
      const log = await page.evaluate(() => ({ aside: window.__asideLog, next: window.__nextLog, current: window.__asideCurrent }));
      expect(log.aside.filter((m) => ['2', '3', '4'].includes(m.bar))).toEqual([]);
      // Gegenprobe: die Beobachter sind scharf (Kopfzeile ändert sich beim Wechsel auf Dm, aria-current wandert in der Leiste)
      expect(log.next).toContain('3');
      expect(log.current).toBeGreaterThan(2);
      await playGo(page).click();
    });

    test('360 px: Schublade ohne waagerechtes Scrollen und im Fenster, danach das Griffbrett sichtbar', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.locator('#go').click();
      await expect(page.locator('#play')).toBeVisible();
      await expect(playGo(page)).toHaveText(L.stop);
      for (const side of ['left', 'right']) {
        await page.locator(`#toggle-${side}`).click();
        await expect(page.locator(`#side-${side}`)).toBeVisible();
        const drawer = await page.locator(`#side-${side}`).boundingBox();
        expect(drawer.x, side).toBeGreaterThanOrEqual(0);
        expect(drawer.x + drawer.width, side).toBeLessThanOrEqual(360);
        expect(drawer.y + drawer.height, side).toBeLessThanOrEqual(740);
        expect(await noScrollX(page), `${side} offen`).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.locator(`#side-${side}`)).toBeHidden();
        const block = await page.locator('section[data-view="fretboard"]').boundingBox();
        await expect(page.locator('section[data-view="fretboard"]')).toBeVisible();
        await expect(page.locator('#fretboard svg')).toBeVisible();
        expect(block.x, side).toBeGreaterThanOrEqual(0);
        expect(block.x + block.width, side).toBeLessThanOrEqual(360);
        expect(await noScrollX(page), `${side} zu`).toBe(true);
      }
      await playGo(page).click();
      await expect(playGo(page)).toHaveText(L.go);
    });

    test('alle drei Stile und alle vier Leitern auf der Spielseite: Leiterton auf jeder Saite, Akkord im Text, Startseite stimmt überein', async ({ page }) => {
      await openPlayPage(page);
      const pressedText = (selector) => page.locator(`${selector} [aria-pressed="true"]`).first().textContent();
      for (const style of ['funk', 'psych', 'dreamy']) {
        for (const scale of ['minorPentatonic', 'majorPentatonic', 'blues', 'dorian']) {
          const label = `${style} + ${scale}`;
          await chooseStyle(page, style);
          await page.locator(`#side-scale-chips [data-scale="${scale}"]`).click();
          expect(await currentStyle(page), label).toBe(style);
          await expect(page.locator(`#side-scale-chips [data-scale="${scale}"]`), label).toHaveAttribute('aria-pressed', 'true');

          // je Saite mindestens ein sichtbarer Leiterton
          const perString = await page.evaluate(() => [0, 1, 2, 3, 4, 5].map((s) => [...document.querySelectorAll(`#fretboard .fret-note[data-string="${s}"]`)]
            .filter((g) => !g.hasAttribute('hidden') && g.checkVisibility() && g.getAttribute('data-role').split(' ').includes('scale')).length));
          expect(perString.map((n) => n > 0), label).toEqual([true, true, true, true, true, true]);

          // Textfassung nennt den ersten Akkord der Folge (im Stand der jetzige)
          const chords = await shownChords(page);
          await expect(page.locator('#fretboard-text'), label).toHaveText(new RegExp(`^${L.now}: ${chords[0]} \\(`));
          expect(await progression(page).allTextContents(), label).toEqual(chords);

          // zurück zur Startseite: Satz, Stil, Tempo, Folge und Auswahl im Popover zeigen dasselbe wie die Leisten
          const expected = {
            key: await pressedText('#side-key-chips'),
            scale: await pressedText('#side-scale-chips'),
            style: ({ de, en })[L.lang][`style.${await currentStyle(page)}`],
            tempo: await page.locator('#tuning-tempo-out').textContent(),
          };
          await page.locator('#play-back').click();
          await expect(page.locator('#start')).toBeVisible();
          await expect(page.locator('#key-btn'), label).toContainText(expected.key);
          await expect(page.locator('#key-btn'), label).toContainText(expected.scale);
          await expect(page.locator('#style-btn'), label).toHaveText(expected.style);
          await expect(page.locator('#tempo-btn'), label).toContainText(expected.tempo);
          expect(await shownChords(page), label).toEqual(chords);
          await expect(page.locator(`#scale-chips [data-scale="${scale}"]`), label).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator(`#style-cards [data-style="${style}"]`), label).toHaveAttribute('aria-pressed', 'true');
          await page.locator('#tune-btn').click();
          await expect(page.locator('#play')).toBeVisible();
        }
      }
    });
  });
}

test.describe('Randfälle der Folge', () => {
  test.describe('einziger Akkord (en-US)', () => {
    test.use({ locale: 'en-US', reducedMotion: 'reduce' });

    test('nur ein Akkord, Wiedergabe an: kein Fehler, kein folgender Akkord über mehrere Takte', async ({ page }) => {
      await openPlayPage(page);
      while (await progression(page).count() > 1) await progression(page).first().click();
      await expect(progression(page)).toHaveCount(1);
      await setTempoFast(page);
      await playGo(page).click();
      await expect(playGo(page)).toHaveText('Stop');
      const seen = await collect(page, (s) => s.at(-1)?.bar >= 3, 3 * BAR_TIMEOUT);
      for (const snap of seen) {
        expect(snap.next, `Bar ${snap.bar}`).toBe('');
        expect(snap.text, `Bar ${snap.bar}`).not.toContain('Next');
        expect(snap.now, `Bar ${snap.bar}`).toBe((await shownChords(page))[0]);
      }
      await playGo(page).click();
    });
  });

  test.describe('Länge 24 mit fünf Akkorden (de-DE)', () => {
    test.use({ locale: 'de-DE', reducedMotion: 'reduce' });

    // An der Naht (Takt 24) ist der folgende Akkord der erste der Folge (hörbar), nicht der fünfte (zyklisch).
    // Ein Durchlauf dauert bei 200 bpm 24 * 1,2 s, daher die lange Frist.
    test('an der Naht ist der folgende Akkord der erste der Folge', async ({ page }) => {
      test.setTimeout(180_000);
      const names = ['Am', 'Dm', 'E', 'F', 'G'];
      await openPlayPage(page);
      await setProgression(page, names);
      await page.locator('#length').selectOption('24');
      await expect(page.locator('#length')).toHaveValue('24');
      await setTempoFast(page);
      await playGo(page).click();
      await expect(page.locator('#play-position')).toHaveText(/^Takt \d+ von 24$/, { timeout: BAR_TIMEOUT });

      const wrong = [];
      const seen = await collect(page, (s) => s.some((x) => x.bar === 24), 120_000);
      for (const snap of seen) {
        const now = names[(snap.bar - 1) % 5];
        const next = names[snap.bar % 24 % 5]; // nach Takt 24 folgt wieder Takt 1, nicht der sechste Akkord
        if (snap.now !== now || snap.next !== `Als Nächstes: ${next}`) wrong.push({ bar: snap.bar, now: snap.now, next: snap.next, want: [now, next] });
      }
      expect(wrong).toEqual([]);
      const seam = seen.find((s) => s.bar === 24);
      expect(seam.now).toBe('F');
      expect(seam.next).toBe('Als Nächstes: Am');
      await playGo(page).click();
    });
  });
});
