import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';
import type { RaidStatus } from '../models';

const api = createApiClient('/api/v1/tyr');

export interface ActiveRaid {
  tracker_id: string;
  identifier: string;
  title: string;
  url: string;
  status: RaidStatus;
  session_id: string | null;
  confidence: number;
  pr_url: string | null;
  last_updated: string;
}

interface UseActiveRaidsResult {
  raids: ActiveRaid[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  patchRaid: (trackerId: string, patch: Partial<ActiveRaid>) => void;
}

export function useActiveRaids(): UseActiveRaidsResult {
  const [raids, setRaids] = useState<ActiveRaid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRaids = useCallback(async () => {
    try {
      const data = await api.get<ActiveRaid[]>('/raids/active');
      setRaids(data.map(r => ({ ...r, status: r.status.toLowerCase() as RaidStatus })));
      setError(null);
    } catch {
      setRaids([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRaids();
  }, [fetchRaids]);

  const patchRaid = useCallback((trackerId: string, patch: Partial<ActiveRaid>) => {
    setRaids(prev => prev.map(r => (r.tracker_id === trackerId ? { ...r, ...patch } : r)));
  }, []);

  return { raids, loading, error, refresh: fetchRaids, patchRaid };
}
