import { test as base, type Page } from '@playwright/test';

/**
 * Wait for the app to finish auth initialisation.
 *
 * Without OIDC env vars the AuthProvider immediately sets
 * `authenticated: true`, but the React tree still needs a tick to render.
 * This helper navigates to the root and waits for the redirect to /volundr
 * (which proves the auth gate passed and the router is active).
 */
async function waitForAuth(page: Page, baseURL: string) {
  await page.goto(baseURL);
  await page.waitForURL('**/volundr', { timeout: 15_000 });
}

type Fixtures = {
  authenticatedPage: Page;
};

export const test = base.extend<Fixtures>({
  authenticatedPage: async ({ page, baseURL }, use) => {
    await waitForAuth(page, baseURL ?? 'http://localhost:5174');
    await use(page);
  },
});

export { expect } from '@playwright/test';
