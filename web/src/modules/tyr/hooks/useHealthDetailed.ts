import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr');

export interface DetailedHealth {
  status: string;
  database: string;
  event_bus_subscriber_count: number;
  activity_subscriber_running: boolean;
  notification_service_running: boolean;
  review_engine_running: boolean;
}

interface UseHealthDetailedResult {
  health: DetailedHealth | null;
  loading: boolean;
  error: string | null;
}

const POLL_MS = 30_000;

export function useHealthDetailed(): UseHealthDetailedResult {
  const [health, setHealth] = useState<DetailedHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.get<DetailedHealth>('/health/detailed');
      setHealth(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return { health, loading, error };
}
