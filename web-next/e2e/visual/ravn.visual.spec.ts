/**
 * Visual regression specs for the Ravn plugin.
 *
 * All views live at /ravn with tab-based navigation. Tests click each tab to
 * reach the target view, then compare the full page snapshot.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ravn');
  await page.waitForSelector('[data-testid="ravn-page"]', { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
});

/** Click a shell tab by its visible label. */
async function clickTab(page: import('@playwright/test').Page, label: string) {
  await page.click(`button.niuu-shell__tab:has-text("${label}")`);
  await page.waitForTimeout(400);
}

// ── Overview ──────────────────────────────────────────────────────────────────

test('ravn overview matches web2', async ({ page }) => {
  // Overview is the default tab, already active
  await page.waitForSelector('[data-testid="overview-page"]', { timeout: 5_000 });
  await expect(page).toHaveScreenshot('ravn-overview.png');
});

// ── Ravens ─────────────────────────────────────────────────────────────────────

test('ravn ravens split view matches web2', async ({ page }) => {
  await clickTab(page, 'Ravens');
  await expect(page).toHaveScreenshot('ravn-ravens-split.png');
});

// ── Sessions ──────────────────────────────────────────────────────────────────

test('ravn sessions matches web2', async ({ page }) => {
  await clickTab(page, 'Sessions');
  await expect(page).toHaveScreenshot('ravn-sessions.png');
});

// ── Budget ─────────────────────────────────────────────────────────────────────

test('ravn budget matches web2', async ({ page }) => {
  await clickTab(page, 'Budget');
  await expect(page).toHaveScreenshot('ravn-budget.png');
});

// ── Personas ───────────────────────────────────────────────────────────────────

test('ravn personas matches web2', async ({ page }) => {
  await clickTab(page, 'Personas');
  await expect(page).toHaveScreenshot('ravn-personas.png');
});
