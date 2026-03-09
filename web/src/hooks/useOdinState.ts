import { useState, useEffect, useCallback } from 'react';
import type { OdinState, PendingDecision } from '@/models';
import { odinService } from '@/adapters';

interface UseOdinStateResult {
  state: OdinState | null;
  pendingDecisions: PendingDecision[];
  loading: boolean;
  error: Error | null;
  approveDecision: (decisionId: string) => Promise<void>;
  rejectDecision: (decisionId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useOdinState(): UseOdinStateResult {
  const [state, setState] = useState<OdinState | null>(null);
  const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [odinState, decisions] = await Promise.all([
        odinService.getState(),
        odinService.getPendingDecisions(),
      ]);
      setState(odinState);
      setPendingDecisions(decisions);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch state'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

    const unsubscribe = odinService.subscribe(newState => {
      setState(newState);
      setPendingDecisions(newState.pendingDecisions);
    });

    return unsubscribe;
  }, [fetchState]);

  const approveDecision = useCallback(async (decisionId: string) => {
    await odinService.approveDecision(decisionId);
    setPendingDecisions(prev => prev.filter(d => d.id !== decisionId));
  }, []);

  const rejectDecision = useCallback(async (decisionId: string) => {
    await odinService.rejectDecision(decisionId);
    setPendingDecisions(prev => prev.filter(d => d.id !== decisionId));
  }, []);

  return {
    state,
    pendingDecisions,
    loading,
    error,
    approveDecision,
    rejectDecision,
    refresh: fetchState,
  };
}
