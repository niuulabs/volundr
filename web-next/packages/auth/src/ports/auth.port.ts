/**
 * IDP-agnostic authentication port.
 *
 * Consumers depend on this interface — never on a concrete OIDC library.
 * Swap the adapter (Keycloak → Entra ID → Okta) by changing config only.
 */

export interface AuthUser {
  /** Subject identifier from the ID token */
  sub: string;
  /** User's email address */
  email: string | undefined;
  /** Display name (name claim) */
  name: string | undefined;
  /** Raw access token string */
  accessToken: string;
  /** Whether the token has expired locally */
  expired: boolean;
}

export interface AuthState {
  /** Whether auth is configured (OIDC issuer + clientId present in config) */
  enabled: boolean;
  /** Whether a valid, non-expired session exists */
  authenticated: boolean;
  /** True while auth state is being resolved (initial load / callback) */
  loading: boolean;
  /** The current user, null when not authenticated */
  user: AuthUser | null;
  /** Convenience: access token string, null when not authenticated */
  accessToken: string | null;
}

export interface IAuthService {
  /** Redirect to the IDP login page */
  login(): void;
  /** Redirect to the IDP logout endpoint */
  logout(): void;
}
