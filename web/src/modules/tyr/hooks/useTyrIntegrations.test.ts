import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTyrIntegrations } from './useTyrIntegrations';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { ITyrIntegrationService } from '../ports';

const mockConnection: IntegrationConnection = {
  id: 'conn-1',
  integrationType: 'code_forge',
  adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  credentialName: 'volundr-pat',
  config: { url: 'http://volundr' },
  enabled: true,
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T10:00:00Z',
  slug: 'code-forge',
};

function createMockService(connections: IntegrationConnection[] = []): ITyrIntegrationService {
  return {
    listIntegrations: vi.fn().mockResolvedValue(connections),
    createIntegration: vi.fn().mockResolvedValue(mockConnection),
    deleteIntegration: vi.fn().mockResolvedValue(undefined),
    toggleIntegration: vi.fn().mockResolvedValue(mockConnection),
    getTelegramSetup: vi.fn().mockResolvedValue({
      deeplink: 'https://t.me/TyrBot?start=tok',
      token: 'tok',
    }),
  };
}

describe('useTyrIntegrations', () => {
  let service: ITyrIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
  });

  it('fetches connections on mount', async () => {
    const { result } = renderHook(() => useTyrIntegrations(service));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(service.listIntegrations).toHaveBeenCalledOnce();
    expect(result.current.connections).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('returns connections from service', async () => {
    service = createMockService([mockConnection]);
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.connections).toEqual([mockConnection]);
  });

  it('sets error when listIntegrations fails', async () => {
    service.listIntegrations = vi.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('sets fallback error for non-Error list failure', async () => {
    service.listIntegrations = vi.fn().mockRejectedValue('oops');
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load integrations');
  });

  it('createConnection calls service and refreshes', async () => {
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const params = {
      integrationType: 'code_forge',
      adapter: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
      credentialName: 'volundr-pat',
      credentialValue: 'secret',
      config: { url: 'http://volundr' },
    };

    await act(async () => {
      await result.current.createConnection(params);
    });

    expect(service.createIntegration).toHaveBeenCalledWith(params);
    // refresh called: initial + after create
    expect(service.listIntegrations).toHaveBeenCalledTimes(2);
  });

  it('createConnection sets error on failure', async () => {
    service.createIntegration = vi.fn().mockRejectedValue(new Error('Create failed'));
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.createConnection({
          integrationType: 'code_forge',
          adapter: 'a',
          credentialName: 'n',
          credentialValue: 'v',
          config: {},
        })
      ).rejects.toThrow('Create failed');
    });

    expect(result.current.error).toBe('Create failed');
  });

  it('createConnection sets fallback error for non-Error failure', async () => {
    service.createIntegration = vi.fn().mockRejectedValue('oops');
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.createConnection({
          integrationType: 'code_forge',
          adapter: 'a',
          credentialName: 'n',
          credentialValue: 'v',
          config: {},
        })
      ).rejects.toBe('oops');
    });

    expect(result.current.error).toBe('Failed to create integration');
  });

  it('deleteConnection calls service and refreshes', async () => {
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.deleteConnection('conn-1');
    });

    expect(service.deleteIntegration).toHaveBeenCalledWith('conn-1');
    expect(service.listIntegrations).toHaveBeenCalledTimes(2);
  });

  it('deleteConnection sets error on failure', async () => {
    service.deleteIntegration = vi.fn().mockRejectedValue(new Error('Delete failed'));
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.deleteConnection('conn-1')).rejects.toThrow('Delete failed');
    });

    expect(result.current.error).toBe('Delete failed');
  });

  it('deleteConnection sets fallback error for non-Error failure', async () => {
    service.deleteIntegration = vi.fn().mockRejectedValue('oops');
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.deleteConnection('conn-1')).rejects.toBe('oops');
    });

    expect(result.current.error).toBe('Failed to delete integration');
  });

  it('toggleConnection calls service and refreshes', async () => {
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleConnection('conn-1', false);
    });

    expect(service.toggleIntegration).toHaveBeenCalledWith('conn-1', false);
    expect(service.listIntegrations).toHaveBeenCalledTimes(2);
  });

  it('toggleConnection sets error on failure', async () => {
    service.toggleIntegration = vi.fn().mockRejectedValue(new Error('Toggle failed'));
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.toggleConnection('conn-1', true)).rejects.toThrow(
        'Toggle failed'
      );
    });

    expect(result.current.error).toBe('Toggle failed');
  });

  it('toggleConnection sets fallback error for non-Error failure', async () => {
    service.toggleIntegration = vi.fn().mockRejectedValue('oops');
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.toggleConnection('conn-1', true)).rejects.toBe('oops');
    });

    expect(result.current.error).toBe('Failed to update integration');
  });

  it('refresh resets error state', async () => {
    service.listIntegrations = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue([]);
    const { result } = renderHook(() => useTyrIntegrations(service));

    await waitFor(() => {
      expect(result.current.error).toBe('fail');
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.connections).toEqual([]);
  });
});
