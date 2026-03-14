import { useState, useEffect, useCallback } from 'react';
import type { IntegrationConnection, IntegrationTestResult } from '@/models';
import { volundrService } from '@/adapters';

interface UseIntegrationsResult {
  integrations: IntegrationConnection[];
  loading: boolean;
  error: Error | null;
  createIntegration: (
    connection: Omit<IntegrationConnection, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<IntegrationConnection>;
  deleteIntegration: (id: string) => Promise<void>;
  testIntegration: (id: string) => Promise<IntegrationTestResult>;
  startOAuthFlow: (slug: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useIntegrations(): UseIntegrationsResult {
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await volundrService.getIntegrations();
      setIntegrations(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch integrations'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const createIntegration = useCallback(
    async (connection: Omit<IntegrationConnection, 'id' | 'createdAt' | 'updatedAt'>) => {
      const created = await volundrService.createIntegration(connection);
      setIntegrations(prev => [created, ...prev]);
      return created;
    },
    []
  );

  const deleteIntegration = useCallback(async (id: string) => {
    await volundrService.deleteIntegration(id);
    setIntegrations(prev => prev.filter(i => i.id !== id));
  }, []);

  const testIntegration = useCallback(async (id: string) => {
    return volundrService.testIntegration(id);
  }, []);

  const startOAuthFlow = useCallback(
    async (slug: string) => {
      const resp = await fetch(`/api/v1/volundr/integrations/oauth/${slug}/authorize`, {
        credentials: 'include',
      });
      if (!resp.ok) {
        throw new Error('Failed to start OAuth flow');
      }
      const { url } = await resp.json();
      const popup = window.open(url, `oauth-${slug}`, 'width=600,height=700');
      if (!popup) {
        throw new Error('Popup blocked — please allow popups for this site');
      }

      await new Promise<void>(resolve => {
        const interval = setInterval(() => {
          if (popup.closed) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });

      await fetchIntegrations();
    },
    [fetchIntegrations]
  );

  return {
    integrations,
    loading,
    error,
    createIntegration,
    deleteIntegration,
    testIntegration,
    startOAuthFlow,
    refresh: fetchIntegrations,
  };
}
