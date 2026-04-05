import { test, expect } from './fixtures';
import { createSession, deleteSession, listSessions, uniqueSessionName } from './helpers/api';
import type { Page, Route } from '@playwright/test';

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
    await page.route(pattern, async (route: Route) => {
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

test.describe('sessions — page load', () => {
  test('page loads and shows main UI elements', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // The "New Session" button should always be visible
    await expect(page.getByRole('button', { name: /New Session/i })).toBeVisible();
  });

  test('shows status filter dropdown', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // The status filter should be present (a select element with "All" option)
    const select = page.locator('select').filter({ hasText: 'All' });
    await expect(select).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('sessions — launch wizard', () => {
  test('opens wizard and shows template selection', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // Click New Session to open the launch wizard
    await page.getByRole('button', { name: /New Session/i }).click();

    // Step 1: Template selection should be visible with "Blank" option
    await expect(page.getByText('Blank')).toBeVisible({ timeout: 5_000 });
  });

  test('configure step shows session name input', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToVolundr(page);

    // Open wizard and select Blank template
    await page.getByRole('button', { name: /New Session/i }).click();
    await expect(page.getByText('Blank')).toBeVisible({ timeout: 5_000 });
    await page.getByText('Blank').click();

    // Step 2: Configure step should show the name input
    const nameInput = page.getByPlaceholder('e.g. feature-auth-refactor');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('sessions — API operations', () => {
  test('create session via API returns valid response', async ({ request }) => {
    const name = uniqueSessionName('e2e-api-create');
    const session = await createSession(request, { name });

    expect(session.id).toBeDefined();
    expect(session.name).toBe(name);
    expect(session.model).toBe('sonnet');
  });

  test('list sessions includes created session', async ({ request }) => {
    const session = await createSession(request);

    const sessions = await listSessions(request);
    const found = sessions.find(s => s.id === session.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe(session.name);
  });

  test('delete session removes it from list', async ({ request }) => {
    const session = await createSession(request);

    // Verify it exists
    const before = await listSessions(request);
    expect(before.some(s => s.id === session.id)).toBe(true);

    // Delete it
    await deleteSession(request, session.id);

    // Verify it's gone
    const after = await listSessions(request);
    expect(after.some(s => s.id === session.id)).toBe(false);
  });
});
