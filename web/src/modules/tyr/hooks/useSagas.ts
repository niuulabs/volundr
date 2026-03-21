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
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await tyrService.getSagas();
        if (!cancelled) {
          setSagas(data);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    setLoading(true);
    setError(null);
    fetch();
    return () => { cancelled = true; };
  }, []);

  return { sagas, loading, error, refresh: fetchSagas };
}
