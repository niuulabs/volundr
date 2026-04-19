import { test, expect } from '@playwright/test';

test('navigate to /volundr shows the session forge page', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();
});

test('volundr overview shows KPI strip after data loads', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();
  // Wait for KPI cards to appear.
  await expect(page.getByText('active')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('idle')).toBeVisible();
  await expect(page.getByText('total CPU')).toBeVisible();
});

test('volundr overview shows cluster health section', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Cluster health')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('cluster-card')).toBeVisible();
});

test('volundr rail icon is visible and links to the page', async ({ page }) => {
  await page.goto('/');
  // The rail should show the ᚲ rune for Völundr.
  await expect(page.getByText('ᚲ')).toBeVisible();
});

test('navigating back from /volundr preserves the shell', async ({ page }) => {
  await page.goto('/hello');
  await expect(page.getByText('hello · smoke test')).toBeVisible();

  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();

  await page.goBack();
  await expect(page.getByText('hello · smoke test')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Sessions page
// ---------------------------------------------------------------------------

test('sessions page shows state subnav', async ({ page }) => {
  await page.goto('/volundr/sessions');
  await expect(page.getByTestId('sessions-page')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('state-tab-running')).toBeVisible();
  await expect(page.getByTestId('state-tab-idle')).toBeVisible();
  await expect(page.getByTestId('state-tab-failed')).toBeVisible();
});

test('sessions page state tabs switch the displayed sessions', async ({ page }) => {
  await page.goto('/volundr/sessions');
  await expect(page.getByTestId('sessions-page')).toBeVisible({ timeout: 8_000 });

  // Running tab is default — ds-1 is running.
  await expect(page.getByText('ds-1')).toBeVisible({ timeout: 5_000 });

  // Switch to idle — ds-2 is idle.
  await page.getByTestId('state-tab-idle').click();
  await expect(page.getByText('ds-2')).toBeVisible({ timeout: 5_000 });
});

test('clicking view on a session navigates to the detail page', async ({ page }) => {
  await page.goto('/volundr/sessions');
  await expect(page.getByTestId('sessions-page')).toBeVisible({ timeout: 8_000 });

  // Wait for sessions to load.
  await expect(page.getByTestId('view-session-ds-1')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('view-session-ds-1').click();

  await expect(page).toHaveURL(/\/volundr\/session\/ds-1/, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Session detail — six tabs
// ---------------------------------------------------------------------------

test('session detail page renders all six tabs', async ({ page }) => {
  await page.goto('/volundr/session/ds-1');
  await expect(page.getByTestId('session-detail-page')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('tab-overview')).toBeVisible();
  await expect(page.getByTestId('tab-terminal')).toBeVisible();
  await expect(page.getByTestId('tab-files')).toBeVisible();
  await expect(page.getByTestId('tab-exec')).toBeVisible();
  await expect(page.getByTestId('tab-events')).toBeVisible();
  await expect(page.getByTestId('tab-metrics')).toBeVisible();
});

test('session id is shown in the header', async ({ page }) => {
  await page.goto('/volundr/session/ds-1');
  await expect(page.getByTestId('session-id-label')).toHaveText('ds-1', { timeout: 8_000 });
});

test('switching through all six tabs works', async ({ page }) => {
  await page.goto('/volundr/session/ds-1');
  await expect(page.getByTestId('session-detail-page')).toBeVisible({ timeout: 8_000 });

  // Overview (default)
  await expect(page.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');

  // Terminal tab
  await page.getByTestId('tab-terminal').click();
  await expect(page.getByTestId('tab-terminal')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('terminal-container')).toBeVisible({ timeout: 5_000 });

  // Files tab
  await page.getByTestId('tab-files').click();
  await expect(page.getByTestId('tab-files')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('filetree-root')).toBeVisible({ timeout: 5_000 });

  // Exec tab
  await page.getByTestId('tab-exec').click();
  await expect(page.getByTestId('tab-exec')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('exec-tab')).toBeVisible();

  // Events tab
  await page.getByTestId('tab-events').click();
  await expect(page.getByTestId('tab-events')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('events-tab')).toBeVisible({ timeout: 3_000 });

  // Metrics tab
  await page.getByTestId('tab-metrics').click();
  await expect(page.getByTestId('tab-metrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('metrics-tab')).toBeVisible();
});

test('exec tab — run a command and see it in history', async ({ page }) => {
  await page.goto('/volundr/session/ds-1');
  await expect(page.getByTestId('session-detail-page')).toBeVisible({ timeout: 8_000 });

  await page.getByTestId('tab-exec').click();
  await expect(page.getByTestId('exec-input')).toBeVisible();

  // Type a command and run it.
  await page.getByTestId('exec-input').fill('echo hello');
  await page.getByTestId('exec-run-btn').click();

  // An exec entry should appear in the history.
  await expect(page.getByTestId('exec-entry').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/echo hello/)).toBeVisible();
});

test('archived session shows archived badge', async ({ page }) => {
  await page.goto('/volundr/session/ds-5/archived');
  await expect(page.getByTestId('session-archived-badge')).toBeVisible({ timeout: 8_000 });
});
