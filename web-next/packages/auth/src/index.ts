// Provider
export { AuthProvider } from './AuthProvider';
export type { LoginPageComponentProps } from './AuthProvider';

// Route guard
export { RequireAuth } from './RequireAuth';

// Hooks
export { useAuth } from './hooks/useAuth';
export { useUser } from './hooks/useUser';
export { useAccessToken } from './hooks/useAccessToken';

// Context (for advanced use — consumers should prefer hooks)
export { AuthContext, type AuthContextValue } from './AuthContext';

// Port types
export type { AuthUser, AuthState, IAuthService } from './ports/auth.port';

// Adapter utilities (for testing / custom wiring)
export {
  buildOidcConfig,
  createUserManager,
  type OidcConfig,
  type AuthConfig,
} from './adapters/oidc';
