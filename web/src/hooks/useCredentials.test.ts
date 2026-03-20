import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCredentials } from './useCredentials';
import type { IVolundrService } from '@/ports';
import type { StoredCredential, SecretTypeInfo } from '@/models';

const mockCredentials: StoredCredential[] = [
  {
    id: 'cred-1',
    name: 'github-token',
    secretType: 'api_key',
    keys: ['api_key'],
    metadata: {},
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
  },
  {
    id: 'cred-2',
    name: 'deploy-key',
    secretType: 'ssh_key',
    keys: ['private_key'],
    metadata: {},
    createdAt: '2025-02-01T09:00:00Z',
    updatedAt: '2025-02-01T09:00:00Z',
  },
];

const mockTypes: SecretTypeInfo[] = [
  {
    type: 'api_key',
    label: 'API Key',
    description: 'API keys for external services',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
    defaultMountType: 'env',
  },
  {
    type: 'ssh_key',
    label: 'SSH Key',
    description: 'SSH private key',
    fields: [{ key: 'private_key', label: 'Private Key', type: 'textarea', required: true }],
    defaultMountType: 'file',
  },
];

function createMockService(overrides: Partial<IVolundrService> = {}): IVolundrService {
  return {
    getCredentials: vi.fn().mockResolvedValue(mockCredentials),
    getCredentialTypes: vi.fn().mockResolvedValue(mockTypes),
    createCredential: vi.fn().mockResolvedValue(mockCredentials[0]),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    // Stubs for the rest of IVolundrService (not used by useCredentials)
    getSessions: vi.fn(),
    getSession: vi.fn(),
    getActiveSessions: vi.fn(),
    getStats: vi.fn(),
    getModels: vi.fn(),
    getRepos: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    subscribeStats: vi.fn(() => vi.fn()),
    startSession: vi.fn(),
    connectSession: vi.fn(),
    updateSession: vi.fn(),
    stopSession: vi.fn(),
    resumeSession: vi.fn(),
    deleteSession: vi.fn(),
    archiveSession: vi.fn(),
    restoreSession: vi.fn(),
    listArchivedSessions: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    subscribeMessages: vi.fn(() => vi.fn()),
    getLogs: vi.fn(),
    subscribeLogs: vi.fn(() => vi.fn()),
    getCodeServerUrl: vi.fn(),
    getChronicle: vi.fn(),
    subscribeChronicle: vi.fn(() => vi.fn()),
    getPullRequests: vi.fn(),
    createPullRequest: vi.fn(),
    mergePullRequest: vi.fn(),
    getCIStatus: vi.fn(),
    getSessionMcpServers: vi.fn(),
    getAvailableMcpServers: vi.fn(),
    getAvailableSecrets: vi.fn(),
    createSecret: vi.fn(),
    searchTrackerIssues: vi.fn(),
    getProjectRepoMappings: vi.fn(),
    updateTrackerIssueStatus: vi.fn(),
    getTemplates: vi.fn(),
    getTemplate: vi.fn(),
    saveTemplate: vi.fn(),
    getPresets: vi.fn(),
    getPreset: vi.fn(),
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    getIdentity: vi.fn(),
    getTenants: vi.fn(),
    getTenant: vi.fn(),
    getUserCredentials: vi.fn(),
    storeUserCredential: vi.fn(),
    deleteUserCredential: vi.fn(),
    getTenantCredentials: vi.fn(),
    storeTenantCredential: vi.fn(),
    deleteTenantCredential: vi.fn(),
    getCredential: vi.fn(),
    ...overrides,
  } as unknown as IVolundrService;
}

describe('useCredentials', () => {
  let service: IVolundrService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
  });

  it('fetches credentials and types on mount', async () => {
    const { result } = renderHook(() => useCredentials(service));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.credentials).toEqual(mockCredentials);
    expect(result.current.types).toEqual(mockTypes);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    service = createMockService({
      getCredentials: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('handles non-Error rejection', async () => {
    service = createMockService({
      getCredentials: vi.fn().mockRejectedValue('string error'),
    });

    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load credentials');
  });

  it('creates a credential and refreshes', async () => {
    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createCredential({
        name: 'new-key',
        secretType: 'api_key',
        data: { api_key: 'secret' },
      });
    });

    expect(service.createCredential).toHaveBeenCalledWith({
      name: 'new-key',
      secretType: 'api_key',
      data: { api_key: 'secret' },
    });
    // Should have fetched credentials twice (initial + after create)
    expect(service.getCredentials).toHaveBeenCalledTimes(2);
  });

  it('deletes a credential and refreshes', async () => {
    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteCredential('github-token');
    });

    expect(service.deleteCredential).toHaveBeenCalledWith('github-token');
    expect(service.getCredentials).toHaveBeenCalledTimes(2);
  });

  it('filters by type', async () => {
    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeFilter).toBeNull();

    act(() => {
      result.current.filterByType('api_key');
    });

    await waitFor(() => {
      expect(result.current.activeFilter).toBe('api_key');
    });

    // Should re-fetch with the filter
    expect(service.getCredentials).toHaveBeenCalledWith('api_key');
  });

  it('filters credentials by search query', async () => {
    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSearchQuery('github');
    });

    expect(result.current.credentials).toHaveLength(1);
    expect(result.current.credentials[0].name).toBe('github-token');
  });

  it('refreshes credentials manually', async () => {
    const { result } = renderHook(() => useCredentials(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(service.getCredentials).toHaveBeenCalledTimes(2);
  });
});
