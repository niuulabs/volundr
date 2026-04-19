import { test, expect } from '@playwright/test';

test('mimir plugin: rail shows rune and /mimir route renders', async ({ page }) => {
  await page.goto('/');
  // The Mimir rune ᛗ should appear in the rail
  await expect(page.getByText('ᛗ')).toBeVisible();
});

test('mimir plugin: /mimir page renders placeholder', async ({ page }) => {
  await page.goto('/mimir');
  // Use exact h2 text to avoid matching topbar <h1>Mímir</h1> and <span>the well of knowledge</span>
  await expect(page.getByText('Mímir · the well of knowledge')).toBeVisible();
  // Loading then stats cards should appear.
  // Use exact: true to avoid substring-matching description paragraphs that contain
  // words like "pages", "categories", "health".
  await expect(
    page.getByText(/loading…/).or(page.getByText('pages', { exact: true })),
  ).toBeVisible();
  await expect(page.getByText('pages', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('categories', { exact: true })).toBeVisible();
  await expect(page.getByText('health', { exact: true })).toBeVisible();
});
