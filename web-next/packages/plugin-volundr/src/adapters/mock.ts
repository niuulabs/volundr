/**
 * Mock adapters for Völundr ports — used in tests and dev mode.
 */
import type { IVolundrService } from '../ports/IVolundrService';
import type { IClusterAdapter } from '../ports/IClusterAdapter';
import type { ISessionStore } from '../ports/ISessionStore';
import type { ITemplateStore } from '../ports/ITemplateStore';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IMetricsStream } from '../ports/IMetricsStream';
import type { IFileSystemPort, FileTreeNode } from '../ports/IFileSystemPort';
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
    events: [
      {
        ts: new Date(Date.now() - 3_600_000).toISOString(),
        kind: 'requested',
        body: 'session requested',
      },
      {
        ts: new Date(Date.now() - 3_595_000).toISOString(),
        kind: 'provisioning',
        body: 'pod scheduling',
      },
      { ts: new Date(Date.now() - 3_590_000).toISOString(), kind: 'ready', body: 'pod ready' },
      {
        ts: new Date(Date.now() - 3_580_000).toISOString(),
        kind: 'running',
        body: 'session active',
      },
    ],
  },
  {
    id: 'ds-2',
    ravnId: 'r2',
    personaName: 'herald',
    templateId: 'tpl-default',
    clusterId: 'cl-eitri',
    state: 'idle',
    startedAt: new Date(Date.now() - 7_200_000).toISOString(),
    readyAt: new Date(Date.now() - 7_190_000).toISOString(),
    lastActivityAt: new Date(Date.now() - 1_800_000).toISOString(),
    resources: {
      cpuRequest: 1,
      cpuLimit: 2,
      cpuUsed: 0.05,
      memRequestMi: 512,
      memLimitMi: 1_024,
      memUsedMi: 280,
      gpuCount: 0,
    },
    env: { NODE_ENV: 'development' },
    events: [
      {
        ts: new Date(Date.now() - 7_200_000).toISOString(),
        kind: 'requested',
        body: 'session requested',
      },
      { ts: new Date(Date.now() - 7_190_000).toISOString(), kind: 'ready', body: 'pod ready' },
      {
        ts: new Date(Date.now() - 1_800_000).toISOString(),
        kind: 'idle',
        body: 'no activity detected',
      },
    ],
  },
  {
    id: 'ds-3',
    ravnId: 'r3',
    personaName: 'bard',
    templateId: 'tpl-default',
    clusterId: 'cl-eitri',
    state: 'provisioning',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    resources: {
      cpuRequest: 2,
      cpuLimit: 4,
      cpuUsed: 0,
      memRequestMi: 1_024,
      memLimitMi: 2_048,
      memUsedMi: 0,
      gpuCount: 1,
    },
    env: {},
    events: [
      {
        ts: new Date(Date.now() - 120_000).toISOString(),
        kind: 'requested',
        body: 'session requested',
      },
      {
        ts: new Date(Date.now() - 90_000).toISOString(),
        kind: 'provisioning',
        body: 'pod scheduling',
      },
    ],
  },
  {
    id: 'ds-4',
    ravnId: 'r4',
    personaName: 'sage',
    templateId: 'tpl-default',
    clusterId: 'cl-eitri',
    state: 'failed',
    startedAt: new Date(Date.now() - 86_400_000).toISOString(),
    terminatedAt: new Date(Date.now() - 86_000_000).toISOString(),
    resources: {
      cpuRequest: 1,
      cpuLimit: 2,
      cpuUsed: 0,
      memRequestMi: 512,
      memLimitMi: 1_024,
      memUsedMi: 0,
      gpuCount: 0,
    },
    env: {},
    events: [
      {
        ts: new Date(Date.now() - 86_400_000).toISOString(),
        kind: 'requested',
        body: 'session requested',
      },
      {
        ts: new Date(Date.now() - 86_000_000).toISOString(),
        kind: 'failed',
        body: 'pod failed to start: OOMKilled',
      },
    ],
  },
  {
    id: 'ds-5',
    ravnId: 'r5',
    personaName: 'scout',
    templateId: 'tpl-default',
    clusterId: 'cl-eitri',
    state: 'terminated',
    startedAt: new Date(Date.now() - 172_800_000).toISOString(),
    readyAt: new Date(Date.now() - 172_790_000).toISOString(),
    terminatedAt: new Date(Date.now() - 43_200_000).toISOString(),
    resources: {
      cpuRequest: 1,
      cpuLimit: 2,
      cpuUsed: 0,
      memRequestMi: 512,
      memLimitMi: 1_024,
      memUsedMi: 0,
      gpuCount: 0,
    },
    env: {},
    events: [
      {
        ts: new Date(Date.now() - 172_800_000).toISOString(),
        kind: 'requested',
        body: 'session requested',
      },
      { ts: new Date(Date.now() - 172_790_000).toISOString(), kind: 'ready', body: 'pod ready' },
      {
        ts: new Date(Date.now() - 43_200_000).toISOString(),
        kind: 'terminated',
        body: 'TTL expired — session terminated',
      },
    ],
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
      return {
        ...existing,
        spec,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };
    },
    deleteTemplate: async () => {},
  };
}

