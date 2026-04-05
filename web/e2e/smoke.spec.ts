import { test, expect } from './fixtures';

test.describe('smoke', () => {
  test('loads the app and redirects to /volundr', async ({ authenticatedPage }) => {
    await expect(authenticatedPage).toHaveURL(/\/volundr/);
    await expect(authenticatedPage.locator('body')).toBeVisible();
  });
});
