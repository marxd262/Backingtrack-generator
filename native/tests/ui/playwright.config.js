// The web app's page tests, ported to run against the app (native/app/ui in the app's WebView): npm run test:app (after native/build.ps1 with the
// app). No web server: every test starts its own app (fixture.js).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // every test has its own app on its own storage folder and port, so the tests of a file run in parallel too
  fullyParallel: true,
  workers: 4,
});
