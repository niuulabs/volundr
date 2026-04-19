/**
 * HTTP adapters for all Tyr ports.
 *
 * Adapted from web/src/modules/tyr/adapters/api/
 * Translates snake_case server responses to camelCase domain types.
 *
 * All factory functions accept an ApiClient structurally compatible with
 * @niuulabs/query (get / post / put / patch / delete methods).
 */

import type { ApiClient } from '@niuulabs/query';
import type {
  ITyrService,
  IDispatcherService,
  ITyrSessionService,
  ITrackerBrowserService,
  ITyrIntegrationService,
  IDispatchBus,
  DispatchResult,
  CommitSagaRequest,
  PlanSession,
  ExtractedStructure,
  PhaseSpec,
  IntegrationConnection,
  CreateIntegrationParams,
  ConnectionTestResult,
  TelegramSetupResult,
} from '../ports';
import type { Saga, Phase, Raid } from '../domain/saga';
import type { DispatcherState } from '../domain/dispatcher';
import type { SessionInfo } from '../domain/session';
import type { TrackerProject, TrackerMilestone, TrackerIssue } from '../domain/tracker';

// ---------------------------------------------------------------------------
// Raw server types (snake_case)
// ---------------------------------------------------------------------------

interface RawSaga {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  repos: string[];
  feature_branch: string;
  status: string;
  confidence: number;
  created_at: string;
  phase_summary: {
    total: number;
    completed: number;
  };
}

interface RawRaid {
  id: string;
  phase_id: string;
  tracker_id: string;
  name: string;
  description: string;
  acceptance_criteria: string[];
  declared_files: string[];
  estimate_hours: number | null;
  status: string;
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

interface RawPhase {
  id: string;
  saga_id: string;
  tracker_id: string;
  number: number;
  name: string;
  status: string;
  confidence: number;
  raids: RawRaid[];
}

interface RawDispatcherState {
  id: string;
  running: boolean;
  threshold: number;
  max_concurrent_raids: number;
  auto_continue: boolean;
  updated_at: string;
}

interface RawSessionInfo {
  session_id: string;
  status: string;
  chronicle_lines: string[];
  branch: string | null;
  confidence: number;
  raid_name: string;
  saga_name: string;
}

interface RawTrackerProject {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  milestone_count: number;
  issue_count: number;
}

interface RawTrackerMilestone {
  id: string;
  project_id: string;
  name: string;
  description: string;
  sort_order: number;
  progress: number;
}

interface RawTrackerIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: string;
  assignee: string | null;
  labels: string[];
  priority: number;
  url: string;
  milestone_id: string | null;
}

interface RawIntegrationConnection {
  id: string;
  integration_type: string;
  adapter: string;
  credential_name: string;
  enabled: boolean;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Transform functions
// ---------------------------------------------------------------------------

function toRaid(raw: RawRaid): Raid {
  return {
    id: raw.id,
    phaseId: raw.phase_id,
    trackerId: raw.tracker_id,
    name: raw.name,
    description: raw.description,
    acceptanceCriteria: raw.acceptance_criteria,
    declaredFiles: raw.declared_files,
    estimateHours: raw.estimate_hours,
    status: raw.status as Raid['status'],
    confidence: raw.confidence,
    sessionId: raw.session_id,
    reviewerSessionId: raw.reviewer_session_id,
    reviewRound: raw.review_round,
    branch: raw.branch,
    chronicleSummary: raw.chronicle_summary,
    retryCount: raw.retry_count,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toPhase(raw: RawPhase): Phase {
  return {
    id: raw.id,
    sagaId: raw.saga_id,
    trackerId: raw.tracker_id,
    number: raw.number,
    name: raw.name,
    status: raw.status as Phase['status'],
    confidence: raw.confidence,
    raids: raw.raids.map(toRaid),
  };
}

function toSaga(raw: RawSaga): Saga {
  return {
    id: raw.id,
    trackerId: raw.tracker_id,
    trackerType: raw.tracker_type,
    slug: raw.slug,
    name: raw.name,
    repos: raw.repos,
    featureBranch: raw.feature_branch,
    status: raw.status as Saga['status'],
    confidence: raw.confidence,
    createdAt: raw.created_at,
    phaseSummary: {
      total: raw.phase_summary.total,
      completed: raw.phase_summary.completed,
    },
  };
}

function toDispatcherState(raw: RawDispatcherState): DispatcherState {
  return {
    id: raw.id,
    running: raw.running,
    threshold: raw.threshold,
    maxConcurrentRaids: raw.max_concurrent_raids,
    autoContinue: raw.auto_continue,
    updatedAt: raw.updated_at,
  };
}

function toSessionInfo(raw: RawSessionInfo): SessionInfo {
  return {
    sessionId: raw.session_id,
    status: raw.status as SessionInfo['status'],
    chronicleLines: raw.chronicle_lines,
    branch: raw.branch,
    confidence: raw.confidence,
    raidName: raw.raid_name,
    sagaName: raw.saga_name,
  };
}

function toTrackerProject(raw: RawTrackerProject): TrackerProject {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    url: raw.url,
    milestoneCount: raw.milestone_count,
    issueCount: raw.issue_count,
  };
}

function toTrackerMilestone(raw: RawTrackerMilestone): TrackerMilestone {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    description: raw.description,
    sortOrder: raw.sort_order,
    progress: raw.progress,
  };
}

function toTrackerIssue(raw: RawTrackerIssue): TrackerIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    assignee: raw.assignee,
    labels: raw.labels,
    priority: raw.priority,
    url: raw.url,
    milestoneId: raw.milestone_id,
  };
}

