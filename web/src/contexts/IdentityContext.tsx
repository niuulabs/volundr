/**
 * Identity context — provides current user identity to the entire app.
 *
 * Replaces the old `useIdentity(volundrService)` pattern with a
 * context-based approach that is not coupled to any specific module.
 */
import { useState, useEffect, type ReactNode } from 'react';
import type { AppIdentity } from '@/modules/shared/ports/identity.port';
import { identityService } from '@/modules/shared/adapters/identity.adapter';
import { IdentityContext } from './identityContextValue';

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AppIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    identityService
      .getIdentity()
      .then(id => {
        if (!cancelled) setIdentity(id);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load identity');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = identity?.roles?.some(r => r.endsWith(':admin')) ?? false;
  const hasRole = (role: string) => identity?.roles?.includes(role) ?? false;

  return (
    <IdentityContext.Provider value={{ identity, isAdmin, hasRole, loading, error }}>
      {children}
    </IdentityContext.Provider>
  );
}
