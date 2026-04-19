import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NiuuConfig } from '@niuulabs/plugin-sdk';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './hooks/useAuth';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@niuulabs/plugin-sdk', () => ({
  useConfig: vi.fn(),
}));

vi.mock('@niuulabs/query', () => ({
  setTokenProvider: vi.fn(),
}));

vi.mock('./adapters/oidc', () => ({
  buildOidcConfig: vi.fn(() => null),
  createUserManager: vi.fn(),
}));

import { useConfig } from '@niuulabs/plugin-sdk';
import { setTokenProvider } from '@niuulabs/query';
import { buildOidcConfig, createUserManager } from './adapters/oidc';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseConfig: NiuuConfig = {
  theme: 'ice',
  plugins: {},
  services: {},
};

const authConfig: NiuuConfig = {
  ...baseConfig,
  auth: { issuer: 'https://auth.example.com', clientId: 'niuu-web' },
};

const mockOidcConfig = {
  authority: 'https://auth.example.com',
  clientId: 'niuu-web',
  redirectUri: 'http://localhost:5173',
  postLogoutRedirectUri: 'http://localhost:5173',
  scope: 'openid profile email',
};

type MockUser = {
  expired: boolean;
  access_token: string;
  profile: { sub: string; email?: string; name?: string };
};

function createMockManager(overrides: Record<string, unknown> = {}) {
  return {
    getUser: vi.fn<[], Promise<MockUser | null>>().mockResolvedValue(null),
    signinRedirect: vi.fn(),
    signinRedirectCallback: vi.fn<[], Promise<MockUser>>(),
    signoutRedirect: vi.fn(),
    signinSilent: vi.fn<[], Promise<MockUser>>(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      addAccessTokenExpired: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
      removeAccessTokenExpired: vi.fn(),
    },
    settings: { authority: mockOidcConfig.authority },
    ...overrides,
  };
}

