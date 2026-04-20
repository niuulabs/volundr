/**
 * Visual regression specs for the Login plugin.
 */

import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// ── Login page ────────────────────────────────────────────────────────────────

test('login page matches web2', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('login-page.png');
});
