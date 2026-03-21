import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSagas } from './useSagas';
import { tyrService } from '../adapters';
import type { Saga } from '../models';

vi.mock('../adapters', () => ({
  tyrService: {
    getSagas: vi.fn(),
    getSaga: vi.fn(),
    getPhases: vi.fn(),
    createSaga: vi.fn(),
    decompose: vi.fn(),
  },
}));

const mockSagas: Saga[] = [
  {
    id: 'saga-001',
    tracker_id: 'NIU-100',
    tracker_type: 'linear',
    slug: 'storage-health',
    name: 'Storage Health Observer',
    repo: 'github.com/niuulabs/volundr',
    feature_branch: 'feat/storage-health',
    status: 'active',
    confidence: 0.72,
    created_at: '2026-03-18T08:30:00Z',
  },
];

describe('useSagas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tyrService.getSagas).mockResolvedValue(mockSagas);
  });

  it('should fetch sagas on mount', async () => {
    const { result } = renderHook(() => useSagas());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sagas).toEqual(mockSagas);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(tyrService.getSagas).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(tyrService.getSagas).mockRejectedValue('string error');

    const { result } = renderHook(() => useSagas());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('string error');
  });
});
