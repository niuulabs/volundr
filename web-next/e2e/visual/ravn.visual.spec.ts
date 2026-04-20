/**
 * Visual regression specs for the Ravn plugin.
 *
 * All views live at /ravn with tab-based navigation. Tests click each tab to
 * reach the target view, then compare the full page snapshot.
 */

import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ravn');
  await page.waitForSelector('[data-testid="ravn-page"]', { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
});

// ── Overview ──────────────────────────────────────────────────────────────────

test('ravn overview matches web2', async ({ page }) => {
  await page.getByTestId('ravn-tab-overview').click();
  await page.waitForSelector('[data-testid="overview-page"]', { timeout: 5_000 });
  await expect(page).toHaveScreenshot('ravn-overview.png');
});

// ── Ravens ─────────────────────────────────────────────────────────────────────

test('ravn ravens split view matches web2', async ({ page }) => {
  await page.getByTestId('ravn-tab-ravens').click();
  await page.waitForSelector('[data-testid="ravens-page"]', { timeout: 5_000 });
  await page.waitForSelector('[data-testid="layout-split"]', { timeout: 5_000 });
  await expect(page).toHaveScreenshot('ravn-ravens-split.png');
});

// ── Sessions ──────────────────────────────────────────────────────────────────

test('ravn sessions matches web2', async ({ page }) => {
  await page.getByRole('tab', { name: 'Sessions' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('ravn-sessions.png');
});

// ── Triggers ──────────────────────────────────────────────────────────────────

test('ravn triggers matches web2', async ({ page }) => {
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('ravn-triggers.png');
});

// ── Events ────────────────────────────────────────────────────────────────────

test('ravn events matches web2', async ({ page }) => {
  await page.getByRole('tab', { name: 'Events' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('ravn-events.png');
});

// ── Budget ─────────────────────────────────────────────────────────────────────

test('ravn budget matches web2', async ({ page }) => {
  await page.getByRole('tab', { name: 'Budget' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('ravn-budget.png');
});
