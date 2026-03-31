import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRaidReview } from './useRaidReview';

const mockReview = {
  raid_id: 'r-1',
  name: 'Fix bug',
  status: 'review',
  chronicle_summary: 'Fixed the bug.',
  pr_url: 'https://github.com/pull/1',
  ci_passed: true,
  confidence: 0.9,
  confidence_events: [],
};

const mockAction = { id: 'r-1', name: 'Fix bug', status: 'merged', confidence: 1.0 };

describe('useRaidReview', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockReview,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when raidId is null', () => {
    const { result } = renderHook(() => useRaidReview(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.review).toBeNull();
  });

  it('should fetch review data when raidId is provided', async () => {
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.review).toEqual(mockReview);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string error');
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('approve should throw when raidId is null', async () => {
    const { result } = renderHook(() => useRaidReview(null));
    await expect(result.current.approve()).rejects.toThrow('No raid selected');
  });

  it('approve should call API when raidId is set', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockAction,
    } as Response);
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.approve();
    });
    expect(actionResult).toEqual(mockAction);
  });

  it('reject should throw when raidId is null', async () => {
    const { result } = renderHook(() => useRaidReview(null));
    await expect(result.current.reject('bad')).rejects.toThrow('No raid selected');
  });

  it('reject should call API when raidId is set', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockAction,
    } as Response);
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.reject('bad code');
    });
    expect(actionResult).toEqual(mockAction);
  });

  it('retry should throw when raidId is null', async () => {
    const { result } = renderHook(() => useRaidReview(null));
    await expect(result.current.retry()).rejects.toThrow('No raid selected');
  });

  it('retry should call API when raidId is set', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockAction,
    } as Response);
    const { result } = renderHook(() => useRaidReview('r-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let actionResult: unknown;
    await act(async () => {
      actionResult = await result.current.retry();
    });
    expect(actionResult).toEqual(mockAction);
  });
});
