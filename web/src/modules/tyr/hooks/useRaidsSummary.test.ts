import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRaidsSummary } from './useRaidsSummary';

describe('useRaidsSummary', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ RUNNING: 3, REVIEW: 1, MERGED: 5 }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch and normalize summary keys to lowercase', async () => {
    const { result } = renderHook(() => useRaidsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary).toEqual({ running: 3, review: 1, merged: 5 });
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useRaidsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(42);
    const { result } = renderHook(() => useRaidsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('42');
  });

  it('should expose a refresh function', async () => {
    const { result } = renderHook(() => useRaidsSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.refresh).toBe('function');
  });
});
