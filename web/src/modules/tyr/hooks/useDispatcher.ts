import { useState, useEffect, useCallback } from 'react';
import type { DispatcherState } from '../models';
import { dispatcherService } from '../adapters';

interface UseDispatcherResult {
  state: DispatcherState | null;
  log: string[];
  loading: boolean;
  error: string | null;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setThreshold: (threshold: number) => Promise<void>;
  refresh: () => void;
}

export function useDispatcher(): UseDispatcherResult {
  const [state, setState] = useState<DispatcherState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([dispatcherService.getState(), dispatcherService.getLog()])
      .then(([stateData, logData]) => {
        setState(stateData);
        setLog(logData);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const [stateData, logData] = await Promise.all([
          dispatcherService.getState(),
          dispatcherService.getLog(),
        ]);
        if (!cancelled) {
          setState(stateData);
          setLog(logData);
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

  const pause = useCallback(async () => {
    await dispatcherService.setRunning(false);
    const updated = await dispatcherService.getState();
    setState(updated);
  }, []);

  const resume = useCallback(async () => {
    await dispatcherService.setRunning(true);
    const updated = await dispatcherService.getState();
    setState(updated);
  }, []);

  const setThreshold = useCallback(async (threshold: number) => {
    await dispatcherService.setThreshold(threshold);
    const updated = await dispatcherService.getState();
    setState(updated);
  }, []);

  return { state, log, loading, error, pause, resume, setThreshold, refresh: fetchState };
}