// Helper component that surfaces auth state via testids
function AuthStatus() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="enabled">{String(auth.enabled)}</span>
      <span data-testid="authenticated">{String(auth.authenticated)}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="token">{auth.accessToken ?? 'none'}</span>
      <span data-testid="user-sub">{auth.user?.sub ?? 'none'}</span>
      <button data-testid="login" onClick={auth.login}>
        Login
      </button>
      <button data-testid="logout" onClick={auth.logout}>
        Logout
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useConfig).mockReturnValue(baseConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(null);

    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: '',
        pathname: '/',
        origin: 'http://localhost:5173',
      },
      writable: true,
    });
  });

  // -------------------------------------------------------------------------
  // No-auth mode (OIDC disabled)
  // -------------------------------------------------------------------------

  it('renders children when auth is not configured', async () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    // When auth is disabled, loading is immediately false
    const enabled = await screen.findByTestId('enabled');
    expect(enabled).toHaveTextContent('false');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('does not register a token provider when auth is disabled', async () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    await screen.findByTestId('enabled');
    expect(setTokenProvider).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Auth enabled — unauthenticated
  // -------------------------------------------------------------------------

  it('shows the built-in login page when OIDC is configured but no session exists', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    vi.mocked(createUserManager).mockReturnValue(createMockManager() as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Niuu')).toBeInTheDocument();
  });

  it('calls signinRedirect when the Sign-in button is clicked', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const mockMgr = createMockManager();
    vi.mocked(createUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByText('Sign in'));

    expect(mockMgr.signinRedirect).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Auth enabled — existing session
  // -------------------------------------------------------------------------

  it('renders children when an existing valid session is found', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const mockUser: MockUser = {
      expired: false,
      access_token: 'tok-abc',
      profile: { sub: 'user-1', email: 'test@example.com' },
    };
    vi.mocked(createUserManager).mockReturnValue(
      createMockManager({ getUser: vi.fn().mockResolvedValue(mockUser) }) as never,
    );

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(await screen.findByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('token')).toHaveTextContent('tok-abc');
    expect(screen.getByTestId('user-sub')).toHaveTextContent('user-1');
  });

  it('shows login page when the existing session is expired', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const expiredUser: MockUser = {
      expired: true,
      access_token: 'old-tok',
      profile: { sub: 'user-1' },
    };
    vi.mocked(createUserManager).mockReturnValue(
      createMockManager({ getUser: vi.fn().mockResolvedValue(expiredUser) }) as never,
    );

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // OIDC callback (code in URL)
  // -------------------------------------------------------------------------

  it('completes signin callback when code is in the URL', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: '?code=abc123&state=xyz',
        pathname: '/callback',
        origin: 'http://localhost:5173',
      },
      writable: true,
    });
    window.history.replaceState = vi.fn();

    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const callbackUser: MockUser = {
      expired: false,
      access_token: 'callback-tok',
      profile: { sub: 'user-2' },
    };
    vi.mocked(createUserManager).mockReturnValue(
      createMockManager({
        signinRedirectCallback: vi.fn().mockResolvedValue(callbackUser),
      }) as never,
    );

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(await screen.findByTestId('token')).toHaveTextContent('callback-tok');
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  it('calls signoutRedirect when logout is triggered', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const mockUser: MockUser = {
      expired: false,
      access_token: 'tok-abc',
      profile: { sub: 'user-1' },
    };
    const mockMgr = createMockManager({ getUser: vi.fn().mockResolvedValue(mockUser) });
    vi.mocked(createUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByTestId('logout'));

    expect(mockMgr.signoutRedirect).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Token refresh / silent renew
  // -------------------------------------------------------------------------

  it('updates the user when the userLoaded event fires (token refresh)', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);

    let capturedOnUserLoaded: ((u: MockUser) => void) | undefined;
    const mockMgr = createMockManager({
      events: {
        addUserLoaded: vi.fn((cb: (u: MockUser) => void) => {
          capturedOnUserLoaded = cb;
        }),
        addUserUnloaded: vi.fn(),
        addAccessTokenExpired: vi.fn(),
        removeUserLoaded: vi.fn(),
        removeUserUnloaded: vi.fn(),
        removeAccessTokenExpired: vi.fn(),
      },
    });
    vi.mocked(createUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    // Wait for initial unauthenticated state
    await screen.findByText('Sign in');

    const renewedUser: MockUser = {
      expired: false,
      access_token: 'renewed-tok',
      profile: { sub: 'user-1' },
    };

    await act(async () => {
      capturedOnUserLoaded?.(renewedUser);
    });

    expect(screen.getByTestId('token')).toHaveTextContent('renewed-tok');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('clears the user when the userUnloaded event fires (session expiry)', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const initialUser: MockUser = {
      expired: false,
      access_token: 'tok-abc',
      profile: { sub: 'user-1' },
    };

    let capturedOnUserUnloaded: (() => void) | undefined;
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(initialUser),
      events: {
        addUserLoaded: vi.fn(),
        addUserUnloaded: vi.fn((cb: () => void) => {
          capturedOnUserUnloaded = cb;
        }),
        addAccessTokenExpired: vi.fn(),
        removeUserLoaded: vi.fn(),
        removeUserUnloaded: vi.fn(),
        removeAccessTokenExpired: vi.fn(),
      },
    });
    vi.mocked(createUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    // Wait for authenticated state
    expect(await screen.findByTestId('token')).toHaveTextContent('tok-abc');

    await act(async () => {
      capturedOnUserUnloaded?.();
    });

    // After unload, login page should show
    expect(await screen.findByText('Sign in')).toBeInTheDocument();
  });

  it('attempts silent renew when the access token expires', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);

    let capturedOnTokenExpired: (() => void) | undefined;
    const renewedUser: MockUser = {
      expired: false,
      access_token: 'silent-tok',
      profile: { sub: 'user-1' },
    };
    const mockMgr = createMockManager({
      signinSilent: vi.fn().mockResolvedValue(renewedUser),
      events: {
        addUserLoaded: vi.fn(),
        addUserUnloaded: vi.fn(),
        addAccessTokenExpired: vi.fn((cb: () => void) => {
          capturedOnTokenExpired = cb;
        }),
        removeUserLoaded: vi.fn(),
        removeUserUnloaded: vi.fn(),
        removeAccessTokenExpired: vi.fn(),
      },
    });
    vi.mocked(createUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    await screen.findByText('Sign in');

    await act(async () => {
      capturedOnTokenExpired?.();
    });

    expect(mockMgr.signinSilent).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Token provider registration
  // -------------------------------------------------------------------------

  it('registers a token provider when auth is enabled', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    const mockUser: MockUser = {
      expired: false,
      access_token: 'tok-abc',
      profile: { sub: 'user-1' },
    };
    vi.mocked(createUserManager).mockReturnValue(
      createMockManager({ getUser: vi.fn().mockResolvedValue(mockUser) }) as never,
    );

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    await screen.findByTestId('authenticated');
    expect(setTokenProvider).toHaveBeenCalledWith(expect.any(Function));
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('shows login page when OIDC init throws', async () => {
    vi.mocked(useConfig).mockReturnValue(authConfig);
    vi.mocked(buildOidcConfig).mockReturnValue(mockOidcConfig);
    vi.mocked(createUserManager).mockReturnValue(
      createMockManager({
        getUser: vi.fn().mockRejectedValue(new Error('network error')),
      }) as never,
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
