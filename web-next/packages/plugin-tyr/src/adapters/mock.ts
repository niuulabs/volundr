/**
 * Mock adapters for all Tyr ports.
 *
 * Seeded with representative data mirroring the Tyr backend's test fixtures.
 * Each factory returns an in-memory implementation suitable for tests and
 * local development without a running backend.
 */

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
// Seed data
// ---------------------------------------------------------------------------

const SEED_SAGAS: Saga[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-500',
    trackerType: 'linear',
    slug: 'auth-rewrite',
    name: 'Auth Rewrite',
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/auth-rewrite',
    status: 'active',
    confidence: 82,
    createdAt: '2026-01-10T09:00:00Z',
    phaseSummary: { total: 3, completed: 1 },
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    trackerId: 'NIU-520',
    trackerType: 'linear',
    slug: 'plugin-ravn',
    name: 'Plugin Ravn Scaffold',
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/plugin-ravn',
    status: 'complete',
    confidence: 95,
    createdAt: '2026-01-05T08:00:00Z',
    phaseSummary: { total: 2, completed: 2 },
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    trackerId: 'NIU-600',
    trackerType: 'linear',
    slug: 'observatory-topology',
    name: 'Observatory Topology Canvas',
    repos: ['niuulabs/volundr'],
    featureBranch: 'feat/topology-canvas',
    status: 'failed',
    confidence: 30,
    createdAt: '2026-01-15T10:00:00Z',
    phaseSummary: { total: 4, completed: 0 },
  },
];

const SEED_RAIDS: Raid[] = [
  {
    id: '00000000-0000-0000-0000-000000000010',
    phaseId: '00000000-0000-0000-0000-000000000100',
    trackerId: 'NIU-501',
    name: 'Implement OIDC flow',
    description: 'Add OIDC login via Keycloak.',
    acceptanceCriteria: ['Users can log in with SSO', 'Token refreshes silently'],
    declaredFiles: ['src/auth/oidc.ts', 'src/auth/refresh.ts'],
    estimateHours: 8,
    status: 'merged',
    confidence: 90,
    sessionId: 'sess-001',
    reviewerSessionId: null,
    reviewRound: 1,
    branch: 'feat/auth-rewrite',
    chronicleSummary: 'Implemented OIDC flow with silent refresh.',
    retryCount: 0,
    createdAt: '2026-01-10T09:00:00Z',
    updatedAt: '2026-01-12T14:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000011',
    phaseId: '00000000-0000-0000-0000-000000000101',
    trackerId: 'NIU-502',
    name: 'Add PAT generation',
    description: 'Personal access tokens for headless dispatch.',
    acceptanceCriteria: ['PATs can be created and revoked', 'Envoy validates PATs'],
    declaredFiles: ['src/niuu/pat.ts'],
    estimateHours: 4,
    status: 'running',
    confidence: 65,
    sessionId: 'sess-002',
    reviewerSessionId: null,
    reviewRound: 0,
    branch: 'feat/auth-rewrite',
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-13T09:00:00Z',
    updatedAt: '2026-01-13T11:00:00Z',
  },
  // Dispatch-queue seed data — raids in dispatchable states
  {
    id: '00000000-0000-0000-0000-000000000012',
    phaseId: '00000000-0000-0000-0000-000000000102',
    trackerId: 'NIU-503',
    name: 'Harden JWT validation',
    description: 'Add clock-skew tolerance and token audience checks.',
    acceptanceCriteria: ['JWT rejects tampered tokens', 'Clock skew ≤ 60s tolerated'],
    declaredFiles: ['src/auth/jwt.ts'],
    estimateHours: 3,
    status: 'pending',
    confidence: 80,
    sessionId: null,
    reviewerSessionId: null,
    reviewRound: 0,
    branch: null,
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-14T08:00:00Z',
    updatedAt: '2026-01-14T08:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000013',
    phaseId: '00000000-0000-0000-0000-000000000102',
    trackerId: 'NIU-504',
    name: 'Write auth integration tests',
    description: 'End-to-end tests for the full auth flow.',
    acceptanceCriteria: ['All auth happy paths covered', 'Token expiry tested'],
    declaredFiles: ['tests/auth/integration.test.ts'],
    estimateHours: 5,
    status: 'pending',
    confidence: 45,
    sessionId: null,
    reviewerSessionId: null,
    reviewRound: 0,
    branch: null,
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-14T09:00:00Z',
    updatedAt: '2026-01-14T09:00:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000014',
    phaseId: '00000000-0000-0000-0000-000000000102',
    trackerId: 'NIU-505',
    name: 'Add refresh token rotation',
    description: 'Rotate refresh tokens on every use.',
    acceptanceCriteria: ['Old refresh tokens invalidated on use', 'New token issued atomically'],
    declaredFiles: ['src/auth/refresh.ts'],
    estimateHours: 4,
    status: 'queued',
    confidence: 75,
    sessionId: null,
    reviewerSessionId: null,
    reviewRound: 0,
    branch: null,
    chronicleSummary: null,
    retryCount: 0,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:30:00Z',
  },
];

