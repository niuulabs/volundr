import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMocks = vi.hoisted(() => ({
  createApiClient: vi.fn((basePath: string) => ({ basePath })),
}));

const tyrMocks = vi.hoisted(() => ({
  createMockTyrService: vi.fn(() => ({ kind: 'mock-tyr' })),
  createMockDispatcherService: vi.fn(() => ({ kind: 'mock-dispatcher' })),
  createMockTyrSessionService: vi.fn(() => ({ kind: 'mock-sessions' })),
  createMockTrackerService: vi.fn(() => ({ kind: 'mock-tracker' })),
  createMockWorkflowService: vi.fn(() => ({ kind: 'mock-workflows' })),
  createMockDispatchBus: vi.fn(() => ({ kind: 'mock-dispatch' })),
  createMockTyrSettingsService: vi.fn(() => ({ kind: 'mock-settings' })),
  createMockAuditLogService: vi.fn(() => ({ kind: 'mock-audit' })),
  buildTyrHttpAdapter: vi.fn((client) => ({ kind: 'tyr', client })),
  buildDispatcherHttpAdapter: vi.fn((client) => ({ kind: 'dispatcher', client })),
  buildTyrSessionHttpAdapter: vi.fn((client) => ({ kind: 'sessions', client })),
  buildTrackerHttpAdapter: vi.fn((client) => ({ kind: 'tracker', client })),
  buildDispatchBusHttpAdapter: vi.fn((client) => ({ kind: 'dispatch', client })),
  buildTyrSettingsHttpAdapter: vi.fn((client) => ({ kind: 'settings', client })),
  buildTyrAuditLogHttpAdapter: vi.fn((client) => ({ kind: 'audit', client })),
}));

const volundrMocks = vi.hoisted(() => ({
  createMockVolundrService: vi.fn(() => ({ kind: 'mock-volundr' })),
  createMockClusterAdapter: vi.fn(() => ({ kind: 'mock-clusters' })),
  createMockTemplateStore: vi.fn(() => ({ kind: 'mock-templates' })),
  createMockSessionStore: vi.fn(() => ({ kind: 'mock-session-store' })),
  buildVolundrHttpAdapter: vi.fn((client) => ({
    kind: 'volundr',
    client,
    getSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    listArchivedSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
  })),
  createMockPtyStream: vi.fn(() => ({})),
  createMockMetricsStream: vi.fn(() => ({})),
  createMockFileSystemPort: vi.fn(() => ({})),
  buildVolundrPtyWsAdapter: vi.fn(() => ({})),
  buildVolundrMetricsSseAdapter: vi.fn(() => ({})),
}));

vi.mock('@niuulabs/query', () => ({
  createApiClient: queryMocks.createApiClient,
}));

vi.mock('@niuulabs/plugin-tyr', () => tyrMocks);
vi.mock('@niuulabs/plugin-ravn', () => ({
  createMockPersonaStore: vi.fn(() => ({})),
  createMockRavenStream: vi.fn(() => ({})),
  createMockSessionStream: vi.fn(() => ({})),
  createMockTriggerStore: vi.fn(() => ({})),
  createMockBudgetStream: vi.fn(() => ({})),
  buildRavnPersonaAdapter: vi.fn(() => ({})),
  buildRavnRavenAdapter: vi.fn(() => ({})),
  buildRavnSessionAdapter: vi.fn(() => ({})),
  buildRavnTriggerAdapter: vi.fn(() => ({})),
  buildRavnBudgetAdapter: vi.fn(() => ({})),
}));
vi.mock('@niuulabs/plugin-mimir', () => ({
  createMimirMockAdapter: vi.fn(() => ({})),
  buildMimirHttpAdapter: vi.fn(() => ({})),
}));
vi.mock('@niuulabs/plugin-observatory', () => ({
  createMockRegistryRepository: vi.fn(() => ({})),
  createMockTopologyStream: vi.fn(() => ({})),
  createMockEventStream: vi.fn(() => ({})),
  buildObservatoryRegistryHttpAdapter: vi.fn(() => ({})),
  buildObservatoryTopologySseStream: vi.fn(() => ({})),
  buildObservatoryEventsSseStream: vi.fn(() => ({})),
}));
vi.mock('@niuulabs/plugin-volundr', () => volundrMocks);

