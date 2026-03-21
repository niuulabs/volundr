import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo } from '../models';
import { tyrSessionService } from '../adapters';

interface UseTyrSessionsResult {
  sessions: SessionInfo[];
  loading: boolean;
  error: string | null;
  approve: (sessionId: string) => Promise<void>;
  refresh: () => void;
}

export function useTyrSessions(): UseTyrSessionsResult {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    setError(null);
    tyrSessionService
      .getSessions()
      .then(setSessions)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await tyrSessionService.getSessions();
        if (!cancelled) {
          setSessions(data);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const approve = useCallback(async (sessionId: string) => {
    await tyrSessionService.approve(sessionId);
    const updated = await tyrSessionService.getSessions();
    setSessions(updated);
  }, []);

  return { sessions, loading, error, approve, refresh: fetchSessions };
}
