import { createContext } from 'react';
import type { AuthState, IAuthService } from './ports/auth.port';

export type AuthContextValue = AuthState & IAuthService;

export const AuthContext = createContext<AuthContextValue>({
  enabled: false,
  authenticated: false,
  loading: true,
  user: null,
  accessToken: null,
  login: () => {},
  logout: () => {},
});
