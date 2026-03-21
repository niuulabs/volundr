import { create } from 'zustand';
import type { Saga, DispatcherState } from '../models';

interface TyrState {
  sagas: Saga[];
  selectedSaga: Saga | null;
  dispatcher: DispatcherState | null;
  loading: boolean;
  error: string | null;
  setSagas: (sagas: Saga[]) => void;
  setSelectedSaga: (saga: Saga | null) => void;
  setDispatcher: (state: DispatcherState | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useTyrStore = create<TyrState>(set => ({
  sagas: [],
  selectedSaga: null,
  dispatcher: null,
  loading: false,
  error: null,
  setSagas: sagas => set({ sagas }),
  setSelectedSaga: saga => set({ selectedSaga: saga }),
  setDispatcher: state => set({ dispatcher: state }),
  setLoading: loading => set({ loading }),
  setError: error => set({ error }),
}));
