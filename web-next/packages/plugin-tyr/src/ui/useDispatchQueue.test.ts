import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { createElement } from 'react';
import { useDispatchQueue } from './useDispatchQueue';
import { createMockTyrService } from '../adapters/mock';
import type { ITyrService } from '../ports';
import type { Saga, Phase, Raid } from '../domain/saga';

function makeSaga(id: string, status: Saga['status'] = 'active'): Saga {
  return {
    id,
    trackerId: 'NIU-001',
    trackerType: 'linear',
    slug: 'test',
    name: 'Test Saga',
    repos: [],
    featureBranch: 'feat/test',
    status,
    confidence: 80,
    createdAt: '2026-01-01T00:00:00Z',
    phaseSummary: { total: 1, completed: 0 },
  };
}

function makeRaid(id: string): Raid {
  return {
    id,
    phaseId: 'p1',
    trackerId: 'NIU-010',
    name: 'Raid ' + id,
    description: '',
    acceptanceCriteria: [],
    declaredFiles: [],
    estimateHours: 2,
    status: 'pending',
    confidence: 80,
    sessionId: null,
    reviewerSessionId: null,
    reviewRound: 0,
    branch: null,
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makePhase(sagaId: string, raids: Raid[]): Phase {
  return {
    id: 'p1',
    sagaId,
    trackerId: 'NIU-M1',
    number: 1,
    name: 'Phase 1',
    status: 'active',
    confidence: 80,
    raids,
  };
}

function wrap(tyr: ITyrService) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(ServicesProvider, { services: { tyr } }, children),
    );
  };
}

describe('useDispatchQueue', () => {
  it('returns raids from active sagas', async () => {
    const saga = makeSaga('saga-1');
    const raids = [makeRaid('raid-1'), makeRaid('raid-2')];
    const phase = makePhase('saga-1', raids);
    const tyr: ITyrService = {
      ...createMockTyrService(),
      getSagas: async () => [saga],
      getPhases: async (_id) => [phase],
    };

    const { result } = renderHook(() => useDispatchQueue(), { wrapper: wrap(tyr) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0]?.raid.id).toBe('raid-1');
    expect(result.current.data?.[0]?.saga.id).toBe('saga-1');
    expect(result.current.data?.[0]?.allPhases).toHaveLength(1);
  });

  it('skips non-active sagas', async () => {
    const activeSaga = makeSaga('saga-active', 'active');
    const completeSaga = makeSaga('saga-complete', 'complete');
    const raid = makeRaid('raid-1');
    const tyr: ITyrService = {
      ...createMockTyrService(),
      getSagas: async () => [activeSaga, completeSaga],
      getPhases: async (id) => (id === 'saga-active' ? [makePhase(id, [raid])] : []),
    };

    const { result } = renderHook(() => useDispatchQueue(), { wrapper: wrap(tyr) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
  });

  it('returns loading state initially', () => {
    const { result } = renderHook(() => useDispatchQueue(), {
      wrapper: wrap(createMockTyrService()),
    });
    expect(result.current.isLoading).toBe(true);
  });

  it('returns empty array when no active sagas', async () => {
    const tyr: ITyrService = {
      ...createMockTyrService(),
      getSagas: async () => [makeSaga('saga-1', 'complete')],
      getPhases: async () => [],
    };
    const { result } = renderHook(() => useDispatchQueue(), { wrapper: wrap(tyr) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });
});
