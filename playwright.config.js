import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node scripts/serve.js', url: 'http://localhost:4173/ui/smoke.html', reuseExistingServer: true },
});
