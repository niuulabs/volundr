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
  type IClusterAdapter,
  type Cluster,
  type IVolundrService,
  type ISessionStore,
  type ITemplateStore,
  type Session,
  type SessionFilters,
  type Template,
  type VolundrSession,
  type VolundrTemplate,
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

function resolveDirectServiceBase(
  config: Pick<NiuuConfig, 'services'>,
  ...serviceKeys: string[]
): string | null {
  for (const serviceKey of serviceKeys) {
    const svc = config.services[serviceKey];
    if (hasHttpBackend(svc)) return svc.baseUrl;
  }
  return null;
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
  const explicitBase = resolveDirectServiceBase(config, serviceKey);
  if (explicitBase) return explicitBase;
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

type ForgeTemplateRecord = VolundrTemplate & {
  createdAt?: string;
  updatedAt?: string;
  env_vars?: Record<string, string>;
  env_secret_refs?: string[];
  resource_config?: Record<string, unknown>;
  mcp_servers?: Array<Record<string, unknown>>;
  workload_config?: Record<string, unknown>;
};

function parseMemoryToMi(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'Mi').toLowerCase();
  switch (unit) {
    case 'ki':
      return Math.round(amount / 1024);
    case 'mi':
      return Math.round(amount);
    case 'gi':
      return Math.round(amount * 1024);
    case 'ti':
      return Math.round(amount * 1024 * 1024);
    default:
      return fallback;
  }
}

