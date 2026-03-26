import type { Saga, Phase } from '../models';

export interface CommitSagaRequest {
  name: string;
  slug: string;
  repos: string[];
  base_branch: string;
  phases: {
    name: string;
    raids: {
      name: string;
      description: string;
      acceptance_criteria: string[];
      declared_files: string[];
      estimate_hours: number;
    }[];
  }[];
}

export interface ITyrService {
  getSagas(): Promise<Saga[]>;
  getSaga(id: string): Promise<Saga | null>;
  getPhases(sagaId: string): Promise<Phase[]>;
  createSaga(spec: string, repo: string): Promise<Saga>;
  commitSaga(request: CommitSagaRequest): Promise<Saga>;
  decompose(spec: string, repo: string): Promise<Phase[]>;
}