const SEED_PHASES: Phase[] = [
  {
    id: '00000000-0000-0000-0000-000000000100',
    sagaId: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-M1',
    number: 1,
    name: 'Phase 1: Foundation',
    status: 'complete',
    confidence: 90,
    raids: [SEED_RAIDS[0]!],
  },
  {
    id: '00000000-0000-0000-0000-000000000101',
    sagaId: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-M2',
    number: 2,
    name: 'Phase 2: PAT Support',
    status: 'complete',
    confidence: 65,
    raids: [SEED_RAIDS[1]!],
  },
  {
    id: '00000000-0000-0000-0000-000000000102',
    sagaId: '00000000-0000-0000-0000-000000000001',
    trackerId: 'NIU-M3',
    number: 3,
    name: 'Phase 3: Security',
    status: 'pending',
    confidence: 50,
    raids: [SEED_RAIDS[2]!, SEED_RAIDS[3]!, SEED_RAIDS[4]!],
  },
];

const SEED_DISPATCHER_STATE: DispatcherState = {
  id: '00000000-0000-0000-0000-000000000999',
  running: true,
  threshold: 70,
  maxConcurrentRaids: 3,
  autoContinue: false,
  updatedAt: '2026-01-13T11:00:00Z',
};

const SEED_SESSIONS: SessionInfo[] = [
  {
    sessionId: 'sess-001',
    status: 'complete',
    chronicleLines: [
      '[10:00] Starting OIDC implementation',
      '[10:45] Created oidc.ts with PKCE flow',
      '[11:30] All acceptance tests pass',
    ],
    branch: 'feat/auth-rewrite',
    confidence: 90,
    raidName: 'Implement OIDC flow',
    sagaName: 'Auth Rewrite',
  },
  {
    sessionId: 'sess-002',
    status: 'running',
    chronicleLines: ['[09:00] Starting PAT generation', '[09:30] JWT signing implemented'],
    branch: 'feat/auth-rewrite',
    confidence: 65,
    raidName: 'Add PAT generation',
    sagaName: 'Auth Rewrite',
  },
];

const SEED_PROJECTS: TrackerProject[] = [
  {
    id: 'proj-niuu-core',
    name: 'Niuu Core',
    description: 'Core platform features',
    status: 'active',
    url: 'https://linear.app/niuu/proj/niuu-core',
    milestoneCount: 8,
    issueCount: 64,
  },
  {
    id: 'proj-plugin-platform',
    name: 'Plugin Platform',
    description: 'Composable plugin infrastructure',
    status: 'active',
    url: 'https://linear.app/niuu/proj/plugin-platform',
    milestoneCount: 4,
    issueCount: 28,
  },
];

const SEED_MILESTONES: TrackerMilestone[] = [
  {
    id: 'ms-auth',
    projectId: 'proj-niuu-core',
    name: 'Auth & Identity',
    description: 'OIDC, PATs, and session management',
    sortOrder: 1,
    progress: 60,
  },
  {
    id: 'ms-observatory',
    projectId: 'proj-niuu-core',
    name: 'Observatory',
    description: 'Topology, registry, events',
    sortOrder: 2,
    progress: 80,
  },
];

