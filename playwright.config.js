import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Wiedergabetests starten AudioContexts ohne Klick
  use: { baseURL: 'http://localhost:4173', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node scripts/serve.js', url: 'http://localhost:4173/ui/render-harness.html', reuseExistingServer: true },
  // Offline-Renders lasten die CPU aus und verzögern Timer: Echtzeit-Tests laufen erst danach auf ruhiger Maschine.
  // Eine einzelne Datei ohne die Offline-Tests davor: npx playwright test tests/e2e/play.spec.js --no-deps
  projects: [
    { name: 'offline', testMatch: /(levels|sound|mix)\.spec\.js$/ },
    { name: 'realtime', testIgnore: /(levels|sound|mix)\.spec\.js$/, dependencies: ['offline'] },
  ],
});
