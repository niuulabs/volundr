import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSagaDetail } from './useSagaDetail';
import { tyrService } from '../adapters';
import type { Saga, Phase } from '../models';

vi.mock('../adapters', () => ({
  tyrService: {
    getSagas: vi.fn(),
    getSaga: vi.fn(),
    getPhases: vi.fn(),
    createSaga: vi.fn(),
    decompose: vi.fn(),
  },
}));

const mockSaga: Saga = {
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
};

const mockPhases: Phase[] = [
  {
    id: 'phase-001',
    saga_id: 'saga-001',
    tracker_id: 'NIU-100',
    number: 1,
    name: 'Core Infrastructure',
    status: 'active',
    confidence: 0.84,
    raids: [],
  },
];

describe('useSagaDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tyrService.getSaga).mockResolvedValue(mockSaga);
    vi.mocked(tyrService.getPhases).mockResolvedValue(mockPhases);
  });

  it('should fetch saga and phases on mount', async () => {
    const { result } = renderHook(() => useSagaDetail('saga-001'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toEqual(mockSaga);
    expect(result.current.phases).toEqual(mockPhases);
    expect(result.current.error).toBeNull();
  });

  it('should return null saga when id is undefined', async () => {
    const { result } = renderHook(() => useSagaDetail(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.saga).toBeNull();
    expect(result.current.phases).toEqual([]);
  });

  it('should handle fetch error', async () => {
    vi.mocked(tyrService.getSaga).mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useSagaDetail('saga-001'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Not found');
  });
});