const SEED_ISSUES: TrackerIssue[] = [
  {
    id: 'iss-679',
    identifier: 'NIU-679',
    title: '@niuulabs/plugin-tyr scaffold',
    description: 'Scaffold Tyr plugin with domain, ports, mock, HTTP adapters',
    status: 'in_progress',
    assignee: null,
    labels: ['plugin', 'scaffold'],
    priority: 1,
    url: 'https://linear.app/niuu/issue/NIU-679',
    milestoneId: 'ms-auth',
  },
  {
    id: 'iss-671',
    identifier: 'NIU-671',
    title: '@niuulabs/plugin-ravn scaffold',
    description: 'Scaffold Ravn plugin',
    status: 'done',
    assignee: null,
    labels: ['plugin', 'scaffold'],
    priority: 1,
    url: 'https://linear.app/niuu/issue/NIU-671',
    milestoneId: null,
  },
];

const SEED_INTEGRATIONS: IntegrationConnection[] = [
  {
    id: 'int-linear',
    integrationType: 'linear',
    adapter: 'LinearAdapter',
    credentialName: 'linear-api-key',
    enabled: true,
    status: 'connected',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'int-github',
    integrationType: 'github',
    adapter: 'GitHubAdapter',
    credentialName: 'github-token',
    enabled: true,
    status: 'connected',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/**
 * Create an in-memory ITyrService backed by seed data.
 */
export function createMockTyrService(): ITyrService {
  const sagas = new Map<string, Saga>(SEED_SAGAS.map((s) => [s.id, s]));
  const phasesBySaga = new Map<string, Phase[]>([
    ['00000000-0000-0000-0000-000000000001', [...SEED_PHASES]],
  ]);

  return {
    async getSagas() {
      return Array.from(sagas.values());
    },

    async getSaga(id: string) {
      return sagas.get(id) ?? null;
    },

    async getPhases(sagaId: string) {
      return phasesBySaga.get(sagaId) ?? [];
    },

    async createSaga(spec: string, _repo: string) {
      const saga: Saga = {
        id: `mock-${Date.now()}`,
        trackerId: '',
        trackerType: 'mock',
        slug: spec.slice(0, 20).toLowerCase().replace(/\s+/g, '-'),
        name: spec,
        repos: [_repo],
        featureBranch: `feat/${spec.slice(0, 20).toLowerCase().replace(/\s+/g, '-')}`,
        status: 'active',
        confidence: 50,
        createdAt: new Date().toISOString(),
        phaseSummary: { total: 0, completed: 0 },
      };
      sagas.set(saga.id, saga);
      return saga;
    },

    async commitSaga(request: CommitSagaRequest) {
      const saga: Saga = {
        id: `mock-${Date.now()}`,
        trackerId: '',
        trackerType: 'mock',
        slug: request.slug,
        name: request.name,
        repos: request.repos,
        featureBranch: `feat/${request.slug}`,
        status: 'active',
        confidence: 60,
        createdAt: new Date().toISOString(),
        phaseSummary: { total: request.phases.length, completed: 0 },
      };
      sagas.set(saga.id, saga);
      return saga;
    },

    async decompose(_spec: string, _repo: string) {
      return [];
    },

    async spawnPlanSession(_spec: string, _repo: string): Promise<PlanSession> {
      return { sessionId: `plan-${Date.now()}`, chatEndpoint: null };
    },

    async extractStructure(_text: string): Promise<ExtractedStructure> {
      return { found: false, structure: null };
    },
  };
}

/**
 * Create an in-memory IDispatcherService.
 */
export function createMockDispatcherService(): IDispatcherService {
  let state: DispatcherState = { ...SEED_DISPATCHER_STATE };
  const log: string[] = ['[mock] Dispatcher initialized'];

  return {
    async getState() {
      return { ...state };
    },

    async setRunning(running: boolean) {
      state = { ...state, running, updatedAt: new Date().toISOString() };
      log.push(`[mock] running = ${running}`);
    },

    async setThreshold(threshold: number) {
      state = { ...state, threshold, updatedAt: new Date().toISOString() };
    },

    async setAutoContinue(autoContinue: boolean) {
      state = { ...state, autoContinue, updatedAt: new Date().toISOString() };
    },

    async getLog() {
      return [...log];
    },
  };
}

/**
 * Create an in-memory ITyrSessionService.
 */
export function createMockTyrSessionService(): ITyrSessionService {
  const sessions = new Map<string, SessionInfo>(SEED_SESSIONS.map((s) => [s.sessionId, { ...s }]));

  return {
    async getSessions() {
      return Array.from(sessions.values());
    },

    async getSession(id: string) {
      return sessions.get(id) ?? null;
    },

    async approve(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status: 'approved' });
      }
    },
  };
}

