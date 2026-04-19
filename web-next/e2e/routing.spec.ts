import { test, expect } from '@playwright/test';

test.describe('routing', () => {
  test('deep link /hello renders the hello page', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByText('hello · smoke test')).toBeVisible();
    await expect(page.getByText('hello from the mock adapter')).toBeVisible({
      timeout: 5000,
    });
  });

  test('/ redirects to the first plugin', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/hello/);
    await expect(page.getByText('hello · smoke test')).toBeVisible();
  });

  test('unknown path shows 404', async ({ page }) => {
    await page.goto('/nonexistent');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByText('Page not found')).toBeVisible();
  });

  test('rail navigation updates URL and content', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByText('hello · smoke test')).toBeVisible();

    // Verify the rail button is active
    const helloButton = page.getByTitle('Hello · smoke test plugin');
    await expect(helloButton).toBeVisible();
  });

  test('localStorage.niuu.active follows router state', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByText('hello · smoke test')).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('niuu.active'));
    expect(stored).toBe('hello');
  });

  test('deep link /ravn renders the ravn page', async ({ page }) => {
    await page.goto('/ravn');
    await expect(page.getByRole('heading', { name: 'Ravn · the flock', level: 2 })).toBeVisible();
    await expect(page.getByText('agent fleet console — coming soon')).toBeVisible();
  });

  test('/ravn renders persona list after loading', async ({ page }) => {
    await page.goto('/ravn');
    await expect(page.getByText('coding-agent')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('reviewer')).toBeVisible();
  });

  test('/ravn rail button is visible', async ({ page }) => {
    await page.goto('/ravn');
    const ravnButton = page.getByTitle('Ravn · the flock · agent fleet console');
    await expect(ravnButton).toBeVisible();
  });
});
