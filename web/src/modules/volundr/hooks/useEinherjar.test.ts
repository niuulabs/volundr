import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useEinherjar } from './useEinherjar';
import { einherjarService } from '@/modules/volundr/adapters';
import type { Einherjar, EinherjarStats } from '@/modules/volundr/models';

vi.mock('@/modules/volundr/adapters', () => ({
  einherjarService: {
    getEinherjar: vi.fn(),
    getWorker: vi.fn(),
    getWorkersByStatus: vi.fn(),
    getWorkersByCampaign: vi.fn(),
    getStats: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    forceCheckpoint: vi.fn(),
    reassignWorker: vi.fn(),
  },
}));

const mockWorkers: Einherjar[] = [
  {
    id: 'ein-valhalla-001',
    name: 'ein-valhalla-001',
    status: 'working',
    realm: 'valhalla',
    campaign: 'campaign-001',
    phase: 'phase-2',
    task: 'Writing tests',
    progress: 78,
    contextUsed: 45,
    contextMax: 128,
    cyclesSinceCheckpoint: 12,
  },
];

const mockStats: EinherjarStats = {
  total: 7,
  working: 5,
  idle: 2,
  averageContextUsage: 0.45,
};

describe('useEinherjar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(einherjarService.getEinherjar).mockResolvedValue(mockWorkers);
    vi.mocked(einherjarService.getStats).mockResolvedValue(mockStats);
    vi.mocked(einherjarService.getWorker).mockResolvedValue(mockWorkers[0]);
    vi.mocked(einherjarService.getWorkersByStatus).mockResolvedValue(mockWorkers);
    vi.mocked(einherjarService.getWorkersByCampaign).mockResolvedValue(mockWorkers);
  });

  it('should fetch workers and stats on mount', async () => {
    const { result } = renderHook(() => useEinherjar());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.workers).toEqual(mockWorkers);
    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(einherjarService.getEinherjar).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(einherjarService.subscribe).toHaveBeenCalled();
  });

  it('should get a single worker', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const worker = await result.current.getWorker('ein-valhalla-001');
    expect(worker).toEqual(mockWorkers[0]);
  });

  it('should get workers by status', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const workers = await result.current.getWorkersByStatus('working');
    expect(workers).toEqual(mockWorkers);
    expect(einherjarService.getWorkersByStatus).toHaveBeenCalledWith('working');
  });

  it('should get workers by campaign', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const workers = await result.current.getWorkersByCampaign('campaign-001');
    expect(workers).toEqual(mockWorkers);
    expect(einherjarService.getWorkersByCampaign).toHaveBeenCalledWith('campaign-001');
  });

  it('should force checkpoint', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.forceCheckpoint('ein-valhalla-001');
    });

    expect(einherjarService.forceCheckpoint).toHaveBeenCalledWith('ein-valhalla-001');
  });

  it('should reassign worker', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.reassignWorker('ein-valhalla-001', 'campaign-002');
    });

    expect(einherjarService.reassignWorker).toHaveBeenCalledWith(
      'ein-valhalla-001',
      'campaign-002'
    );
  });

  it('should refresh data', async () => {
    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(einherjarService.getEinherjar).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(einherjarService.getEinherjar).mockRejectedValue('string error');

    const { result } = renderHook(() => useEinherjar());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch einherjar');
  });
});
