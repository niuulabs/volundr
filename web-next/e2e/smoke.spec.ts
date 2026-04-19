import { test, expect } from '@playwright/test';

test('niuu boots and hello plugin renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('hello · smoke test')).toBeVisible();
  await expect(page.getByText('loading…').or(page.getByText('hello from the mock adapter'))).toBeVisible();
  await expect(page.getByText('hello from the mock adapter')).toBeVisible({ timeout: 5000 });
});
