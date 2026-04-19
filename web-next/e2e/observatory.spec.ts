import { test, expect } from '@playwright/test';

test('observatory rail button navigates to /observatory', async ({ page }) => {
  await page.goto('/');

  // The rail button uses the plugin title in its `title` attribute (tooltip)
  const railButton = page.locator('button[title*="Observatory"]');
  await expect(railButton).toBeVisible();

  await railButton.click();
  await expect(page).toHaveURL(/\/observatory/);
  await expect(page.getByText('Observatory').first()).toBeVisible();
});

test('observatory page shows topology node and edge counts', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Observatory').first()).toBeVisible();
  await expect(page.getByText('nodes')).toBeVisible();
  await expect(page.getByText('edges')).toBeVisible();
});

test('observatory page shows recent events', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Recent events')).toBeVisible({ timeout: 5000 });
});

test('registry page renders entity type list', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByText('Registry').first()).toBeVisible();
  await expect(page.getByText('Realm')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Cluster')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Raid')).toBeVisible({ timeout: 5000 });
});
