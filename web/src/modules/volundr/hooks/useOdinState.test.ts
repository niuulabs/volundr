import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useOdinState } from './useOdinState';
import { odinService } from '@/modules/volundr/adapters';
import type { OdinState, PendingDecision } from '@/modules/volundr/models';

vi.mock('@/modules/volundr/adapters', () => ({
  odinService: {
    getState: vi.fn(),
    getPendingDecisions: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    approveDecision: vi.fn(),
    rejectDecision: vi.fn(),
  },
}));

const mockOdinState: OdinState = {
  status: 'thinking',
  loopCycle: 847291,
  loopPhase: 'THINK',
  loopProgress: 65,
  currentThought: 'Processing...',
  attention: { primary: 'Storage migration', secondary: [] },
  disposition: { alertness: 0.7, concern: 0.3, creativity: 0.5 },
  circadianMode: 'active',
  resources: { idleGPUs: 4, totalGPUs: 8, availableCapacity: 35 },
  stats: {
    realmsHealthy: 4,
    realmsTotal: 5,
    activeCampaigns: 2,
    einherjarWorking: 5,
    einherjarTotal: 7,
    observationsToday: 1247,
    decisionsToday: 89,
    actionsToday: 34,
  },
  pendingDecisions: [],
};

const mockDecisions: PendingDecision[] = [
  {
    id: 'dec-1',
    type: 'merge',
    description: 'Merge PR #47',
    confidence: 0.82,
    threshold: 0.85,
    zone: 'yellow',
  },
];

describe('useOdinState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(odinService.getState).mockResolvedValue(mockOdinState);
    vi.mocked(odinService.getPendingDecisions).mockResolvedValue(mockDecisions);
  });

  it('should fetch state on mount', async () => {
    const { result } = renderHook(() => useOdinState());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.state).toEqual(mockOdinState);
    expect(result.current.pendingDecisions).toEqual(mockDecisions);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(odinService.getState).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(odinService.subscribe).toHaveBeenCalled();
  });

  it('should approve decision', async () => {
    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.approveDecision('dec-1');
    });

    expect(odinService.approveDecision).toHaveBeenCalledWith('dec-1');
    expect(result.current.pendingDecisions).toHaveLength(0);
  });

  it('should reject decision', async () => {
    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.rejectDecision('dec-1');
    });

    expect(odinService.rejectDecision).toHaveBeenCalledWith('dec-1');
    expect(result.current.pendingDecisions).toHaveLength(0);
  });

  it('should refresh state', async () => {
    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(odinService.getState).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(odinService.getState).mockRejectedValue('string error');

    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch state');
  });

  it('should update state and decisions from subscriber', async () => {
    let subscriberCallback: (state: OdinState) => void = () => {};
    vi.mocked(odinService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useOdinState());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedState: OdinState = {
      ...mockOdinState,
      status: 'acting',
      pendingDecisions: [
        {
          id: 'dec-2',
          type: 'deploy',
          description: 'Deploy hotfix',
          confidence: 0.95,
          threshold: 0.85,
          zone: 'green',
        },
      ],
    };

    act(() => {
      subscriberCallback(updatedState);
    });

    expect(result.current.state?.status).toBe('acting');
    expect(result.current.pendingDecisions).toHaveLength(1);
    expect(result.current.pendingDecisions[0].id).toBe('dec-2');
  });
});
