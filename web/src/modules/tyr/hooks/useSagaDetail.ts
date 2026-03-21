import { useState, useEffect, useCallback } from 'react';
import type { Saga, Phase } from '../models';
import { tyrService } from '../adapters';

interface UseSagaDetailResult {
  saga: Saga | null;
  phases: Phase[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSagaDetail(sagaId: string | undefined): UseSagaDetailResult {
  const [saga, setSaga] = useState<Saga | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(() => {
    if (!sagaId) {
      setSaga(null);
      setPhases([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    Promise.all([tyrService.getSaga(sagaId), tyrService.getPhases(sagaId)])
      .then(([sagaData, phasesData]) => {
        setSaga(sagaData);
        setPhases(phasesData);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sagaId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { saga, phases, loading, error, refresh: fetchDetail };
}
