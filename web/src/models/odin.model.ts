import type { OdinStatus, ConsciousnessPhase, CircadianMode, ActionZone } from './status.model';

export interface AttentionState {
  primary: string;
  secondary: string[];
}

export interface DispositionState {
  alertness: number;
  concern: number;
  creativity: number;
}

export interface ResourceState {
  idleGPUs: number;
  totalGPUs: number;
  availableCapacity: number;
}

export interface OdinStats {
  realmsHealthy: number;
  realmsTotal: number;
  activeCampaigns: number;
  einherjarWorking: number;
  einherjarTotal: number;
  observationsToday: number;
  decisionsToday: number;
  actionsToday: number;
}

export interface PendingDecision {
  id: string;
  type: 'merge' | 'config' | 'deploy' | 'other';
  description: string;
  confidence?: number;
  threshold?: number;
  zone: ActionZone;
}

export interface OdinState {
  status: OdinStatus;
  loopCycle: number;
  loopPhase: ConsciousnessPhase;
  loopProgress: number;
  currentThought: string;
  attention: AttentionState;
  disposition: DispositionState;
  circadianMode: CircadianMode;
  resources: ResourceState;
  stats: OdinStats;
  pendingDecisions: PendingDecision[];
}
