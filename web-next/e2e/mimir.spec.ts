import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// /mimir — landing page (mount list)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// /mimir/search — Search view
// ---------------------------------------------------------------------------

test('/mimir/search renders the search page', async ({ page }) => {
  await page.goto('/mimir/search');
  await expect(page.getByRole('heading', { name: /search/i })).toBeVisible();
});

test('/mimir/search shows search input', async ({ page }) => {
  await page.goto('/mimir/search');
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('/mimir/search shows mode toggle buttons', async ({ page }) => {
  await page.goto('/mimir/search');
  await expect(page.getByRole('button', { name: /full-text/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /semantic/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /hybrid/i })).toBeVisible();
});

test('/mimir/search — typing a query returns results', async ({ page }) => {
  await page.goto('/mimir/search');
  await page.getByRole('searchbox').fill('architecture');
  await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 5000 });
});

test('/mimir/search — toggling mode changes active button', async ({ page }) => {
  await page.goto('/mimir/search');
  const ftsBtn = page.getByRole('button', { name: /full-text/i });
  await ftsBtn.click();
  await expect(ftsBtn).toHaveAttribute('aria-pressed', 'true');
});

test('/mimir/search — search result shows title and path', async ({ page }) => {
  await page.goto('/mimir/search');
  await page.getByRole('searchbox').fill('architecture');
  const firstResult = page.getByTestId('search-result').first();
  await expect(firstResult).toBeVisible({ timeout: 5000 });
  await expect(firstResult.locator('.search-page__result-title')).toBeVisible();
  await expect(firstResult.locator('.search-page__result-path')).toBeVisible();
});

test('/mimir/search — searching across mounts (hybrid mode)', async ({ page }) => {
  await page.goto('/mimir/search');
  // Hybrid is default; switch to fts and back to hybrid to verify toggle works
  await page.getByRole('button', { name: /full-text/i }).click();
  await page.getByRole('button', { name: /hybrid/i }).click();
  await expect(page.getByRole('button', { name: /hybrid/i })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('searchbox').fill('api');
  await expect(page.getByTestId('search-result').first()).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// /mimir/graph — Graph view
// ---------------------------------------------------------------------------

test('/mimir/graph renders the graph page', async ({ page }) => {
  await page.goto('/mimir/graph');
  await expect(page.getByRole('heading', { name: /knowledge graph/i })).toBeVisible();
});

test('/mimir/graph shows the graph SVG after load', async ({ page }) => {
  await page.goto('/mimir/graph');
  await expect(page.getByRole('img', { name: /knowledge graph/i })).toBeVisible({
    timeout: 5000,
  });
});

test('/mimir/graph shows node and edge counts', async ({ page }) => {
  await page.goto('/mimir/graph');
  await expect(page.getByText(/nodes/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/edges/)).toBeVisible({ timeout: 5000 });
});

test('/mimir/graph has hop selector', async ({ page }) => {
  await page.goto('/mimir/graph');
  await expect(page.getByRole('group', { name: /hop count/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// /mimir/entities — Entities view
// ---------------------------------------------------------------------------

test('/mimir/entities renders the entities page', async ({ page }) => {
  await page.goto('/mimir/entities');
  await expect(page.getByRole('heading', { name: /entities/i })).toBeVisible();
});

test('/mimir/entities shows entity items after load', async ({ page }) => {
  await page.goto('/mimir/entities');
  await expect(page.getByTestId('entity-item').first()).toBeVisible({ timeout: 5000 });
});

test('/mimir/entities shows entity type filter buttons', async ({ page }) => {
  await page.goto('/mimir/entities');
  await expect(page.getByRole('button', { name: /all/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /org/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /concept/i })).toBeVisible();
});

test('/mimir/entities — clicking a kind filter updates active state', async ({ page }) => {
  await page.goto('/mimir/entities');
  const orgBtn = page.getByRole('button', { name: /org/i });
  await orgBtn.click();
  await expect(orgBtn).toHaveAttribute('aria-pressed', 'true');
});
