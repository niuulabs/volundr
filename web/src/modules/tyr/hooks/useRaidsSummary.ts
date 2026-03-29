import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr');

interface UseRaidsSummaryResult {
  summary: Record<string, number>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useRaidsSummary(): UseRaidsSummaryResult {
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const raw = await api.get<Record<string, number>>('/raids/summary');
      const normalized: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        normalized[k.toLowerCase()] = v;
      }
      setSummary(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return { summary, loading, error, refresh: fetchSummary };
}
