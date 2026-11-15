// Screenshots aller Hauptansichten und Zustände der Oberfläche in mehreren Breiten, dazu Messwerte (metrics.json).
// Aufruf: node scripts/ui-screens.mjs [tag] [nur-breite]   → .superpowers/ui-screens/<tag>/<breite>-<ansicht>.png (nicht eingecheckt)
// Die App hat nur ein Thema (Rack-Look), also kein hell/dunkel.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { start } from './serve.js';

const tag = process.argv[2] ?? 'current';
const only = Number(process.argv[3]) || null;
const out = new URL(`../.superpowers/ui-screens/${tag}/`, import.meta.url);
const SIZES = [[1440, 900], [1024, 768], [390, 844]].filter(([w]) => !only || w === only);

// Messwerte im Browser: Scrollflächen, Leerraum unter dem Modulinhalt, kleine Schrift, kleine Klickflächen, Notengröße am Griffbrett
const measure = () => {
  const vis = (el) => el.checkVisibility() && el.getClientRects().length > 0;
  const box = (el) => el.getBoundingClientRect();
  const rack = document.querySelector('#rack');
  const modules = [...document.querySelectorAll('.module')].filter(vis).map((m) => {
    const bottom = Math.max(0, ...[...m.children].filter(vis).map((c) => box(c).bottom));
    return { id: m.id || m.dataset.layer, w: Math.round(box(m).width), h: Math.round(box(m).height), emptyBelow: Math.round(box(m).bottom - bottom) };
  });
  const small = {};
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12) small[px] = (small[px] ?? 0) + 1;
  }
  const targets = [...document.querySelectorAll('button, select, input, [role="option"]')].filter(vis)
    .map((el) => ({ id: el.id || el.className, w: Math.round(box(el).width), h: Math.round(box(el).height) }))
    .filter((b) => b.w < 24 || b.h < 24);
  const notes = [...document.querySelectorAll('#fretboard .fret-note:not([hidden])')];
  const radii = notes.map((n) => parseFloat(getComputedStyle(n).getPropertyValue('--r')) * (box(n.ownerSVGElement).width / n.ownerSVGElement.viewBox.baseVal.width || 1));
  const scrolls = [...document.querySelectorAll('body *')].filter((el) => vis(el) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    && /auto|scroll/.test(getComputedStyle(el).overflow)).map((el) => ({ id: el.id || el.className, x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight }));
  return {
    page: { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight },
    rack: rack && vis(rack) ? { w: rack.clientWidth, h: rack.clientHeight, scrollW: rack.scrollWidth, scrollH: rack.scrollHeight } : null,
    scrolls, modules, fontsBelow12px: small, targetsBelow24px: targets,
    fretNotes: notes.length ? { count: notes.length, minR: Math.min(...radii).toFixed(1), maxR: Math.max(...radii).toFixed(1), fontPx: getComputedStyle(notes[0].querySelector('text')).fontSize } : null,
  };
};

const server = await start(0);
const base = `http://localhost:${server.address().port}/ui/index.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
await mkdir(out, { recursive: true });
const metrics = {};

async function run(width, height, { lang = 'de', closeups = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: lang === 'de' ? 'de-DE' : 'en-US', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const name = lang === 'de' ? `${width}` : `${width}-${lang}`;
  const shot = async (view) => {
    await page.screenshot({ path: new URL(`${name}-${view}.png`, out).pathname.slice(1), fullPage: width < 768 });
    metrics[`${name}-${view}`] = await page.evaluate(measure);
  };
  const pop = async (button, view) => {
    await page.locator(button).click();
    await shot(view);
    await page.keyboard.press('Escape');
  };
  await page.goto(base);
  await page.locator('#go').filter({ hasText: /\S/ }).waitFor();
  if (lang !== 'de') await page.locator(`[data-lang="${lang}"]`).first().click();
  await page.evaluate(() => document.fonts.ready);

  await shot('start');
  if (lang === 'de') {
    await pop('#style-btn', 'start-style');
    await pop('#key-btn', 'start-key');
  }
  await page.locator('#tune-btn').click();
  await shot('setup');
  const rack = page.locator('#rack');
  if (lang === 'de') {
    await pop('#tags-btn', 'setup-tags');
    await pop('#add-btn', 'setup-add');
    await pop('#profiles-btn', 'setup-profiles');
  }
  // ganzes Rack: Fenster so hoch, dass das Rack nicht mehr in sich scrollt (das Rack scrollt nur senkrecht)
  if (width >= 768) {
    let tall = height;
    for (let i = 0; i < 3; i++) { // die Visualisierung wächst mit: nachmessen, bis das Rack nicht mehr scrollt
      tall += await rack.evaluate((el) => el.scrollHeight - el.clientHeight);
      await page.setViewportSize({ width, height: tall });
    }
    await shot('setup-rack-full');
    if (closeups) {
      for (const el of await page.locator('#play .module').all()) {
        const id = await el.evaluate((m) => m.id || `inst-${m.dataset.layer}`);
        await el.screenshot({ path: new URL(`${name}-closeup-${id}.png`, out).pathname.slice(1) });
      }
    }
    await page.setViewportSize({ width, height });
  }
  await page.locator('#mode-switch').click();
  await shot('focus');
  // Wiedergabe: wartet auf die Sample-Packs, dann zwei, drei Takte laufen lassen (LEDs, Abspielmarke, Akkordfarben)
  await page.locator('#play-go').click();
  await page.locator('#play-position').filter({ hasText: /\d/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  await shot('focus-playing');
  if (closeups) await page.locator('#mod-fretboard').screenshot({ path: new URL(`${name}-closeup-fretboard-playing.png`, out).pathname.slice(1) });
  await page.locator('#mode-switch').click();
  await shot('setup-playing');
  if (closeups) { // Mixer und Gesamtklang bei laufender Wiedergabe (Pegelanzeigen, LEDs): Fenster so hoch, dass das Rack ganz zu sehen ist
    let tall = height;
    for (let i = 0; i < 3; i++) {
      tall += await rack.evaluate((el) => el.scrollHeight - el.clientHeight);
      await page.setViewportSize({ width, height: tall });
    }
    await page.waitForTimeout(500);
    await shot('setup-rack-full-playing');
    for (const id of ['mod-mixer', 'mod-master']) await page.locator(`#${id}`).screenshot({ path: new URL(`${name}-closeup-${id}-playing.png`, out).pathname.slice(1) });
  }
  await context.close();
}

for (const [w, h] of SIZES) {
  await run(w, h, { closeups: w === 1440 });
  console.log(`${w} fertig`);
}
if (!only) {
  await run(1440, 900, { lang: 'en' });
  await run(2560, 1440); // großer Monitor: Höchstmaße der Module, leerer Rackplatz
}
await writeFile(new URL('metrics.json', out), JSON.stringify(metrics, null, 1));
await browser.close();
server.close();
console.log(`Screenshots: .superpowers/ui-screens/${tag}/`);
