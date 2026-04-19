import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext, type AuthContextValue } from '../AuthContext';
import { useUser } from './useUser';

function UserDisplay() {
  const user = useUser();
  return (
    <div>
      <span data-testid="sub">{user?.sub ?? 'none'}</span>
      <span data-testid="email">{user?.email ?? 'none'}</span>
    </div>
  );
}

function wrapper(value: AuthContextValue, children: React.ReactNode) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const baseCtx: AuthContextValue = {
  enabled: true,
  authenticated: false,
  loading: false,
  user: null,
  accessToken: null,
  login: () => {},
  logout: () => {},
};

describe('useUser', () => {
  it('returns null when not authenticated', () => {
    render(wrapper(baseCtx, <UserDisplay />));
    expect(screen.getByTestId('sub')).toHaveTextContent('none');
  });

  it('returns user when authenticated', () => {
    const ctx: AuthContextValue = {
      ...baseCtx,
      authenticated: true,
      user: {
        sub: 'user-42',
        email: 'user@example.com',
        name: 'Test User',
        accessToken: 'tok',
        expired: false,
      },
    };

    render(wrapper(ctx, <UserDisplay />));
    expect(screen.getByTestId('sub')).toHaveTextContent('user-42');
    expect(screen.getByTestId('email')).toHaveTextContent('user@example.com');
  });
});
