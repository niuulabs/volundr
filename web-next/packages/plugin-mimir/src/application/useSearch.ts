import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useService } from '@niuulabs/plugin-sdk';
import type { IMimirService, SearchMode } from '../ports';

export interface UseSearchReturn {
  query: string;
  mode: SearchMode;
  setQuery: (q: string) => void;
  setMode: (m: SearchMode) => void;
  results: import('../domain/page').SearchResult[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid');
  const service = useService<IMimirService>('mimir');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['mimir', 'search', query, mode],
    queryFn: () => service.pages.search(query, mode),
    enabled: query.trim().length > 0,
  });

  return {
    query,
    mode,
    setQuery,
    setMode,
    results: data ?? [],
    isLoading,
    isError,
    error,
  };
}
