import { test, expect } from './fixtures';

test.describe('navigation', () => {
  test('sidebar navigation between modules', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const nav = page.locator('nav[aria-label="Main navigation"]');

    // Should start on Volundr
    await expect(page).toHaveURL(/\/volundr/);

    // Navigate to Tyr via sidebar
    const tyrLink = nav.locator('a[data-tooltip="Tyr"]');
    if (await tyrLink.isVisible()) {
      await tyrLink.click();
      await expect(page).toHaveURL(/\/tyr/);
    }

    // Navigate to Settings via sidebar
    const settingsLink = nav.locator('a[data-tooltip="Settings"]');
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings/);

    // Verify settings page content
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Navigate back to Volundr
    const volundrLink = nav.locator('a[data-tooltip="Völundr"]');
    await volundrLink.click();
    await expect(page).toHaveURL(/\/volundr/);
  });

  test('redirect from / to /volundr', async ({ page, baseURL }) => {
    await page.goto(baseURL ?? 'http://localhost:5174');
    await page.waitForURL('**/volundr', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/volundr/);
  });
});
