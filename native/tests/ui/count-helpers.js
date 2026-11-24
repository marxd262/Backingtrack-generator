// What the web tests count with Web Audio (tests/e2e/count-helpers.js: AudioContexts, instrument sets), counted in the app, which has no Web Audio:
// from what the shell sends the page (native/PROTOKOLL.md section 7). The web makes its AudioContext at the first start of the playback (one per
// page, src/ui/app.js 125): one means the playback started and nothing built its audio anew. Here a start is a report of the engine that plays
// after one that did not, or plays another start (`run`, the number of the page's playSession): one means one start, without a break. A new
// instrument set of the web is a start or a restart: here a start, or an answer to an action whose flags restart the song while the engine plays.
// Counted when the shell has done everything the page sent before (settled): the web counts at once, the app's engine follows an action's answer
// with its engine calls and restart (up to 1 s); a start or a break they cause is in the reports by then.
import { settled } from './fixture.js';

/** Counts from now on (the web's countContexts counts from the next load; the session lives on in the app, so no load is needed).
 *  shortcut: counts in the current document only, a reload or restart() of the page starts without the counters, upgrade: when a test counts
 *  across a reload, record in the fixture's init script. */
export const countContexts = (page) => page.evaluate(() => {
  const got = (window.__playback = { engine: [], restarts: 0 });
  const backend = window.__JUCE__.backend;
  backend.addEventListener('engine', (m) => got.engine.push(m));
  backend.addEventListener('state', (m) => { if (m.change?.restart && got.engine.at(-1)?.playing) got.restarts++; });
});

export const contexts = async (page) => {
  await settled(page);
  return page.evaluate(() => window.__playback.engine.filter((m, i, all) => m.playing && !(all[i - 1]?.playing && all[i - 1].run === m.run)).length);
};

export const sets = async (page) => (await contexts(page)) + (await page.evaluate(() => window.__playback.restarts));
