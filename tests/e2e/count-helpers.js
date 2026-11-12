// Gemeinsame Helfer der Wiedergabe-Spezifikationen: Instrumentensätze und AudioContexts zählen, Taktzeile aufzeichnen.
import { expect } from '@playwright/test';

const BAR_TIMEOUT = 10_000;

// Init-Skript: zählt erzeugte AudioContexts (window.__audioContexts) und Instrumentensätze (window.__instrumentSets, je einer hat
// genau einen Faltungshall): ein Neustart der Wiedergabe baut einen neuen Satz, eine Live-Änderung nicht
export const countingScript = () => {
  window.__audioContexts = 0;
  window.__instrumentSets = 0;
  const convolver = BaseAudioContext.prototype.createConvolver;
  BaseAudioContext.prototype.createConvolver = function (...args) {
    window.__instrumentSets++;
    return convolver.apply(this, args);
  };
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      window.__audioContexts++;
    }
  };
};

// Zählt ab dem nächsten Laden (lädt neu)
export async function countContexts(page) {
  await page.addInitScript(countingScript);
  await page.reload();
  await expect(page.locator('#go')).toHaveText(/\S/);
}

export const sets = (page) => page.evaluate(() => window.__instrumentSets);
export const contexts = (page) => page.evaluate(() => window.__audioContexts);

const position = (page) => page.locator('#play-position');

// Zeichnet jeden Text der Taktzeile auf (window.__positions), auch kurze Zwischenstände wie die leere Zeile beim Neustart
export const recordPositions = (page) => page.evaluate(() => {
  window.__positions = [];
  const el = document.querySelector('#play-position');
  new MutationObserver(() => window.__positions.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
});
export const positionsSince = async (page) => page.evaluate(() => window.__positions.splice(0));
export const shownBar = async (page) => Number((await position(page).textContent()).match(/^Takt (\d+) von \d+$/)?.[1] ?? NaN);

// Läuft ohne Neustart oder in der gleichen Position weiter: die Taktzeile wird nie leer, springt nie hinter `before` zurück und läuft weiter
export async function expectContinuous(page, before, label) {
  await expect.poll(() => shownBar(page), { message: label, timeout: BAR_TIMEOUT }).toBeGreaterThan(before);
  const texts = await positionsSince(page);
  expect(texts.every(Boolean), `${label}: Taktzeile war leer: ${JSON.stringify(texts)}`).toBe(true);
  const shown = texts.map((text) => Number(text.match(/^Takt (\d+) von/)[1]));
  expect(shown.length, label).toBeGreaterThan(0);
  for (const bar of shown) expect(bar, `${label}: ${shown}`).toBeGreaterThanOrEqual(before);
}
