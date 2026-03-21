import type { Saga, Phase } from '../models';

export interface ITyrService {
  getSagas(): Promise<Saga[]>;
  getSaga(id: string): Promise<Saga | null>;
  getPhases(sagaId: string): Promise<Phase[]>;
  createSaga(spec: string, repo: string): Promise<Saga>;
  decompose(spec: string, repo: string): Promise<Phase[]>;
}
