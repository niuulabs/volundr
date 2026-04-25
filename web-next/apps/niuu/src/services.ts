import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
  buildRavnPersonaAdapter,
  buildRavnRavenAdapter,
  buildRavnSessionAdapter,
  buildRavnTriggerAdapter,
  buildRavnBudgetAdapter,
} from '@niuulabs/plugin-ravn';
import {
  createMockTyrService,
  createMockDispatcherService,
  createMockTyrSessionService,
  createMockTrackerService,
  createMockWorkflowService,
  createMockDispatchBus,
  createMockTyrSettingsService,
  createMockAuditLogService,
  buildTyrHttpAdapter,
  buildDispatcherHttpAdapter,
  buildTyrSessionHttpAdapter,
  buildTrackerHttpAdapter,
  buildDispatchBusHttpAdapter,
  buildTyrSettingsHttpAdapter,
  buildTyrAuditLogHttpAdapter,
} from '@niuulabs/plugin-tyr';
import { createMimirMockAdapter, buildMimirHttpAdapter } from '@niuulabs/plugin-mimir';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
  buildObservatoryRegistryHttpAdapter,
  buildObservatoryTopologySseStream,
  buildObservatoryEventsSseStream,
} from '@niuulabs/plugin-observatory';
import {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockTemplateStore,
  createMockSessionStore,
  buildVolundrHttpAdapter,
  createMockPtyStream,
  createMockMetricsStream,
  createMockFileSystemPort,
  buildVolundrPtyWsAdapter,
  buildVolundrMetricsSseAdapter,
  type IVolundrService,
  type ISessionStore,
  type Session,
  type SessionFilters,
  type VolundrSession,
} from '@niuulabs/plugin-volundr';
import { createApiClient } from '@niuulabs/query';
import {
  buildFeatureCatalogAdapter,
  buildIdentityAdapter,
  createMockFeatureCatalogService,
  createMockIdentityService,
  type IFeatureCatalogService,
  type IIdentityService,
} from '@niuulabs/plugin-sdk';
import type { NiuuConfig, ServiceConfig, ServicesMap } from '@niuulabs/plugin-sdk';

/**
 * A service config is "live" (i.e. should use a real transport) when its mode
 * is `http` or `ws` and a URL is present. Any other combination — missing
 * mode, `mock`, or missing URL — falls back to the mock adapter.
 */
function hasHttpBackend(
  svc: ServiceConfig | undefined,
): svc is ServiceConfig & { baseUrl: string } {
  return svc?.mode === 'http' && typeof svc.baseUrl === 'string';
}

function hasWsBackend(svc: ServiceConfig | undefined): svc is ServiceConfig & { wsUrl: string } {
  return svc?.mode === 'ws' && typeof svc.wsUrl === 'string';
}

export function toSharedApiBase(baseUrl: string): string {
  return baseUrl.replace(/\/(?:tyr|volundr)\/?$/, '');
}

export function resolveSharedApiBase(config: Pick<NiuuConfig, 'services'>): string | null {
  const tyrSvc = config.services['tyr'];
  if (hasHttpBackend(tyrSvc)) return toSharedApiBase(tyrSvc.baseUrl);

  const volundrSvc = config.services['volundr'];
  if (hasHttpBackend(volundrSvc)) return toSharedApiBase(volundrSvc.baseUrl);

  return null;
}

export function resolveCanonicalServiceBase(
  config: Pick<NiuuConfig, 'services'>,
  serviceKey: string,
): string | null {
  const explicitService = config.services[serviceKey];
  if (hasHttpBackend(explicitService)) return explicitService.baseUrl;
  return resolveSharedApiBase(config);
}

export function buildSharedFeatureCatalogService(
  config: Pick<NiuuConfig, 'services'>,
): IFeatureCatalogService {
  const featuresBase = resolveCanonicalServiceBase(config, 'features');
  if (!featuresBase) return createMockFeatureCatalogService();
  return buildFeatureCatalogAdapter(createApiClient(featuresBase));
}

export function buildSharedIdentityService(config: Pick<NiuuConfig, 'services'>): IIdentityService {
  const identityBase = resolveCanonicalServiceBase(config, 'identity');
  if (!identityBase) return createMockIdentityService();
  return buildIdentityAdapter(createApiClient(identityBase));
}

const EMPTY_SESSION_RESOURCES: Session['resources'] = {
  cpuRequest: 0,
  cpuLimit: 0,
  cpuUsed: 0,
  memRequestMi: 0,
  memLimitMi: 0,
  memUsedMi: 0,
  gpuCount: 0,
};

function toIsoFromEpochMs(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return undefined;
  return new Date(value).toISOString();
}

function toSessionState(session: VolundrSession): Session['state'] {
  switch (session.status) {
    case 'created':
      return 'requested';
    case 'starting':
    case 'provisioning':
      return 'provisioning';
    case 'running':
      return session.activityState === 'idle' ? 'idle' : 'running';
    case 'stopping':
      return 'terminating';
    case 'stopped':
    case 'archived':
      return 'terminated';
    case 'error':
      return 'failed';
  }
}

