import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActiveRaids } from './useActiveRaids';

const mockRaids = [
  {
    tracker_id: 'tr-1',
    identifier: 'NIU-100',
    title: 'Fix bug',
    url: 'https://linear.app/NIU-100',
    status: 'RUNNING',
    session_id: 's-1',
    confidence: 0.8,
    pr_url: null,
    last_updated: '2026-03-27T00:00:00Z',
  },
];

describe('useActiveRaids', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRaids,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch active raids on mount and lowercase status', async () => {
    const { result } = renderHook(() => useActiveRaids());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.raids).toHaveLength(1);
    expect(result.current.raids[0].status).toBe('running');
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error gracefully', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useActiveRaids());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.raids).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should patch a raid locally', async () => {
    const { result } = renderHook(() => useActiveRaids());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.patchRaid('tr-1', { confidence: 0.95 });
    });
    expect(result.current.raids[0].confidence).toBe(0.95);
  });

  it('should refresh raids', async () => {
    const { result } = renderHook(() => useActiveRaids());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.raids).toHaveLength(1);
  });
});
