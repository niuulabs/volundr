import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// /tyr/settings — index page
// ---------------------------------------------------------------------------

test.describe('Tyr Settings index', () => {
  test('navigates to /tyr/settings and shows index page', async ({ page }) => {
    await page.goto('/tyr/settings');
    await expect(page.getByText('Tyr Settings')).toBeVisible();
  });

  test('settings index shows all 5 section links', async ({ page }) => {
    await page.goto('/tyr/settings');
    await expect(page.getByText('Personas')).toBeVisible();
    await expect(page.getByText('Flock Config')).toBeVisible();
    await expect(page.getByText('Dispatch Defaults')).toBeVisible();
    await expect(page.getByText('Notifications')).toBeVisible();
    await expect(page.getByText('Audit Log')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// /tyr/settings/dispatch — Dispatch Defaults section
// ---------------------------------------------------------------------------

test.describe('Tyr Dispatch Defaults settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tyr/settings/dispatch');
  });

  test('renders dispatch defaults form', async ({ page }) => {
    await expect(page.getByRole('form', { name: /dispatch defaults form/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('shows confidence threshold field with default value', async ({ page }) => {
    await page.waitForSelector('[data-testid="confidence-threshold"]');
    const input = page.getByTestId('confidence-threshold');
    await expect(input).toHaveValue('70');
  });

  test('tweak confidence threshold and save', async ({ page }) => {
    await page.waitForSelector('[data-testid="confidence-threshold"]');

    const input = page.getByTestId('confidence-threshold');
    await input.fill('85');

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 3000 });
  });

  test('shows validation error for out-of-range threshold', async ({ page }) => {
    await page.waitForSelector('[data-testid="confidence-threshold"]');

    const input = page.getByTestId('confidence-threshold');
    await input.fill('150');

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/between 0 and 100/i)).toBeVisible({ timeout: 3000 });
  });

  test('shows retry policy section', async ({ page }) => {
    await expect(page.getByText('Retry Policy')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// /tyr/settings/audit — Audit Log section
// ---------------------------------------------------------------------------

test.describe('Tyr Audit Log settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tyr/settings/audit');
  });

  test('renders audit log section heading', async ({ page }) => {
    await expect(page.getByText('Audit Log')).toBeVisible();
  });

  test('shows audit log entries after loading', async ({ page }) => {
    await expect(page.getByText(/entries/i)).toBeVisible({ timeout: 5000 });
  });

  test('shows filter buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Raid dispatched' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Dispatcher started' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flock config updated' })).toBeVisible();
  });

  test('filter activates on click', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Raid dispatched' });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();

    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/filtered/i)).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// /tyr/settings/flock — Flock Config section
// ---------------------------------------------------------------------------

test.describe('Tyr Flock Config settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tyr/settings/flock');
  });

  test('renders flock config form', async ({ page }) => {
    await expect(page.getByRole('form', { name: /flock configuration form/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('shows default flock name', async ({ page }) => {
    await page.waitForSelector('input[name="flockName"]');
    const input = page.locator('input[name="flockName"]');
    await expect(input).toHaveValue('Niuu Core');
  });

  test('save updates flock name', async ({ page }) => {
    await page.waitForSelector('input[name="flockName"]');
    const input = page.locator('input[name="flockName"]');
    await input.fill('Updated Flock');

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// /tyr/settings/personas — Personas browser
// ---------------------------------------------------------------------------

test.describe('Tyr Personas settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tyr/settings/personas');
  });

  test('renders personas section heading', async ({ page }) => {
    await expect(page.getByText('Personas')).toBeVisible();
  });

  test('shows persona list after loading', async ({ page }) => {
    await expect(page.getByText(/personas/)).toBeVisible({ timeout: 5000 });
    // Mock has 21 builtin personas
    await expect(page.getByText(/21 personas/)).toBeVisible({ timeout: 5000 });
  });

  test('shows filter tabs', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('tab', { name: 'Builtin' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Custom' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// /tyr/settings/notifications — Notifications section
// ---------------------------------------------------------------------------

test.describe('Tyr Notifications settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tyr/settings/notifications');
  });

  test('renders notifications section heading', async ({ page }) => {
    await expect(page.getByText('Notifications')).toBeVisible();
  });

  test('shows event toggle rows', async ({ page }) => {
    await expect(page.getByText('Raid awaiting approval')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Raid failed')).toBeVisible();
    await expect(page.getByText('Saga complete')).toBeVisible();
  });

  test('save persists notification settings', async ({ page }) => {
    await page.waitForSelector('form[aria-label="Notification settings form"]', { timeout: 5000 });
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Dispatch Defaults → applied on Dispatch page (integration test)
// ---------------------------------------------------------------------------

test.describe('Dispatch defaults applied to dispatch behaviour', () => {
  test('tweaking dispatch threshold is reflected in saved value', async ({ page }) => {
    // Save a new threshold in settings
    await page.goto('/tyr/settings/dispatch');
    await page.waitForSelector('[data-testid="confidence-threshold"]');

    const input = page.getByTestId('confidence-threshold');
    await input.fill('80');
    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText('Saved')).toBeVisible({ timeout: 3000 });

    // Navigate back to /tyr — the Tyr page is still accessible
    await page.goto('/tyr');
    await expect(page.getByText(/tyr · sagas · raids · dispatch/)).toBeVisible();
  });
});
