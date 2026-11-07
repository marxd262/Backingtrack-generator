// Griffbrett-Block der Spielseite: Rollen je Bund, Namen/Stufen, folgender Akkord, Textfassung, Breiten.
import { test, expect } from '@playwright/test';

const BAR_TIMEOUT = 10_000; // ein Takt bei 200 bpm dauert 1,2 s; unter Last großzügig
const RAW_KEY = /^(ui|tag|style|err|layer|scale|mode|category|view)\.[A-Za-z.]+$/;

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const note = (page, string, fret) => page.locator(`#fretboard .fret-note[data-string="${string}"][data-fret="${fret}"]`);
const playGo = (page) => page.locator('#play-go');
const position = (page) => page.locator('#play-position');
const shownChords = async (page) => (await page.locator('#chords').textContent()).split(' – ').map((s) => s.trim());
const progression = (page) => page.locator('#progression button');
const noScrollX = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// Feintuning: Spielseite mit beiden Leisten (bei 1280 px neben den Blöcken)
async function openPlayPage(page) {
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
}

// Folge über die rechte Leiste setzen: bis auf einen Akkord entfernen, anfügen, den übrigen ersten entfernen
async function setProgression(page, names) {
  while (await progression(page).count() > 1) await progression(page).first().click();
  for (const name of names) await page.locator('#add-chords button', { hasText: new RegExp(`^${name}$`) }).click();
  await progression(page).first().click();
  await expect.poll(() => shownChords(page)).toEqual(names);
}

async function playFast(page) {
  await page.locator('#quick-pick [data-style="funk"]').click();
  await page.locator('#tuning-tempo').fill('200');
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 1 von \d+$/, { timeout: BAR_TIMEOUT });
}

const roleHas = (...tokens) => new RegExp(tokens.map((tok) => `(?=.*\\b${tok}\\b)`).join(''));

