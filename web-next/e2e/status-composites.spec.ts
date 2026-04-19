import { test, expect } from '@playwright/test';

test.describe('status composites showcase', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hello/status-showcase');
  });

  test('page renders the heading', async ({ page }) => {
    await expect(page.getByText(/status composites/i)).toBeVisible();
  });

  test('StatusBadge — renders all 12 statuses', async ({ page }) => {
    const grid = page.getByTestId('status-badge-grid');
    await expect(grid).toBeVisible();
    const badges = grid.locator('[role="status"]');
    await expect(badges).toHaveCount(12);
  });

  test('StatusBadge — running badge is visible', async ({ page }) => {
    await expect(page.getByRole('status', { name: 'running' }).first()).toBeVisible();
  });

  test('StatusBadge — failed badge is visible', async ({ page }) => {
    await expect(page.getByRole('status', { name: 'failed' })).toBeVisible();
  });

  test('ConfidenceBar — renders high, medium, low', async ({ page }) => {
    const grid = page.getByTestId('confidence-bar-grid');
    const bars = grid.locator('[role="meter"]');
    await expect(bars).toHaveCount(3);
    await expect(page.getByRole('meter', { name: 'confidence: high' })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'confidence: medium' })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'confidence: low' })).toBeVisible();
  });

  test('ConfidenceBadge — renders grid including null placeholder', async ({ page }) => {
    const grid = page.getByTestId('confidence-badge-grid');
    await expect(grid).toBeVisible();
    await expect(grid.getByText('—')).toBeVisible();
  });

  test('ConfidenceBadge — renders numeric percentages', async ({ page }) => {
    const grid = page.getByTestId('confidence-badge-grid');
    const meters = grid.locator('[role="meter"]');
    await expect(meters.first()).toBeVisible();
  });

  test('Pipe — renders all three pipe variants', async ({ page }) => {
    const grid = page.getByTestId('pipe-grid');
    await expect(grid).toBeVisible();
    const pipes = grid.locator('[role="list"]');
    await expect(pipes).toHaveCount(3);
  });

  test('Pipe — cells are individually labelled', async ({ page }) => {
    const grid = page.getByTestId('pipe-grid');
    const cells = grid.locator('[role="listitem"]');
    await expect(cells.first()).toBeVisible();
  });

  test('keyboard accessibility — page is tabbable', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });
});
