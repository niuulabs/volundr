import { useState, useEffect, useCallback } from 'react';
import type { Saga } from '../models';
import { tyrService } from '../adapters';

interface UseSagasResult {
  sagas: Saga[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSagas(): UseSagasResult {
  const [sagas, setSagas] = useState<Saga[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSagas = useCallback(() => {
    setLoading(true);
    setError(null);
    tyrService.getSagas()
      .then(setSagas)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSagas();
  }, [fetchSagas]);

  return { sagas, loading, error, refresh: fetchSagas };
}
