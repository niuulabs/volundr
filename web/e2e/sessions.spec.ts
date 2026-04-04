import { test, expect } from './fixtures';
import { createSession, deleteSession, listSessions, uniqueSessionName } from './helpers/api';
import type { Page } from '@playwright/test';

/**
 * Intercept API calls that may fail in the E2E environment and return
 * safe default responses.  This prevents the Volundr page from getting
 * stuck on "Loading..." when optional backend services are unavailable.
 */
async function stubMissingApis(page: Page) {
  const fallbacks: Record<string, string> = {
    '**/api/v1/niuu/repos': '{}',
    '**/api/v1/volundr/models': '[]',
    '**/api/v1/volundr/mcp-servers': '[]',
    '**/api/v1/volundr/secrets': '[]',
    '**/api/v1/volundr/templates': '[]',
    '**/api/v1/volundr/presets': '[]',
  };

  for (const [pattern, body] of Object.entries(fallbacks)) {
    await page.route(pattern, async (route) => {
      const response = await route.fetch().catch(() => null);
      if (!response || !response.ok()) {
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      }
      return route.fulfill({ response });
    });
  }
}

/**
 * Wait for the Volundr page to finish loading data.
 * The page shows "Loading..." until stats are fetched from the API.
 */
async function waitForPageReady(page: Page) {
  await expect(page.getByText('Loading...')).toBeHidden({ timeout: 30_000 });
}

/**
 * Navigate to /volundr with API stubs and wait for page to load.
 */
async function navigateToVolundr(page: Page) {
  await stubMissingApis(page);
  await page.goto('/volundr');
  await page.waitForURL('**/volundr', { timeout: 15_000 });
  await waitForPageReady(page);
}

test.describe('sessions', () => {
  test('page loads and shows main UI elements', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // The "New Session" button should always be visible
    await expect(page.getByRole('button', { name: /New Session/i })).toBeVisible();
  });

  test('launch wizard opens and shows template step', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // Click New Session to open the launch wizard
    await page.getByRole('button', { name: /New Session/i }).click();

    // Step 1: Template selection should be visible with "Blank" option
    await expect(page.getByText('Blank')).toBeVisible({ timeout: 5_000 });
  });

  test('session created via API appears in list', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;

    // Seed a session via API first
    const session = await createSession(request);

    // Verify session exists in API response
    const sessions = await listSessions(request);
    const found = sessions.find(s => s.id === session.id);
    expect(found).toBeDefined();

    // Now navigate to the page (fresh load will include the session)
    await navigateToVolundr(page);

    // Session should appear in the sidebar list
    await expect(page.getByText(session.name)).toBeVisible({ timeout: 15_000 });
  });

  test('session detail view shows session info', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;

    // Seed a session via API first
    const session = await createSession(request);

    // Navigate to the page (fresh load will include the session)
    await navigateToVolundr(page);

    // Click on the session in the list
    await page.getByText(session.name).click();

    // Verify detail panel shows session info
    await expect(page.getByText(session.name)).toBeVisible();

    // The session bar should show status and action buttons
    await expect(
      page.getByRole('button', { name: /Stop|Start/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('delete session removes it from list', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;

    // Seed a session via API first
    const session = await createSession(request);

    // Navigate to the page
    await navigateToVolundr(page);

    // Select the session
    await page.getByText(session.name).click();

    // Click delete button
    await page.getByRole('button', { name: /Delete session/i }).click();

    // Confirm deletion in dialog
    const confirmButton = page.getByTestId('delete-session-confirm');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Verify session is removed from the list
    await expect(page.getByText(session.name)).toBeHidden({ timeout: 10_000 });
  });
});