test('im Stand: Rollen an der tiefen E-Saite für Am Am Dm E in A-Moll-Pentatonik', async ({ page }) => {
  await openPlayPage(page);
  await setProgression(page, ['Am', 'Am', 'Dm', 'E']);
  await expect(note(page, 5, 5)).toHaveAttribute('data-role', roleHas('both', 'root'));
  await expect(note(page, 5, 5)).toHaveText('A');
  await expect(note(page, 5, 0)).toHaveAttribute('data-role', roleHas('current'));
  await expect(note(page, 5, 0)).not.toHaveAttribute('data-role', roleHas('next'));
  await expect(note(page, 5, 0)).toHaveText('E');
  await expect(note(page, 5, 1)).toHaveAttribute('data-role', roleHas('next', 'outside'));
  await expect(note(page, 5, 1)).toBeVisible();
  await expect(note(page, 5, 1)).toHaveText('F');
  await expect(note(page, 5, 2)).toBeHidden();
  await expect(note(page, 5, 3)).toHaveAttribute('data-role', 'scale'); // G: nur Leiterton
  // je Saite 16 Positionen (Bund 0 bis 15), sechs Saiten
  await expect(page.locator('#fretboard .fret-note[data-string]')).toHaveCount(96);
  await expect(page.locator('#play-next')).toHaveText('Als Nächstes: Dm');
  await expect(page.locator('#fretboard-text')).toHaveText('Jetzt: Am (A, C, E). Als Nächstes: Dm (D, F, A)');
  await expect(page.getByRole('img', { name: /^Griffbrett/ })).toBeVisible();
  await expect(page.locator('#fretboard')).toHaveAccessibleName('Griffbrett'); // kurzer Name, die Beschreibung trägt das SVG
  for (const text of ['Leiterton', 'Jetziger Akkord', 'Grundton des jetzigen Akkords', 'Folgender Akkord', 'In beiden Akkorden', 'Akkordton außerhalb der Leiter']) {
    await expect(page.locator('#fretboard-legend')).toContainText(text);
  }
  // Farbe des folgenden Akkords in der Kopfzeile: Sekundärfarbe
  expect(await page.locator('#play-next').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(47, 111, 143)');
});

test('Namen/Stufen: Schalter im Blockkopf, aria-pressed, Wahl überlebt Neuladen', async ({ page }) => {
  await openPlayPage(page);
  const group = page.getByRole('group', { name: 'Beschriftung' });
  await expect(group.locator('#labels-names')).toHaveText('Namen');
  await expect(group.locator('#labels-degrees')).toHaveText('Stufen');
  await expect(page.locator('section[data-view="fretboard"] #labels-names')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#labels-degrees')).toHaveAttribute('aria-pressed', 'false');
  await expect(note(page, 5, 0)).toHaveText('E');
  await page.locator('#labels-degrees').click();
  await expect(note(page, 5, 0)).toHaveText('5');
  await expect(note(page, 5, 3)).toHaveText('b7');
  await expect(page.locator('#labels-degrees')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#labels-names')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('backingtrack.layout')).labels)).toBe('degrees');

  await page.reload();
  await openPlayPage(page);
  await expect(note(page, 5, 0)).toHaveText('5');
  await expect(page.locator('#labels-degrees')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#labels-names').click();
  await expect(note(page, 5, 0)).toHaveText('E');
  await expect(page.locator('#labels-names')).toHaveAttribute('aria-pressed', 'true');
});

// Ein Schnappschuss in einem einzigen evaluate: Takt, Akkorde, Kopfzeile, Textfassung und Rollen gehören zum selben render()
const snapshot = (page) => page.evaluate(() => {
  const role = (s, f) => document.querySelector(`#fretboard .fret-note[data-string="${s}"][data-fret="${f}"]`).getAttribute('data-role').split(' ');
  const text = (id) => document.getElementById(id).textContent;
  const bar = Number(text('play-position').match(/^Takt (\d+) von/)?.[1] ?? 0);
  return {
    bar, now: text('play-now'), next: text('play-next'), text: text('fretboard-text'),
    roles: { d: role(3, 0), e: role(5, 0), f: role(5, 1), gSharp: role(5, 4), a: role(5, 5) },
  };
});

test('beim Abspielen folgen die Rollen dem Akkord, die Kopfzeile zeigt den folgenden', async ({ page }) => {
  await openPlayPage(page);
  await setProgression(page, ['Am', 'Am', 'Dm', 'E']);
  await playFast(page);
  // Schnappschüsse sammeln, bis Takt 3 (Dm) und Takt 4 (E) gesehen sind; jeder muss zu seinem eigenen Takt passen
  const seen = {};
  const wrong = [];
  await expect.poll(async () => {
    const snap = await snapshot(page);
    const expected = ['Am', 'Am', 'Dm', 'E'][(snap.bar - 1) % 4];
    if (snap.now !== expected) wrong.push(`Takt ${snap.bar}: ${snap.now} statt ${expected}`);
    seen[snap.now] ??= snap;
    return Boolean(seen.Dm && seen.E);
  }, { timeout: 3 * BAR_TIMEOUT, intervals: [100] }).toBe(true);
  expect(wrong).toEqual([]);

  // Dm klingt, E folgt
  const dm = seen.Dm;
  expect(dm.next).toBe('Als Nächstes: E');
  expect(dm.text).toBe('Jetzt: Dm (D, F, A). Als Nächstes: E (E, G#, B)');
  expect(dm.roles.d).toEqual(expect.arrayContaining(['current', 'root']));
  expect(dm.roles.f).toEqual(expect.arrayContaining(['current', 'outside']));
  expect(dm.roles.a).toContain('current');
  expect(dm.roles.a).not.toContain('root');
  expect(dm.roles.e).toContain('next');
  // E klingt, über die Naht folgt Am
  const e = seen.E;
  expect(e.next).toBe('Als Nächstes: Am');
  expect(e.text).toBe('Jetzt: E (E, G#, B). Als Nächstes: Am (A, C, E)');
  expect(e.roles.e).toEqual(expect.arrayContaining(['both', 'root']));
  expect(e.roles.gSharp).toEqual(expect.arrayContaining(['current', 'outside']));
  expect(e.roles.d).toEqual(['scale']);

  await playGo(page).click();
  await expect(playGo(page)).toHaveText('Los');
  await expect(page.locator('#play-next')).toHaveText('Als Nächstes: Dm');
});

test('Folge aus einem einzigen Akkord: kein folgender, nur "Jetzt", auch beim Abspielen', async ({ page }) => {
  await openPlayPage(page);
  while (await progression(page).count() > 1) await progression(page).first().click();
  await expect(page.locator('#play-next')).toHaveText('');
  await expect(page.locator('#fretboard-text')).toHaveText(/^Jetzt: \S+ \([^)]+\)$/);
  await expect(page.locator('#fretboard .fret-note[data-role~="next"]')).toHaveCount(0);
  await expect(page.locator('#fretboard .fret-note[data-role~="current"]').first()).toBeVisible();
  await playFast(page);
  await expect(position(page)).toHaveText(/^Takt 2 von \d+$/, { timeout: BAR_TIMEOUT });
  await expect(page.locator('#play-next')).toHaveText('');
  await expect(page.locator('#fretboard-text')).not.toContainText('Als Nächstes');
  await playGo(page).click();
});

test('c-Moll: Notennamen mit Bs, nie mit Kreuzen', async ({ page }) => {
  await openPlayPage(page);
  await page.locator('#side-key-chips').getByRole('button', { name: 'C', exact: true }).click();
  await page.locator('#side-scale-chips').getByRole('button', { name: 'Moll-Pentatonik' }).click();
  await expect(note(page, 4, 1)).toHaveText('Bb'); // A-Saite, Bund 1
  await expect(note(page, 4, 1)).toBeVisible();
  await expect(note(page, 4, 6)).toHaveText('Eb');
  const names = await page.locator('#fretboard .fret-note:visible').allTextContents();
  expect(names).toContain('Bb');
  expect(names.filter((n) => n.includes('#'))).toEqual([]);
  await expect(page.locator('#fretboard-text')).not.toContainText('#');
  await page.locator('#labels-degrees').click();
  await expect(note(page, 4, 1)).toHaveText('b7');
  await expect(note(page, 4, 6)).toHaveText('b3');
});

test('Sprachwechsel: Legende, Schalter, Textfassung und Kopfzeile auf Englisch, keine rohen Schlüssel', async ({ page }) => {
  const rawKeys = () => page.evaluate((source) => {
    const re = new RegExp(source);
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (re.test(walker.currentNode.textContent.trim())) found.push(walker.currentNode.textContent);
    for (const el of document.querySelectorAll('*')) {
      for (const { name, value } of el.attributes) if ((name.startsWith('aria-') || name === 'title') && re.test(value)) found.push(`${name}=${value}`);
    }
    return found;
  }, RAW_KEY.source);
  await openPlayPage(page);
  await setProgression(page, ['Am', 'Am', 'Dm', 'E']);
  expect(await rawKeys()).toEqual([]);
  await page.locator('[data-lang="en"]').click();
  await expect(page.locator('#play-next')).toHaveText('Next: Dm');
  await expect(page.locator('#fretboard-text')).toHaveText('Now: Am (A, C, E). Next: Dm (D, F, A)');
  await expect(page.getByRole('group', { name: 'Labels' }).locator('#labels-names')).toHaveText('Names');
  await expect(page.locator('#labels-degrees')).toHaveText('Degrees');
  await expect(page.getByRole('img', { name: /^Fretboard/ })).toBeVisible();
  await expect(page.locator('#fretboard')).toHaveAccessibleName('Fretboard');
  for (const text of ['Scale note', 'Current chord', 'Root of the current chord', 'Next chord', 'In both chords', 'Chord note outside the scale']) {
    await expect(page.locator('#fretboard-legend')).toContainText(text);
  }
  await expect(page.locator('#fretboard-legend')).not.toContainText('Leiterton');
  expect(await rawKeys()).toEqual([]);
  await page.locator('#labels-degrees').click();
  expect(await rawKeys()).toEqual([]);
});

test('keine DOM-Schreibvorgänge im Griffbrett-Block über Takte ohne Akkordwechsel (Am Am Dm E, Takt 1 auf 2)', async ({ page }) => {
  await openPlayPage(page);
  await setProgression(page, ['Am', 'Am', 'Dm', 'E']);
  await page.locator('#quick-pick [data-style="funk"]').click();
  await page.locator('#tuning-tempo').fill('200');
  // Stand, Takt 1 und Takt 2 zeigen alle Am mit folgendem Dm. Jede Mutation wird mit dem Takt markiert, der beim
  // Schreiben in der Kopfzeile steht (Beobachter laufen direkt nach dem render() dieses Takts): so ist das Fenster durch
  // die Takte selbst bestimmt, nicht durch den Zeitpunkt des Auslesens.
  await page.evaluate(() => {
    window.__fretMutations = [];
    const count = (target) => new MutationObserver((list) => {
      const bar = document.getElementById('play-position').textContent;
      for (const m of list) window.__fretMutations.push({ target, bar });
    });
    const all = { attributes: true, childList: true, characterData: true, subtree: true };
    count('text').observe(document.getElementById('fretboard-text'), all);
    count('block').observe(document.querySelector('section[data-view="fretboard"]'), all);
    count('next').observe(document.getElementById('play-next'), all);
  });
  await playGo(page).click();
  await expect(position(page)).toHaveText(/^Takt 3 von \d+$/, { timeout: 2 * BAR_TIMEOUT });
  const log = await page.evaluate(() => window.__fretMutations);
  const at = (bar) => log.filter((m) => m.bar === bar).map((m) => m.target);
  expect(at(''), 'Stand').toEqual([]);
  expect(at('Takt 1 von 96'), 'Takt 1').toEqual([]);
  expect(at('Takt 2 von 96'), 'Takt 2').toEqual([]);
  // Gegenprobe: beim Wechsel auf Dm (Takt 3) wird neu geschrieben
  expect(at('Takt 3 von 96')).toEqual(expect.arrayContaining(['text', 'next', 'block']));
  await playGo(page).click();
});

// Zeichen einer Rolle ohne Farbe: Form (Rundung, Drehung), gefüllt, blass, gestrichelt, Außenring
const signatures = (page, selector) => page.evaluate((sel) => {
  const paper = getComputedStyle(document.body).backgroundColor;
  return [...document.querySelectorAll(sel)].map((g) => {
    const dot = getComputedStyle(g.querySelector('.dot'));
    const ring = g.querySelector('.ring');
    return {
      role: g.getAttribute('data-role'),
      fill: dot.fill,
      stroke: dot.stroke,
      sig: JSON.stringify({
        rx: dot.rx, transform: dot.transform, filled: dot.fill !== paper, pale: Number(dot.fillOpacity) < 1,
        dashed: dot.strokeDasharray !== 'none', ring: ring !== null && getComputedStyle(ring).display !== 'none',
      }),
    };
  });
}, selector);
const ACCENTS = ['rgb(200, 69, 45)', 'rgb(47, 111, 143)'];

test('Legende: jede Rolle hat ohne Farbe ein eigenes Zeichen, "außerhalb" ist neutral und passt zu beiden Akkorden', async ({ page }) => {
  await openPlayPage(page);
  const legend = await signatures(page, '#fretboard-legend .fret-note');
  expect(legend.map((l) => l.role)).toEqual(['scale', 'current', 'current root', 'next', 'both', 'outside']);
  const bySig = Object.groupBy(legend, (l) => l.sig);
  expect(Object.values(bySig).filter((group) => group.length > 1).map((group) => group.map((l) => l.role))).toEqual([]);
  // neutral: keine Rollenfarbe, gestrichelt und blass
  const outside = legend.find((l) => l.role === 'outside');
  expect(ACCENTS).not.toContain(outside.fill);
  expect(ACCENTS).not.toContain(outside.stroke);
  expect(JSON.parse(outside.sig)).toMatchObject({ dashed: true, pale: true });
  // auf dem Brett: Akkordton außerhalb beim jetzigen (F in Dm) und beim folgenden (G# in E) gestrichelt und blass
  await setProgression(page, ['Dm', 'E']);
  await expect(note(page, 5, 1)).toHaveAttribute('data-role', roleHas('current', 'outside'));
  await expect(note(page, 5, 4)).toHaveAttribute('data-role', roleHas('next', 'outside'));
  const board = await signatures(page, '#fretboard .fret-note[data-string="5"]:is([data-fret="1"], [data-fret="4"])');
  for (const n of board) expect(JSON.parse(n.sig), n.role).toMatchObject({ dashed: true, pale: true });
  // Formen wie in der Legende: jetzig rund, folgend eckig
  const shape = (sig) => { const { rx, transform } = JSON.parse(sig); return { rx, transform }; };
  expect(shape(board[0].sig)).toEqual(shape(legend.find((l) => l.role === 'current').sig));
  expect(shape(board[1].sig)).toEqual(shape(legend.find((l) => l.role === 'next').sig));
});

test('Graustufen: ein Ton in beiden Akkorden sieht anders aus als ein Ton nur im jetzigen (C, dann Am)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlayPage(page);
  await setProgression(page, ['C', 'Am']);
  // E (tiefe E-Saite leer) in C und Am, G (Bund 3) nur in C; beide ohne Grundton-Ring
  await expect(note(page, 5, 0)).toHaveAttribute('data-role', 'scale both');
  await expect(note(page, 5, 3)).toHaveAttribute('data-role', 'scale current');
  const board = await signatures(page, '#fretboard .fret-note[data-string="5"][data-fret="0"]');
  expect(board[0].sig).toBe((await signatures(page, '#fretboard-legend .fret-note[data-role="both"]'))[0].sig);
  // Graustufen, ohne Beschriftung und ohne Saiten/Bünde (Buchstaben und Linien unterscheiden sich ohnehin): nur das Zeichen zählt
  await page.addStyleTag({ content: '#fretboard { filter: grayscale(1); } #fretboard :is(.fret-note text, .string, .fret-wire, .nut, .board, .inlay) { visibility: hidden; }' });
  const shot = async (fret) => {
    const b = await note(page, 5, fret).locator('.dot').boundingBox();
    const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
    return (await page.screenshot({ clip: { x: Math.round(cx) - 18, y: Math.round(cy) - 18, width: 36, height: 36 } })).toString('base64');
  };
  // Formmaß der dunklen Fläche: Breite / Wurzel(Fläche); Kreis 2/Wurzel(Pi) = 1,13, Quadrat 1,0, Raute Wurzel(2) = 1,41.
  // Größe und Strichstärke fallen heraus: ein dicker Kreis bleibt ein Kreis (so sah "beide" vorher aus).
  const form = (data) => page.evaluate(async (png) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let [count, left, right] = [0, Infinity, -Infinity];
    for (let i = 0; i < px.length / 4; i++) {
      if (px[4 * i] >= 200) continue; // Papier ist hell (um 246), die gefüllten Zeichen dunkel (um 95)
      count++;
      left = Math.min(left, i % bitmap.width);
      right = Math.max(right, i % bitmap.width);
    }
    return (right - left + 1) / Math.sqrt(count);
  }, data);
  const [both, current] = [await form(await shot(0)), await form(await shot(3))];
  expect(current).toBeCloseTo(1.13, 1);
  expect(Math.abs(both - current), `Formmaß beide ${both.toFixed(2)}, jetzig ${current.toFixed(2)}`).toBeGreaterThan(0.15);
});

test('360 px: Seite ohne waagerechtes Scrollen, das Griffbrett scrollt in sich und ist per Tastatur erreichbar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openPlayPage(page);
  await page.keyboard.press('Escape'); // schmal öffnet Feintuning die Klang-Schublade (modal)
  const region = page.locator('#fretboard');
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAttribute('role', 'region');
  const sizes = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  // sichtbare (schmale) Bildlaufleiste als Hinweis, dass das Griffbrett weitergeht
  expect(await region.evaluate((el) => { const s = getComputedStyle(el); return { x: s.overflowX, bar: s.scrollbarWidth }; }))
    .toEqual({ x: expect.stringMatching(/^(auto|scroll)$/), bar: 'thin' });
  expect(await noScrollX(page)).toBe(true);
  const box = await region.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  // Tab aus dem Blockkopf erreicht den Bereich; Pfeil rechts scrollt ihn
  await page.locator('#labels-degrees').focus();
  await page.keyboard.press('Tab');
  await expect(region).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await noScrollX(page)).toBe(true);
});

test('1280 px mit beiden Leisten: alle 16 Bünde ohne inneres Scrollen, Griffbrett füllt die Breite', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPlayPage(page);
  const region = page.locator('#fretboard');
  const sizes = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  const [svg, area, last] = [await page.locator('#fretboard svg').boundingBox(), await region.boundingBox(), await note(page, 0, 15).boundingBox()];
  expect(Math.abs(svg.width - area.width)).toBeLessThanOrEqual(1);
  expect(last.x + last.width).toBeLessThanOrEqual(area.x + area.width);
  expect(await noScrollX(page)).toBe(true);
});
