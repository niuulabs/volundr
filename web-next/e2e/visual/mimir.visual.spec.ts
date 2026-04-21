/**
 * Visual regression specs for the Mimir plugin.
 *
 * Mimir has a main overview page (/mimir) with three tabs and dedicated
 * sub-routes for search, graph, and entity views.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// ── Home — Overview tab ───────────────────────────────────────────────────────

test('mimir overview matches web2', async ({ page }) => {
  await page.goto('/mimir');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('text=Mímir', { timeout: 10_000 });
  await expect(page).toHaveScreenshot('mimir-overview.png');
});

// ── Pages tab ─────────────────────────────────────────────────────────────────

test('mimir pages — tree matches web2', async ({ page }) => {
  await page.goto('/mimir');
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('mimir-pages-tree.png');
});

test('mimir pages — reader matches web2', async ({ page }) => {
  await page.goto('/mimir');
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole('button', { name: /overview/ })
    .first()
    .click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('mimir-pages-reader.png');
});

// ── Sources tab ───────────────────────────────────────────────────────────────

test('mimir sources matches web2', async ({ page }) => {
  await page.goto('/mimir');
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Sources' }).click();
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('mimir-sources.png');
});

// ── Search ────────────────────────────────────────────────────────────────────

test('mimir search matches web2', async ({ page }) => {
  await page.goto('/mimir/search');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('input[type="search"]', { timeout: 10_000 });
  await expect(page).toHaveScreenshot('mimir-search.png');
});

// ── Graph ─────────────────────────────────────────────────────────────────────

test('mimir graph matches web2', async ({ page }) => {
  await page.goto('/mimir/graph');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-graph.png');
});

// ── Entities ──────────────────────────────────────────────────────────────────

test('mimir entities matches web2', async ({ page }) => {
  await page.goto('/mimir/entities');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-entities.png');
});

// ── Ravns (Wardens) ───────────────────────────────────────────────────────────

test('mimir ravns matches web2', async ({ page }) => {
  await page.goto('/mimir/ravns');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-ravns.png');
});

// ── Lint ──────────────────────────────────────────────────────────────────────

test('mimir lint matches web2', async ({ page }) => {
  await page.goto('/mimir/lint');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-lint.png');
});

// ── Routing (ingest rules in web2) ────────────────────────────────────────────

test('mimir routing matches web2', async ({ page }) => {
  await page.goto('/mimir/routing');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-routing.png');
});

// ── Dreams (log / dream-cycle history in web2) ────────────────────────────────

test('mimir dreams matches web2', async ({ page }) => {
  await page.goto('/mimir/dreams');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('mimir-dreams.png');
});
