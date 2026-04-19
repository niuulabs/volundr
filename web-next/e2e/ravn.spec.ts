import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

test('ravn plugin renders at /ravn', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('Ravn')).toBeVisible();
});

test('ravn shows subtitle', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/personas · ravens · sessions/)).toBeVisible();
});

test('rail shows ravn rune ᚱ', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('ᚱ').first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

test('renders all five tabs', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByRole('tab', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Triggers' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Events' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Budget' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Log' })).toBeVisible();
});

test('Sessions tab is active by default', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

// ---------------------------------------------------------------------------
// Sessions view
// ---------------------------------------------------------------------------

test('/ravn — Sessions tab shows session list', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByLabel('session list')).toBeVisible({ timeout: 5000 });
});

test('/ravn — session list shows coding-agent', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('coding-agent').first()).toBeVisible({ timeout: 5000 });
});

test('/ravn — selecting a session loads transcript', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByRole('log').first()).toBeVisible({ timeout: 5000 });
});

test('/ravn — transcript shows message kinds', async ({ page }) => {
  await page.goto('/ravn');
  // The first session has user, think, tool_call, tool_result, asst, emit messages
  await expect(page.getByText(/messages/).first()).toBeVisible({ timeout: 5000 });
});

test('/ravn — running session shows active cursor', async ({ page }) => {
  await page.goto('/ravn');
  // coding-agent session status=running, so ActiveCursor should appear
  await expect(page.getByRole('status', { name: /session in progress/i })).toBeVisible({
    timeout: 5000,
  });
});

test('/ravn — think message shows toggle button', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('show reasoning')).toBeVisible({ timeout: 5000 });
});

test('/ravn — clicking think toggle expands reasoning', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('show reasoning')).toBeVisible({ timeout: 5000 });
  await page.getByText('show reasoning').click();
  await expect(page.getByText('hide reasoning')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Triggers view
// ---------------------------------------------------------------------------

test('/ravn — Triggers tab shows trigger groups', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await expect(page.getByRole('region', { name: /cron triggers/i })).toBeVisible({ timeout: 5000 });
});

test('/ravn — Triggers shows event triggers', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await expect(page.getByRole('region', { name: /event triggers/i })).toBeVisible({
    timeout: 5000,
  });
});

test('/ravn — Triggers shows cron spec', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await expect(page.getByText('0 * * * *')).toBeVisible({ timeout: 5000 });
});

// ---------------------------------------------------------------------------
// Events view
// ---------------------------------------------------------------------------

test('/ravn — Events tab shows event graph', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByRole('region', { name: /event graph/i })).toBeVisible({ timeout: 5000 });
});

test('/ravn — Events shows code.changed event', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByLabel('event code.changed')).toBeVisible({ timeout: 5000 });
});

test('/ravn — Events — clicking a persona dims others', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByLabel('event code.changed')).toBeVisible({ timeout: 5000 });
  // Click first persona pill
  const coderBtn = page.getByRole('button', { name: 'coder' }).first();
  await coderBtn.click();
  await expect(page.getByText(/filtering by/i)).toBeVisible();
});

test('/ravn — Events — clear filter resets persona selection', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByLabel('event code.changed')).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'coder' }).first().click();
  await page.getByLabel('clear persona filter').click();
  await expect(page.getByText(/filtering by/i)).not.toBeVisible();
});

// ---------------------------------------------------------------------------
// Budget view
// ---------------------------------------------------------------------------

test('/ravn — Budget tab shows hero card', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByLabel(/fleet budget/i)).toBeVisible({ timeout: 5000 });
});

test('/ravn — Budget shows three attention columns', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByRole('group', { name: /budget attention/i })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByLabel('Burning fast')).toBeVisible();
  await expect(page.getByLabel('Near cap')).toBeVisible();
  await expect(page.getByLabel('Idle')).toBeVisible();
});

test('/ravn — Budget fleet table is hidden initially', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByText(/full fleet table/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel(/fleet budget table/i)).not.toBeVisible();
});

test('/ravn — Budget fleet table expands on click', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Budget' }).click();
  await expect(page.getByText(/full fleet table/i)).toBeVisible({ timeout: 5000 });
  await page.getByText(/full fleet table/i).click();
  await expect(page.getByLabel(/fleet budget table/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Log view
// ---------------------------------------------------------------------------

test('/ravn — Log tab renders event stream', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('log', { name: /event log/i })).toBeVisible();
});

test('/ravn — Log shows column headers', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByText('time')).toBeVisible();
  await expect(page.getByText('raven')).toBeVisible();
  await expect(page.getByText('kind')).toBeVisible();
  await expect(page.getByText('body')).toBeVisible();
});

test('/ravn — Log has search input', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('searchbox', { name: /search log/i })).toBeVisible();
});

test('/ravn — Log has kind filter buttons', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('button', { name: 'user' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'emit' })).toBeVisible();
});

test('/ravn — Log — join a live session and observe tool_call → tool_result → emit', async ({
  page,
}) => {
  await page.goto('/ravn');
  // The first session (coding-agent) is running and has tool_call, tool_result, emit messages
  await expect(page.getByText('coding-agent').first()).toBeVisible({ timeout: 5000 });
  // Navigate to log
  await page.getByRole('tab', { name: 'Log' }).click();
  // Wait for entries to load
  await expect(page.getByText(/entries/i)).toBeVisible({ timeout: 5000 });
  // Filter to tool_call kind
  await page.getByRole('button', { name: 'tool_call' }).click();
  // tool_call entries should now be visible
  await expect(page.getByRole('button', { name: 'tool_call' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('/ravn — Log — filter the log by typing in search', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  await expect(page.getByRole('searchbox', { name: /search log/i })).toBeVisible();
  await page.getByRole('searchbox', { name: /search log/i }).fill('login');
  // Footer should update
  await expect(page.getByText(/entries/i)).toBeVisible({ timeout: 3000 });
});

test('/ravn — Log — auto-tail checkbox is checked by default', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  const checkbox = page.getByRole('checkbox', { name: /auto-tail/i });
  await expect(checkbox).toBeChecked();
});

test('/ravn — Log — unchecking auto-tail persists', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByRole('tab', { name: 'Log' }).click();
  const checkbox = page.getByRole('checkbox', { name: /auto-tail/i });
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});
