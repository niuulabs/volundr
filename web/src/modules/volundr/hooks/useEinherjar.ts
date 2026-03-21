import { useState, useEffect, useCallback } from 'react';
import type { Einherjar, EinherjarStats, WorkerStatus } from '@/modules/volundr/models';
import { einherjarService } from '@/modules/volundr/adapters';

interface UseEinherjarResult {
  workers: Einherjar[];
  stats: EinherjarStats | null;
  loading: boolean;
  error: Error | null;
  getWorker: (id: string) => Promise<Einherjar | null>;
  getWorkersByStatus: (status: WorkerStatus) => Promise<Einherjar[]>;
  getWorkersByCampaign: (campaignId: string) => Promise<Einherjar[]>;
  forceCheckpoint: (workerId: string) => Promise<void>;
  reassignWorker: (workerId: string, campaignId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useEinherjar(): UseEinherjarResult {
  const [workers, setWorkers] = useState<Einherjar[]>([]);
  const [stats, setStats] = useState<EinherjarStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [workersData, statsData] = await Promise.all([
        einherjarService.getEinherjar(),
        einherjarService.getStats(),
      ]);
      setWorkers(workersData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch einherjar'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const unsubscribe = einherjarService.subscribe(newWorkers => {
      setWorkers(newWorkers);
    });

    return unsubscribe;
  }, [fetchData]);

  const getWorker = useCallback(async (id: string) => {
    return einherjarService.getWorker(id);
  }, []);

  const getWorkersByStatus = useCallback(async (status: WorkerStatus) => {
    return einherjarService.getWorkersByStatus(status);
  }, []);

  const getWorkersByCampaign = useCallback(async (campaignId: string) => {
    return einherjarService.getWorkersByCampaign(campaignId);
  }, []);

  const forceCheckpoint = useCallback(async (workerId: string) => {
    await einherjarService.forceCheckpoint(workerId);
  }, []);

  const reassignWorker = useCallback(
    async (workerId: string, campaignId: string | null) => {
      await einherjarService.reassignWorker(workerId, campaignId);
      await fetchData();
    },
    [fetchData]
  );

  return {
    workers,
    stats,
    loading,
    error,
    getWorker,
    getWorkersByStatus,
    getWorkersByCampaign,
    forceCheckpoint,
    reassignWorker,
    refresh: fetchData,
  };
}
