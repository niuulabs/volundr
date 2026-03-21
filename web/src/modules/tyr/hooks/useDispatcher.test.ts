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
});
