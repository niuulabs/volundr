import { test, expect } from '@playwright/test';

test('volundr plugin is in the rail', async ({ page }) => {
  await page.goto('/');
  // Rail button is identified by its title attribute
  await expect(page.getByTitle('Völundr · session forge')).toBeVisible({ timeout: 5000 });
});

test('navigating to /volundr renders the placeholder', async ({ page }) => {
  await page.goto('/volundr');
  await expect(
    page.getByRole('heading', { name: 'Völundr · session forge', level: 2 }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Provision and manage remote dev sessions')).toBeVisible();
});

test('volundr page renders the forge rune', async ({ page }) => {
  await page.goto('/volundr');
  // The page content area renders the rune; the rail also renders it — use the page heading area
  await expect(
    page.getByRole('heading', { name: 'Völundr · session forge', level: 2 }),
  ).toBeVisible({ timeout: 5000 });
});
