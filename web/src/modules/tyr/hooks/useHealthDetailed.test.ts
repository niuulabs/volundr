import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHealthDetailed } from './useHealthDetailed';

const mockHealth = {
  status: 'healthy',
  database: 'connected',
  event_bus_subscriber_count: 2,
  activity_subscriber_running: true,
  notification_service_running: true,
  review_engine_running: false,
};

describe('useHealthDetailed', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockHealth,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch health on mount', async () => {
    const { result } = renderHook(() => useHealthDetailed());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.health).toEqual(mockHealth);
    expect(result.current.error).toBeNull();
  });

  it('should handle Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('timeout'));
    const { result } = renderHook(() => useHealthDetailed());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('timeout');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string fail');
    const { result } = renderHook(() => useHealthDetailed());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string fail');
  });
});
