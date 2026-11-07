import { test, expect } from '@playwright/test';

test('Server liefert src/', async ({ page }) => {
  await page.goto('/ui/smoke.html');
  await expect(page.locator('h1')).toHaveText('ok');
});
