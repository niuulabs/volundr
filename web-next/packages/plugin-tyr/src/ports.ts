/**
 * Tyr plugin port interfaces.
 *
 * Migrated from web/src/modules/tyr/ports/ — shape preserved, imports updated.
 *
 * All types in this file are pure TypeScript interfaces or type aliases.
 * Implementations live in src/adapters/.
 */

import type { Saga, Phase } from './domain/saga';
import type { DispatcherState } from './domain/dispatcher';
import type { SessionInfo } from './domain/session';
import type { TrackerProject, TrackerMilestone, TrackerIssue } from './domain/tracker';

// Re-export domain types so consumers can import from a single location.
export type { Saga, Phase } from './domain/saga';
export type { DispatcherState, DispatchRule } from './domain/dispatcher';
export type { SessionInfo, TyrSessionStatus } from './domain/session';
export type { TrackerProject, TrackerMilestone, TrackerIssue, RepoInfo } from './domain/tracker';

// ---------------------------------------------------------------------------
// ITyrService — saga lifecycle and planning
// ---------------------------------------------------------------------------

export interface CommitSagaRequest {
  name: string;
  slug: string;
  description: string;
  repos: string[];
  baseBranch: string;
  phases: {
    name: string;
    raids: {
      name: string;
      description: string;
      acceptanceCriteria: string[];
      declaredFiles: string[];
      estimateHours: number;
    }[];
  }[];
  transcript?: string;
}

export interface PlanSession {
  sessionId: string;
  chatEndpoint: string | null;
}

export interface RaidSpec {
  name: string;
  description: string;
  acceptanceCriteria: string[];
  declaredFiles: string[];
  estimateHours: number;
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

/**
 * Core Tyr service — saga lifecycle, planning, and decomposition.
 *
 * Lifted verbatim from web/src/modules/tyr/ports/tyr.port.ts; camelCase
 * field names replace snake_case in the request types.
 */
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

// ---------------------------------------------------------------------------
// IDispatcherService — autonomous execution queue
// ---------------------------------------------------------------------------

/**
 * Dispatcher control service.
 *
 * Lifted from web/src/modules/tyr/ports/dispatcher.port.ts.
 */
export interface IDispatcherService {
  getState(): Promise<DispatcherState | null>;
  setRunning(running: boolean): Promise<void>;
  setThreshold(threshold: number): Promise<void>;
  setAutoContinue(autoContinue: boolean): Promise<void>;
  getLog(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// ITyrSessionService — raid session approval flow
// ---------------------------------------------------------------------------

/**
 * Session management service.
 *
 * Lifted from web/src/modules/tyr/ports/session.port.ts.
 */
export interface ITyrSessionService {
  getSessions(): Promise<SessionInfo[]>;
  getSession(id: string): Promise<SessionInfo | null>;
  approve(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// ITrackerBrowserService — external issue tracker browsing
// ---------------------------------------------------------------------------

/**
 * Tracker browser service.
 *
 * Lifted from web/src/modules/tyr/ports/tracker.port.ts.
 */
export interface ITrackerBrowserService {
  listProjects(): Promise<TrackerProject[]>;
  getProject(projectId: string): Promise<TrackerProject>;
  listMilestones(projectId: string): Promise<TrackerMilestone[]>;
  listIssues(projectId: string, milestoneId?: string): Promise<TrackerIssue[]>;
  importProject(projectId: string, repos: string[], baseBranch?: string): Promise<Saga>;
}

// ---------------------------------------------------------------------------
// ITyrIntegrationService — external integration connections
// ---------------------------------------------------------------------------

export interface IntegrationConnection {
  id: string;
  integrationType: string;
  adapter: string;
  credentialName: string;
  enabled: boolean;
  status: string;
  createdAt: string;
}

export interface TelegramSetupResult {
  deeplink: string;
  token: string;
}

export interface CreateIntegrationParams {
  integrationType: string;
  adapter: string;
  credentialName: string;
  credentialValue: string;
  config: Record<string, string>;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
}

/**
 * Integration connection management service.
 *
 * Lifted from web/src/modules/tyr/ports/integrations.port.ts.
 */
export interface ITyrIntegrationService {
  listIntegrations(): Promise<IntegrationConnection[]>;
  createIntegration(params: CreateIntegrationParams): Promise<IntegrationConnection>;
  deleteIntegration(id: string): Promise<void>;
  toggleIntegration(id: string, enabled: boolean): Promise<IntegrationConnection>;
  testConnection(id: string): Promise<ConnectionTestResult>;
  getTelegramSetup(): Promise<TelegramSetupResult>;
}
