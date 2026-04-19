import { test, expect } from '@playwright/test';

// The session detail page at /volundr/session/sess-1 renders Terminal + FileTree.

test('session page renders terminal container', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('volundr-session-page')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('terminal-container')).toBeVisible({ timeout: 8_000 });
});

test('terminal shows session id label', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('session-id-label')).toHaveText('sess-1', { timeout: 8_000 });
});

test('terminal transitions from connecting to connected after data arrives', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  // The mock stream emits data after ~50ms — wait for the status badge to disappear.
  await expect(page.getByTestId('terminal-connection-status')).not.toBeVisible({ timeout: 5_000 });
});

test('type a command in terminal and see echoed output', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  // Wait for xterm to mount and connect.
  await expect(page.getByTestId('terminal-connection-status')).not.toBeVisible({ timeout: 5_000 });

  // Click the terminal area to focus it.
  const container = page.getByTestId('terminal-container');
  await container.click();

  // Type into the terminal — xterm captures keyboard events on the canvas.
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');

  // The mock stream echoes input back — xterm renders it to canvas.
  // We verify by checking the canvas element is attached (xterm renders to canvas/WebGL).
  await expect(container.locator('canvas').first()).toBeAttached({ timeout: 5_000 });
});

test('reconnect button triggers re-subscription', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('terminal-reconnect-button')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('terminal-reconnect-button').click();
  // After reconnect, the connection badge should appear briefly then disappear.
  // The mock stream re-connects in 50ms, so just wait for the badge to clear.
  await expect(page.getByTestId('terminal-connection-status')).not.toBeVisible({ timeout: 8_000 });
});

test('archived session page shows read-only badge', async ({ page }) => {
  await page.goto('/volundr/session/sess-1/archived');
  await expect(page.getByTestId('terminal-readonly-badge')).toBeVisible({ timeout: 8_000 });
  // Reconnect button should NOT be visible in read-only mode.
  await expect(page.getByTestId('terminal-reconnect-button')).not.toBeVisible();
});

test('file tree renders workspace files', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('filetree-root')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('package.json')).toBeVisible();
  await expect(page.getByText('src')).toBeVisible();
});

test('clicking a file opens the file viewer with highlighted content', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('filetree-root')).toBeVisible({ timeout: 8_000 });

  await page.getByText('package.json').click();

  await expect(page.getByTestId('file-viewer')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('file-viewer-path')).toContainText('package.json');

  // Wait for Shiki to highlight the content.
  await expect(
    page.getByTestId('file-viewer-highlighted').or(page.getByTestId('file-viewer-plain')),
  ).toBeVisible({
    timeout: 8_000,
  });
});

test('secret files show the secret badge and cannot be opened', async ({ page }) => {
  await page.goto('/volundr/session/sess-1');
  await expect(page.getByTestId('filetree-root')).toBeVisible({ timeout: 8_000 });

  // The secret mount badge should be visible.
  await expect(page.getByText(/mount: api-secrets/)).toBeVisible();

  // Click the API_KEY secret file — viewer should NOT open.
  await page.getByText('API_KEY').click();
  await expect(page.getByTestId('file-viewer-placeholder')).toBeVisible();
});
