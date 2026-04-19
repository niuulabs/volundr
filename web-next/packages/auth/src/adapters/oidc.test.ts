import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOidcConfig, createUserManager } from './oidc';

// oidc-client-ts uses sessionStorage — stub it out
vi.stubGlobal('sessionStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
});

describe('buildOidcConfig', () => {
  it('returns null when auth config is undefined', () => {
    expect(buildOidcConfig(undefined)).toBeNull();
  });

  it('returns null when issuer is missing', () => {
    expect(buildOidcConfig({ clientId: 'niuu-web' })).toBeNull();
  });

  it('returns null when clientId is missing', () => {
    expect(buildOidcConfig({ issuer: 'https://auth.example.com' })).toBeNull();
  });

  it('returns null when both fields are empty strings', () => {
    expect(buildOidcConfig({ issuer: '', clientId: '' })).toBeNull();
  });

  it('builds config with defaults when authority and clientId are present', () => {
    const config = buildOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'niuu-web',
    });

    expect(config).not.toBeNull();
    expect(config!.authority).toBe('https://auth.example.com');
    expect(config!.clientId).toBe('niuu-web');
    expect(config!.scope).toBe('openid profile email');
    expect(config!.redirectUri).toBe(window.location.origin);
    expect(config!.postLogoutRedirectUri).toBe(window.location.origin);
  });

  it('respects custom scope', () => {
    const config = buildOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'niuu-web',
      scope: 'openid offline_access',
    });

    expect(config!.scope).toBe('openid offline_access');
  });

  it('respects custom redirect URIs', () => {
    const config = buildOidcConfig({
      issuer: 'https://auth.example.com',
      clientId: 'niuu-web',
      redirectUri: 'https://app.example.com/callback',
      postLogoutRedirectUri: 'https://app.example.com',
    });

    expect(config!.redirectUri).toBe('https://app.example.com/callback');
    expect(config!.postLogoutRedirectUri).toBe('https://app.example.com');
  });
});

describe('createUserManager', () => {
  beforeEach(() => {
    // Reset window.location
    Object.defineProperty(window, 'location', {
      value: { ...window.location, origin: 'http://localhost:5173' },
      writable: true,
    });
  });

  it('returns a UserManager with the correct settings', () => {
    const config = {
      authority: 'https://auth.example.com',
      clientId: 'niuu-web',
      redirectUri: 'http://localhost:5173',
      postLogoutRedirectUri: 'http://localhost:5173',
      scope: 'openid profile email',
    };

    const mgr = createUserManager(config);

    expect(mgr).toBeDefined();
    expect(mgr.settings.authority).toBe(config.authority);
    expect(mgr.settings.client_id).toBe(config.clientId);
    expect(mgr.settings.redirect_uri).toBe(config.redirectUri);
    expect(mgr.settings.scope).toBe(config.scope);
  });

  it('creates a fresh instance each call (no singleton)', () => {
    const config = {
      authority: 'https://auth.example.com',
      clientId: 'niuu-web',
      redirectUri: 'http://localhost:5173',
      postLogoutRedirectUri: 'http://localhost:5173',
      scope: 'openid profile email',
    };

    const mgr1 = createUserManager(config);
    const mgr2 = createUserManager(config);

    expect(mgr1).not.toBe(mgr2);
  });
});
