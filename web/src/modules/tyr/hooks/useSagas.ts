import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr/sagas');

export interface SagaListItem {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  repos: string[];
  feature_branch: string;
  status: string;
  progress: number;
  milestone_count: number;
  issue_count: number;
  url: string;
}

interface UseSagasResult {
  sagas: SagaListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  deleteSaga: (id: string) => Promise<void>;
}

export function useSagas(): UseSagasResult {
  const [sagas, setSagas] = useState<SagaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSagas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SagaListItem[]>('');
      setSagas(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSagas();
  }, [fetchSagas]);

  const deleteSaga = useCallback(async (id: string) => {
    await api.delete(`/${id}`);
    setSagas(prev => prev.filter(s => s.id !== id));
  }, []);

  return { sagas, loading, error, refresh: fetchSagas, deleteSaga };
}
