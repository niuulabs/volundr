import { UserManager, WebStorageStateStore, type UserManagerSettings } from 'oidc-client-ts';
import type { RuntimeConfig } from '@/config';

export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scope: string;
}

/**
 * Build OIDC configuration from runtime config.
 * Returns null when OIDC is not configured (dev / allow-all mode).
 */
export function getOidcConfig(runtimeConfig: RuntimeConfig | null): OidcConfig | null {
  const oidc = runtimeConfig?.oidc;
  if (!oidc?.authority || !oidc?.clientId) {
    return null;
  }

  return {
    authority: oidc.authority,
    clientId: oidc.clientId,
    redirectUri: oidc.redirectUri || window.location.origin,
    postLogoutRedirectUri: oidc.postLogoutRedirectUri || window.location.origin,
    scope: oidc.scope || 'openid profile email',
  };
}

let userManagerInstance: UserManager | null = null;

/**
 * Create (or return cached) UserManager for the given OIDC config.
 */
export function getUserManager(config: OidcConfig): UserManager {
  if (userManagerInstance) {
    return userManagerInstance;
  }

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

  userManagerInstance = new UserManager(settings);
  return userManagerInstance;
}
