import { useState, useEffect, useCallback } from 'react';
import type { ChronicleEntry, ChronicleType } from '@/modules/volundr/models';
import { chronicleService } from '@/modules/volundr/adapters';

interface UseChronicleResult {
  entries: ChronicleEntry[];
  loading: boolean;
  error: Error | null;
  filter: ChronicleType | 'all';
  setFilter: (filter: ChronicleType | 'all') => void;
  getEntriesByAgent: (agent: string, limit?: number) => Promise<ChronicleEntry[]>;
  refresh: () => Promise<void>;
}

export function useChronicle(limit?: number): UseChronicleResult {
  const [entries, setEntries] = useState<ChronicleEntry[]>([]);
  const [filter, setFilter] = useState<ChronicleType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data =
        filter === 'all'
          ? await chronicleService.getEntries(limit)
          : await chronicleService.getEntriesByType(filter, limit);
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch chronicle'));
    } finally {
      setLoading(false);
    }
  }, [filter, limit]);

  useEffect(() => {
    fetchEntries();

    const unsubscribe = chronicleService.subscribe(newEntry => {
      setEntries(prev => {
        const updated = [newEntry, ...prev];
        return limit ? updated.slice(0, limit) : updated;
      });
    });

    return unsubscribe;
  }, [fetchEntries, limit]);

  const handleSetFilter = useCallback((newFilter: ChronicleType | 'all') => {
    setFilter(newFilter);
  }, []);

  const getEntriesByAgent = useCallback(async (agent: string, agentLimit?: number) => {
    return chronicleService.getEntriesByAgent(agent, agentLimit);
  }, []);

  return {
    entries,
    loading,
    error,
    filter,
    setFilter: handleSetFilter,
    getEntriesByAgent,
    refresh: fetchEntries,
  };
}
