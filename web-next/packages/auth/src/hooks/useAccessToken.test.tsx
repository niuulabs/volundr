import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext, type AuthContextValue } from '../AuthContext';
import { useAccessToken } from './useAccessToken';

function TokenDisplay() {
  const token = useAccessToken();
  return <span data-testid="token">{token ?? 'none'}</span>;
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

describe('useAccessToken', () => {
  it('returns null when not authenticated', () => {
    render(
      <AuthContext.Provider value={baseCtx}>
        <TokenDisplay />
      </AuthContext.Provider>,
    );
    expect(screen.getByTestId('token')).toHaveTextContent('none');
  });

  it('returns the access token when authenticated', () => {
    const ctx: AuthContextValue = {
      ...baseCtx,
      authenticated: true,
      accessToken: 'bearer-xyz',
      user: {
        sub: 'user-1',
        email: undefined,
        name: undefined,
        accessToken: 'bearer-xyz',
        expired: false,
      },
    };

    render(
      <AuthContext.Provider value={ctx}>
        <TokenDisplay />
      </AuthContext.Provider>,
    );

    expect(screen.getByTestId('token')).toHaveTextContent('bearer-xyz');
  });
});
