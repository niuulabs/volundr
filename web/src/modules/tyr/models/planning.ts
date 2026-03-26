export type PlanningSessionStatus =
  | 'SPAWNING'
  | 'ACTIVE'
  | 'STRUCTURE_PROPOSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED';

export interface PlanningRaidSpec {
  name: string;
  description: string;
  acceptance_criteria: string[];
  declared_files: string[];
  estimate_hours: number;
  confidence: number;
}

export interface PlanningPhaseSpec {
  name: string;
  raids: PlanningRaidSpec[];
}

export interface PlanningStructure {
  name: string;
  phases: PlanningPhaseSpec[];
}

export interface PlanningSession {
  id: string;
  owner_id: string;
  session_id: string;
  repo: string;
  status: PlanningSessionStatus;
  structure: PlanningStructure | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningMessage {
  id: string;
  content: string;
  sender: string;
  created_at: string;
}
