import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Wiedergabetests starten AudioContexts ohne Klick
  use: { baseURL: 'http://localhost:4173', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node scripts/serve.js', url: 'http://localhost:4173/ui/render-harness.html', reuseExistingServer: true },
  // Jeder Test ist unabhängig (eigene Seite), also laufen auch die Tests einer Datei parallel.
  fullyParallel: true,
  // Offline-Renders (levels, sound, mix und alle voices-*-sound) lasten die CPU aus und verzögern Timer:
  // Echtzeit-Tests laufen im vollen Lauf erst danach auf ruhiger Maschine (npm run test:e2e).
  // Alltag ohne die Renders: npm run test:ui (= --project=realtime --no-deps)
  projects: [
    { name: 'offline', testMatch: /(levels|sound|mix)\.spec\.js$/ },
    { name: 'realtime', testIgnore: /(levels|sound|mix)\.spec\.js$/, dependencies: ['offline'] },
  ],
});
