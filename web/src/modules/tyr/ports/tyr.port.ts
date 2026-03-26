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

export interface PlanSession {
  session_id: string;
  chat_endpoint: string | null;
}

export interface RaidSpec {
  name: string;
  description: string;
  acceptance_criteria: string[];
  declared_files: string[];
  estimate_hours: number;
  confidence: number;
}

export interface PhaseSpec {
  name: string;
  raids: RaidSpec[];
}

export interface ExtractedStructure {
  found: boolean;
  structure: {
    name: string;
    phases: PhaseSpec[];
  } | null;
}

export interface ITyrService {
  getSagas(): Promise<Saga[]>;
  getSaga(id: string): Promise<Saga | null>;
  getPhases(sagaId: string): Promise<Phase[]>;
  createSaga(spec: string, repo: string): Promise<Saga>;
  commitSaga(request: CommitSagaRequest): Promise<Saga>;
  decompose(spec: string, repo: string): Promise<Phase[]>;
  spawnPlanSession(spec: string, repo: string): Promise<PlanSession>;
  extractStructure(text: string): Promise<ExtractedStructure>;
}
