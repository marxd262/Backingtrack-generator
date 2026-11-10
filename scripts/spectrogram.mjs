// Speichert das Spektrogramm einer Stimme als PNG (und gibt die Messwerte aus), damit man es ansehen kann.
// Aufruf: node scripts/spectrogram.mjs <ausgabe.png> "<query>" [referenz.wav]
// query wie bei ui/spectrogram.html, zum Beispiel "layer=bass&id=string&variant=finger&midi=40&vel=0.8".
import { chromium } from '@playwright/test';
import { start } from './serve.js';

const [out, query = '', ref] = process.argv.slice(2);
if (!out) {
  console.error('Aufruf: node scripts/spectrogram.mjs <ausgabe.png> "<query>" [referenz.wav]');
  process.exit(2);
}

const server = await start(0);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.goto(`http://localhost:${server.address().port}/ui/spectrogram.html?${query}`);
  if (ref) await page.setInputFiles('#ref-file', ref);
  await page.waitForSelector(ref ? '#plot[data-ready="2"], #plot[data-ready="error"]' : '#plot[data-ready]', { timeout: 60_000 });
  await page.locator('#plot').screenshot({ path: out });
  console.log(await page.locator('#metrics').textContent());
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
