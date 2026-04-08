import { useState, useEffect } from 'react';
import type { VolundrIdentity } from '@/models';
import type { IVolundrService } from '@/ports';

export interface UseIdentityResult {
  identity: VolundrIdentity | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
}

export function useIdentity(service: IVolundrService): UseIdentityResult {
  const [identity, setIdentity] = useState<VolundrIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    service
      .getIdentity()
      .then(id => {
        if (cancelled) return;
        setIdentity(id);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load identity');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const isAdmin = identity?.roles?.includes('volundr:admin') ?? false;

  return { identity, isAdmin, loading, error };
}
