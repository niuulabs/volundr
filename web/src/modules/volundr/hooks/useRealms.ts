import { useState, useEffect, useCallback } from 'react';
import type { Realm, RealmDetail } from '@/modules/volundr/models';
import { realmService } from '@/modules/volundr/adapters';

interface UseRealmsResult {
  realms: Realm[];
  loading: boolean;
  error: Error | null;
  getRealm: (id: string) => Promise<Realm | null>;
  refresh: () => Promise<void>;
}

export function useRealms(): UseRealmsResult {
  const [realms, setRealms] = useState<Realm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRealms = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await realmService.getRealms();
      setRealms(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch realms'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealms();

    const unsubscribe = realmService.subscribe(newRealms => {
      setRealms(newRealms);
    });

    return unsubscribe;
  }, [fetchRealms]);

  const getRealm = useCallback(async (id: string) => {
    return realmService.getRealm(id);
  }, []);

  return {
    realms,
    loading,
    error,
    getRealm,
    refresh: fetchRealms,
  };
}

interface UseRealmDetailResult {
  detail: RealmDetail | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useRealmDetail(realmId: string | undefined): UseRealmDetailResult {
  const [detail, setDetail] = useState<RealmDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!realmId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await realmService.getRealmDetail(realmId);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch realm detail'));
    } finally {
      setLoading(false);
    }
  }, [realmId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return {
    detail,
    loading,
    error,
    refresh: fetchDetail,
  };
}
