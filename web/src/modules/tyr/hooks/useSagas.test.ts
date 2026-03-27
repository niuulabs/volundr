import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSagas } from './useSagas';

const mockSagas = [
  {
    id: 'saga-001',
    tracker_id: 'proj-1',
    tracker_type: 'linear',
    slug: 'alpha',
    name: 'Alpha',
    repos: ['org/repo'],
    feature_branch: 'feat/alpha',
    status: 'started',
    progress: 0.5,
    milestone_count: 2,
    issue_count: 5,
    url: 'https://linear.app/proj-1',
  },
];

describe('useSagas', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSagas,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch sagas on mount', async () => {
    const { result } = renderHook(() => useSagas());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sagas).toHaveLength(1);
    expect(result.current.sagas[0].name).toBe('Alpha');
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useSagas());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
    expect(result.current.sagas).toHaveLength(0);
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string error');
    const { result } = renderHook(() => useSagas());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('should delete a saga', async () => {
    const { result } = renderHook(() => useSagas());
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => undefined,
    } as Response);

    await act(async () => {
      await result.current.deleteSaga('saga-001');
    });
    expect(result.current.sagas).toHaveLength(0);
  });
});