import { buildServices, resolveSharedApiBase, toSharedApiBase } from './services';

describe('toSharedApiBase', () => {
  it('strips a trailing Tyr service suffix', () => {
    expect(toSharedApiBase('http://localhost:8080/api/v1/tyr')).toBe(
      'http://localhost:8080/api/v1',
    );
  });

  it('strips a trailing Volundr service suffix', () => {
    expect(toSharedApiBase('http://localhost:8080/api/v1/volundr')).toBe(
      'http://localhost:8080/api/v1',
    );
  });
});

describe('resolveSharedApiBase', () => {
  it('prefers the Tyr shared base when Tyr is live', () => {
    expect(
      resolveSharedApiBase({
        services: {
          tyr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/tyr' },
          volundr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr' },
        },
      } as any),
    ).toBe('http://localhost:8080/api/v1');
  });

  it('falls back to the Volundr shared base when Tyr is not live', () => {
    expect(
      resolveSharedApiBase({
        services: {
          volundr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr' },
        },
      } as any),
    ).toBe('http://localhost:8080/api/v1');
  });

  it('returns null when neither Tyr nor Volundr is live', () => {
    expect(
      resolveSharedApiBase({
        services: {
          tyr: { mode: 'mock' },
          volundr: { mode: 'mock' },
        },
      } as any),
    ).toBeNull();
  });
});

