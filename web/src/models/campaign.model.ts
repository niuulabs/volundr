import type { CampaignStatus, PhaseStatus } from './status.model';

export interface CampaignPhaseTasks {
  total: number;
  complete: number;
  active: number;
  pending: number;
}

export interface CampaignPhase {
  id: string;
  name: string;
  repo: string;
  status: PhaseStatus;
  pr?: string | null;
  merged?: boolean;
  tasks?: CampaignPhaseTasks;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: CampaignStatus;
  progress: number;
  confidence: number | null;
  mergeThreshold: number;
  phases: CampaignPhase[];
  einherjar: string[];
  started: string | null;
  eta: string;
  repoAccess: string[];
}
