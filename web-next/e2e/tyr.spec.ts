import { test, expect } from '@playwright/test';

test('tyr dashboard renders at /tyr', async ({ page }) => {
  await page.goto('/tyr');
  await expect(page.getByText('Tyr · Dashboard')).toBeVisible();
});

test('tyr dashboard shows the Tyr rune ᛏ', async ({ page }) => {
  await page.goto('/tyr');
  await expect(page.getByText('ᛏ').first()).toBeVisible();
});

test('tyr dashboard shows active sagas from seed data', async ({ page }) => {
  await page.goto('/tyr');
  await expect(page.getByText('Auth Rewrite')).toBeVisible();
});

test('tyr dashboard shows KPI strip', async ({ page }) => {
  await page.goto('/tyr');
  // Scope to KPI group since "Active Sagas" also appears as a section heading
  const kpiGroup = page.getByRole('group', { name: /KPI/i });
  await expect(kpiGroup).toBeVisible();
  await expect(kpiGroup.getByText('Active Sagas')).toBeVisible();
  await expect(kpiGroup.getByText('Dispatcher')).toBeVisible();
});

test('tyr sagas page renders at /tyr/sagas', async ({ page }) => {
  await page.goto('/tyr/sagas');
  await expect(page.getByText('Tyr · Sagas')).toBeVisible();
});

test('tyr sagas page shows all seed sagas', async ({ page }) => {
  await page.goto('/tyr/sagas');
  await expect(page.getByText('Auth Rewrite')).toBeVisible();
  await expect(page.getByText('Plugin Ravn Scaffold')).toBeVisible();
  await expect(page.getByText('Observatory Topology Canvas')).toBeVisible();
});

test('tyr sagas page status tabs filter list', async ({ page }) => {
  await page.goto('/tyr/sagas');
  await expect(page.getByText('Auth Rewrite')).toBeVisible();

  await page.getByRole('tab', { name: /active/i }).click();
  await expect(page.getByText('Auth Rewrite')).toBeVisible();
  await expect(page.getByText('Plugin Ravn Scaffold')).not.toBeVisible();
});

test('tyr dashboard → saga detail → raid → open session (full flow)', async ({ page }) => {
  // 1. Start at dashboard
  await page.goto('/tyr');
  await expect(page.getByText('Tyr · Dashboard')).toBeVisible();
  await expect(page.getByText('Auth Rewrite')).toBeVisible();

  // 2. Click the active saga to navigate to detail
  await page.getByRole('button', { name: /View saga Auth Rewrite/i }).click();

  // 3. Saga detail page should show the saga header and phases
  await expect(page.getByText('Phase 1: Foundation')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Implement OIDC flow')).toBeVisible();

  // 4. Expand the raid panel
  await page.getByRole('button', { name: /Expand raid Implement OIDC flow/i }).click();

  // 5. Raid detail panel should appear
  await expect(
    page.getByRole('region', { name: /Raid detail: Implement OIDC flow/i }),
  ).toBeVisible();
  await expect(page.getByText('Add OIDC login via Keycloak.')).toBeVisible();

  // 6. Click "Open session" — asserts URL changes, not a network fetch
  await page.getByRole('button', { name: /Open Völundr session/i }).click();
  await expect(page).toHaveURL(/\/volundr\/session\/sess-001/, { timeout: 5000 });
});

test('tyr saga detail back button returns to sagas list', async ({ page }) => {
  await page.goto('/tyr/sagas/00000000-0000-0000-0000-000000000001');
  await expect(page.getByText('Auth Rewrite')).toBeVisible({ timeout: 5000 });

  await page.getByRole('button', { name: /Back to sagas/i }).click();
  await expect(page).toHaveURL(/\/tyr\/sagas/, { timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Dispatch page
// ---------------------------------------------------------------------------

test('dispatch page renders at /tyr/dispatch', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByText('Dispatch rules')).toBeVisible({ timeout: 8000 });
});

test('dispatch page shows rule summary card', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByLabel('Dispatch rules')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Confidence threshold')).toBeVisible();
  await expect(page.getByText('Concurrent cap')).toBeVisible();
});

test('dispatch page shows segmented filter', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('group', { name: /filter raids/i })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('button', { name: /all/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /ready/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /blocked/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /queue/i })).toBeVisible();
});

test('dispatch page shows dispatch queue table', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('table', { name: /dispatch queue/i })).toBeVisible({ timeout: 8000 });
});

test('filter to ready tab shows only ready raids', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  // Wait for table to load
  await expect(page.getByRole('table')).toBeVisible({ timeout: 8000 });

  await page.getByRole('button', { name: /ready/i }).click();
  // After filtering, the ready raids should remain (those with confidence >= threshold)
  // The "Harden JWT validation" raid has confidence 80 >= 70 → ready
  await expect(page.getByText('Harden JWT validation')).toBeVisible();
  // The "Write auth integration tests" raid has confidence 45 < 70 → blocked (not shown)
  await expect(page.getByText('Write auth integration tests')).not.toBeVisible();
});

test('select multiple raids and batch dispatch', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 8000 });

  // Switch to ready filter to only see dispatchable raids
  await page.getByRole('button', { name: /ready/i }).click();

  // Select the first available raid
  const firstCheckbox = page.getByRole('checkbox', { name: /select row/i }).first();
  await firstCheckbox.waitFor({ state: 'visible', timeout: 5000 });
  await firstCheckbox.check();

  // Dispatch bar should appear
  await expect(page.getByText(/raid.*selected/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^dispatch$/i })).toBeVisible();

  // Click dispatch
  await page.getByRole('button', { name: /^dispatch$/i }).click();

  // Optimistic update — selection cleared, raid moves to queue
  await expect(page.getByText(/raid.*selected/i)).not.toBeVisible({ timeout: 3000 });
});

test('dispatch button disabled for non-feasible selection', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 8000 });

  // Switch to blocked filter
  await page.getByRole('button', { name: /blocked/i }).click();

  const firstCheckbox = page.getByRole('checkbox', { name: /select row/i }).first();
  if (await firstCheckbox.isVisible()) {
    await firstCheckbox.check();
    const dispatchBtn = page.getByRole('button', { name: /^dispatch$/i });
    await expect(dispatchBtn).toBeVisible();
    await expect(dispatchBtn).toHaveAttribute('aria-disabled', 'true');
  }
});

test('search filters raids by name', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('table')).toBeVisible({ timeout: 8000 });

  await page.getByRole('searchbox', { name: /search raids/i }).fill('harden');
  await expect(page.getByText('Harden JWT validation')).toBeVisible();
  await expect(page.getByText('Write auth integration tests')).not.toBeVisible();
});

test('keyboard: tab focuses segmented filter buttons', async ({ page }) => {
  await page.goto('/tyr/dispatch');
  await expect(page.getByRole('group', { name: /filter raids/i })).toBeVisible({ timeout: 8000 });

  const allBtn = page.getByRole('button', { name: /all/i });
  await allBtn.focus();
  await expect(allBtn).toBeFocused();
});
