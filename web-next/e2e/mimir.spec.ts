import { test, expect } from '@playwright/test';

test('navigate to /mimir renders the page header', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('Mímir')).toBeVisible();
  await expect(page.getByText('the well of knowledge')).toBeVisible();
});

test('/mimir renders tab navigation', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Pages' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sources' })).toBeVisible();
});

test('Overview tab shows KPI strip', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('pages')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('sources')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('lint issues')).toBeVisible({ timeout: 5000 });
});

test('Overview tab shows mount cards', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByRole('article', { name: /mount local/ })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByRole('article', { name: /mount shared/ })).toBeVisible({
    timeout: 5000,
  });
});

test('Overview tab shows recent-writes feed', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByRole('log', { name: /recent writes/ })).toBeVisible({ timeout: 5000 });
});

test('switching to Pages tab shows the file tree', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await expect(page.getByRole('complementary', { name: /page tree/ })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText('arch/')).toBeVisible({ timeout: 5000 });
});

test('can open a page and see its title', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Pages' }).click();
  // Click on the arch/ dir then overview leaf
  const archDir = page.getByText('arch/');
  await expect(archDir).toBeVisible({ timeout: 5000 });
  // Leaf node for overview
  await page.getByRole('button', { name: /overview/ }).first().click();
  await expect(page.getByText('Architecture Overview')).toBeVisible({ timeout: 5000 });
});

test('edit a zone and cancel restores read mode', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Pages' }).click();
  // Open architecture overview
  await page.getByRole('button', { name: /overview/ }).first().click();
  await expect(page.getByText('Architecture Overview')).toBeVisible({ timeout: 5000 });
  // Click edit on first zone
  const editBtn = page.getByRole('button', { name: /edit key-facts zone/ });
  await expect(editBtn).toBeVisible({ timeout: 5000 });
  await editBtn.click();
  // Zone edit area is visible
  await expect(page.getByRole('textbox', { name: /zone edit area/ })).toBeVisible();
  // Cancel returns to read mode
  await page.getByRole('button', { name: /cancel edit/ }).click();
  await expect(page.getByRole('textbox', { name: /zone edit area/ })).not.toBeVisible();
});

test('save a zone shows destination mount in success banner', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: /overview/ }).first().click();
  await expect(page.getByText('Architecture Overview')).toBeVisible({ timeout: 5000 });
  const editBtn = page.getByRole('button', { name: /edit key-facts zone/ });
  await expect(editBtn).toBeVisible({ timeout: 5000 });
  await editBtn.click();
  await page.getByRole('button', { name: /save key-facts zone/ }).click();
  // After save, a success banner with destination mount(s) should appear
  await expect(page.getByText(/saved →/)).toBeVisible({ timeout: 5000 });
});

test('switching to Sources tab shows origin filter tabs', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Sources' }).click();
  await expect(page.getByRole('tab', { name: 'all' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('tab', { name: 'web' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'file' })).toBeVisible();
});

test('Sources tab shows source count', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Sources' }).click();
  await expect(page.getByText(/sources/)).toBeVisible({ timeout: 5000 });
});

test('filtering sources by origin updates the count', async ({ page }) => {
  await page.goto('/mimir');
  await page.getByRole('tab', { name: 'Sources' }).click();
  await expect(page.getByText('7 sources')).toBeVisible({ timeout: 5000 });
  await page.getByRole('tab', { name: 'web' }).click();
  await expect(page.getByText(/1 source/)).toBeVisible({ timeout: 3000 });
});

test('mimir rune is visible in the rail', async ({ page }) => {
  await page.goto('/mimir');
  await expect(page.getByText('ᛗ')).toBeVisible();
});
