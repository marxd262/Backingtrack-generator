// Drehknopf und LCD-Auswahl in der echten Seite (/ui/index.html): Komplexität ist der erste echte Drehknopf.
import { test, expect } from '@playwright/test';

let problems;

test.use({ locale: 'de-DE' });

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {};
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/ui/index.html');
  await expect(page.locator('#go')).toHaveText(/\S/);
  await page.locator('#tune-btn').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#rack')).toBeVisible(); // Feintuning öffnet den Zustand Einstellen
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

const complexity = (page) => page.locator('#complexity');
const knob = (page) => page.locator('.knob', { has: page.locator('#complexity') });
const arc = (page) => knob(page).locator('.knob-arc');
const center = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('Komplexität ist ein Schieberegler mit Beschriftung, per Tab erreichbar, der Fokusring sitzt am Knopf', async ({ page }) => {
  await expect(page.getByRole('slider', { name: 'Komplexität' })).toHaveCount(1);
  await page.locator('#groove-select').focus();
  await page.keyboard.press('Tab');
  // die Tasten ‹ › am Display sind keine Tab-Halte (die Pfeiltasten am Select schalten weiter)
  await expect(complexity(page)).toBeFocused();
  expect(await knob(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
});

test('Pfeil hoch erhöht um 1, aria-valuetext folgt, der Zeiger dreht mit', async ({ page }) => {
  await complexity(page).focus();
  const turn = () => knob(page).locator('svg g').getAttribute('transform');
  const before = await turn();
  await page.keyboard.press('ArrowUp');
  await expect(complexity(page)).toHaveValue('51');
  await expect(complexity(page)).toHaveAttribute('aria-valuetext', '51 %');
  expect(await turn()).not.toBe(before);
});

test('Ziehen: 100 px nach oben sind 50 Punkte, Doppelklick setzt auf 50 zurück', async ({ page }) => {
  await complexity(page).fill('20');
  const { x, y } = await center(knob(page));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 50, { steps: 5 });
  await page.mouse.move(x, y - 100, { steps: 5 });
  await page.mouse.up();
  await expect(complexity(page)).toHaveValue('70');
  await expect(page.locator('#complexity-out')).toHaveText('70 %');
  await knob(page).dblclick();
  await expect(complexity(page)).toHaveValue('50');
});

test('Mausrad: je Raste ein Schritt', async ({ page }) => {
  const { x, y } = await center(knob(page));
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -100);
  await expect(complexity(page)).toHaveValue('51');
  await page.mouse.wheel(0, 100);
  await expect(complexity(page)).toHaveValue('50');
});

test('Umschalt+Mausrad ändert den Wert nicht (scrollt das Rack)', async ({ page }) => {
  const { x, y } = await center(knob(page));
  await page.mouse.move(x, y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  await expect(complexity(page)).toHaveValue('50');
});

test('während der Wiedergabe bleibt der gehaltene Knopf stehen, auch wenn render() je Takt läuft', async ({ page }) => {
  await page.locator('#tuning-tempo').fill('200'); // ein Takt 1,2 s
  await page.locator('#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  const { x, y } = await center(knob(page));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 }); // +30
  await expect(complexity(page)).toHaveValue('80');
  const bar = await page.locator('#play-position').textContent();
  await expect(page.locator('#play-position')).not.toHaveText(bar); // mindestens ein Takt (und render) später
  const later = await page.locator('#play-position').textContent();
  await expect(page.locator('#play-position')).not.toHaveText(later);
  await expect(complexity(page)).toHaveValue('80');
  await page.mouse.up();
  await expect(complexity(page)).toHaveValue('80');
  await page.locator('#play-go').click();
});

test('Bogen: bei 50 keiner, rechts der Mitte pink, links türkis', async ({ page }) => {
  await expect(arc(page)).toHaveCount(0);
  await complexity(page).fill('80');
  await expect(arc(page)).toHaveCount(1);
  expect(await arc(page).evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(227, 70, 94)');
  await complexity(page).fill('20');
  expect(await arc(page).evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(24, 162, 166)');
  await complexity(page).fill('50');
  await expect(arc(page)).toHaveCount(0);
});

test('LCD-Auswahl: Tasten springen über deaktivierte Einträge, am Ende deaktiviert, Select bleibt echt', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createLcdSelect, syncLcdSelects } = await import('/ui/lcd-select.js');
    const select = document.createElement('select');
    select.innerHTML = '<option value="a">A</option><option value="b" disabled>B</option><option value="c">C</option>';
    document.body.append(select);
    createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
    const [prev, next] = select.parentElement.querySelectorAll('button');
    const seen = [];
    select.addEventListener('change', () => seen.push(select.value));
    const out = { start: [prev.disabled, next.disabled], keys: [prev.dataset.i18nLabel, next.dataset.i18nLabel], types: [prev.type, next.type] };
    next.click();
    out.afterNext = [select.value, prev.disabled, next.disabled];
    next.click(); // am Ende: nichts
    out.beyond = select.value;
    select.selectedIndex = 0; // von außen geändert
    syncLcdSelects();
    out.synced = [prev.disabled, next.disabled];
    out.seen = seen;
    out.isSelect = select.tagName;
    select.parentElement.remove();
    return out;
  });
  expect(result.start).toEqual([true, false]);
  expect(result.keys).toEqual(['ui.lcdPrev', 'ui.lcdNext']);
  expect(result.types).toEqual(['button', 'button']);
  expect(result.afterNext).toEqual(['c', false, true]);
  expect(result.beyond).toBe('c');
  expect(result.synced).toEqual([true, false]);
  expect(result.seen).toEqual(['c']);
  expect(result.isSelect).toBe('SELECT');
});

test('entfernte Knöpfe und LCD-Auswahlen fallen aus der Liste: syncKnobs/syncLcdSelects zeichnen sie nicht mehr nach', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createKnob, syncKnobs } = await import('/ui/knob.js');
    const { createLcdSelect, syncLcdSelects } = await import('/ui/lcd-select.js');
    const input = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', value: '0' });
    const select = document.createElement('select');
    select.innerHTML = '<option>a</option><option>b</option>';
    document.body.append(input, select);
    createKnob(input, { origin: 'start' });
    createLcdSelect(select, { prevKey: 'ui.lcdPrev', nextKey: 'ui.lcdNext' });
    const wrap = input.parentElement, lcd = select.parentElement;
    const pointer = () => wrap.querySelector('g').getAttribute('transform');
    const [prev, next] = lcd.querySelectorAll('button');
    const before = [pointer(), prev.disabled, next.disabled];
    wrap.remove();
    lcd.remove();
    input.value = '100'; // ohne input-Ereignis: nur ein sync könnte das Bild ändern
    select.selectedIndex = 1;
    syncKnobs();
    syncLcdSelects();
    return { before, after: [pointer(), prev.disabled, next.disabled] };
  });
  expect(result.after).toEqual(result.before);
});
