import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext, type AuthContextValue } from './AuthContext';
import { RequireAuth } from './RequireAuth';

// Mock TanStack Router's Navigate component
vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const baseCtx: AuthContextValue = {
  enabled: true,
  authenticated: true,
  loading: false,
  user: {
    sub: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    accessToken: 'tok',
    expired: false,
  },
  accessToken: 'tok',
  login: () => {},
  logout: () => {},
};

function wrap(ctx: AuthContextValue, children: React.ReactNode) {
  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

describe('RequireAuth', () => {
  it('renders children when authenticated', () => {
    render(
      wrap(
        baseCtx,
        <RequireAuth>
          <p data-testid="protected">Protected content</p>
        </RequireAuth>,
      ),
    );

    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    const unauthCtx: AuthContextValue = {
      ...baseCtx,
      authenticated: false,
      user: null,
      accessToken: null,
    };

    render(
      wrap(
        unauthCtx,
        <RequireAuth>
          <p data-testid="protected">Protected content</p>
        </RequireAuth>,
      ),
    );

    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/login');
  });

  it('redirects to a custom path when redirectTo is provided', () => {
    const unauthCtx: AuthContextValue = {
      ...baseCtx,
      authenticated: false,
      user: null,
      accessToken: null,
    };

    render(
      wrap(
        unauthCtx,
        <RequireAuth redirectTo="/sign-in">
          <p data-testid="protected">Protected content</p>
        </RequireAuth>,
      ),
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/sign-in');
  });

  it('renders nothing while loading', () => {
    const loadingCtx: AuthContextValue = {
      ...baseCtx,
      loading: true,
      authenticated: false,
      user: null,
      accessToken: null,
    };

    const { container } = render(
      wrap(
        loadingCtx,
        <RequireAuth>
          <p data-testid="protected">Protected content</p>
        </RequireAuth>,
      ),
    );

    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
