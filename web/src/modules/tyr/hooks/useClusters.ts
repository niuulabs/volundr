import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr');

export interface ClusterInfo {
  connection_id: string;
  name: string;
  url: string;
  enabled: boolean;
}

interface UseClustersResult {
  clusters: ClusterInfo[];
  loading: boolean;
  error: string | null;
}

export function useClusters(): UseClustersResult {
  const [clusters, setClusters] = useState<ClusterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    try {
      const data = await api.get<ClusterInfo[]>('/dispatch/clusters');
      setClusters(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  return { clusters, loading, error };
}
