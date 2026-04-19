import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginRoute } from './LoginRoute';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@niuulabs/auth', () => ({
  useAuth: vi.fn(),
}));

// Mock LoginPage to keep the test focused on LoginRoute wiring only
vi.mock('./LoginPage', () => ({
  LoginPage: vi.fn(({ onLogin, loading }: { onLogin: () => void; loading?: boolean }) => (
    <div data-testid="login-page-mock" data-loading={String(loading)}>
      <button onClick={onLogin}>sign-in</button>
    </div>
  )),
}));

import { useAuth } from '@niuulabs/auth';
import { LoginPage } from './LoginPage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginRoute', () => {
  const mockLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      logout: vi.fn(),
      loading: false,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
    });
  });

  it('renders LoginPage', () => {
    render(<LoginRoute />);
    expect(screen.getByTestId('login-page-mock')).toBeInTheDocument();
  });

  it('passes login from useAuth to LoginPage as onLogin', () => {
    render(<LoginRoute />);
    expect(vi.mocked(LoginPage)).toHaveBeenCalledWith(
      expect.objectContaining({ onLogin: mockLogin }),
      undefined,
    );
  });

  it('forwards loading state from useAuth to LoginPage', () => {
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      logout: vi.fn(),
      loading: true,
      authenticated: false,
      enabled: true,
      user: null,
      accessToken: null,
    });
    render(<LoginRoute />);
    expect(screen.getByTestId('login-page-mock')).toHaveAttribute('data-loading', 'true');
  });
});
