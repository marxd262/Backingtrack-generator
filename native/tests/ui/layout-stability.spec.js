// Kopfzeile und Griffbrett springen nicht, wenn der Akkord wechselt (Spec-Antiziel "Das Layout springt"): lange und kurze
// Akkordnamen im Wechsel (As-Moll: Bbdim, E, Dbm, B), Lagen je Takt in einem einzigen evaluate gelesen, ohne Schlafzeiten.
// Portiert aus tests/e2e/layout-stability.spec.js: die App lädt ihre Seite und spielt den Song der Sitzung.
import { test, expect, answered, settled } from './fixture.js';
import { addChordByName } from './chord-helpers.js';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const PROGRESSION = ['Bbdim', 'E', 'Dbm', 'B'];
const WATCHED = ['play-go', 'play-position', 'play-back', 'mode-switch', 'fretboard', 'play-next'];

test.use({ locale: 'de-DE', reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#go')).toHaveText(/\S/);
});

const progression = (page) => page.locator('#progression button');
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
// gezählt, wenn die Seite die Antworten auf ihre Aktionen zeigt (die Seite der Web-App zeichnet sofort)
const count = async (page) => { await answered(page); return progression(page).count(); };

// Folge im Modul Harmonie setzen: bis auf einen Akkord entfernen, anfügen, den übrigen ersten entfernen
async function setProgression(page, names) {
  while (await count(page) > 1) await progression(page).first().click();
  for (const name of names) await addChordByName(page, name);
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(names);
}

// Takt und Lagen aller beobachteten Elemente im selben render()
const snapshot = (page, ids) => page.evaluate((list) => {
  const bar = Number(document.getElementById('play-position').textContent.match(/\d+/)?.[0] ?? 0);
  const boxes = Object.fromEntries(list.map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return [id, { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }];
  }));
  return { bar, now: document.getElementById('play-now').textContent, next: document.getElementById('play-next').textContent, boxes };
}, ids);

for (const width of [1280, 360]) {
  test(`${width} px: Kopfzeile und Griffbrett bleiben über fünf Takte mit langen und kurzen Akkordnamen auf 1 px stehen`, async ({ page }) => {
    await page.locator('#tune-btn').click();
    await page.locator('#key-select').selectOption('Ab');
    await page.locator('#scale-select').selectOption('minorPentatonic');
    await setProgression(page, PROGRESSION);
    await page.locator('#tuning-tempo').fill('200');
    await expect(page.locator('#tuning-tempo-out')).toHaveText('200 bpm');
    if (width === 360) {
      await page.setViewportSize({ width, height: 740 });
    }
    await page.locator('#play-go').click();

    // Schnappschüsse sammeln, bis fünf verschiedene Takte gesehen sind (vier Akkordwechsel, einer über die Naht)
    const seen = new Map();
    await expect.poll(async () => {
      const snap = await snapshot(page, WATCHED);
      if (snap.bar > 0 && !seen.has(snap.bar)) seen.set(snap.bar, snap);
      return seen.size;
    }, { timeout: 6 * BAR_TIMEOUT, intervals: [100] }).toBeGreaterThanOrEqual(5);
    await page.locator('#play-go').click();
    await settled(page); // die Seite steht wie nach dem Stopp der Web-App (die Prüfung auf waagerechtes Scrollen gälte auch vorher)

    const snaps = [...seen.values()];
    // die Folge wurde wirklich durchlaufen: alle vier Namen standen im Kopf
    expect(new Set(snaps.map((s) => s.now))).toEqual(new Set(PROGRESSION));
    const first = snaps[0];
    const moved = [];
    for (const snap of snaps) {
      for (const id of WATCHED) {
        for (const prop of ['x', 'y', 'width', 'height']) {
          const delta = Math.abs(snap.boxes[id][prop] - first.boxes[id][prop]);
          if (delta > 1) moved.push(`Takt ${snap.bar} (${snap.now}, ${snap.next}): #${id}.${prop} ${first.boxes[id][prop].toFixed(1)} -> ${snap.boxes[id][prop].toFixed(1)}`);
        }
      }
    }
    expect(moved).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

// Reservierter Platz reicht für das breiteste Etikett: kein Überlauf und kein Abschneiden bei 1280 und 360 px
test('breiteste Akkordnamen passen in den reservierten Platz, in beiden Sprachen', async ({ page }) => {
  await page.locator('#tune-btn').click();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const over = await page.evaluate(() => {
      const roots = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
      const names = roots.flatMap((r) => [r, `${r}m`, `${r}dim`]);
      const found = [];
      for (const [id, texts] of [['play-now', names], ['play-next', names]]) {
        const el = document.getElementById(id);
        const saved = el.textContent;
        const reserved = (() => { el.textContent = 'x'; return el.getBoundingClientRect().width; })();
        for (const text of texts) {
          el.textContent = text;
          const r = el.getBoundingClientRect();
          if (r.width > reserved + 0.5 || el.scrollWidth > el.clientWidth || r.right > document.documentElement.clientWidth) found.push(`${id}: ${text}`);
        }
        el.textContent = saved;
      }
      return found;
    });
    expect(over, `${width} px`).toEqual([]);
  }
});
