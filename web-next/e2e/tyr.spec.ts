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
  await expect(page.getByText('Active Sagas')).toBeVisible();
  await expect(page.getByText('Dispatcher')).toBeVisible();
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
