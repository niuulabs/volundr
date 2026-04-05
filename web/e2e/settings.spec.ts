import { test, expect } from './fixtures';

test.describe('settings', () => {
  test('settings page loads', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Navigate to settings
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/);

    // Verify the settings page renders with title
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    // Verify back button exists
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

    // Verify at least one settings section loads in the nav
    const settingsNav = page.locator('nav').filter({ has: page.getByRole('button') });
    await expect(settingsNav).toBeVisible();
  });
});
