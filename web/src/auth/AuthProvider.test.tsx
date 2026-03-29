import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

// Mock the config module
vi.mock('@/config', () => ({
  loadRuntimeConfig: vi.fn(() => Promise.resolve({ apiBaseUrl: '' })),
}));

// Mock the oidc module
vi.mock('./oidc', () => ({
  getOidcConfig: vi.fn(() => null),
  getUserManager: vi.fn(),
}));

// Mock the client token provider
vi.mock('@/modules/volundr/adapters/api/client', () => ({
  setTokenProvider: vi.fn(),
}));

import { loadRuntimeConfig } from '@/config';
import { getOidcConfig, getUserManager } from './oidc';
import { setTokenProvider } from '@/modules/volundr/adapters/api/client';

const mockConfig = {
  authority: 'https://keycloak.example.com/realms/test',
  clientId: 'volundr',
  redirectUri: 'http://localhost:5174',
  postLogoutRedirectUri: 'http://localhost:5174',
  scope: 'openid profile email',
};

function createMockManager(overrides: Record<string, unknown> = {}) {
  return {
    getUser: vi.fn().mockResolvedValue(null),
    signinRedirect: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signoutRedirect: vi.fn(),
    signinSilent: vi.fn(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      addAccessTokenExpired: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
    },
    settings: { authority: mockConfig.authority },
    ...overrides,
  };
}

function AuthStatus() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="enabled">{String(auth.enabled)}</span>
      <span data-testid="authenticated">{String(auth.authenticated)}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="token">{auth.accessToken ?? 'none'}</span>
      <button data-testid="logout" onClick={auth.logout}>
        Logout
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: config loaded, no OIDC
    vi.mocked(loadRuntimeConfig).mockResolvedValue({ apiBaseUrl: '' });
    vi.mocked(getOidcConfig).mockReturnValue(null);
    // Reset location.search
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', pathname: '/', origin: 'http://localhost:5174' },
      writable: true,
    });
  });

  it('renders children directly when OIDC is not configured', async () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const enabled = await screen.findByTestId('enabled');
    expect(enabled).toHaveTextContent('false');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('does not set token provider when auth is disabled', async () => {
    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    await screen.findByTestId('enabled');
    expect(setTokenProvider).not.toHaveBeenCalled();
  });

  it('shows login page when OIDC is configured but user is not authenticated', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    vi.mocked(getUserManager).mockReturnValue(createMockManager() as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const loginButton = await screen.findByText('Sign in');
    expect(loginButton).toBeInTheDocument();
    expect(screen.getByText('Völundr')).toBeInTheDocument();
    expect(screen.getByText('Sign in to manage your coding sessions')).toBeInTheDocument();
  });

  it('calls signinRedirect when Sign in button is clicked', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockMgr = createMockManager();
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const user = userEvent.setup();
    const loginButton = await screen.findByText('Sign in');
    await user.click(loginButton);

    expect(mockMgr.signinRedirect).toHaveBeenCalled();
  });

  it('renders children when existing session is found', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockUser = { expired: false, access_token: 'test-token' };
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(mockUser),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const enabled = await screen.findByTestId('enabled');
    expect(enabled).toHaveTextContent('true');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    expect(screen.getByTestId('token')).toHaveTextContent('test-token');
  });

  it('shows login when existing session is expired', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockUser = { expired: true, access_token: 'expired-token' };
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(mockUser),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const loginButton = await screen.findByText('Sign in');
    expect(loginButton).toBeInTheDocument();
  });

  it('handles OIDC callback with code in URL', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        search: '?code=abc123&state=xyz',
        pathname: '/',
        origin: 'http://localhost:5174',
      },
      writable: true,
    });
    window.history.replaceState = vi.fn();

    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const callbackUser = { expired: false, access_token: 'callback-token' };
    const mockMgr = createMockManager({
      signinRedirectCallback: vi.fn().mockResolvedValue(callbackUser),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const token = await screen.findByTestId('token');
    expect(token).toHaveTextContent('callback-token');
    expect(mockMgr.signinRedirectCallback).toHaveBeenCalled();
    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('calls signoutRedirect on logout', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockUser = { expired: false, access_token: 'test-token' };
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(mockUser),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    const user = userEvent.setup();
    const logoutBtn = await screen.findByTestId('logout');
    await user.click(logoutBtn);

    expect(mockMgr.signoutRedirect).toHaveBeenCalled();
  });

  it('sets token provider when auth is enabled', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockUser = { expired: false, access_token: 'test-token' };
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(mockUser),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    await screen.findByTestId('authenticated');
    expect(setTokenProvider).toHaveBeenCalledWith(expect.any(Function));
  });

  it('handles error during OIDC init gracefully', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    const mockMgr = createMockManager({
      getUser: vi.fn().mockRejectedValue(new Error('OIDC error')),
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    // Should fall through to login page
    const loginButton = await screen.findByText('Sign in');
    expect(loginButton).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('handles userLoaded event from manager', async () => {
    vi.mocked(getOidcConfig).mockReturnValue(mockConfig);
    let userLoadedCallback: ((user: unknown) => void) | undefined;
    const mockMgr = createMockManager({
      getUser: vi.fn().mockResolvedValue(null),
      events: {
        addUserLoaded: vi.fn((cb: (user: unknown) => void) => {
          userLoadedCallback = cb;
        }),
        addUserUnloaded: vi.fn(),
        addAccessTokenExpired: vi.fn(),
        removeUserLoaded: vi.fn(),
        removeUserUnloaded: vi.fn(),
      },
    });
    vi.mocked(getUserManager).mockReturnValue(mockMgr as never);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    // Wait for login page
    await screen.findByText('Sign in');

    // Simulate user loaded event (e.g. from silent renew)
    await act(async () => {
      userLoadedCallback?.({ expired: false, access_token: 'renewed-token' });
    });

    expect(screen.getByTestId('token')).toHaveTextContent('renewed-token');
  });
});
