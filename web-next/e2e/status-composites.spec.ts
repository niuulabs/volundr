import { test, expect } from '@playwright/test';

test.describe('status composites showcase', () => {
  test('showcase page renders all component sections', async ({ page }) => {
    await page.goto('/hello/showcase');
    await expect(page.getByText('status composites · showcase')).toBeVisible();
    await expect(page.getByTestId('status-badges')).toBeVisible();
    await expect(page.getByTestId('confidence-bars')).toBeVisible();
    await expect(page.getByTestId('confidence-badges')).toBeVisible();
    await expect(page.getByTestId('pipes')).toBeVisible();
  });

  test('StatusBadge renders all six status variants', async ({ page }) => {
    await page.goto('/hello/showcase');
    const section = page.getByTestId('status-badges');
    await expect(section).toBeVisible();

    for (const status of ['running', 'queued', 'ok', 'review', 'failed', 'archived']) {
      await expect(section.getByText(status)).toBeVisible();
    }
  });

  test('ConfidenceBar renders all three levels with labels', async ({ page }) => {
    await page.goto('/hello/showcase');
    const section = page.getByTestId('confidence-bars');
    await expect(section.getByText('high')).toBeVisible();
    await expect(section.getByText('medium')).toBeVisible();
    await expect(section.getByText('low')).toBeVisible();
  });

  test('ConfidenceBadge renders em-dash for empty values', async ({ page }) => {
    await page.goto('/hello/showcase');
    const section = page.getByTestId('confidence-badges');
    const dashes = section.getByText('—');
    await expect(dashes).toHaveCount(2);
  });

  test('Pipe renders phase cells', async ({ page }) => {
    await page.goto('/hello/showcase');
    const pipes = page.getByTestId('pipes').locator('.niuu-pipe');
    await expect(pipes).toHaveCount(3);
  });
});
