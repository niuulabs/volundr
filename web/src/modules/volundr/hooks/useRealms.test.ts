import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRealms, useRealmDetail } from './useRealms';
import { realmService } from '@/modules/volundr/adapters';
import type { Realm, RealmDetail } from '@/modules/volundr/models';

vi.mock('@/modules/volundr/adapters', () => ({
  realmService: {
    getRealms: vi.fn(),
    getRealm: vi.fn(),
    getRealmDetail: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

const mockRealms: Realm[] = [
  {
    id: 'valhalla',
    name: 'Valhalla',
    description: 'AI/ML GPU cluster',
    location: 'ca-hamilton-1',
    status: 'healthy',
    health: {
      status: 'healthy',
      inputs: {
        nodesReady: 3,
        nodesTotal: 3,
        podRunningRatio: 1.0,
        volumesDegraded: 0,
        volumesFaulted: 0,
        recentErrorCount: 0,
      },
      reason: '',
    },
    resources: {
      cpu: { capacity: 48, allocatable: 44, unit: 'cores' },
      memory: { capacity: 384, allocatable: 360, unit: 'GiB' },
      gpuCount: 6,
      pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
    },
    valkyrie: null,
  },
];

describe('useRealms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(realmService.getRealms).mockResolvedValue(mockRealms);
    vi.mocked(realmService.getRealm).mockResolvedValue(mockRealms[0]);
  });

  it('should fetch realms on mount', async () => {
    const { result } = renderHook(() => useRealms());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.realms).toEqual(mockRealms);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(realmService.getRealms).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(realmService.subscribe).toHaveBeenCalled();
  });

  it('should get a single realm', async () => {
    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const realm = await result.current.getRealm('valhalla');
    expect(realm).toEqual(mockRealms[0]);
    expect(realmService.getRealm).toHaveBeenCalledWith('valhalla');
  });

  it('should refresh realms', async () => {
    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(realmService.getRealms).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(realmService.getRealms).mockRejectedValue('string error');

    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch realms');
  });

  it('should update realms from subscriber', async () => {
    let subscriberCallback: (realms: Realm[]) => void = () => {};
    vi.mocked(realmService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useRealms());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedRealms = [{ ...mockRealms[0], status: 'warning' as const }];

    act(() => {
      subscriberCallback(updatedRealms);
    });

    expect(result.current.realms[0].status).toBe('warning');
  });
});

const mockDetail: RealmDetail = {
  ...mockRealms[0],
  nodes: [
    {
      name: 'valhalla-gpu-1',
      status: 'Ready',
      roles: ['worker', 'gpu'],
      cpu: { capacity: 16, allocatable: 14, unit: 'cores' },
      memory: { capacity: 128, allocatable: 120, unit: 'GiB' },
      gpuCount: 4,
      conditions: [{ conditionType: 'Ready', status: 'True', message: '' }],
    },
  ],
  workloads: {
    namespaceCount: 6,
    deploymentTotal: 8,
    deploymentHealthy: 8,
    statefulsetCount: 2,
    daemonsetCount: 3,
    pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
  },
  storage: {
    totalCapacityBytes: 4_000_000_000_000,
    usedBytes: 2_200_000_000_000,
    volumes: { healthy: 8, degraded: 0, faulted: 0 },
  },
  events: [
    {
      timestamp: '2026-02-10T10:47:00Z',
      severity: 'info',
      source: 'gpu-operator',
      message: 'All GPUs healthy',
      involvedObject: 'daemonset/gpu-operator',
    },
  ],
};

describe('useRealmDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(realmService.getRealmDetail).mockResolvedValue(mockDetail);
  });

  it('should fetch detail on mount', async () => {
    const { result } = renderHook(() => useRealmDetail('valhalla'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.detail).toEqual(mockDetail);
    expect(result.current.error).toBeNull();
  });

  it('should set detail to null when realmId is undefined', async () => {
    const { result } = renderHook(() => useRealmDetail(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.detail).toBeNull();
    expect(realmService.getRealmDetail).not.toHaveBeenCalled();
  });

  it('should handle fetch error', async () => {
    vi.mocked(realmService.getRealmDetail).mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useRealmDetail('valhalla'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Not found');
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(realmService.getRealmDetail).mockRejectedValue('string error');

    const { result } = renderHook(() => useRealmDetail('valhalla'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch realm detail');
  });

  it('should refetch when realmId changes', async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useRealmDetail(id),
      { initialProps: { id: 'valhalla' } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    rerender({ id: 'vanaheim' });

    await waitFor(() => {
      expect(realmService.getRealmDetail).toHaveBeenCalledWith('vanaheim');
    });
  });

  it('should refresh detail', async () => {
    const { result } = renderHook(() => useRealmDetail('valhalla'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(realmService.getRealmDetail).toHaveBeenCalledTimes(2);
  });
});
