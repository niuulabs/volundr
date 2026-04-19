import { test, expect } from '@playwright/test';

test('observatory rail button navigates to /observatory', async ({ page }) => {
  await page.goto('/');

  // The rail should contain a button for the Observatory plugin (rune ᚠ)
  const railButton = page.getByRole('button', { name: /observatory/i });
  await expect(railButton).toBeVisible();

  await railButton.click();
  await expect(page).toHaveURL(/\/observatory/);
  await expect(page.getByText('Observatory')).toBeVisible();
});

test('observatory page shows topology node and edge counts', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Observatory')).toBeVisible();
  await expect(page.getByText('nodes')).toBeVisible();
  await expect(page.getByText('edges')).toBeVisible();
});

test('observatory page shows recent events', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Recent events')).toBeVisible({ timeout: 5000 });
});

test('registry page renders entity type list', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByText('Registry')).toBeVisible();
  await expect(page.getByText('Realm')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Cluster')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Raid')).toBeVisible({ timeout: 5000 });
});
