import { UserManager, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';

export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scope: string;
}

export interface AuthConfig {
  issuer?: string;
  clientId?: string;
  redirectUri?: string;
  postLogoutRedirectUri?: string;
  scope?: string;
}

/**
 * Build OidcConfig from the runtime auth config block.
 * Returns null when OIDC is not configured (dev / allow-all mode).
 */
export function buildOidcConfig(authConfig: AuthConfig | undefined): OidcConfig | null {
  if (!authConfig?.issuer || !authConfig?.clientId) {
    return null;
  }

  return {
    authority: authConfig.issuer,
    clientId: authConfig.clientId,
    redirectUri: authConfig.redirectUri ?? window.location.origin,
    postLogoutRedirectUri: authConfig.postLogoutRedirectUri ?? window.location.origin,
    scope: authConfig.scope ?? 'openid profile email',
  };
}

/**
 * Create a new UserManager for the given OIDC config.
 * Intentionally not a singleton — AuthProvider owns the instance lifetime.
 */
export function createUserManager(config: OidcConfig): UserManager {
  const settings: UserManagerSettings = {
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    post_logout_redirect_uri: config.postLogoutRedirectUri,
    scope: config.scope,
    response_type: 'code',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  };

  return new UserManager(settings);
}
