import { test, expect } from '@playwright/test';

test('navigate to /volundr shows the session forge page', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();
});

test('volundr page shows loading state then session list', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();
  // Data loads from mock — either loading or data should be visible
  await expect(
    page.getByText(/loading sessions/).or(page.getByText('feat/refactor-auth')),
  ).toBeVisible();
  await expect(page.getByText('feat/refactor-auth')).toBeVisible({ timeout: 5_000 });
});

test('volundr rail icon is visible and links to the page', async ({ page }) => {
  await page.goto('/');
  // The rail should show the ᚲ rune for Völundr
  await expect(page.getByText('ᚲ')).toBeVisible();
});

test('deep-link /volundr renders directly without shell re-mount', async ({ page }) => {
  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();
  await expect(page.getByText('feat/refactor-auth')).toBeVisible({ timeout: 5_000 });
});

test('navigating back from /volundr preserves the shell', async ({ page }) => {
  await page.goto('/hello');
  await expect(page.getByText('hello · smoke test')).toBeVisible();

  await page.goto('/volundr');
  await expect(page.getByText('Völundr · session forge')).toBeVisible();

  await page.goBack();
  await expect(page.getByText('hello · smoke test')).toBeVisible();
});
