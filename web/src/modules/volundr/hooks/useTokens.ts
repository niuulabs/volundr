import { useState, useEffect, useCallback } from 'react';
import type { PersonalAccessToken, CreatePATResult } from '@/modules/volundr/models';
import type { IVolundrService } from '@/modules/volundr/ports';

export interface UseTokensResult {
  tokens: PersonalAccessToken[];
  loading: boolean;
  error: string | null;
  createToken: (name: string) => Promise<CreatePATResult>;
  revokeToken: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useTokens(service: IVolundrService): UseTokensResult {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await service.listTokens();
      setTokens(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const createToken = useCallback(
    async (name: string): Promise<CreatePATResult> => {
      const result = await service.createToken(name);
      return result;
    },
    [service]
  );

  const revokeToken = useCallback(
    async (id: string) => {
      await service.revokeToken(id);
      await fetchTokens();
    },
    [service, fetchTokens]
  );

  return {
    tokens,
    loading,
    error,
    createToken,
    revokeToken,
    refresh: fetchTokens,
  };
}
