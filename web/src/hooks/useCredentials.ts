import { useState, useEffect, useCallback } from 'react';
import type {
  StoredCredential,
  CredentialCreateRequest,
  SecretType,
  SecretTypeInfo,
} from '@/models';
import type { IVolundrService } from '@/ports';

export interface UseCredentialsResult {
  credentials: StoredCredential[];
  types: SecretTypeInfo[];
  loading: boolean;
  error: string | null;
  createCredential: (req: CredentialCreateRequest) => Promise<void>;
  deleteCredential: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
  filterByType: (type: SecretType | null) => void;
  activeFilter: SecretType | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export function useCredentials(service: IVolundrService): UseCredentialsResult {
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [types, setTypes] = useState<SecretTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SecretType | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchCredentials = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [creds, typeInfos] = await Promise.all([
        service.getCredentials(activeFilter ?? undefined),
        service.getCredentialTypes(),
      ]);
      setCredentials(creds);
      setTypes(typeInfos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, [service, activeFilter]);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const createCredential = useCallback(
    async (req: CredentialCreateRequest) => {
      await service.createCredential(req);
      await fetchCredentials();
    },
    [service, fetchCredentials]
  );

  const deleteCredential = useCallback(
    async (name: string) => {
      await service.deleteCredential(name);
      await fetchCredentials();
    },
    [service, fetchCredentials]
  );

  const filterByType = useCallback((type: SecretType | null) => {
    setActiveFilter(type);
  }, []);

  const filteredCredentials = searchQuery
    ? credentials.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : credentials;

  return {
    credentials: filteredCredentials,
    types,
    loading,
    error,
    createCredential,
    deleteCredential,
    refresh: fetchCredentials,
    filterByType,
    activeFilter,
    searchQuery,
    setSearchQuery,
  };
}
