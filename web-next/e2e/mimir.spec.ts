import { test, expect } from '@playwright/test';

test('mimir plugin: rail shows rune and /mimir route renders', async ({ page }) => {
  await page.goto('/');
  // The Mimir rune ᛗ should appear in the rail
  await expect(page.getByText('ᛗ')).toBeVisible();
});

test('mimir plugin: /mimir page renders placeholder', async ({ page }) => {
  await page.goto('/mimir');
  // Title must be visible
  await expect(page.getByText(/Mímir/)).toBeVisible();
  await expect(page.getByText(/the well of knowledge/)).toBeVisible();
  // Loading then stats cards should appear
  await expect(
    page.getByText(/loading/).or(page.getByText('pages')),
  ).toBeVisible();
  await expect(page.getByText('pages')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('categories')).toBeVisible();
  await expect(page.getByText('health')).toBeVisible();
});
