import type { Meta, StoryObj } from '@storybook/react';
import { AuthContext, type AuthContextValue } from './AuthContext';

/**
 * Stories for the auth state — stubbed via context, no real OIDC provider needed.
 *
 * AuthProvider itself wraps useConfig() so it can't be isolated in Storybook without
 * a ConfigProvider. Instead, we expose AuthContext stubs that represent the two
 * key states consumers care about: signed-out and signed-in.
 */

// ---------------------------------------------------------------------------
// Helper wrapper that puts an AuthContext value into the tree
// ---------------------------------------------------------------------------

function AuthContextStub({
  value,
  children,
}: {
  value: AuthContextValue;
  children: React.ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// A minimal "App" that reacts to auth state — mirrors real usage
// ---------------------------------------------------------------------------

import { useAuth } from './hooks/useAuth';
import { useUser } from './hooks/useUser';
import { useAccessToken } from './hooks/useAccessToken';

function AuthDemo() {
  const { authenticated, loading, enabled } = useAuth();
  const user = useUser();
  const token = useAccessToken();

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>Loading auth…</p>;

  if (!enabled) {
    return (
      <div
        style={{
          padding: 'var(--space-4)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Auth disabled (dev mode)
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div
        style={{
          padding: 'var(--space-4)',
          color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        Not signed in
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        fontFamily: 'var(--font-mono)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div>
        <strong>sub:</strong> {user?.sub}
      </div>
      <div>
        <strong>email:</strong> {user?.email ?? '—'}
      </div>
      <div>
        <strong>name:</strong> {user?.name ?? '—'}
      </div>
      <div>
        <strong>token:</strong>{' '}
        <span style={{ color: 'var(--color-accent-emerald)', fontSize: 'var(--text-xs)' }}>
          {token?.slice(0, 20)}…
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared context values
// ---------------------------------------------------------------------------

const signedOutCtx: AuthContextValue = {
  enabled: true,
  authenticated: false,
  loading: false,
  user: null,
  accessToken: null,
  login: () => alert('login() called'),
  logout: () => {},
};

const signedInCtx: AuthContextValue = {
  enabled: true,
  authenticated: true,
  loading: false,
  user: {
    sub: 'user-story-001',
    email: 'elara@niuulabs.com',
    name: 'Elara Voss',
    accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.stub',
    expired: false,
  },
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.stub',
  login: () => {},
  logout: () => alert('logout() called'),
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'Auth / AuthProvider',
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const SignedOut: Story = {
  name: 'Signed out',
  render: () => (
    <AuthContextStub value={signedOutCtx}>
      <AuthDemo />
    </AuthContextStub>
  ),
};

export const SignedIn: Story = {
  name: 'Signed in',
  render: () => (
    <AuthContextStub value={signedInCtx}>
      <AuthDemo />
    </AuthContextStub>
  ),
};

export const Loading: Story = {
  name: 'Loading',
  render: () => (
    <AuthContextStub value={{ ...signedOutCtx, loading: true }}>
      <AuthDemo />
    </AuthContextStub>
  ),
};

export const AuthDisabled: Story = {
  name: 'Auth disabled (dev mode)',
  render: () => (
    <AuthContextStub
      value={{
        ...signedInCtx,
        enabled: false,
        authenticated: true,
        user: null,
        accessToken: null,
      }}
    >
      <AuthDemo />
    </AuthContextStub>
  ),
};
