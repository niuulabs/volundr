/**
 * Mock adapters for Völundr ports — used in tests and dev mode.
 */
import type { IVolundrService } from '../ports/IVolundrService';
import type { IClusterAdapter } from '../ports/IClusterAdapter';
import type { ISessionStore } from '../ports/ISessionStore';
import type { ITemplateStore } from '../ports/ITemplateStore';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IMetricsStream } from '../ports/IMetricsStream';
import type {
  VolundrSession,
  VolundrStats,
  VolundrMessage,
  StoredCredential,
  FeatureModule,
} from '../models/volundr.model';
import type { Cluster } from '../domain/cluster';
import type { Session } from '../domain/session';
import type { Template } from '../domain/template';

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const SEED_SESSIONS: VolundrSession[] = [
  {
    id: 'sess-1',
    name: 'feat/refactor-auth',
    source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'feat/refactor-auth' },
    status: 'running',
    model: 'claude-sonnet',
    lastActive: Date.now() - 60_000,
    messageCount: 14,
    tokensUsed: 8_400,
    taskType: 'skuld-claude',
    activityState: 'active',
  },
  {
    id: 'sess-2',
    name: 'fix/login-redirect',
    source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'fix/login-redirect' },
    status: 'stopped',
    model: 'claude-haiku',
    lastActive: Date.now() - 3_600_000,
    messageCount: 6,
    tokensUsed: 1_200,
    taskType: 'skuld-claude',
    activityState: null,
  },
];

const SEED_STATS: VolundrStats = {
  activeSessions: 1,
  totalSessions: 2,
  tokensToday: 9_600,
  localTokens: 0,
  cloudTokens: 9_600,
  costToday: 0.14,
};

const SEED_CLUSTERS: Cluster[] = [
  {
    id: 'cl-eitri',
    realm: 'asgard',
    name: 'Eitri',
    capacity: { cpu: 64, memMi: 131_072, gpu: 4 },
    used: { cpu: 12, memMi: 24_576, gpu: 1 },
    nodes: [
      { id: 'n-1', status: 'ready', role: 'worker' },
      { id: 'n-2', status: 'ready', role: 'worker' },
    ],
    runningSessions: 1,
    queuedProvisions: 0,
  },
];

const SEED_DOMAIN_SESSIONS: Session[] = [
  {
    id: 'ds-1',
    ravnId: 'r1',
    personaName: 'skald',
    templateId: 'tpl-default',
    clusterId: 'cl-eitri',
    state: 'running',
    startedAt: new Date(Date.now() - 3_600_000).toISOString(),
    readyAt: new Date(Date.now() - 3_590_000).toISOString(),
    resources: {
      cpuRequest: 1,
      cpuLimit: 2,
      cpuUsed: 0.4,
      memRequestMi: 512,
      memLimitMi: 1_024,
      memUsedMi: 320,
      gpuCount: 0,
    },
    env: {},
    events: [{ ts: new Date().toISOString(), kind: 'ready', body: 'pod ready' }],
  },
];

