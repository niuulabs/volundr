import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSagaDetail } from './useSagaDetail';
import { tyrService } from '../adapters';
import type { Saga, Phase } from '../models';

vi.mock('../adapters', () => ({
  tyrService: {
    getSagas: vi.fn(),
    getSaga: vi.fn(),
    getPhases: vi.fn(),
    createSaga: vi.fn(),
    decompose: vi.fn(),
  },
}));

const mockSaga: Saga = {
  id: 'saga-001',
  tracker_id: 'NIU-100',
  tracker_type: 'linear',
  slug: 'storage-health',
  name: 'Storage Health Observer',
  repo: 'github.com/niuulabs/volundr',
  feature_branch: 'feat/storage-health',
  status: 'active',
  confidence: 0.72,
  created_at: '2026-03-18T08:30:00Z',
};

const mockPhases: Phase[] = [
  {
    id: 'phase-001',
    saga_id: 'saga-001',
    tracker_id: 'NIU-100',
    number: 1,
    name: 'Core Infrastructure',
    status: 'active',
    confidence: 0.84,
    raids: [],
  },
];

describe('useSagaDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tyrService.getSaga).mockResolvedValue(mockSaga);
    vi.mocked(tyrService.getPhases).mockResolvedValue(mockPhases);
  });

  it('should fetch saga and phases on mount', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toEqual(mockSaga);
    expect(result.current.phases).toEqual(mockPhases);
    expect(result.current.error).toBeNull();
  });

  it('should return null saga when id is undefined', async () => {
    const { result } = renderHook(() => useSagaDetail(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toBeNull();
    expect(result.current.phases).toEqual([]);
  });

  it('should handle fetch error', async () => {
    vi.mocked(tyrService.getSaga).mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Not found');
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(tyrService.getSaga).mockRejectedValue('string rejection');

    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('string rejection');
  });

  it('should refresh saga and phases when refresh is called', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(tyrService.getSaga).toHaveBeenCalledTimes(1);

    const updatedSaga = { ...mockSaga, confidence: 0.99 };
    const updatedPhases = [{ ...mockPhases[0], confidence: 0.95 }];
    vi.mocked(tyrService.getSaga).mockResolvedValue(updatedSaga);
    vi.mocked(tyrService.getPhases).mockResolvedValue(updatedPhases);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toEqual(updatedSaga);
    expect(result.current.phases).toEqual(updatedPhases);
    expect(result.current.error).toBeNull();
  });

  it('should set error when refresh fails', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(tyrService.getSaga).mockRejectedValue(new Error('Refresh error'));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Refresh error');
  });

  it('should handle non-Error rejection in refresh', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(tyrService.getPhases).mockRejectedValue(99);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('99');
  });

  it('should clear saga and phases when refresh is called with undefined sagaId', async () => {
    const { result } = renderHook(() => useSagaDetail(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toBeNull();
    expect(result.current.phases).toEqual([]);

    // Calling refresh with undefined sagaId should also clear
    await act(async () => {
      result.current.refresh();
    });

    expect(result.current.saga).toBeNull();
    expect(result.current.phases).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('should set loading to true during refresh', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let resolveSaga!: (value: Saga) => void;
    vi.mocked(tyrService.getSaga).mockImplementation(
      () =>
        new Promise<Saga>(resolve => {
          resolveSaga = resolve;
        })
    );

    act(() => {
      result.current.refresh();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveSaga(mockSaga);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should not update state after unmount (cancelled flag)', async () => {
    let resolveSaga!: (value: Saga) => void;
    vi.mocked(tyrService.getSaga).mockImplementation(
      () =>
        new Promise<Saga>(resolve => {
          resolveSaga = resolve;
        })
    );

    const { unmount } = renderHook(() => useSagaDetail('saga-001'));

    unmount();

    await act(async () => {
      resolveSaga(mockSaga);
    });
  });

  it('should not set error after unmount when fetch fails', async () => {
    let rejectSaga!: (reason: unknown) => void;
    vi.mocked(tyrService.getSaga).mockImplementation(
      () =>
        new Promise<Saga>((_resolve, reject) => {
          rejectSaga = reject;
        })
    );

    const { unmount } = renderHook(() => useSagaDetail('saga-001'));

    unmount();

    await act(async () => {
      rejectSaga(new Error('late error'));
    });
  });
});
