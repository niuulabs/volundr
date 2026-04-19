/**
 * Shared OIDC mock helpers for Playwright e2e specs.
 *
 * Centralises the discovery document, token builder, and route setup so
 * auth.spec.ts and login.spec.ts don't diverge.
 */
import type { Page } from '@playwright/test';

export const MOCK_AUTHORITY = 'http://localhost:5173/mock-oidc';
export const MOCK_TOKEN = 'e2e-access-token';

export const discoveryDoc = {
  issuer: MOCK_AUTHORITY,
  authorization_endpoint: `${MOCK_AUTHORITY}/auth`,
  token_endpoint: `${MOCK_AUTHORITY}/token`,
  end_session_endpoint: `${MOCK_AUTHORITY}/logout`,
  jwks_uri: `${MOCK_AUTHORITY}/jwks`,
  response_types_supported: ['code'],
  subject_types_supported: ['public'],
  id_token_signing_alg_values_supported: ['RS256'],
};

export interface IdTokenOptions {
  /** Defaults to 'e2e@example.com' */
  email?: string;
  /** Defaults to 'E2E User' */
  name?: string;
  /** Defaults to 'niuu-e2e' */
  clientId?: string;
}

/** Minimal JWT-shaped ID token (not verified — tests stub the JWKS endpoint). */
export function buildIdToken(sub: string, opts: IdTokenOptions = {}): string {
  const { email = 'e2e@example.com', name = 'E2E User', clientId = 'niuu-e2e' } = opts;
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      sub,
      email,
      name,
      iss: MOCK_AUTHORITY,
      aud: clientId,
      exp: 9_999_999_999,
      iat: 1_700_000_000,
    }),
  );
  return `${header}.${payload}.signature`;
}

/** Register the OIDC discovery and JWKS routes on a Playwright page. */
export async function setupOidcRoutes(page: Page): Promise<void> {
  await page.route(`${MOCK_AUTHORITY}/.well-known/openid-configuration`, (route) =>
    route.fulfill({ json: discoveryDoc }),
  );
  await page.route(`${MOCK_AUTHORITY}/jwks`, (route) => route.fulfill({ json: { keys: [] } }));
}
