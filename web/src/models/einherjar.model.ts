import type { WorkerStatus } from './status.model';

export interface Einherjar {
  id: string;
  name: string;
  status: WorkerStatus;
  realm: string;
  campaign: string | null;
  phase: string | null;
  task: string;
  progress: number | null;
  contextUsed: number;
  contextMax: number;
  cyclesSinceCheckpoint: number;
}

export interface EinherjarStats {
  total: number;
  working: number;
  idle: number;
}
