import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSagas } from './useSagas';
import { tyrService } from '../adapters';
import type { Saga } from '../models';

vi.mock('../adapters', () => ({
  tyrService: {
    getSagas: vi.fn(),
    getSaga: vi.fn(),
    getPhases: vi.fn(),
    createSaga: vi.fn(),
    decompose: vi.fn(),
  },
}));

const mockSagas: Saga[] = [
  {
    id: 'saga-001',
    tracker_id: 'NIU-100',
    tracker_type: 'linear',
    slug: 'storage-health',
    name: 'Storage Health Observer',
    repos: ['github.com/niuulabs/volundr'],
    feature_branch: 'feat/storage-health',
    status: 'active',
    confidence: 0.72,
    created_at: '2026-03-18T08:30:00Z',
    phase_summary: { total: 2, completed: 1 },
  },
];

describe('useSagas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tyrService.getSagas).mockResolvedValue(mockSagas);
  });

  it('should fetch sagas on mount', async () => {
    const { result } = renderHook(() => useSagas());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sagas).toEqual(mockSagas);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(tyrService.getSagas).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(tyrService.getSagas).mockRejectedValue('string error');

    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('string error');
  });

  it('should refresh sagas when refresh is called', async () => {
    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(tyrService.getSagas).toHaveBeenCalledTimes(1);

    const updatedSagas: Saga[] = [{ ...mockSagas[0], confidence: 0.95 }];
    vi.mocked(tyrService.getSagas).mockResolvedValue(updatedSagas);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(tyrService.getSagas).toHaveBeenCalledTimes(2);
    expect(result.current.sagas).toEqual(updatedSagas);
    expect(result.current.error).toBeNull();
  });

  it('should set error when refresh fails', async () => {
    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(tyrService.getSagas).mockRejectedValue(new Error('Refresh failed'));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Refresh failed');
  });

  it('should handle non-Error rejection in refresh', async () => {
    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(tyrService.getSagas).mockRejectedValue(42);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('42');
  });

  it('should set loading to true during refresh', async () => {
    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let resolveRefresh!: (value: Saga[]) => void;
    vi.mocked(tyrService.getSagas).mockImplementation(
      () =>
        new Promise<Saga[]>(resolve => {
          resolveRefresh = resolve;
        })
    );

    act(() => {
      result.current.refresh();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveRefresh(mockSagas);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should not update state after unmount (cancelled flag)', async () => {
    let resolveGetSagas!: (value: Saga[]) => void;
    vi.mocked(tyrService.getSagas).mockImplementation(
      () =>
        new Promise<Saga[]>(resolve => {
          resolveGetSagas = resolve;
        })
    );

    const { result, unmount } = renderHook(() => useSagas());

    expect(result.current.loading).toBe(true);

    unmount();

    // Resolve after unmount — should not throw or update state
    await act(async () => {
      resolveGetSagas(mockSagas);
    });
  });

  it('should not set error after unmount when fetch fails', async () => {
    let rejectGetSagas!: (reason: unknown) => void;
    vi.mocked(tyrService.getSagas).mockImplementation(
      () =>
        new Promise<Saga[]>((_resolve, reject) => {
          rejectGetSagas = reject;
        })
    );

    const { unmount } = renderHook(() => useSagas());

    unmount();

    // Reject after unmount — should not throw
    await act(async () => {
      rejectGetSagas(new Error('late error'));
    });
  });
});
