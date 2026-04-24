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
vi.mock('@niuulabs/plugin-volundr', () => ({
  createMockVolundrService: vi.fn(() => ({})),
  createMockClusterAdapter: vi.fn(() => ({})),
  createMockTemplateStore: vi.fn(() => ({})),
  createMockSessionStore: vi.fn(() => ({})),
  buildVolundrHttpAdapter: vi.fn(() => ({})),
  createMockPtyStream: vi.fn(() => ({})),
  createMockMetricsStream: vi.fn(() => ({})),
  createMockFileSystemPort: vi.fn(() => ({})),
  buildVolundrPtyWsAdapter: vi.fn(() => ({})),
  buildVolundrMetricsSseAdapter: vi.fn(() => ({})),
}));

import { buildServices, toSharedApiBase } from './services';

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
});