function toSessionTemplateId(session: VolundrSession): string {
  if (session.taskType) return session.taskType;
  if (session.source.type === 'git') {
    const repoName = session.source.repo.split('/').pop();
    return repoName && repoName.length > 0 ? repoName : 'git';
  }
  return session.source.local_path ?? session.source.paths[0]?.mount_path ?? 'local-mount';
}

function toSessionClusterId(session: VolundrSession): string {
  return session.podName ?? session.hostname ?? session.tenantId ?? 'shared';
}

function toSessionRavnId(session: VolundrSession): string {
  return session.trackerIssue?.identifier ?? session.ownerId ?? session.tenantId ?? session.id;
}

function toSessionPreview(session: VolundrSession): string | undefined {
  if (session.source.type === 'git') {
    return `${session.source.repo}#${session.source.branch}`;
  }
  return session.source.local_path ?? session.source.paths[0]?.mount_path;
}

function toDomainSession(session: VolundrSession): Session {
  const startedAt = toIsoFromEpochMs(session.lastActive) ?? new Date(0).toISOString();
  const lastActivityAt = toIsoFromEpochMs(session.lastActive);
  const state = toSessionState(session);
  const readyAt =
    state === 'running' || state === 'idle' || state === 'terminating' || state === 'terminated'
      ? startedAt
      : undefined;
  const terminatedAt =
    state === 'terminated' || state === 'failed' ? session.archivedAt?.toISOString() : undefined;

  return {
    id: session.id,
    ravnId: toSessionRavnId(session),
    personaName: session.name,
    templateId: toSessionTemplateId(session),
    clusterId: toSessionClusterId(session),
    state,
    startedAt,
    readyAt,
    lastActivityAt,
    terminatedAt,
    resources: EMPTY_SESSION_RESOURCES,
    env: {},
    events: [],
    bootProgress: state === 'provisioning' ? (session.status === 'starting' ? 0.25 : 0.6) : undefined,
    connectionType: 'cli',
    tokensIn: session.tokensUsed,
    tokensOut: 0,
    preview: toSessionPreview(session),
  };
}

function applySessionFilters(sessions: Session[], filters?: SessionFilters): Session[] {
  if (!filters) return sessions;
  return sessions.filter((session) => {
    if (filters.state && session.state !== filters.state) return false;
    if (filters.clusterId && session.clusterId !== filters.clusterId) return false;
    if (filters.ravnId && session.ravnId !== filters.ravnId) return false;
    return true;
  });
}

async function listAllVolundrSessions(volundr: IVolundrService): Promise<Session[]> {
  const [sessions, archived] = await Promise.all([
    volundr.getSessions(),
    volundr.listArchivedSessions().catch(() => []),
  ]);
  const byId = new Map<string, Session>();
  for (const session of [...sessions, ...archived]) {
    byId.set(session.id, toDomainSession(session));
  }
  return Array.from(byId.values());
}

