import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSagaDetail } from './useSagaDetail';

const mockDetail = {
  id: 'saga-001',
  tracker_id: 'proj-1',
  tracker_type: 'linear',
  slug: 'alpha',
  name: 'Alpha',
  description: 'First project',
  repos: ['org/repo'],
  feature_branch: 'feat/alpha',
  status: 'started',
  progress: 0.5,
  url: 'https://linear.app/proj-1',
  phases: [
    {
      id: 'ms-1',
      name: 'Phase 1',
      description: '',
      sort_order: 1,
      progress: 1.0,
      target_date: null,
      raids: [
        {
          id: 'i-1',
          identifier: 'A-1',
          title: 'Task',
          status: 'Done',
          status_type: 'completed',
          assignee: null,
          labels: [],
          priority: 1,
          priority_label: 'Urgent',
          estimate: 2,
          url: '',
        },
      ],
    },
  ],
};

describe('useSagaDetail', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDetail,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch detail on mount', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).not.toBeNull();
    expect(result.current.detail!.name).toBe('Alpha');
    expect(result.current.detail!.phases).toHaveLength(1);
  });

  it('should return null when id is undefined', async () => {
    const { result } = renderHook(() => useSagaDetail(undefined));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.detail).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useSagaDetail('saga-001'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
  });

  it('should refresh on call', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...mockDetail, name: 'Updated' }),
    } as Response);

    await result.current.refresh();
    await waitFor(() => expect(result.current.detail!.name).toBe('Updated'));
  });
});
