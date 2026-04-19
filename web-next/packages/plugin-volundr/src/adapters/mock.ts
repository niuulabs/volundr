/**
 * Mock adapters for all Völundr ports.
 *
 * Used in tests, Storybook, and the dev app when mode = "mock".
 */
import type { IVolundrService } from '../ports/IVolundrService';
import type { IClusterAdapter } from '../ports/IClusterAdapter';
import type { ISessionStore } from '../ports/ISessionStore';
import type { ITemplateStore } from '../ports/ITemplateStore';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IMetricsStream } from '../ports/IMetricsStream';
import type { Cluster } from '../domain/cluster';
import type { Session } from '../domain/session';
import type { Template } from '../domain/template';
import type {
  VolundrSession,
  VolundrStats,
  VolundrFeatures,
  VolundrIdentity,
  AdminSettings,
  FeatureModule,
  UserFeaturePreference,
  VolundrProvisioningResult,
  CredentialCreateRequest,
  StoredCredential,
  IntegrationConnection,
  VolundrPreset,
  VolundrTenant,
  TrackerIssue,
  PullRequest,
  CreatePATResult,
} from '../domain/models';

/* ── Shared helpers ─────────────────────────────────────────────── */

const NOW = new Date().toISOString();

function mockSession(overrides?: Partial<VolundrSession>): VolundrSession {
  return {
    id: 'mock-session-1',
    name: 'Mock Session',
    source: { type: 'git', repo: 'niuulabs/niuu', branch: 'main' },
    status: 'stopped',
    model: 'claude-sonnet',
    lastActive: Date.now(),
    messageCount: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

function mockFeatureModule(key: string, enabled = true): FeatureModule {
  return {
    key,
    label: key,
    icon: '',
    scope: 'admin',
    enabled,
    defaultEnabled: enabled,
    adminOnly: false,
    order: 0,
  };
}

function mockTenant(id = 'mock-tenant'): VolundrTenant {
  return {
    id,
    path: id,
    name: 'Mock Tenant',
    tier: 'standard',
    maxSessions: 10,
    maxStorageGb: 50,
    createdAt: NOW,
  };
}

function mockTrackerIssue(id = 'mock-issue'): TrackerIssue {
  return {
    id,
    identifier: 'NIU-001',
    title: 'Mock Issue',
    status: 'in_progress',
    url: 'https://linear.app/niuu/issue/NIU-001',
  };
}

function mockPullRequest(): PullRequest {
  return {
    number: 1,
    title: 'Mock PR',
    url: 'https://github.com/niuulabs/niuu/pull/1',
    repoUrl: 'https://github.com/niuulabs/niuu',
    provider: 'github',
    sourceBranch: 'feat/mock',
    targetBranch: 'main',
    status: 'open',
  };
}

function mockAdminSettings(): AdminSettings {
  return { storage: { homeEnabled: true, fileManagerEnabled: true } };
}

function mockIdentity(): VolundrIdentity {
  return {
    userId: 'mock-user-id',
    email: 'mock@niuulabs.com',
    tenantId: 'mock-tenant',
    roles: ['user'],
    displayName: 'Mock User',
    status: 'active',
  };
}

function mockPreset(id = 'mock-preset'): VolundrPreset {
  return {
    id,
    name: 'Mock Preset',
    description: 'A mock preset',
    isDefault: false,
    createdAt: NOW,
    updatedAt: NOW,
    cliTool: 'claude',
    workloadType: 'standard',
    model: null,
    systemPrompt: null,
    resourceConfig: {},
    mcpServers: [],
    terminalSidecar: { enabled: false, allowedCommands: [] },
    skills: [],
    rules: [],
    envVars: {},
    envSecretRefs: [],
    source: null,
    integrationIds: [],
    setupScripts: [],
    workloadConfig: {},
  };
}

function mockStoredCredential(req: CredentialCreateRequest): StoredCredential {
  return {
    id: `cred-${req.name}`,
    name: req.name,
    secretType: req.secretType,
    keys: Object.keys(req.data),
    metadata: req.metadata ?? {},
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mockIntegration(
  connection: Omit<IntegrationConnection, 'id' | 'createdAt' | 'updatedAt'>
): IntegrationConnection {
  return { ...connection, id: 'mock-integration', createdAt: NOW, updatedAt: NOW };
}

/* ── IVolundrService ────────────────────────────────────────────── */

export function createMockVolundrService(): IVolundrService {
  const features: VolundrFeatures = {
    localMountsEnabled: true,
    fileManagerEnabled: true,
    miniMode: false,
  };
  const stats: VolundrStats = {
    activeSessions: 0,
    totalSessions: 0,
    tokensToday: 0,
    localTokens: 0,
    cloudTokens: 0,
    costToday: 0,
  };

  return {
    async getFeatures() { return features; },
    async getSessions() { return []; },
    async getSession(_id) { return null; },
    async getActiveSessions() { return []; },
    async getStats() { return stats; },
    async getModels() { return {}; },
    async getRepos() { return []; },
    subscribe(_cb) { return () => undefined; },
    subscribeStats(_cb) { return () => undefined; },
    async getTemplates() { return []; },
    async getTemplate(_name) { return null; },
    async saveTemplate(template) { return template; },
    async getPresets() { return [mockPreset()]; },
    async getPreset(_id) { return mockPreset(); },
    async savePreset(preset) {
      return mockPreset(preset.id ?? 'mock-preset');
    },
    async deletePreset(_id) { return; },
    async getAvailableMcpServers() { return []; },
    async getAvailableSecrets() { return []; },
    async createSecret(name, data) {
      return { name, keys: Object.keys(data) };
    },
    async getClusterResources() {
      return { resourceTypes: [], nodes: [] };
    },
    async startSession(config) {
      return mockSession({ name: config.name, source: config.source, model: config.model });
    },
    async connectSession(config) {
      return mockSession({ name: config.name, hostname: config.hostname });
    },
    async updateSession(_id, updates) {
      return mockSession({ ...updates });
    },
    async stopSession(_id) { return; },
    async resumeSession(_id) { return; },
    async deleteSession(_id, _cleanup) { return; },
    async archiveSession(_id) { return; },
    async restoreSession(_id) { return; },
    async listArchivedSessions() { return []; },
    async getMessages(_id) { return []; },
    async sendMessage(sessionId, content) {
      return {
        id: 'mock-msg-1',
        sessionId,
        role: 'assistant',
        content: `echo: ${content}`,
        timestamp: Date.now(),
      };
    },
    subscribeMessages(_id, _cb) { return () => undefined; },
    async getLogs(_id, _limit) { return []; },
    subscribeLogs(_id, _cb) { return () => undefined; },
    async getCodeServerUrl(_id) { return null; },
    async getChronicle(_id) { return null; },
    subscribeChronicle(_id, _cb) { return () => undefined; },
    async getPullRequests(_repoUrl, _status) { return []; },
    async createPullRequest(_id, _title, _branch) {
      return mockPullRequest();
    },
    async mergePullRequest(_prNumber, _repoUrl, _method) {
      return { merged: true };
    },
    async getCIStatus(_prNumber, _repoUrl, _branch) {
      return 'unknown';
    },
    async getSessionMcpServers(_id) { return []; },
    async searchTrackerIssues(_query, _projectId) { return []; },
    async getProjectRepoMappings() { return []; },
    async updateTrackerIssueStatus(issueId, _status) {
      return mockTrackerIssue(issueId);
    },
    async getIdentity() { return mockIdentity(); },
    async listUsers() { return []; },
    async getTenants() { return [mockTenant()]; },
    async getTenant(id) { return mockTenant(id); },
    async createTenant(data) {
      return { id: 'new-tenant', path: 'new-tenant', createdAt: NOW, ...data };
    },
    async deleteTenant(_id) { return; },
    async updateTenant(id, data) {
      return { ...mockTenant(id), ...data };
    },
    async getTenantMembers(_tenantId) { return []; },
    async reprovisionUser(userId): Promise<VolundrProvisioningResult> {
      return { success: true, userId, errors: [] };
    },
    async reprovisionTenant(_tenantId) { return []; },
    async getUserCredentials() { return []; },
    async storeUserCredential(_name, _data) { return; },
    async deleteUserCredential(_name) { return; },
    async getTenantCredentials() { return []; },
    async storeTenantCredential(_name, _data) { return; },
    async deleteTenantCredential(_name) { return; },
    async getIntegrationCatalog() { return []; },
    async getIntegrations() { return []; },
    async createIntegration(connection) { return mockIntegration(connection); },
    async deleteIntegration(_id) { return; },
    async testIntegration(_id) { return { success: true, message: 'ok' }; },
    async getCredentials(_type) { return []; },
    async getCredential(_name) { return null; },
    async createCredential(req) { return mockStoredCredential(req); },
    async deleteCredential(_name) { return; },
    async getCredentialTypes() { return []; },
    async listWorkspaces(_status) { return []; },
    async listAllWorkspaces(_status) { return []; },
    async restoreWorkspace(_id) { return; },
    async deleteWorkspace(_id) { return; },
    async bulkDeleteWorkspaces(sessionIds) {
      return { deleted: sessionIds.length, failed: [] };
    },
    async getAdminSettings() { return mockAdminSettings(); },
    async updateAdminSettings(data) {
      const base = mockAdminSettings();
      return { storage: { ...base.storage, ...data.storage } };
    },
    async getFeatureModules(_scope) {
      return [mockFeatureModule('volundr')];
    },
    async toggleFeature(key, enabled) { return mockFeatureModule(key, enabled); },
    async getUserFeaturePreferences(): Promise<UserFeaturePreference[]> { return []; },
    async updateUserFeaturePreferences(prefs) { return prefs; },
    async listTokens() { return []; },
    async createToken(name): Promise<CreatePATResult> {
      return { id: 'mock-pat', name, token: 'mock-token-value', createdAt: NOW };
    },
    async revokeToken(_id) { return; },
  };
}

/* ── IClusterAdapter ────────────────────────────────────────────── */

function mockCluster(id = 'mock-cluster'): Cluster {
  return {
    id,
    realm: 'mock-realm',
    name: 'Mock Cluster',
    capacity: { cpu: 100, memMi: 204800, gpu: 4 },
    used: { cpu: 10, memMi: 20480, gpu: 0 },
    nodes: [{ id: 'node-1', status: 'ready', role: 'worker' }],
    runningSessions: 0,
    queuedProvisions: 0,
  };
}

export function createMockClusterAdapter(): IClusterAdapter {
  return {
    async getCluster(clusterId) { return mockCluster(clusterId); },
    async listClusters() { return [mockCluster()]; },
    async scheduleSession(_session, _podSpec) { return 'mock-pod-name'; },
    async releaseSession(_session) { return; },
  };
}

/* ── ISessionStore ──────────────────────────────────────────────── */

export function createMockSessionStore(): ISessionStore {
  const store = new Map<string, Session>();

  return {
    async get(id) { return store.get(id) ?? null; },
    async list(filter) {
      const all = [...store.values()];
      if (!filter) return all;
      return all.filter((s) => {
        if (filter.state !== undefined && s.state !== filter.state) return false;
        if (filter.clusterId !== undefined && s.clusterId !== filter.clusterId) return false;
        return true;
      });
    },
    async save(session) {
      store.set(session.id, session);
      return session;
    },
    async delete(id) {
      store.delete(id);
    },
  };
}

/* ── ITemplateStore ─────────────────────────────────────────────── */

export function createMockTemplateStore(): ITemplateStore {
  const store = new Map<string, Template>();

  return {
    async get(id) { return store.get(id) ?? null; },
    async list() { return [...store.values()]; },
    async save(template) {
      store.set(template.id, template);
      return template;
    },
    async delete(id) {
      store.delete(id);
    },
  };
}

/* ── IPtyStream ─────────────────────────────────────────────────── */

export function createMockPtyStream(): IPtyStream {
  const subs = new Map<string, Set<(output: { data: string; timestamp: number }) => void>>();

  function getOrCreate(sessionId: string) {
    let set = subs.get(sessionId);
    if (!set) {
      set = new Set();
      subs.set(sessionId, set);
    }
    return set;
  }

  return {
    async connect(_sessionId) { return; },
    async write(sessionId, data) {
      const set = subs.get(sessionId);
      if (!set) return;
      const output = { data: `echo: ${data}`, timestamp: Date.now() };
      for (const cb of set) cb(output);
    },
    subscribe(sessionId, callback) {
      const set = getOrCreate(sessionId);
      set.add(callback);
      return () => { set.delete(callback); };
    },
    async disconnect(sessionId) {
      subs.delete(sessionId);
    },
  };
}

/* ── IMetricsStream ─────────────────────────────────────────────── */

export function createMockMetricsStream(): IMetricsStream {
  const intervals = new Map<string, ReturnType<typeof setInterval>>();

  return {
    subscribe(sessionId, callback) {
      const handle = setInterval(() => {
        callback({
          sessionId,
          timestamp: Date.now(),
          cpuMillicores: Math.floor(Math.random() * 500),
          memMi: Math.floor(Math.random() * 1024),
          gpuUtilisation: 0,
        });
      }, 5000);
      intervals.set(sessionId, handle);
      return () => {
        const h = intervals.get(sessionId);
        if (h !== undefined) {
          clearInterval(h);
          intervals.delete(sessionId);
        }
      };
    },
    unsubscribeAll() {
      for (const h of intervals.values()) clearInterval(h);
      intervals.clear();
    },
  };
}

/** Convenience: mock the whole service + all side-ports together. */
export function createMockVolundrServices() {
  return {
    volundr: createMockVolundrService(),
    clusterAdapter: createMockClusterAdapter(),
    sessionStore: createMockSessionStore(),
    templateStore: createMockTemplateStore(),
    ptyStream: createMockPtyStream(),
    metricsStream: createMockMetricsStream(),
  };
}
