import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useClusters } from './useClusters';

const mockClusters = [
  { connection_id: 'c-1', name: 'prod', url: 'https://prod.example.com', enabled: true },
];

describe('useClusters', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockClusters,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch clusters on mount', async () => {
    const { result } = renderHook(() => useClusters());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clusters).toHaveLength(1);
    expect(result.current.clusters[0].name).toBe('prod');
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useClusters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string error');
    const { result } = renderHook(() => useClusters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });
});
