import { test, expect } from '@playwright/test';

test('observatory rail button navigates to /observatory', async ({ page }) => {
  await page.goto('/');

  // The rail should contain a button for the Observatory plugin (rune ᚠ)
  const railButton = page.locator('.niuu-shell__rail button[title*="Observatory"]');
  await expect(railButton).toBeVisible();

  await railButton.click();
  await expect(page).toHaveURL(/\/observatory/);
  await expect(page.getByText('Observatory').first()).toBeVisible();
});

test('observatory page shows topology node and edge counts', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Observatory').first()).toBeVisible();
  await expect(page.getByText('nodes')).toBeVisible();
  await expect(page.getByText('edges')).toBeVisible();
});

test('observatory page shows recent events', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByText('Recent events')).toBeVisible({ timeout: 5000 });
});

// ── Registry page ─────────────────────────────────────────────────────────────

test('registry page renders entity type list', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByText('Registry').first()).toBeVisible();
  await expect(page.getByText('Realm').first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Cluster')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Raid')).toBeVisible({ timeout: 5000 });
});

test('registry: Types tab is active by default', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByTestId('tab-types')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('tab-types')).toHaveAttribute('aria-selected', 'true');
});

test('registry: clicking a type row opens the preview drawer', async ({ page }) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="type-row-cluster"]', { timeout: 5000 });

  await page.click('[data-testid="type-row-cluster"]');
  await expect(page.getByTestId('type-preview-drawer')).toBeVisible();
  await expect(page.getByTestId('type-preview-drawer')).toContainText('Cluster');
});

test('registry: search filters type list', async ({ page }) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="tab-types"]', { timeout: 5000 });

  await page.fill('[aria-label="Filter types"]', 'realm');
  await expect(page.getByTestId('type-row-realm')).toBeVisible();
  await expect(page.getByTestId('type-row-cluster')).not.toBeVisible();
});

test('registry: Containment tab shows tree with root nodes', async ({ page }) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="tab-containment"]', { timeout: 5000 });

  await page.click('[data-testid="tab-containment"]');
  await expect(page.getByTestId('containment-tree')).toBeVisible();
  await expect(page.getByTestId('tree-node-realm')).toBeVisible();
});

test('registry: JSON tab shows formatted registry JSON', async ({ page }) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="tab-json"]', { timeout: 5000 });

  await page.click('[data-testid="tab-json"]');
  await expect(page.getByTestId('json-output')).toBeVisible();
  await expect(page.getByTestId('json-output')).toContainText('"version"');
  await expect(page.getByTestId('copy-json-btn')).toBeVisible();
});

test('registry: drag a type, drop on valid target, verify parentTypes updated', async ({
  page,
}) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="tab-containment"]', { timeout: 5000 });
  await page.click('[data-testid="tab-containment"]');

  // host is currently a child of cluster; drag it to realm
  const hostNode = page.getByTestId('tree-node-host');
  const realmNode = page.getByTestId('tree-node-realm');

  await hostNode.dragTo(realmNode);

  // After drop the JSON should show host.parentTypes = ['realm']
  await page.click('[data-testid="tab-json"]');
  const jsonText = await page.getByTestId('json-output').textContent();
  const registry = JSON.parse(jsonText ?? '{}');
  const host = registry.types.find((t: { id: string }) => t.id === 'host');
  expect(host?.parentTypes).toContain('realm');
  expect(registry.version).toBeGreaterThan(7);
});

test('registry: cycle is rejected — dragging ancestor onto descendant does nothing', async ({
  page,
}) => {
  await page.goto('/registry');
  await page.waitForSelector('[data-testid="tab-containment"]', { timeout: 5000 });
  await page.click('[data-testid="tab-containment"]');

  const realmNode = page.getByTestId('tree-node-realm');
  const hostNode = page.getByTestId('tree-node-host');

  // Note initial version
  await page.click('[data-testid="tab-json"]');
  const before = await page.getByTestId('json-output').textContent();
  const versionBefore = JSON.parse(before ?? '{}').version as number;

  await page.click('[data-testid="tab-containment"]');
  await realmNode.dragTo(hostNode);

  // Version should not change
  await page.click('[data-testid="tab-json"]');
  const after = await page.getByTestId('json-output').textContent();
  const versionAfter = JSON.parse(after ?? '{}').version as number;
  expect(versionAfter).toBe(versionBefore);
});
