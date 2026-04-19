import { test, expect } from '@playwright/test';

test.describe('Data Surfaces Showcase', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/showcase');
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  test('loads showcase page and shows heading', async ({ page }) => {
    await expect(page.getByText('Data Surfaces · Showcase')).toBeVisible();
  });

  test('renders KPI strip with all four metrics', async ({ page }) => {
    await expect(page.getByText('Active Sessions')).toBeVisible();
    await expect(page.getByText('Error Rate')).toBeVisible();
    await expect(page.getByText('P99 Latency')).toBeVisible();
    await expect(page.getByText('Throughput')).toBeVisible();
  });

  test('renders sessions table in loaded state', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Sessions table' })).toBeVisible();
    await expect(page.getByText('session-alpha')).toBeVisible();
    await expect(page.getByText('session-beta')).toBeVisible();
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  test('shows loading state', async ({ page }) => {
    await page.getByTestId('state-btn-loading').click();
    await expect(page.getByText('Loading sessions…')).toBeVisible();
    await expect(page.getByRole('table')).not.toBeVisible();
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  test('shows empty state', async ({ page }) => {
    await page.getByTestId('state-btn-empty').click();
    await expect(page.getByText('No sessions found')).toBeVisible();
    await expect(page.getByRole('table')).not.toBeVisible();
  });

  test('empty state has clear filters action', async ({ page }) => {
    await page.getByTestId('state-btn-empty').click();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  });

  // ── Error state ────────────────────────────────────────────────────────────

  test('shows error state', async ({ page }) => {
    await page.getByTestId('state-btn-error').click();
    await expect(page.getByText('Failed to load sessions')).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/i })).toBeVisible();
    await expect(page.getByRole('table')).not.toBeVisible();
  });

  test('error state has alert role', async ({ page }) => {
    await page.getByTestId('state-btn-error').click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  // ── Filter ─────────────────────────────────────────────────────────────────

  test('search filters table rows', async ({ page }) => {
    const search = page.getByPlaceholder('Search sessions…');
    await search.fill('alpha');
    await expect(page.getByText('session-alpha')).toBeVisible();
    await expect(page.getByText('session-beta')).not.toBeVisible();
  });

  test('clear button removes search text', async ({ page }) => {
    const search = page.getByPlaceholder('Search sessions…');
    await search.fill('alpha');
    await page.getByLabel('Clear search').click();
    await expect(search).toHaveValue('');
    await expect(page.getByText('session-beta')).toBeVisible();
  });

  // ── Sorting ────────────────────────────────────────────────────────────────

  test('clicking column header sorts the table', async ({ page }) => {
    const nameHeader = page.getByRole('columnheader', { name: /session/i });
    await nameHeader.click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await nameHeader.click();
    await expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
  });

  // ── Selection ─────────────────────────────────────────────────────────────

  test('select-all checkbox selects all rows', async ({ page }) => {
    const selectAll = page.getByLabel('Select all rows');
    await selectAll.check();
    const rowCheckboxes = page.getByLabel(/Select row/);
    await expect(rowCheckboxes.first()).toBeChecked();
  });

  // ── Row expand ────────────────────────────────────────────────────────────

  test('expand button shows expanded row content', async ({ page }) => {
    const expandBtns = page.getByLabel('Expand row');
    await expandBtns.first().click();
    await expect(page.getByText(/Session ID:/)).toBeVisible();
  });

  // ── Keyboard accessibility ─────────────────────────────────────────────────

  test('search input is reachable via Tab', async ({ page }) => {
    await page.keyboard.press('Tab');
    const search = page.getByPlaceholder('Search sessions…');
    // Tab through enough elements to reach search
    for (let i = 0; i < 20; i++) {
      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('placeholder'),
      );
      if (focused === 'Search sessions…') break;
      await page.keyboard.press('Tab');
    }
    await expect(search).toBeFocused();
  });

  test('filter toggle is pressable with keyboard', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'High score (>80)' });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
