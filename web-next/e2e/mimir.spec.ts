import { test, expect } from '@playwright/test';

test('navigate to /mimir renders the placeholder page', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('Mímir · the well of knowledge')).toBeVisible();
});

test('/mimir shows loading state then mount list', async ({ page }) => {
  await page.goto('/mimir');
  await expect(
    page.getByText(/loading mounts/).or(page.getByText(/mounts connected/)),
  ).toBeVisible();
  await expect(page.getByText(/mounts connected/)).toBeVisible({ timeout: 5000 });
});

test('/mimir shows individual mount names', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('local')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('shared')).toBeVisible({ timeout: 5000 });
});

test('mimir rune is visible in the rail', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('ᛗ')).toBeVisible();
});
