// The app's strip and its sound follow the page that shows, whichever way the browser got there (Task 34c): the page that loads says which it is
// (its sync, native/PROTOKOLL.md section 7); when it is the other page, the shell's strip leads to the page it left and the sound of that page stops.
// The strip's button is a JUCE component, read and pressed through UI Automation (app.strip). Keys of the browser (Alt+ArrowLeft) cannot be sent to
// a WebView2 on a desktop of its own (over CDP they reach the page but not the browser's own handling, and posted window messages do nothing); the
// mouse's back and forward buttons, sent over CDP, take the browser's own way through its history.
import { test, expect, fromSession, settled } from './fixture.js';

test.use({ locale: 'de-DE' });

const generator = async (page) => {
  await page.waitForURL(/\/app\/index\.html$/);
  await expect(page.locator('#go')).toHaveText(/\S/); // drawn from the answer to its sync
};
const track = async (page) => {
  await page.waitForURL(/\/app\/track\.html$/);
  await page.waitForFunction(() => document.getElementById('scale').options.length > 0); // built from the answer to its sync
};
// the engine's report after the shell has done everything the page sent (the stop the shell queues before the sync's answer too)
const plays = async (page) => { await settled(page); return (await fromSession(page, 'engine')).playing; };
const los = async (page) => {
  await page.locator(await page.locator('#play').isHidden() ? '#go' : '#play-go').click();
  await expect(page.locator('#play-go')).toHaveText('Stopp');
  expect(await plays(page), 'the song plays').toBe(true);
};
// the mouse's back (3) or forward (4) button over the page, as the browser takes it
const mouse = async (page, button) => {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: 300, y: 300, button, buttons: button === 'back' ? 8 : 16, clickCount: 1 });
  await cdp.detach().catch(() => {}); // the page it was for may be gone
};

test('Zurück und Vor im Verlauf: die Leiste folgt der Seite, der Song der verlassenen Seite hält an, Los spielt wieder', async ({ app, page }) => {
  await los(page);
  expect(app.strip()).toBe('Eigener Track');
  app.strip(true); // as the strip leads to the track page: it stops the song
  await track(page);
  expect(await plays(page), 'on the track page after the strip').toBe(false);
  expect(app.strip()).toBe('Generator');

  await page.evaluate(() => history.back());
  await generator(page);
  expect(app.strip(), 'the strip after back to the generator').toBe('Eigener Track');
  await los(page);

  await page.evaluate(() => history.forward());
  await track(page);
  expect(await plays(page), 'the generator\'s song once the track page shows').toBe(false);
  expect(app.strip()).toBe('Generator');

  await page.evaluate(() => history.back());
  await generator(page);
  await expect(page.locator('#go')).toHaveText('Los');
  expect(app.strip()).toBe('Eigener Track');
  await los(page);
});

test('Maustasten Zurück und Vor, Neuladen: die Leiste folgt, der Song hält an; ein Neuladen ändert nichts am Klang', async ({ app, page }) => {
  await los(page);
  await page.reload();
  await generator(page); // drawn from the answer to the reloaded page's sync
  expect(await plays(page), 'the song after a reload of its page').toBe(true);
  expect(app.strip()).toBe('Eigener Track');
  app.strip(true);
  await track(page);

  await mouse(page, 'back');
  await generator(page);
  expect(app.strip(), 'the strip after the mouse\'s back button').toBe('Eigener Track');
  await los(page);

  await mouse(page, 'forward');
  await track(page);
  expect(await plays(page), 'the generator\'s song after the mouse\'s forward button').toBe(false);
  expect(app.strip()).toBe('Generator');
});
