// What the web tests count with Web Audio (tests/e2e/count-helpers.js: AudioContexts, instrument sets), counted in the app, which has no Web Audio:
// from what the shell sends the page (native/PROTOKOLL.md section 7). The web makes its AudioContext at the first start of the playback (one per
// page, src/ui/app.js 125): one means the playback started and nothing built its audio anew. Here a start is a playSession of the page that the
// engine's reports show playing after it, or a report that plays after one that did not with no such playSession since: one means one start,
// without a break. A new
// instrument set of the web is a start or a restart: here a start, or an answer to an action whose flags restart the song while the engine plays.
// Counted when the shell has done everything the page sent before (settled): the web counts at once, the app's engine follows an action's answer
// with its engine calls and restart (up to 1 s); a start or a break they cause is in the reports by then.
// recordPositions, positionsSince, shownBar and expectContinuous work on the DOM and are the web's (tests/e2e/count-helpers.js).
import { expect, settled } from './fixture.js';

const BAR_TIMEOUT = 10_000;

/** Counts from now on (the web's countContexts counts from the next load; the session lives on in the app, so no load is needed).
 *  shortcut: counts in the current document only, a reload or restart() of the page starts without the counters, upgrade: when a test counts
 *  across a reload, record in the fixture's init script. */
export const countContexts = (page) => page.evaluate(() => {
  const got = (window.__playback = { engine: [], posts: [], restarts: 0 });
  const backend = window.__JUCE__.backend;
  // each playSession the page posts, as the number of engine reports before it
  const emit = backend.emitEvent.bind(backend);
  backend.emitEvent = (name, data) => { if (data?.type === 'playSession') got.posts.push(got.engine.length); return emit(name, data); };
  backend.addEventListener('engine', (m) => got.engine.push(m));
  backend.addEventListener('state', (m) => { if (m.change?.restart && got.engine.at(-1)?.playing) got.restarts++; });
});

export const contexts = async (page) => {
  await settled(page);
  const { n, changes, posts } = await page.evaluate(() => {
    const { engine: all, posts } = window.__playback;
    const differs = (m, i) => i === 0 || ['playing', 'standing', 'run'].some((k) => m[k] !== all[i - 1][k]);
    // Every playSession starts the transport anew, also while it plays (PROTOKOLL.md section 7): each one that a playing report follows is a start.
    // The reports' `run` cannot tell them apart: the shell names a start only after its job (PluginEditor.cpp `done`), so a start's first reports
    // can carry the run before, and two starts within one report can show one run. A stretch of playing with no such post since the stretch
    // before is a start too (a resume, a start of the shell's own).
    const played = posts.filter((at) => all.slice(at).some((m) => m.playing));
    let starts = played.length, used = 0;
    all.forEach((m, i) => {
      if (!m.playing || all[i - 1]?.playing) return;
      const upTo = played.filter((at) => at <= i).length;
      if (upTo === used) starts++;
      used = upTo;
    });
    return { n: starts, posts, changes: all.map((m, i) => (differs(m, i) ? `${i}: playing ${m.playing} standing ${m.standing} run ${m.run}` : '')).filter(Boolean) };
  });
  // no test expects more than one: when one counts more, the line says where the page started and where the engine's reports changed
  if (n > 1) console.log(`contexts() counted ${n} starts; playSession before report ${posts.join(', ')}; the engine's reports changed at report ${changes.join('; ')}`);
  return n;
};

export const sets = async (page) => (await contexts(page)) + (await page.evaluate(() => window.__playback.restarts));

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