function parseCpuCores(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (trimmed.endsWith('m')) {
    const milli = Number(trimmed.slice(0, -1));
    return Number.isFinite(milli) ? milli / 1000 : fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerResource(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

type ClusterResourceRecord = {
  resourceTypes?: Array<{ name?: string; resourceKey?: string }>;
  nodes?: Array<{
    name: string;
    labels?: Record<string, string>;
    allocatable?: Record<string, string>;
    allocated?: Record<string, string>;
    available?: Record<string, string>;
  }>;
};

function toTemplateSpec(raw: ForgeTemplateRecord): Template['spec'] {
  const workloadConfig =
    raw.workloadConfig && typeof raw.workloadConfig === 'object' ? raw.workloadConfig : raw.workload_config;
  const resourceConfig =
    raw.resourceConfig && typeof raw.resourceConfig === 'object' ? raw.resourceConfig : raw.resource_config;
  const env = toStringRecord(raw.envVars ?? raw.env_vars);
  const envSecretRefs = toStringArray(raw.envSecretRefs ?? raw.env_secret_refs);
  const tools = toStringArray((workloadConfig as Record<string, unknown> | undefined)?.tools);
  const ttlSec = Number((workloadConfig as Record<string, unknown> | undefined)?.ttlSec ?? 3600);
  const idleTimeoutSec = Number(
    (workloadConfig as Record<string, unknown> | undefined)?.idleTimeoutSec ?? 600,
  );
  const imageValue = (workloadConfig as Record<string, unknown> | undefined)?.image;
  const imageRef = typeof imageValue === 'string' && imageValue.length > 0 ? imageValue : 'ghcr.io/niuulabs/skuld:latest';
  const imageTagIndex = imageRef.lastIndexOf(':');
  const image = imageTagIndex > imageRef.lastIndexOf('/') ? imageRef.slice(0, imageTagIndex) : imageRef;
  const tag = imageTagIndex > imageRef.lastIndexOf('/') ? imageRef.slice(imageTagIndex + 1) : 'latest';

  const mounts = Array.isArray(raw.repos)
    ? raw.repos
        .map((repo, index) => {
          if (!repo || typeof repo !== 'object') return null;
          const url = typeof repo.url === 'string' ? repo.url : null;
          if (!url) return null;
          const branch = typeof repo.branch === 'string' ? repo.branch : 'main';
          const name =
            typeof repo.name === 'string'
              ? repo.name
              : typeof repo.repo === 'string'
                ? repo.repo
                : `repo-${index + 1}`;
          const mountPath =
            typeof repo.path === 'string' ? repo.path : `/workspace/${name.replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
          return {
            name,
            mountPath,
            source: { kind: 'git' as const, repo: url, branch },
            readOnly: false,
          };
        })
        .filter((mount): mount is Template['spec']['mounts'][number] => mount !== null)
    : [];

  const resourceMap = (resourceConfig as Record<string, unknown> | undefined) ?? {};
  const mcpServers = Array.isArray(raw.mcpServers ?? raw.mcp_servers)
    ? (raw.mcpServers ?? raw.mcp_servers)!.map((server, index) => {
        const record = server && typeof server === 'object' ? (server as Record<string, unknown>) : {};
        const transport = typeof record.transport === 'string' ? record.transport : 'stdio';
        const connectionString =
          typeof record.connectionString === 'string'
            ? record.connectionString
            : typeof record.command === 'string'
              ? record.command
              : typeof record.url === 'string'
                ? record.url
                : '';
        return {
          name: typeof record.name === 'string' ? record.name : `server-${index + 1}`,
          transport,
          connectionString,
          tools: toStringArray(record.tools),
        };
      })
    : [];

  return {
    image,
    tag,
    mounts,
    env,
    envSecretRefs,
    tools,
    mcpServers,
    resources: {
      cpuRequest: String(resourceMap.cpuRequest ?? resourceMap.cpu_request ?? resourceMap.cpu ?? '1'),
      cpuLimit: String(resourceMap.cpuLimit ?? resourceMap.cpu_limit ?? resourceMap.cpu ?? '2'),
      memRequestMi: parseMemoryToMi(
        resourceMap.memRequestMi ?? resourceMap.memoryRequestMi ?? resourceMap.memory_request ?? resourceMap.memory,
        1024,
      ),
      memLimitMi: parseMemoryToMi(
        resourceMap.memLimitMi ?? resourceMap.memoryLimitMi ?? resourceMap.memory_limit ?? resourceMap.memory,
        2048,
      ),
      gpuCount: Number(resourceMap.gpuCount ?? resourceMap.gpu ?? 0),
    },
    ttlSec: Number.isFinite(ttlSec) ? ttlSec : 3600,
    idleTimeoutSec: Number.isFinite(idleTimeoutSec) ? idleTimeoutSec : 600,
    clusterAffinity: toStringArray(
      (workloadConfig as Record<string, unknown> | undefined)?.clusterAffinity ??
        (workloadConfig as Record<string, unknown> | undefined)?.cluster_affinity,
    ),
    tolerations: toStringArray((workloadConfig as Record<string, unknown> | undefined)?.tolerations),
  };
}

function toDomainTemplate(raw: ForgeTemplateRecord): Template {
  return {
    id: raw.name,
    name: raw.name,
    description: raw.description || undefined,
    version: 1,
    spec: toTemplateSpec(raw),
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    updatedAt: raw.updatedAt ?? new Date(0).toISOString(),
  };
}

function buildVolundrTemplateStore(volundr: IVolundrService): ITemplateStore {
  return {
    async getTemplate(id: string) {
      const template = (await volundr.getTemplate(id)) as ForgeTemplateRecord | null;
      return template ? toDomainTemplate(template) : null;
    },
    async listTemplates() {
      return ((await volundr.getTemplates()) as ForgeTemplateRecord[]).map(toDomainTemplate);
    },
    async createTemplate() {
      throw new Error('Template creation is not yet supported through the live forge template adapter.');
    },
    async updateTemplate() {
      throw new Error('Template updates are not yet supported through the live forge template adapter.');
    },
    async deleteTemplate() {
      throw new Error('Template deletion is not yet supported through the live forge template adapter.');
    },
  };
}

function toPodStatus(session: VolundrSession): Cluster['pods'][number]['status'] {
  switch (session.status) {
    case 'created':
    case 'starting':
    case 'provisioning':
      return 'pending';
    case 'running':
      return session.activityState === 'idle' ? 'idle' : 'running';
    case 'error':
      return 'failed';
    default:
      return 'succeeded';
  }
}

function buildVolundrClusterAdapter(volundr: IVolundrService): IClusterAdapter {
  return {
    async getClusters() {
      const [resources, sessions] = await Promise.all([
        volundr.getClusterResources().catch(() => ({ resourceTypes: [], nodes: [] } as ClusterResourceRecord)),
        volundr.getSessions().catch(() => [] as VolundrSession[]),
      ]);

      const nodes = (resources.nodes ?? []).map((node, index) => ({
        id: node.name || `node-${index + 1}`,
        status: 'ready' as const,
        role:
          node.labels?.['node-role.kubernetes.io/control-plane'] != null ||
          node.labels?.['node-role.kubernetes.io/master'] != null
            ? 'control-plane'
            : 'worker',
        allocatable: node.allocatable ?? {},
        allocated: node.allocated ?? {},
        available: node.available ?? {},
        labels: node.labels ?? {},
      }));

      if (nodes.length === 0 && sessions.length === 0) return [];

      const capacity = nodes.reduce(
        (acc, node) => ({
          cpu: acc.cpu + parseCpuCores(node.allocatable.cpu, 0),
          memMi: acc.memMi + parseMemoryToMi(node.allocatable.memory, 0),
          gpu: acc.gpu + parseIntegerResource(node.allocatable['nvidia.com/gpu'], 0),
        }),
        { cpu: 0, memMi: 0, gpu: 0 },
      );
      const used = nodes.reduce(
        (acc, node) => ({
          cpu: acc.cpu + parseCpuCores(node.allocated.cpu, 0),
          memMi: acc.memMi + parseMemoryToMi(node.allocated.memory, 0),
          gpu: acc.gpu + parseIntegerResource(node.allocated['nvidia.com/gpu'], 0),
        }),
        { cpu: 0, memMi: 0, gpu: 0 },
      );

      const sampleLabels = nodes[0]?.labels ?? {};
      const region =
        sampleLabels['topology.kubernetes.io/region'] ??
        sampleLabels['failure-domain.beta.kubernetes.io/region'] ??
        'shared';
      const cluster: Cluster = {
        id: 'shared',
        realm: 'shared',
        name: capacity.gpu > 0 ? 'Shared GPU Forge' : 'Shared Forge',
        kind: capacity.gpu > 0 ? 'gpu' : 'primary',
        status: nodes.length > 0 ? 'healthy' : 'warning',
        region,
        capacity,
        used,
        disk: {
          usedGi: 0,
          totalGi: 0,
          systemGi: 0,
          podsGi: 0,
          logsGi: 0,
        },
        nodes: nodes.map((node) => ({
          id: node.id,
          status: node.status,
          role: node.role,
        })),
        pods: sessions.map((session) => ({
          name: session.podName ?? session.name,
          status: toPodStatus(session),
          startedAt: toIsoFromEpochMs(session.lastActive) ?? new Date(0).toISOString(),
          cpuUsed: 0,
          cpuLimit: 0,
          memUsedMi: 0,
          memLimitMi: 0,
          restarts: 0,
        })),
        runningSessions: sessions.filter((session) => session.status === 'running').length,
        queuedProvisions: sessions.filter(
          (session) => session.status === 'created' || session.status === 'starting' || session.status === 'provisioning',
        ).length,
      };

      return [cluster];
    },
    async getCluster(id: string) {
      const clusters = await this.getClusters();
      return clusters.find((cluster) => cluster.id === id) ?? null;
    },
  };
}

export function buildServices(config: NiuuConfig): ServicesMap {
  const tyrSvc = config.services['tyr'];
  const mimirSvc = config.services['mimir'];
  const volundrSvc = config.services['volundr'];
  const volundrPtySvc = config.services['volundr.pty'];
  const volundrMetricsSvc = config.services['volundr.metrics'];
  const obsRegistrySvc = config.services['observatory.registry'];
  const obsTopologySvc = config.services['observatory.topology'];
  const obsEventsSvc = config.services['observatory.events'];

  // ── Ravn: all five sub-services share one HTTP base URL when configured ──
  const ravnPersonaBase = resolveDirectServiceBase(config, 'ravn.personas', 'ravn');
  const ravnRavenBase = resolveDirectServiceBase(config, 'ravn.ravens', 'ravn');
  const ravnSessionBase = resolveDirectServiceBase(config, 'ravn.sessions', 'ravn');
  const ravnTriggerBase = resolveDirectServiceBase(config, 'ravn.triggers', 'ravn');
  const ravnBudgetBase = resolveDirectServiceBase(config, 'ravn.budget', 'ravn');
  const ravnPersonas = ravnPersonaBase
    ? buildRavnPersonaAdapter(createApiClient(ravnPersonaBase))
    : createMockPersonaStore();
  const ravnRavens = ravnRavenBase
    ? buildRavnRavenAdapter(createApiClient(ravnRavenBase))
    : createMockRavenStream();
  const ravnSessions = ravnSessionBase
    ? buildRavnSessionAdapter(createApiClient(ravnSessionBase))
    : createMockSessionStream();
  const ravnTriggers = ravnTriggerBase
    ? buildRavnTriggerAdapter(createApiClient(ravnTriggerBase))
    : createMockTriggerStore();
  const ravnBudget = ravnBudgetBase
    ? buildRavnBudgetAdapter(createApiClient(ravnBudgetBase))
    : createMockBudgetStream();

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
  const clusterAdapter = hasHttpBackend(volundrSvc)
    ? buildVolundrClusterAdapter(volundr)
    : createMockClusterAdapter();
  const templateStore = hasHttpBackend(volundrSvc)
    ? buildVolundrTemplateStore(volundr)
    : createMockTemplateStore();

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
  const featureCatalogService = buildSharedFeatureCatalogService(config);
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
    features: featureCatalogService,
    identity: identityService,
    filesystem: createMockFileSystemPort(),
    // NIU-678 pages (ClustersPage, TemplatesPage, HistoryPage)
    'volundr.clusters': clusterAdapter,
    'volundr.templates': templateStore,
    'volundr.sessions': sessionStore,
    // VolundrPage overview hooks (useVolundrClusters, useSessionStore)
    clusterAdapter,
    sessionStore,
    'observatory.registry': observatoryRegistry,
    'observatory.topology': observatoryTopology,
    'observatory.events': observatoryEvents,
  };
}
