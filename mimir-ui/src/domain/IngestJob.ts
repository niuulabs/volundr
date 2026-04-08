export type IngestStatus = 'queued' | 'running' | 'complete' | 'failed';

export type IngestSourceType = 'document' | 'web' | 'conversation' | 'text';

export interface IngestJob {
  id: string;
  title: string;
  sourceType: IngestSourceType;
  status: IngestStatus;
  instanceName: string;
  /** Pages written during run */
  pagesUpdated: string[];
  /** Current activity message when running */
  currentActivity?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface IngestRequest {
  title: string;
  content: string;
  sourceType: IngestSourceType;
  originUrl?: string;
}

export interface IngestResponse {
  sourceId: string;
  pagesUpdated: string[];
}

/** Transition the job to the next state */
export function transitionJob(job: IngestJob, update: Partial<IngestJob>): IngestJob {
  return { ...job, ...update };
}

/** Returns true if the job is in a terminal state */
export function isTerminal(status: IngestStatus): boolean {
  return status === 'complete' || status === 'failed';
}