describe('buildServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds Tyr tracker and audit services against the shared api base', () => {
    const services = buildServices({
      theme: 'ice',
      plugins: {},
      services: {
        tyr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/tyr' },
      },
    } as any);

    expect(tyrMocks.buildTyrHttpAdapter).toHaveBeenCalledWith({
      basePath: 'http://localhost:8080/api/v1/tyr',
    });
    expect(tyrMocks.buildTrackerHttpAdapter).toHaveBeenCalledWith({
      basePath: 'http://localhost:8080/api/v1',
    });
    expect(tyrMocks.buildTyrAuditLogHttpAdapter).toHaveBeenCalledWith({
      basePath: 'http://localhost:8080/api/v1',
    });
    expect((services['tyr.tracker'] as any).kind).toBe('tracker');
    expect((services['tyr.audit'] as any).kind).toBe('audit');
  });

  it('falls back to the Volundr host when Tyr is not live', () => {
    buildServices({
      theme: 'ice',
      plugins: {},
      services: {
        volundr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr' },
      },
    } as any);

    expect(tyrMocks.buildTrackerHttpAdapter).toHaveBeenCalledWith({
      basePath: 'http://localhost:8080/api/v1',
    });
    expect(tyrMocks.buildTyrAuditLogHttpAdapter).toHaveBeenCalledWith({
      basePath: 'http://localhost:8080/api/v1',
    });
  });

  it('builds a live session store from the live Volundr service', async () => {
    const activeSession = {
      id: 'sess-live',
      name: 'feat/canonical-routes',
      source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'feat/canonical-routes' },
      status: 'running',
      model: 'claude-sonnet',
      lastActive: Date.parse('2026-04-24T12:30:00Z'),
      messageCount: 12,
      tokensUsed: 4200,
      taskType: 'forge-web',
      trackerIssue: { identifier: 'NIU-754' },
      activityState: 'active',
    };
    const archivedSession = {
      id: 'sess-archived',
      name: 'fix/legacy-shim-cleanup',
      source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'fix/legacy-shim-cleanup' },
      status: 'archived',
      model: 'claude-haiku',
      lastActive: Date.parse('2026-04-23T12:30:00Z'),
      messageCount: 4,
      tokensUsed: 800,
      taskType: 'forge-web',
      trackerIssue: { identifier: 'NIU-753' },
      activityState: null,
      archivedAt: new Date('2026-04-23T13:00:00Z'),
    };
    const liveVolundr = {
      kind: 'volundr',
      getSessions: vi.fn().mockResolvedValue([activeSession]),
      getSession: vi.fn().mockImplementation(async (id: string) => {
        if (id === activeSession.id) return activeSession;
        return null;
      }),
      listArchivedSessions: vi.fn().mockResolvedValue([archivedSession]),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn((callback: (sessions: typeof activeSession[]) => void) => {
        callback([activeSession]);
        return () => {};
      }),
    };
    volundrMocks.buildVolundrHttpAdapter.mockReturnValue(liveVolundr as any);

    const services = buildServices({
      theme: 'ice',
      plugins: {},
      services: {
        volundr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr' },
      },
    } as any);

    expect(services['volundr.sessions']).toBe(services.sessionStore);

    const sessionStore = services.sessionStore as any;
    await expect(sessionStore.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'sess-live',
        ravnId: 'NIU-754',
        personaName: 'feat/canonical-routes',
        templateId: 'forge-web',
        clusterId: 'shared',
        state: 'running',
        tokensIn: 4200,
        tokensOut: 0,
        preview: 'github.com/niuulabs/volundr#feat/canonical-routes',
      }),
      expect.objectContaining({
        id: 'sess-archived',
        ravnId: 'NIU-753',
        state: 'terminated',
        terminatedAt: '2026-04-23T13:00:00.000Z',
      }),
    ]);
    await expect(sessionStore.listSessions({ state: 'terminated' })).resolves.toEqual([
      expect.objectContaining({ id: 'sess-archived' }),
    ]);
    await expect(sessionStore.getSession('sess-archived')).resolves.toEqual(
      expect.objectContaining({ id: 'sess-archived', state: 'terminated' }),
    );
    await sessionStore.deleteSession('sess-live');
    expect(liveVolundr.deleteSession).toHaveBeenCalledWith('sess-live');
  });

  it('keeps mock session stores when Volundr is not live', () => {
    const services = buildServices({
      theme: 'ice',
      plugins: {},
      services: {},
    } as any);

    expect(volundrMocks.createMockSessionStore).toHaveBeenCalledTimes(1);
    expect((services['volundr.sessions'] as any).kind).toBe('mock-session-store');
    expect((services.sessionStore as any).kind).toBe('mock-session-store');
  });

  it('maps lifecycle variants and subscription updates through the live session store', async () => {
    const liveSessions = [
      {
        id: 'sess-created',
        name: 'draft/session',
        source: {
          type: 'local_mount',
          local_path: '/workspace/niuu',
          paths: [{ host_path: '/workspace/niuu', mount_path: '/workspace', read_only: false }],
        },
        status: 'created',
        model: 'claude-sonnet',
        lastActive: 0,
        messageCount: 0,
        tokensUsed: 0,
        ownerId: 'ravn-created',
        activityState: null,
      },
      {
        id: 'sess-starting',
        name: 'booting/session',
        source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'boot' },
        status: 'starting',
        model: 'claude-sonnet',
        lastActive: Date.parse('2026-04-24T10:00:00Z'),
        messageCount: 0,
        tokensUsed: 15,
        tenantId: 'tenant-a',
        activityState: null,
      },
      {
        id: 'sess-idle',
        name: 'idle/session',
        source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'idle' },
        status: 'running',
        model: 'claude-sonnet',
        lastActive: Date.parse('2026-04-24T11:00:00Z'),
        messageCount: 0,
        tokensUsed: 20,
        podName: 'forge-pod-1',
        activityState: 'idle',
      },
      {
        id: 'sess-stopping',
        name: 'stopping/session',
        source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'stop' },
        status: 'stopping',
        model: 'claude-sonnet',
        lastActive: Date.parse('2026-04-24T11:30:00Z'),
        messageCount: 0,
        tokensUsed: 25,
        hostname: 'forge-host',
        activityState: null,
      },
    ];
    const archivedSession = {
      id: 'sess-error',
      name: 'error/session',
      source: { type: 'git', repo: 'github.com/niuulabs/volundr', branch: 'err' },
      status: 'error',
      model: 'claude-haiku',
      lastActive: Date.parse('2026-04-23T12:30:00Z'),
      messageCount: 0,
      tokensUsed: 0,
      activityState: null,
      archivedAt: new Date('2026-04-23T13:00:00Z'),
    };
    const liveVolundr = {
      kind: 'volundr',
      getSessions: vi.fn().mockResolvedValue(liveSessions),
      getSession: vi.fn().mockResolvedValue(null),
      listArchivedSessions: vi.fn().mockResolvedValue([archivedSession]),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn((callback: (sessions: typeof liveSessions) => void) => {
        callback(liveSessions);
        return () => {};
      }),
    };
    volundrMocks.buildVolundrHttpAdapter.mockReturnValue(liveVolundr as any);

    const services = buildServices({
      theme: 'ice',
      plugins: {},
      services: {
        volundr: { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr' },
      },
    } as any);
    const sessionStore = services.sessionStore as any;

    await expect(sessionStore.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'sess-created',
        state: 'requested',
        startedAt: '1970-01-01T00:00:00.000Z',
        templateId: '/workspace/niuu',
        clusterId: 'shared',
        ravnId: 'ravn-created',
        preview: '/workspace/niuu',
      }),
      expect.objectContaining({
        id: 'sess-starting',
        state: 'provisioning',
        bootProgress: 0.25,
        clusterId: 'tenant-a',
        ravnId: 'tenant-a',
      }),
      expect.objectContaining({
        id: 'sess-idle',
        state: 'idle',
        clusterId: 'forge-pod-1',
      }),
      expect.objectContaining({
        id: 'sess-stopping',
        state: 'terminating',
        clusterId: 'forge-host',
      }),
      expect.objectContaining({
        id: 'sess-error',
        state: 'failed',
        terminatedAt: '2026-04-23T13:00:00.000Z',
      }),
    ]);
    await expect(sessionStore.listSessions({ clusterId: 'forge-pod-1' })).resolves.toEqual([
      expect.objectContaining({ id: 'sess-idle' }),
    ]);
    await expect(sessionStore.listSessions({ ravnId: 'tenant-a' })).resolves.toEqual([
      expect.objectContaining({ id: 'sess-starting' }),
    ]);
    await expect(sessionStore.createSession({})).rejects.toThrow(/not yet supported/);
    await expect(sessionStore.updateSession('sess-idle', {})).rejects.toThrow(/not yet supported/);

    const callback = vi.fn();
    const unsubscribe = sessionStore.subscribe(callback);
    await Promise.resolve();
    await Promise.resolve();
    expect(callback).toHaveBeenCalled();
    expect(callback.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sess-idle', state: 'idle' }),
        expect.objectContaining({ id: 'sess-error', state: 'failed' }),
      ]),
    );
    unsubscribe();
  });

  it('builds live stream and observatory adapters when those backends are configured', () => {
    buildServices({
      theme: 'ice',
      plugins: {},
      services: {
        'volundr.pty': { mode: 'ws', wsUrl: 'ws://localhost:8080/api/v1/volundr/pty/{sessionId}' },
        'volundr.metrics': { mode: 'http', baseUrl: 'http://localhost:8080/api/v1/volundr/metrics' },
        'observatory.registry': {
          mode: 'http',
          baseUrl: 'http://localhost:8080/api/v1/observatory/registry',
        },
        'observatory.topology': {
          mode: 'http',
          baseUrl: 'http://localhost:8080/api/v1/observatory/topology',
        },
        'observatory.events': {
          mode: 'http',
          baseUrl: 'http://localhost:8080/api/v1/observatory/events',
        },
      },
    } as any);

    expect(volundrMocks.buildVolundrPtyWsAdapter).toHaveBeenCalledWith({
      urlTemplate: 'ws://localhost:8080/api/v1/volundr/pty/{sessionId}',
    });
    expect(volundrMocks.buildVolundrMetricsSseAdapter).toHaveBeenCalledWith({
      urlTemplate: 'http://localhost:8080/api/v1/volundr/metrics',
    });
  });
});
