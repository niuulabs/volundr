import { type ReactNode } from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from './hooks/useAuth';

interface RequireAuthProps {
  children: ReactNode;
  /** Path to redirect unauthenticated users to. Defaults to "/login". */
  redirectTo?: string;
}

/**
 * Route guard — renders children only when the user is authenticated.
 * Unauthenticated users are redirected to `redirectTo` (default: "/login").
 *
 * Place inside route components, not above the router.
 *
 * @example
 * ```tsx
 * function DashboardRoute() {
 *   return (
 *     <RequireAuth>
 *       <Dashboard />
 *     </RequireAuth>
 *   );
 * }
 * ```
 */
export function RequireAuth({ children, redirectTo = '/login' }: RequireAuthProps) {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!authenticated) {
    return <Navigate to={redirectTo} />;
  }

  return <>{children}</>;
}