function buildVolundrSessionStore(volundr: IVolundrService): ISessionStore {
  return {
    async getSession(id: string) {
      const session = await volundr.getSession(id);
      if (session) return toDomainSession(session);
      const archived = await volundr.listArchivedSessions().catch(() => []);
      const archivedSession = archived.find((candidate: VolundrSession) => candidate.id === id);
      return archivedSession ? toDomainSession(archivedSession) : null;
    },
    async listSessions(filters?: SessionFilters) {
      return applySessionFilters(await listAllVolundrSessions(volundr), filters);
    },
    async createSession() {
      throw new Error('Session creation is not yet supported through the app session-store adapter.');
    },
    async updateSession() {
      throw new Error('Session updates are not yet supported through the app session-store adapter.');
    },
    async deleteSession(id: string) {
      await volundr.deleteSession(id);
    },
    subscribe(callback: (sessions: Session[]) => void) {
      let active = true;
      const emit = async (sessions?: VolundrSession[]) => {
        const current = sessions?.map(toDomainSession) ?? [];
        const archived = await volundr.listArchivedSessions().catch(() => []);
        if (!active) return;
        const byId = new Map<string, Session>();
        for (const session of [...current, ...archived.map(toDomainSession)]) {
          byId.set(session.id, session);
        }
        callback(Array.from(byId.values()));
      };
      void emit();
      const unsubscribe = volundr.subscribe((sessions: VolundrSession[]) => {
        void emit(sessions);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}

export function buildServices(config: NiuuConfig): ServicesMap {
  const ravnSvc = config.services['ravn'];
  const tyrSvc = config.services['tyr'];
  const mimirSvc = config.services['mimir'];
  const volundrSvc = config.services['volundr'];
  const volundrPtySvc = config.services['volundr.pty'];
  const volundrMetricsSvc = config.services['volundr.metrics'];
  const obsRegistrySvc = config.services['observatory.registry'];
  const obsTopologySvc = config.services['observatory.topology'];
  const obsEventsSvc = config.services['observatory.events'];

  // ── Ravn: all five sub-services share one HTTP base URL when configured ──
  const ravnClient = hasHttpBackend(ravnSvc) ? createApiClient(ravnSvc.baseUrl) : null;
  const ravnPersonas = ravnClient ? buildRavnPersonaAdapter(ravnClient) : createMockPersonaStore();
  const ravnRavens = ravnClient ? buildRavnRavenAdapter(ravnClient) : createMockRavenStream();
  const ravnSessions = ravnClient ? buildRavnSessionAdapter(ravnClient) : createMockSessionStream();
  const ravnTriggers = ravnClient ? buildRavnTriggerAdapter(ravnClient) : createMockTriggerStore();
  const ravnBudget = ravnClient ? buildRavnBudgetAdapter(ravnClient) : createMockBudgetStream();

  // ── Mímir ──
  const mimir = hasHttpBackend(mimirSvc)
    ? buildMimirHttpAdapter(createApiClient(mimirSvc.baseUrl))
    : createMimirMockAdapter();

  // ── Völundr request/response ──
  const volundr = hasHttpBackend(volundrSvc)
    ? buildVolundrHttpAdapter(createApiClient(volundrSvc.baseUrl))
    : createMockVolundrService();
  const sessionStore = hasHttpBackend(volundrSvc)
    ? buildVolundrSessionStore(volundr)
    : createMockSessionStore();

  // ── Völundr streams: keyed as separate services so they can be flipped
  //    independently (e.g. mock PTY with live metrics during bring-up). ──
  const ptyStream = hasWsBackend(volundrPtySvc)
    ? buildVolundrPtyWsAdapter({ urlTemplate: volundrPtySvc.wsUrl })
    : createMockPtyStream();
  const metricsStream = hasHttpBackend(volundrMetricsSvc)
    ? buildVolundrMetricsSseAdapter({ urlTemplate: volundrMetricsSvc.baseUrl })
    : createMockMetricsStream();

  // ── Observatory ──
  const observatoryRegistry = hasHttpBackend(obsRegistrySvc)
    ? buildObservatoryRegistryHttpAdapter(createApiClient(obsRegistrySvc.baseUrl))
    : createMockRegistryRepository();
  const observatoryTopology = hasHttpBackend(obsTopologySvc)
    ? buildObservatoryTopologySseStream(obsTopologySvc.baseUrl)
    : createMockTopologyStream();
  const observatoryEvents = hasHttpBackend(obsEventsSvc)
    ? buildObservatoryEventsSseStream(obsEventsSvc.baseUrl)
    : createMockEventStream();
  const identityService = buildSharedIdentityService(config);

  // ── Tyr ──
  const tyrClient = hasHttpBackend(tyrSvc) ? createApiClient(tyrSvc.baseUrl) : null;
  const trackerBase = resolveCanonicalServiceBase(config, 'tracker');
  const trackerClient = trackerBase ? createApiClient(trackerBase) : null;
  const auditBase = resolveCanonicalServiceBase(config, 'audit');
  const auditClient = auditBase ? createApiClient(auditBase) : null;
  const tyrService = tyrClient ? buildTyrHttpAdapter(tyrClient) : createMockTyrService();
  const dispatcherService = tyrClient
    ? buildDispatcherHttpAdapter(tyrClient)
    : createMockDispatcherService();
  const tyrSessionService = tyrClient
    ? buildTyrSessionHttpAdapter(tyrClient)
    : createMockTyrSessionService();
  const trackerService = trackerClient
    ? buildTrackerHttpAdapter(trackerClient)
    : createMockTrackerService();
  const workflowService = createMockWorkflowService();
  const dispatchBus = tyrClient ? buildDispatchBusHttpAdapter(tyrClient) : createMockDispatchBus();
  const tyrSettingsService = tyrClient
    ? buildTyrSettingsHttpAdapter(tyrClient)
    : createMockTyrSettingsService();
  const tyrAuditLogService = auditClient
    ? buildTyrAuditLogHttpAdapter(auditClient)
    : createMockAuditLogService();

  return {
    tyr: tyrService,
    'tyr.dispatcher': dispatcherService,
    'tyr.sessions': tyrSessionService,
    'tyr.tracker': trackerService,
    'tyr.workflows': workflowService,
    'tyr.dispatch': dispatchBus,
    'tyr.settings': tyrSettingsService,
    'tyr.audit': tyrAuditLogService,
    'ravn.personas': ravnPersonas,
    'ravn.ravens': ravnRavens,
    'ravn.sessions': ravnSessions,
    'ravn.triggers': ravnTriggers,
    'ravn.budget': ravnBudget,
    mimir,
    volundr,
    ptyStream,
    metricsStream,
    identity: identityService,
    filesystem: createMockFileSystemPort(),
    // NIU-678 pages (ClustersPage, TemplatesPage, HistoryPage)
    'volundr.clusters': createMockClusterAdapter(),
    'volundr.templates': createMockTemplateStore(),
    'volundr.sessions': sessionStore,
    // VolundrPage overview hooks (useVolundrClusters, useSessionStore)
    clusterAdapter: createMockClusterAdapter(),
    sessionStore,
    'observatory.registry': observatoryRegistry,
    'observatory.topology': observatoryTopology,
    'observatory.events': observatoryEvents,
  };
}
