import { describe, it, expect, beforeEach } from 'vitest';
import { useTyrStore } from './tyr.store';
import type { Saga, DispatcherState } from '../models';

const mockSaga: Saga = {
  id: 'test-saga-001',
  tracker_id: 'NIU-100',
  tracker_type: 'linear',
  slug: 'test-saga',
  name: 'Test Saga',
  repos: ['github.com/test/repo'],
  feature_branch: 'feat/test',
  status: 'active',
  confidence: 0.8,
  created_at: '2026-03-21T00:00:00Z',
};

const mockDispatcher: DispatcherState = {
  id: 'dispatcher-001',
  running: true,
  threshold: 0.6,
  max_concurrent_raids: 3,
  updated_at: '2026-03-21T00:00:00Z',
};

describe('useTyrStore', () => {
  beforeEach(() => {
    useTyrStore.setState({
      sagas: [],
      selectedSaga: null,
      dispatcher: null,
      loading: false,
      error: null,
    });
  });

  it('has correct initial state', () => {
    const state = useTyrStore.getState();

    expect(state.sagas).toEqual([]);
    expect(state.selectedSaga).toBeNull();
    expect(state.dispatcher).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('sets sagas', () => {
    useTyrStore.getState().setSagas([mockSaga]);

    expect(useTyrStore.getState().sagas).toEqual([mockSaga]);
  });

  it('sets selected saga', () => {
    useTyrStore.getState().setSelectedSaga(mockSaga);

    expect(useTyrStore.getState().selectedSaga).toEqual(mockSaga);
  });

  it('clears selected saga', () => {
    useTyrStore.getState().setSelectedSaga(mockSaga);
    useTyrStore.getState().setSelectedSaga(null);

    expect(useTyrStore.getState().selectedSaga).toBeNull();
  });

  it('sets dispatcher state', () => {
    useTyrStore.getState().setDispatcher(mockDispatcher);

    expect(useTyrStore.getState().dispatcher).toEqual(mockDispatcher);
  });

  it('sets loading', () => {
    useTyrStore.getState().setLoading(true);

    expect(useTyrStore.getState().loading).toBe(true);
  });

  it('sets error', () => {
    useTyrStore.getState().setError('Something went wrong');

    expect(useTyrStore.getState().error).toBe('Something went wrong');
  });

  it('clears error', () => {
    useTyrStore.getState().setError('Something went wrong');
    useTyrStore.getState().setError(null);

    expect(useTyrStore.getState().error).toBeNull();
  });
});