const SEED_TEMPLATES: Template[] = [
  {
    id: 'tpl-default',
    name: 'default',
    version: 1,
    spec: {
      image: 'ghcr.io/niuulabs/skuld',
      tag: 'latest',
      mounts: [],
      env: {},
      envSecretRefs: [],
      tools: [],
      resources: {
        cpuRequest: '1',
        cpuLimit: '2',
        memRequestMi: 512,
        memLimitMi: 1_024,
        gpuCount: 0,
      },
      ttlSec: 3_600,
      idleTimeoutSec: 600,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// IVolundrService mock
// ---------------------------------------------------------------------------

export function createMockVolundrService(): IVolundrService {
  const sessions = [...SEED_SESSIONS];

  return {
    getFeatures: async () => ({
      localMountsEnabled: false,
      fileManagerEnabled: true,
      miniMode: false,
    }),

    getSessions: async () => sessions,

    getSession: async (id) => sessions.find((s) => s.id === id) ?? null,

    getActiveSessions: async () =>
      sessions.filter((s) => ['starting', 'provisioning', 'running'].includes(s.status)),

    getStats: async () => ({ ...SEED_STATS }),

    getModels: async () => ({}),

    getRepos: async () => [],

    subscribe: (callback) => {
      callback(sessions);
      return () => {};
    },

    subscribeStats: (_callback) => () => {},

    getTemplates: async () => [],
    getTemplate: async () => null,
    saveTemplate: async (t) => t,

    getPresets: async () => [],
    getPreset: async () => null,
    savePreset: async (p) => ({
      ...p,
      id: p.id ?? 'preset-new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    deletePreset: async () => {},

    getAvailableMcpServers: async () => [],
    getAvailableSecrets: async () => [],
    createSecret: async (name) => ({ name, keys: [] }),
    getClusterResources: async () => ({ resourceTypes: [], nodes: [] }),

    startSession: async (config) => ({
      id: 'sess-new',
      name: config.name,
      source: config.source,
      status: 'starting',
      model: config.model,
      lastActive: Date.now(),
      messageCount: 0,
      tokensUsed: 0,
    }),

    connectSession: async (config) => ({
      id: 'sess-ext',
      name: config.name,
      source: { type: 'git', repo: config.hostname, branch: 'main' },
      status: 'running',
      model: 'unknown',
      lastActive: Date.now(),
      messageCount: 0,
      tokensUsed: 0,
      origin: 'manual',
      hostname: config.hostname,
    }),

    updateSession: async (_id, updates) => ({ ...sessions[0]!, ...updates }),

    stopSession: async () => {},
    resumeSession: async () => {},
    deleteSession: async () => {},
    archiveSession: async () => {},
    restoreSession: async () => {},
    listArchivedSessions: async () => [],

    getMessages: async () => [],
    sendMessage: async (_sessionId, content): Promise<VolundrMessage> => ({
      id: `msg-${Date.now()}`,
      sessionId: _sessionId,
      role: 'assistant',
      content: `echo: ${content}`,
      timestamp: Date.now(),
    }),
    subscribeMessages: () => () => {},

    getLogs: async () => [],
    subscribeLogs: () => () => {},

    getCodeServerUrl: async () => null,

    getChronicle: async () => null,
    subscribeChronicle: () => () => {},

    getPullRequests: async () => [],
    createPullRequest: async (_sessionId, title = 'Draft PR') => ({
      number: 1,
      title,
      url: 'https://github.com/niuulabs/volundr/pull/1',
      repoUrl: 'github.com/niuulabs/volundr',
      provider: 'github',
      sourceBranch: 'feat/new',
      targetBranch: 'main',
      status: 'open',
    }),
    mergePullRequest: async () => ({ merged: true }),
    getCIStatus: async () => 'unknown',

    getSessionMcpServers: async () => [],

    searchTrackerIssues: async () => [],
    getProjectRepoMappings: async () => [],
    updateTrackerIssueStatus: async (issueId, status) => ({
      id: issueId,
      identifier: 'NIU-?',
      title: 'mock issue',
      status,
      url: '',
    }),

    getIdentity: async () => ({
      userId: 'u1',
      email: 'dev@niuu.world',
      tenantId: 't1',
      roles: ['user'],
      displayName: 'Dev',
      status: 'active',
    }),

    listUsers: async () => [],

    getTenants: async () => [],
    getTenant: async () => null,
    createTenant: async (data) => ({
      id: `tenant-${Date.now()}`,
      path: `/${data.name}`,
      name: data.name,
      tier: data.tier,
      maxSessions: data.maxSessions,
      maxStorageGb: data.maxStorageGb,
    }),
    deleteTenant: async () => {},
    updateTenant: async (id, data) => ({
      id,
      path: `/${id}`,
      name: id,
      tier: data.tier ?? 'free',
      maxSessions: data.maxSessions ?? 5,
      maxStorageGb: data.maxStorageGb ?? 10,
    }),
    getTenantMembers: async () => [],
    reprovisionUser: async (userId) => ({ success: true, userId, errors: [] }),
    reprovisionTenant: async () => [],

    getUserCredentials: async () => [],
    storeUserCredential: async () => {},
    deleteUserCredential: async () => {},
    getTenantCredentials: async () => [],
    storeTenantCredential: async () => {},
    deleteTenantCredential: async () => {},

    getIntegrationCatalog: async () => [],
    getIntegrations: async () => [],
    createIntegration: async () => ({
      id: `int-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    deleteIntegration: async () => {},
    testIntegration: async () => ({ success: true }),

    getCredentials: async (): Promise<StoredCredential[]> => [],
    getCredential: async () => null,
    createCredential: async (req) => ({
      id: `cred-${Date.now()}`,
      name: req.name,
      secretType: req.secretType,
      keys: Object.keys(req.data),
      metadata: req.metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    deleteCredential: async () => {},
    getCredentialTypes: async () => [],

    listWorkspaces: async () => [],
    listAllWorkspaces: async () => [],
    restoreWorkspace: async () => {},
    deleteWorkspace: async () => {},
    bulkDeleteWorkspaces: async () => ({ deleted: 0, failed: [] }),

    getAdminSettings: async () => ({
      storage: { homeEnabled: false, fileManagerEnabled: false },
    }),
    updateAdminSettings: async () => ({
      storage: { homeEnabled: false, fileManagerEnabled: false },
    }),

    getFeatureModules: async (): Promise<FeatureModule[]> => [],
    toggleFeature: async (key, enabled): Promise<FeatureModule> => ({
      key,
      label: key,
      icon: '',
      scope: 'user',
      enabled,
      defaultEnabled: false,
      adminOnly: false,
      order: 0,
    }),
    getUserFeaturePreferences: async () => [],
    updateUserFeaturePreferences: async (prefs) => prefs,

    listTokens: async () => [],
    createToken: async (name) => ({
      id: `pat-${Date.now()}`,
      name,
      token: 'mock-pat-token',
      createdAt: new Date().toISOString(),
    }),
    revokeToken: async () => {},
  };
}

// ---------------------------------------------------------------------------
// IClusterAdapter mock
// ---------------------------------------------------------------------------

export function createMockClusterAdapter(): IClusterAdapter {
  const clusters = [...SEED_CLUSTERS];
  return {
    getClusters: async () => clusters,
    getCluster: async (id) => clusters.find((c) => c.id === id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// ISessionStore mock
// ---------------------------------------------------------------------------

export function createMockSessionStore(): ISessionStore {
  let sessions = [...SEED_DOMAIN_SESSIONS];
  const listeners: Array<(sessions: Session[]) => void> = [];

  function notify() {
    for (const cb of listeners) cb(sessions);
  }

  return {
    getSession: async (id) => sessions.find((s) => s.id === id) ?? null,

    listSessions: async (filters) => {
      if (!filters) return sessions;
      return sessions.filter((s) => {
        if (filters.state && s.state !== filters.state) return false;
        if (filters.clusterId && s.clusterId !== filters.clusterId) return false;
        if (filters.ravnId && s.ravnId !== filters.ravnId) return false;
        return true;
      });
    },

    createSession: async (spec) => {
      const session: Session = {
        ...spec,
        id: `ds-${Date.now()}`,
        events: [],
      };
      sessions = [...sessions, session];
      notify();
      return session;
    },

    updateSession: async (id, updates) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx === -1) throw new Error(`Session not found: ${id}`);
      const updated = { ...sessions[idx]!, ...updates };
      sessions = sessions.map((s) => (s.id === id ? updated : s));
      notify();
      return updated;
    },

    deleteSession: async (id) => {
      sessions = sessions.filter((s) => s.id !== id);
      notify();
    },

    subscribe: (callback) => {
      listeners.push(callback);
      callback(sessions);
      return () => {
        const i = listeners.indexOf(callback);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ITemplateStore mock
// ---------------------------------------------------------------------------

export function createMockTemplateStore(): ITemplateStore {
  const templates = [...SEED_TEMPLATES];
  return {
    getTemplate: async (id) => templates.find((t) => t.id === id) ?? null,
    listTemplates: async () => templates,
    createTemplate: async (name, spec) => ({
      id: `tpl-${Date.now()}`,
      name,
      version: 1,
      spec,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    updateTemplate: async (id, spec) => {
      const existing = templates.find((t) => t.id === id);
      if (!existing) throw new Error(`Template not found: ${id}`);
      return { ...existing, spec, version: existing.version + 1, updatedAt: new Date().toISOString() };
    },
    deleteTemplate: async () => {},
  };
}

// ---------------------------------------------------------------------------
// IPtyStream mock
// ---------------------------------------------------------------------------

export function createMockPtyStream(): IPtyStream {
  return {
    subscribe: (_sessionId, onData) => {
      onData('$ ');
      return () => {};
    },
    send: () => {},
  };
}

// ---------------------------------------------------------------------------
// IMetricsStream mock
// ---------------------------------------------------------------------------

export function createMockMetricsStream(): IMetricsStream {
  return {
    subscribe: (_sessionId, onMetrics) => {
      onMetrics({ timestamp: Date.now(), cpu: 0.4, memMi: 320, gpu: 0 });
      const interval = setInterval(
        () => onMetrics({ timestamp: Date.now(), cpu: Math.random(), memMi: 300 + Math.random() * 100, gpu: 0 }),
        2_000,
      );
      return () => clearInterval(interval);
    },
  };
}
