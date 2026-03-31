import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionTimeline } from './useSessionTimeline';

const mockTimeline = {
  session_id: 's-1',
  entries: [{ timestamp: '2026-03-27T00:00:00Z', type: 'message', content: 'Hello' }],
};

describe('useSessionTimeline', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockTimeline,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when sessionId is null', async () => {
    const { result } = renderHook(() => useSessionTimeline(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.timeline).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch timeline when sessionId is provided', async () => {
    const { result } = renderHook(() => useSessionTimeline('s-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.timeline).toEqual(mockTimeline);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() => useSessionTimeline('s-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('timeout');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('oops');
    const { result } = renderHook(() => useSessionTimeline('s-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('oops');
  });
});