/**
 * Create an in-memory ITrackerBrowserService.
 */
export function createMockTrackerService(): ITrackerBrowserService {
  const projectMap = new Map<string, TrackerProject>(SEED_PROJECTS.map((p) => [p.id, p]));
  const milestoneMap = new Map<string, TrackerMilestone>(SEED_MILESTONES.map((m) => [m.id, m]));

  return {
    async listProjects() {
      return Array.from(projectMap.values());
    },

    async getProject(projectId: string) {
      const project = projectMap.get(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return project;
    },

    async listMilestones(projectId: string) {
      return Array.from(milestoneMap.values()).filter((m) => m.projectId === projectId);
    },

    async listIssues(projectId: string, milestoneId?: string) {
      const byProject = SEED_ISSUES.filter((i) =>
        SEED_MILESTONES.some((m) => m.id === i.milestoneId && m.projectId === projectId),
      );
      if (!milestoneId) return byProject;
      return byProject.filter((i) => i.milestoneId === milestoneId);
    },

    async importProject(projectId: string, repos: string[], _baseBranch?: string) {
      const project = projectMap.get(projectId);
      const name = project?.name ?? projectId;
      const saga: Saga = {
        id: `mock-import-${Date.now()}`,
        trackerId: projectId,
        trackerType: 'mock',
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        repos,
        featureBranch: `feat/${name.toLowerCase().replace(/\s+/g, '-')}`,
        status: 'active',
        confidence: 50,
        createdAt: new Date().toISOString(),
        phaseSummary: { total: 0, completed: 0 },
      };
      return saga;
    },
  };
}

/**
 * Create an in-memory IDispatchBus (Sleipnir stub).
 *
 * Immediately resolves all dispatches — callers apply optimistic updates
 * in the UI layer. Use in tests and local development.
 */
export function createMockDispatchBus(): IDispatchBus {
  return {
    async dispatch(_raidId: string): Promise<void> {
      // No-op in mock; UI handles optimistic status update.
    },

    async dispatchBatch(raidIds: string[]): Promise<DispatchResult> {
      return { dispatched: raidIds, failed: [] };
    },
  };
}

/**
 * Create an in-memory ITyrIntegrationService.
 */
export function createMockTyrIntegrationService(): ITyrIntegrationService {
  const integrations = new Map<string, IntegrationConnection>(
    SEED_INTEGRATIONS.map((i) => [i.id, { ...i }]),
  );

  return {
    async listIntegrations() {
      return Array.from(integrations.values());
    },

    async createIntegration(params: CreateIntegrationParams) {
      const integration: IntegrationConnection = {
        id: `int-${Date.now()}`,
        integrationType: params.integrationType,
        adapter: params.adapter,
        credentialName: params.credentialName,
        enabled: true,
        status: 'connected',
        createdAt: new Date().toISOString(),
      };
      integrations.set(integration.id, integration);
      return integration;
    },

    async deleteIntegration(id: string) {
      integrations.delete(id);
    },

    async toggleIntegration(id: string, enabled: boolean) {
      const integration = integrations.get(id);
      if (!integration) throw new Error(`Integration not found: ${id}`);
      const updated = { ...integration, enabled };
      integrations.set(id, updated);
      return updated;
    },

    async testConnection(_id: string): Promise<ConnectionTestResult> {
      return { success: true, message: 'Connection successful (mock)' };
    },

    async getTelegramSetup(): Promise<TelegramSetupResult> {
      return { deeplink: 'https://t.me/niuu_bot?start=mock', token: 'mock-telegram-token' };
    },
  };
}
