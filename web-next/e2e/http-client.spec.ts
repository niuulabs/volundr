import { test, expect } from '@playwright/test';

/**
 * E2E: Hello plugin round-trips through the HTTP client.
 *
 * Strategy:
 * 1. Override config.json to set hello service to HTTP mode
 * 2. Intercept the API call and return mock greeting data
 * 3. Verify the UI renders the API-supplied greetings
 *
 * Token provider integration is covered by unit tests in client.test.ts.
 */
test.describe('HTTP client', () => {
  test('hello plugin fetches greetings via HTTP client', async ({ page }) => {
    const mockGreetings = [
      { id: 'e2e-1', text: 'greeting from API', mood: 'warm' },
      { id: 'e2e-2', text: 'token was accepted', mood: 'curious' },
    ];

    // Intercept config.json to enable HTTP mode for hello service
    await page.route('**/config.json', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'ice',
          plugins: { hello: { enabled: true, order: 1 } },
          services: {
            hello: { baseUrl: '/api/v1/hello', mode: 'http' },
          },
        }),
      });
    });

    // Intercept the hello API call
    await page.route('**/api/v1/hello/greetings', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(mockGreetings),
      });
    });

    await page.goto('/');

    // The greetings should render from the mocked API response
    await expect(page.getByText('greeting from API')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('token was accepted')).toBeVisible();

    // Verify the page rendered both greeting items
    await expect(page.locator('li')).toHaveCount(2);
  });

  test('hello plugin shows loading state before data resolves', async ({ page }) => {
    // Intercept config for HTTP mode
    await page.route('**/config.json', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'ice',
          plugins: { hello: { enabled: true, order: 1 } },
          services: {
            hello: { baseUrl: '/api/v1/hello', mode: 'http' },
          },
        }),
      });
    });

    // Delay the API response to observe loading state
    await page.route('**/api/v1/hello/greetings', async (route) => {
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ id: '1', text: 'delayed greeting', mood: 'warm' }]),
      });
    });

    await page.goto('/');

    // Loading state should appear first
    await expect(page.getByText('loading…')).toBeVisible({ timeout: 3000 });

    // Then data should appear
    await expect(page.getByText('delayed greeting')).toBeVisible({ timeout: 5000 });
  });

  test('hello plugin shows error state when API fails', async ({ page }) => {
    await page.route('**/config.json', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'ice',
          plugins: { hello: { enabled: true, order: 1 } },
          services: {
            hello: { baseUrl: '/api/v1/hello', mode: 'http' },
          },
        }),
      });
    });

    // Return an error from the API
    await page.route('**/api/v1/hello/greetings', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    });

    await page.goto('/');

    // Error state should appear
    await expect(page.getByText(/error|failed/i)).toBeVisible({ timeout: 5000 });
  });
});
