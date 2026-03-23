import { useState, useEffect, useCallback } from 'react';
import type { ITyrIntegrationService, TyrIntegrationConnection } from '../ports';

export interface UseTyrIntegrationsResult {
  connections: TyrIntegrationConnection[];
  loading: boolean;
  error: string | null;
  createConnection: (params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  toggleConnection: (id: string, enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useTyrIntegrations(service: ITyrIntegrationService): UseTyrIntegrationsResult {
  const [connections, setConnections] = useState<TyrIntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await service.listIntegrations();
      setConnections(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createConnection = useCallback(
    async (params: {
      integration_type: string;
      adapter: string;
      credential_name: string;
      credential_value: string;
      config: Record<string, string>;
    }) => {
      setError(null);
      try {
        await service.createIntegration(params);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create integration';
        setError(msg);
        throw err;
      }
    },
    [service, refresh]
  );

  const deleteConnection = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await service.deleteIntegration(id);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to delete integration';
        setError(msg);
        throw err;
      }
    },
    [service, refresh]
  );

  const toggleConnection = useCallback(
    async (id: string, enabled: boolean) => {
      setError(null);
      try {
        await service.toggleIntegration(id, enabled);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update integration';
        setError(msg);
        throw err;
      }
    },
    [service, refresh]
  );

  return {
    connections,
    loading,
    error,
    createConnection,
    deleteConnection,
    toggleConnection,
    refresh,
  };
}
