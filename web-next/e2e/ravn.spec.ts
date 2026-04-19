import { test, expect } from '@playwright/test';

test('ravn plugin renders at /ravn', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/ravn · personas · ravens · sessions/)).toBeVisible();
});

test('ravn shows persona count after loading', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/loading/).or(page.getByText(/personas loaded/))).toBeVisible();
  await expect(page.getByText(/21 personas loaded/)).toBeVisible({ timeout: 5000 });
});

test('rail shows ravn rune ᚱ', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('ᚱ').first()).toBeVisible();
});

test('deep-link /ravn renders ravn page directly', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/ravn · personas · ravens · sessions/)).toBeVisible();
  await expect(page.getByText(/21 personas loaded/)).toBeVisible({ timeout: 5000 });
});
