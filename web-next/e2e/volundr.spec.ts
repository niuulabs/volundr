import { test, expect } from '@playwright/test';

test('volundr plugin is in the rail', async ({ page }) => {
  await page.goto('/');
  // The rune ᚲ should appear in the navigation rail
  await expect(page.getByText('ᚲ')).toBeVisible({ timeout: 5000 });
});

test('navigating to /volundr renders the placeholder', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Provision and manage remote dev sessions')).toBeVisible();
});

test('volundr page renders the forge rune', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('ᚲ')).toBeVisible({ timeout: 5000 });
});
