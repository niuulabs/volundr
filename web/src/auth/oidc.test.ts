import { describe, it, expect } from 'vitest';
import { getOidcConfig, getUserManager } from './oidc';
import type { RuntimeConfig } from '@/config';

describe('getOidcConfig', () => {
  it('returns null when runtime config is null', () => {
    expect(getOidcConfig(null)).toBeNull();
  });

  it('returns null when oidc is not in runtime config', () => {
    const rc: RuntimeConfig = { apiBaseUrl: '' };
    expect(getOidcConfig(rc)).toBeNull();
  });

  it('returns null when only authority is set', () => {
    const rc: RuntimeConfig = {
      apiBaseUrl: '',
      oidc: { authority: 'https://keycloak.example.com/realms/test', clientId: '' },
    };
    expect(getOidcConfig(rc)).toBeNull();
  });

  it('returns config when authority and clientId are set', () => {
    const rc: RuntimeConfig = {
      apiBaseUrl: '',
      oidc: {
        authority: 'https://keycloak.example.com/realms/test',
        clientId: 'volundr',
      },
    };

    const config = getOidcConfig(rc);

    expect(config).not.toBeNull();
    expect(config!.authority).toBe('https://keycloak.example.com/realms/test');
    expect(config!.clientId).toBe('volundr');
    expect(config!.scope).toBe('openid profile email');
  });

  it('uses custom scope when provided', () => {
    const rc: RuntimeConfig = {
      apiBaseUrl: '',
      oidc: {
        authority: 'https://keycloak.example.com/realms/test',
        clientId: 'volundr',
        scope: 'openid custom',
      },
    };

    const config = getOidcConfig(rc);

    expect(config!.scope).toBe('openid custom');
  });
});

describe('getUserManager', () => {
  it('returns a UserManager instance', () => {
    const config = {
      authority: 'https://keycloak.example.com/realms/test',
      clientId: 'volundr',
      redirectUri: 'http://localhost:5174',
      postLogoutRedirectUri: 'http://localhost:5174',
      scope: 'openid profile email',
    };

    const mgr = getUserManager(config);

    expect(mgr).toBeDefined();
    expect(mgr.settings.authority).toBe(config.authority);
    expect(mgr.settings.client_id).toBe(config.clientId);
  });
});
