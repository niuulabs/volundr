import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';
import type { TimelineResponse } from './useTyrSessions';

const volundrApi = createApiClient('/api/v1/volundr');

interface UseSessionTimelineResult {
  timeline: TimelineResponse | null;
  loading: boolean;
  error: string | null;
}

export function useSessionTimeline(sessionId: string | null): UseSessionTimelineResult {
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await volundrApi.get<TimelineResponse>(`/chronicles/${id}/timeline`);
      setTimeline(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetchTimeline(sessionId);
  }, [sessionId, fetchTimeline]);

  return { timeline, loading, error };
}
