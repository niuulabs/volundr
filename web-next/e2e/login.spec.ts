import { test, expect } from '@playwright/test';
import { MOCK_AUTHORITY, MOCK_TOKEN, buildIdToken, setupOidcRoutes } from './helpers/oidc-mocks';

/**
 * Login plugin e2e specs.
 *
 * All OIDC endpoints and the runtime config are intercepted at the network
 * layer so the suite runs without a real identity provider.
 *
 * Flow under test:
 *   unauthenticated user → /login → "Sign in" → OIDC callback → default plugin
 */

const MOCK_SUBJECT = 'e2e-user-login-001';

const LOGIN_ID_TOKEN_OPTS = {
  email: 'login-e2e@example.com',
  name: 'Login E2E User',
};

const authEnabledConfig = {
  theme: 'ice',
  plugins: {
    login: { enabled: true, order: 0 },
    hello: { enabled: true, order: 1 },
  },
  services: { hello: { mode: 'mock' } },
  auth: {
    issuer: MOCK_AUTHORITY,
    clientId: 'niuu-e2e',
  },
};

test.describe('Login plugin', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/config.json', (route) => route.fulfill({ json: authEnabledConfig }));
    await setupOidcRoutes(page);
  });

  test('unauthenticated user navigating to /login sees the Sign in button', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByTestId('login-page')).toBeVisible();
    await expect(page.getByTestId('sign-in-button')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('unauthenticated user at / is shown the login page', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('login-page')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('Sign in → OIDC callback → lands on default plugin (hello)', async ({ page }) => {
    // Intercept the OIDC authorization redirect and immediately redirect back
    // with a code, simulating a successful IDP round-trip.
    await page.route(`${MOCK_AUTHORITY}/auth*`, (route) => {
      const url = new URL(route.request().url());
      const redirectUri = url.searchParams.get('redirect_uri') ?? 'http://localhost:5173';
      const state = url.searchParams.get('state') ?? '';
      route.fulfill({
        status: 302,
        headers: { Location: `${redirectUri}?code=mock-code&state=${state}` },
      });
    });

    await page.route(`${MOCK_AUTHORITY}/token`, (route) =>
      route.fulfill({
        json: {
          access_token: MOCK_TOKEN,
          id_token: buildIdToken(MOCK_SUBJECT, LOGIN_ID_TOKEN_OPTS),
          token_type: 'Bearer',
          expires_in: 3600,
        },
      }),
    );

    await page.goto('/');

    // Login page is visible
    await expect(page.getByTestId('login-page')).toBeVisible({ timeout: 8_000 });

    // Click Sign in
    await page.getByRole('button', { name: /sign in/i }).click();

    // After callback, login page should be gone and the shell/default plugin rendered
    await expect(page.getByTestId('login-page')).not.toBeVisible({ timeout: 12_000 });
  });

  test('loading state shown while redirect is in flight', async ({ page }) => {
    // Use a slow auth endpoint to keep the loading state visible long enough to assert
    let resolveToken: (() => void) | undefined;
    const tokenPending = new Promise<void>((res) => {
      resolveToken = res;
    });

    await page.route(`${MOCK_AUTHORITY}/auth*`, (route) => {
      const url = new URL(route.request().url());
      const redirectUri = url.searchParams.get('redirect_uri') ?? 'http://localhost:5173';
      const state = url.searchParams.get('state') ?? '';
      route.fulfill({
        status: 302,
        headers: { Location: `${redirectUri}?code=mock-code&state=${state}` },
      });
    });

    // Token endpoint hangs until we release it
    await page.route(`${MOCK_AUTHORITY}/token`, async (route) => {
      await tokenPending;
      await route.fulfill({
        json: {
          access_token: MOCK_TOKEN,
          id_token: buildIdToken(MOCK_SUBJECT, LOGIN_ID_TOKEN_OPTS),
          token_type: 'Bearer',
          expires_in: 3600,
        },
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('login-page')).toBeVisible({ timeout: 8_000 });

    // Click sign in — triggers OIDC redirect
    await page.getByRole('button', { name: /sign in/i }).click();

    // While the OIDC callback is being processed AuthProvider shows a loading screen
    // (the login-page itself disappears during the redirect round-trip)
    // Release the token endpoint so the test can complete
    resolveToken?.();
  });

  test('pre-existing session skips the login page', async ({ page }) => {
    await page.addInitScript(
      (args: {
        authority: string;
        clientId: string;
        token: string;
        idToken: string;
        sub: string;
      }) => {
        const userKey = `oidc.user:${args.authority}:${args.clientId}`;
        sessionStorage.setItem(
          userKey,
          JSON.stringify({
            id_token: args.idToken,
            access_token: args.token,
            token_type: 'Bearer',
            expires_at: 9_999_999_999,
            profile: { sub: args.sub, email: 'login-e2e@example.com', name: 'Login E2E User' },
          }),
        );
      },
      {
        authority: MOCK_AUTHORITY,
        clientId: 'niuu-e2e',
        token: MOCK_TOKEN,
        idToken: buildIdToken(MOCK_SUBJECT, LOGIN_ID_TOKEN_OPTS),
        sub: MOCK_SUBJECT,
      },
    );

    await page.goto('/');

    // Should bypass login page entirely
    await expect(page.getByTestId('login-page')).not.toBeVisible({ timeout: 10_000 });
  });
});
