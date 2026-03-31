import { useState, useEffect } from 'react';
import { createApiClient } from '@/modules/shared/api/client';
import type { RepoInfo } from '../models';

const niuuApi = createApiClient('/api/v1/niuu');

interface UseReposResult {
  repos: RepoInfo[];
  loading: boolean;
  error: string | null;
}

export function useRepos(): UseReposResult {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    niuuApi
      .get<Record<string, RepoInfo[]>>('/repos')
      .then(reposByProvider => {
        if (cancelled) return;
        setRepos(Object.values(reposByProvider).flat());
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { repos, loading, error };
}