// ---------------------------------------------------------------------------
// IPtyStream mock
// ---------------------------------------------------------------------------

export function createMockPtyStream(): IPtyStream {
  const subscribers = new Map<string, Array<(chunk: string) => void>>();

  function notify(sessionId: string, chunk: string) {
    for (const cb of subscribers.get(sessionId) ?? []) cb(chunk);
  }

  return {
    subscribe: (sessionId, onData) => {
      const existing = subscribers.get(sessionId) ?? [];
      existing.push(onData);
      subscribers.set(sessionId, existing);
      // Emit a prompt after a short delay to simulate connection.
      setTimeout(() => {
        notify(sessionId, `\x1b[1;32m[mock]\x1b[0m connected to ${sessionId}\r\n$ `);
      }, 50);
      return () => {
        const updated = (subscribers.get(sessionId) ?? []).filter((cb) => cb !== onData);
        subscribers.set(sessionId, updated);
      };
    },
    send: (sessionId, data) => {
      // Echo input back so the terminal shows what was typed.
      if (data === '\r') {
        notify(sessionId, '\r\nmock-output\r\n$ ');
      } else {
        notify(sessionId, data);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// IFileSystemPort mock
// ---------------------------------------------------------------------------

const SEED_FILE_TREE: FileTreeNode[] = [
  {
    name: 'src',
    path: '/workspace/src',
    kind: 'directory',
    children: [
      { name: 'index.ts', path: '/workspace/src/index.ts', kind: 'file', size: 512 },
      { name: 'app.tsx', path: '/workspace/src/app.tsx', kind: 'file', size: 1_024 },
    ],
  },
  { name: 'package.json', path: '/workspace/package.json', kind: 'file', size: 800 },
  { name: 'README.md', path: '/workspace/README.md', kind: 'file', size: 2_048 },
  {
    name: 'env',
    path: '/mnt/secrets',
    kind: 'directory',
    mountName: 'api-secrets',
    isSecret: true,
    children: [
      {
        name: 'API_KEY',
        path: '/mnt/secrets/API_KEY',
        kind: 'file',
        isSecret: true,
        mountName: 'api-secrets',
      },
    ],
  },
];

const SEED_FILE_CONTENTS: Record<string, string> = {
  '/workspace/src/index.ts': `import { App } from './app';\n\nconst app = new App();\napp.listen(8080);\n`,
  '/workspace/src/app.tsx': `import React from 'react';\n\nexport function App() {\n  return <div>Hello from the dev pod!</div>;\n}\n`,
  '/workspace/package.json': `{\n  "name": "mock-project",\n  "version": "0.0.1",\n  "type": "module"\n}\n`,
  '/workspace/README.md': `# Mock project\n\nThis is a mock workspace generated by the Völundr mock adapter.\n`,
};

export function createMockFileSystemPort(): IFileSystemPort {
  return {
    listTree: async (_sessionId) => SEED_FILE_TREE,

    expandDirectory: async (_sessionId, path) => {
      function findNode(nodes: FileTreeNode[], target: string): FileTreeNode | null {
        for (const node of nodes) {
          if (node.path === target) return node;
          if (node.children) {
            const found = findNode(node.children, target);
            if (found) return found;
          }
        }
        return null;
      }
      return findNode(SEED_FILE_TREE, path)?.children ?? [];
    },

    readFile: async (_sessionId, path) => {
      const content = SEED_FILE_CONTENTS[path];
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
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
        () =>
          onMetrics({
            timestamp: Date.now(),
            cpu: Math.random(),
            memMi: 300 + Math.random() * 100,
            gpu: 0,
          }),
        2_000,
      );
      return () => clearInterval(interval);
    },
  };
}
