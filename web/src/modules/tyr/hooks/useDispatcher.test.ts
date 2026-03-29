import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDispatcher } from './useDispatcher';
import { dispatcherService } from '../adapters';
import type { DispatcherState } from '../models';

vi.mock('../adapters', () => ({
  dispatcherService: {
    getState: vi.fn(),
    setRunning: vi.fn(),
    setThreshold: vi.fn(),
    getLog: vi.fn(),
  },
}));

const mockState: DispatcherState = {
  id: 'dispatcher-001',
  running: true,
  threshold: 0.6,
  max_concurrent_raids: 3,
  updated_at: '2026-03-21T08:00:00Z',
};

const mockLog = [
  '[2026-03-21T08:00:01Z] Dispatcher started',
  '[2026-03-21T08:00:02Z] Scanning raids...',
];

describe('useDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dispatcherService.getState).mockResolvedValue(mockState);
    vi.mocked(dispatcherService.getLog).mockResolvedValue(mockLog);
    vi.mocked(dispatcherService.setRunning).mockResolvedValue(undefined);
    vi.mocked(dispatcherService.setThreshold).mockResolvedValue(undefined);
  });

  it('should fetch dispatcher state on mount', async () => {
    const { result } = renderHook(() => useDispatcher());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.state).toEqual(mockState);
    expect(result.current.log).toEqual(mockLog);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(dispatcherService.getState).mockRejectedValue(new Error('Connection failed'));

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Connection failed');
  });

  it('should pause dispatcher', async () => {
    const pausedState = { ...mockState, running: false };
    vi.mocked(dispatcherService.getState)
      .mockResolvedValueOnce(mockState)
      .mockResolvedValueOnce(pausedState);

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(dispatcherService.setRunning).toHaveBeenCalledWith(false);
  });

  it('should resume dispatcher', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resume();
    });

    expect(dispatcherService.setRunning).toHaveBeenCalledWith(true);
  });

  it('should set threshold', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setThreshold(0.8);
    });

    expect(dispatcherService.setThreshold).toHaveBeenCalledWith(0.8);
  });

  it('should handle non-Error rejection on mount', async () => {
    vi.mocked(dispatcherService.getState).mockRejectedValue('string error');

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('string error');
  });

  it('should refresh state and log when refresh is called', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(dispatcherService.getState).toHaveBeenCalledTimes(1);

    const updatedState = { ...mockState, threshold: 0.9 };
    const updatedLog = ['[2026-03-21T09:00:00Z] Threshold updated'];
    vi.mocked(dispatcherService.getState).mockResolvedValue(updatedState);
    vi.mocked(dispatcherService.getLog).mockResolvedValue(updatedLog);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.state).toEqual(updatedState);
    expect(result.current.log).toEqual(updatedLog);
    expect(result.current.error).toBeNull();
  });

  it('should set error when refresh fails', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(dispatcherService.getState).mockRejectedValue(new Error('Refresh failed'));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Refresh failed');
  });

  it('should handle non-Error rejection in refresh', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.mocked(dispatcherService.getLog).mockRejectedValue(404);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('404');
  });

  it('should set loading to true during refresh', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let resolveState!: (value: DispatcherState) => void;
    vi.mocked(dispatcherService.getState).mockImplementation(
      () =>
        new Promise<DispatcherState>(resolve => {
          resolveState = resolve;
        })
    );

    act(() => {
      result.current.refresh();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolveState(mockState);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('should update state after pause', async () => {
    const pausedState = { ...mockState, running: false };
    vi.mocked(dispatcherService.getState)
      .mockResolvedValueOnce(mockState) // initial useEffect call
      .mockResolvedValueOnce(pausedState); // after pause

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.state).toEqual(pausedState);
  });

  it('should update state after resume', async () => {
    const resumedState = { ...mockState, running: true };
    vi.mocked(dispatcherService.getState)
      .mockResolvedValueOnce({ ...mockState, running: false }) // initial
      .mockResolvedValueOnce(resumedState); // after resume

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resume();
    });

    expect(result.current.state).toEqual(resumedState);
  });

  it('should update state after setThreshold', async () => {
    const updatedState = { ...mockState, threshold: 0.8 };
    vi.mocked(dispatcherService.getState)
      .mockResolvedValueOnce(mockState) // initial
      .mockResolvedValueOnce(updatedState); // after setThreshold

    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setThreshold(0.8);
    });

    expect(result.current.state).toEqual(updatedState);
  });

  it('should not update state after unmount (cancelled flag)', async () => {
    let resolveState!: (value: DispatcherState) => void;
    vi.mocked(dispatcherService.getState).mockImplementation(
      () =>
        new Promise<DispatcherState>(resolve => {
          resolveState = resolve;
        })
    );

    const { unmount } = renderHook(() => useDispatcher());

    unmount();

    await act(async () => {
      resolveState(mockState);
    });
  });

  it('should not set error after unmount when fetch fails', async () => {
    let rejectState!: (reason: unknown) => void;
    vi.mocked(dispatcherService.getState).mockImplementation(
      () =>
        new Promise<DispatcherState>((_resolve, reject) => {
          rejectState = reject;
        })
    );

    const { unmount } = renderHook(() => useDispatcher());

    unmount();

    await act(async () => {
      rejectState(new Error('late error'));
    });
  });

  it('should fetch log data on mount', async () => {
    const { result } = renderHook(() => useDispatcher());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(dispatcherService.getLog).toHaveBeenCalledTimes(1);
    expect(result.current.log).toEqual(mockLog);
  });
});
