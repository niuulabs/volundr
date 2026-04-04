export type SagaStatus = 'active' | 'complete' | 'failed';
export type PhaseStatus = 'pending' | 'active' | 'gated' | 'complete';
export type RaidStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'review'
  | 'escalated'
  | 'merged'
  | 'failed';
export type ConfidenceEventType = 'ci_pass' | 'ci_fail' | 'scope_breach' | 'retry' | 'human_reject';

export interface Saga {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  repos: string[];
  feature_branch: string;
  status: SagaStatus;
  confidence: number;
  created_at: string;
  phase_summary: SagaPhaseSummary;
}

export interface Phase {
  id: string;
  saga_id: string;
  tracker_id: string;
  number: number;
  name: string;
  status: PhaseStatus;
  confidence: number;
  raids: Raid[];
}

export interface Raid {
  id: string;
  phase_id: string;
  tracker_id: string;
  name: string;
  description: string;
  acceptance_criteria: string[];
  declared_files: string[];
  estimate_hours: number | null;
  status: RaidStatus;
  confidence: number;
  session_id: string | null;
  reviewer_session_id: string | null;
  review_round: number;
  branch: string | null;
  chronicle_summary: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConfidenceEvent {
  id: string;
  raid_id: string;
  event_type: ConfidenceEventType;
  delta: number;
  score_after: number;
  created_at: string;
}

export interface DispatcherState {
  id: string;
  running: boolean;
  threshold: number;
  max_concurrent_raids: number;
  auto_continue: boolean;
  updated_at: string;
}

export interface SagaPhaseSummary {
  total: number;
  completed: number;
}

export interface SessionInfo {
  session_id: string;
  status: string;
  chronicle_lines: string[];
  branch: string | null;
  confidence: number;
  raid_name: string;
  saga_name: string;
}