function toIntegrationConnection(raw: RawIntegrationConnection): IntegrationConnection {
  return {
    id: raw.id,
    integrationType: raw.integration_type,
    adapter: raw.adapter,
    credentialName: raw.credential_name,
    enabled: raw.enabled,
    status: raw.status,
    createdAt: raw.created_at,
  };
}

function toCommitRequestBody(req: CommitSagaRequest): Record<string, unknown> {
  return {
    name: req.name,
    slug: req.slug,
    description: req.description,
    repos: req.repos,
    base_branch: req.baseBranch,
    phases: req.phases.map((p) => ({
      name: p.name,
      raids: p.raids.map((r) => ({
        name: r.name,
        description: r.description,
        acceptance_criteria: r.acceptanceCriteria,
        declared_files: r.declaredFiles,
        estimate_hours: r.estimateHours,
      })),
    })),
    transcript: req.transcript,
  };
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/**
 * Build an ITyrService backed by the Tyr REST API.
 *
 * @param client - HTTP client scoped to the Tyr sagas base path.
 */
export function buildTyrHttpAdapter(client: ApiClient): ITyrService {
  return {
    async getSagas() {
      const raw = await client.get<RawSaga[]>('/sagas');
      return raw.map(toSaga);
    },

    async getSaga(id: string) {
      try {
        const raw = await client.get<RawSaga>(`/sagas/${encodeURIComponent(id)}`);
        return toSaga(raw);
      } catch {
        return null;
      }
    },

    async getPhases(sagaId: string) {
      const raw = await client.get<RawPhase[]>(`/sagas/${encodeURIComponent(sagaId)}/phases`);
      return raw.map(toPhase);
    },

    async createSaga(spec: string, repo: string) {
      const raw = await client.post<RawSaga>('/sagas', { spec, repo });
      return toSaga(raw);
    },

    async commitSaga(request: CommitSagaRequest) {
      const raw = await client.post<RawSaga>('/sagas/commit', toCommitRequestBody(request));
      return toSaga(raw);
    },

    async decompose(spec: string, repo: string) {
      const raw = await client.post<RawPhase[]>('/sagas/decompose', { spec, repo });
      return raw.map(toPhase);
    },

    async spawnPlanSession(spec: string, repo: string) {
      const raw = await client.post<{ session_id: string; chat_endpoint: string | null }>(
        '/sagas/plan',
        { spec, repo },
      );
      return { sessionId: raw.session_id, chatEndpoint: raw.chat_endpoint } satisfies PlanSession;
    },

    async extractStructure(text: string) {
      const raw = await client.post<{
        found: boolean;
        structure: { name: string; phases: PhaseSpec[] } | null;
      }>('/sagas/extract-structure', { text });
      return raw satisfies ExtractedStructure;
    },
  };
}

/**
 * Build an IDispatcherService backed by the Tyr dispatcher API.
 *
 * @param client - HTTP client scoped to the dispatcher base path.
 */
export function buildDispatcherHttpAdapter(client: ApiClient): IDispatcherService {
  return {
    async getState() {
      try {
        const raw = await client.get<RawDispatcherState>('/dispatcher');
        return toDispatcherState(raw);
      } catch {
        return null;
      }
    },

    async setRunning(running: boolean) {
      await client.patch<void>('/dispatcher', { running });
    },

    async setThreshold(threshold: number) {
      await client.patch<void>('/dispatcher', { threshold });
    },

    async setAutoContinue(autoContinue: boolean) {
      await client.patch<void>('/dispatcher', { auto_continue: autoContinue });
    },

    async getLog() {
      return client.get<string[]>('/dispatcher/log');
    },
  };
}

/**
 * Build an ITyrSessionService backed by the Tyr sessions API.
 *
 * @param client - HTTP client scoped to the sessions base path.
 */
export function buildTyrSessionHttpAdapter(client: ApiClient): ITyrSessionService {
  return {
    async getSessions() {
      const raw = await client.get<RawSessionInfo[]>('/sessions');
      return raw.map(toSessionInfo);
    },

    async getSession(id: string) {
      try {
        const raw = await client.get<RawSessionInfo>(`/sessions/${encodeURIComponent(id)}`);
        return toSessionInfo(raw);
      } catch {
        return null;
      }
    },

    async approve(sessionId: string) {
      await client.post<void>(`/sessions/${encodeURIComponent(sessionId)}/approve`, {});
    },
  };
}

/**
 * Build an ITrackerBrowserService backed by the Tyr tracker API.
 *
 * @param client - HTTP client scoped to the tracker base path.
 */
export function buildTrackerHttpAdapter(client: ApiClient): ITrackerBrowserService {
  return {
    async listProjects() {
      const raw = await client.get<RawTrackerProject[]>('/tracker/projects');
      return raw.map(toTrackerProject);
    },

    async getProject(projectId: string) {
      const raw = await client.get<RawTrackerProject>(
        `/tracker/projects/${encodeURIComponent(projectId)}`,
      );
      return toTrackerProject(raw);
    },

    async listMilestones(projectId: string) {
      const raw = await client.get<RawTrackerMilestone[]>(
        `/tracker/projects/${encodeURIComponent(projectId)}/milestones`,
      );
      return raw.map(toTrackerMilestone);
    },

    async listIssues(projectId: string, milestoneId?: string) {
      const query = milestoneId ? `?milestone_id=${encodeURIComponent(milestoneId)}` : '';
      const raw = await client.get<RawTrackerIssue[]>(
        `/tracker/projects/${encodeURIComponent(projectId)}/issues${query}`,
      );
      return raw.map(toTrackerIssue);
    },

    async importProject(projectId: string, repos: string[], baseBranch?: string) {
      const raw = await client.post<RawSaga>('/tracker/import', {
        project_id: projectId,
        repos,
        base_branch: baseBranch,
      });
      return toSaga(raw);
    },
  };
}

/**
 * Build an ITyrIntegrationService backed by the Tyr integrations API.
 *
 * @param client - HTTP client scoped to the integrations base path.
 */
export function buildTyrIntegrationHttpAdapter(client: ApiClient): ITyrIntegrationService {
  return {
    async listIntegrations() {
      const raw = await client.get<RawIntegrationConnection[]>('/integrations');
      return raw.map(toIntegrationConnection);
    },

    async createIntegration(params: CreateIntegrationParams) {
      const raw = await client.post<RawIntegrationConnection>('/integrations', {
        integration_type: params.integrationType,
        adapter: params.adapter,
        credential_name: params.credentialName,
        credential_value: params.credentialValue,
        config: params.config,
      });
      return toIntegrationConnection(raw);
    },

    async deleteIntegration(id: string) {
      await client.delete<void>(`/integrations/${encodeURIComponent(id)}`);
    },

    async toggleIntegration(id: string, enabled: boolean) {
      const raw = await client.patch<RawIntegrationConnection>(
        `/integrations/${encodeURIComponent(id)}`,
        { enabled },
      );
      return toIntegrationConnection(raw);
    },

    async testConnection(id: string) {
      return client.post<ConnectionTestResult>(`/integrations/${encodeURIComponent(id)}/test`, {});
    },

    async getTelegramSetup() {
      return client.get<TelegramSetupResult>('/integrations/telegram/setup');
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch bus (Sleipnir) HTTP adapter
// ---------------------------------------------------------------------------

export function buildDispatchBusHttpAdapter(client: ApiClient): IDispatchBus {
  return {
    async dispatch(raidId: string): Promise<void> {
      await client.post<void>(`/dispatch/${encodeURIComponent(raidId)}`, {});
    },

    async dispatchBatch(raidIds: string[]): Promise<DispatchResult> {
      return client.post<DispatchResult>('/dispatch/batch', { raid_ids: raidIds });
    },
  };
}
