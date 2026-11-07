import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Wiedergabetests starten AudioContexts ohne Klick
  use: { baseURL: 'http://localhost:4173', launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } },
  webServer: { command: 'node scripts/serve.js', url: 'http://localhost:4173/ui/render-harness.html', reuseExistingServer: true },
});
