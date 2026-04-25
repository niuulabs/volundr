/**
 * HTTP adapter for IVolundrService.
 *
 * Accepts any HTTP client with `get` and `post` / `delete` methods —
 * structurally compatible with `createApiClient(baseUrl)` from @niuulabs/query.
 */
import { openEventStream, type EventStreamHandle, type EventStreamOptions } from '@niuulabs/query';
import type { IVolundrService } from '../ports/IVolundrService';
import type {
  VolundrSession,
  VolundrStats,
  VolundrFeatures,
  VolundrModel,
  VolundrRepo,
  VolundrMessage,
  VolundrLog,
  SessionChronicle,
  ClusterResourceInfo,
  PullRequest,
  MergeResult,
  CIStatusValue,
  McpServer,
  McpServerConfig,
  VolundrPreset,
  VolundrTemplate,
  TrackerIssue,
  ProjectRepoMapping,
  VolundrIdentity,
  VolundrUser,
  VolundrTenant,
  VolundrCredential,
  IntegrationConnection,
  IntegrationTestResult,
  CatalogEntry,
  StoredCredential,
  CredentialCreateRequest,
  SecretType,
  SecretTypeInfo,
  VolundrWorkspace,
  WorkspaceStatus,
  VolundrMember,
  VolundrProvisioningResult,
  AdminSettings,
  AdminStorageSettings,
  FeatureModule,
  FeatureScope,
  UserFeaturePreference,
  PersonalAccessToken,
  CreatePATResult,
} from '../models/volundr.model';

/** Minimal HTTP client — structurally compatible with ApiClient from @niuulabs/query. */
export interface HttpClient {
  basePath?: string;
  get<T>(endpoint: string): Promise<T>;
  post<T>(endpoint: string, body?: unknown): Promise<T>;
  delete<T>(endpoint: string): Promise<T>;
  patch<T>(endpoint: string, body?: unknown): Promise<T>;
  put<T>(endpoint: string, body?: unknown): Promise<T>;
}

type EventStreamOpener = (url: string, options: EventStreamOptions) => EventStreamHandle;
const LIVE_POLL_MS = 2_000;

type SessionPayload = {
  id: string;
  name: string;
  source: VolundrSession['source'];
  status: VolundrSession['status'];
  model: string;
  lastActive?: number;
  last_active?: string;
  messageCount?: number;
  message_count?: number;
  tokensUsed?: number;
  tokens_used?: number;
  podName?: string;
  pod_name?: string | null;
  error?: string | null;
  origin?: VolundrSession['origin'];
  hostname?: string;
  chatEndpoint?: string | null;
  chat_endpoint?: string | null;
  codeEndpoint?: string | null;
  code_endpoint?: string | null;
  taskType?: string | null;
  task_type?: string | null;
  archivedAt?: Date | string | null;
  archived_at?: string | null;
  trackerIssue?: TrackerIssue;
  activityState?: VolundrSession['activityState'];
  activity_state?: VolundrSession['activityState'];
  ownerId?: string | null;
  owner_id?: string | null;
  tenantId?: string | null;
  tenant_id?: string | null;
};

type StatsPayload = {
  activeSessions?: number;
  active_sessions?: number;
  totalSessions?: number;
  total_sessions?: number;
  tokensToday?: number;
  tokens_today?: number;
  localTokens?: number;
  local_tokens?: number;
  cloudTokens?: number;
  cloud_tokens?: number;
  costToday?: number;
  cost_today?: number;
  sparklines?: VolundrStats['sparklines'];
};

type ConversationPayload = {
  turns: Array<{
    id: string;
    role: string;
    content: string;
    created_at?: string;
    metadata?: {
      tokens_in?: number;
      tokens_out?: number;
      latency?: number;
    };
  }>;
};

type LogPayload = {
  lines: Array<{
    timestamp?: number | string;
    time?: string;
    level?: string;
    logger?: string;
    message: string;
  }>;
};

type ChroniclePayload = {
  events: SessionChronicle['events'];
  files: SessionChronicle['files'];
  commits: SessionChronicle['commits'];
  token_burn?: number[];
  tokenBurn?: number[];
};

type ChronicleEventPayload = {
  session_id: string;
  event: SessionChronicle['events'][number];
  files: SessionChronicle['files'];
  commits: SessionChronicle['commits'];
  token_burn?: number[];
};

function toEpochMs(value?: number | string | null): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toDate(value?: Date | string | null): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function normalizeSession(session: SessionPayload): VolundrSession {
  return {
    id: session.id,
    name: session.name,
    source: session.source,
    status: session.status,
    model: session.model,
    lastActive: toEpochMs(session.lastActive ?? session.last_active),
    messageCount: session.messageCount ?? session.message_count ?? 0,
    tokensUsed: session.tokensUsed ?? session.tokens_used ?? 0,
    podName: session.podName ?? session.pod_name ?? undefined,
    error: session.error ?? undefined,
    origin: session.origin,
    hostname: session.hostname,
    chatEndpoint: session.chatEndpoint ?? session.chat_endpoint ?? undefined,
    codeEndpoint: session.codeEndpoint ?? session.code_endpoint ?? undefined,
    taskType: session.taskType ?? session.task_type ?? undefined,
    archivedAt: toDate(session.archivedAt ?? session.archived_at),
    trackerIssue: session.trackerIssue,
    activityState: session.activityState ?? session.activity_state ?? undefined,
    ownerId: session.ownerId ?? session.owner_id ?? undefined,
    tenantId: session.tenantId ?? session.tenant_id ?? undefined,
  };
}

function normalizeStats(stats: StatsPayload): VolundrStats {
  return {
    activeSessions: stats.activeSessions ?? stats.active_sessions ?? 0,
    totalSessions: stats.totalSessions ?? stats.total_sessions ?? 0,
    tokensToday: stats.tokensToday ?? stats.tokens_today ?? 0,
    localTokens: stats.localTokens ?? stats.local_tokens ?? 0,
    cloudTokens: stats.cloudTokens ?? stats.cloud_tokens ?? 0,
    costToday: stats.costToday ?? stats.cost_today ?? 0,
    sparklines: stats.sparklines,
  };
}

function normalizeMessageRole(role: string): VolundrMessage['role'] {
  return role === 'user' ? 'user' : 'assistant';
}

function normalizeMessages(
  sessionId: string,
  payload: ConversationPayload,
): VolundrMessage[] {
  return payload.turns.map((turn) => ({
    id: turn.id,
    sessionId,
    role: normalizeMessageRole(turn.role),
    content: turn.content,
    timestamp: toEpochMs(turn.created_at),
    tokensIn: turn.metadata?.tokens_in,
    tokensOut: turn.metadata?.tokens_out,
    latency: turn.metadata?.latency,
  }));
}

function normalizeLogLevel(level?: string): VolundrLog['level'] {
  const normalized = (level ?? 'INFO').toLowerCase();
  if (normalized === 'warning') return 'warn';
  if (normalized === 'debug' || normalized === 'info' || normalized === 'warn') return normalized;
  return 'error';
}

function makeLogFingerprint(log: Pick<VolundrLog, 'timestamp' | 'level' | 'source' | 'message'>): string {
  return `${log.timestamp}:${log.level}:${log.source}:${log.message}`;
}

function normalizeLogs(sessionId: string, payload: LogPayload): VolundrLog[] {
  const seenCounts = new Map<string, number>();
  return payload.lines.map((line) => {
    const normalized: Omit<VolundrLog, 'id'> = {
      sessionId,
      timestamp: toEpochMs(line.timestamp ?? line.time),
      level: normalizeLogLevel(line.level),
      source: line.logger ?? 'broker',
      message: line.message,
    };
    const fingerprint = makeLogFingerprint(normalized);
    const occurrence = (seenCounts.get(fingerprint) ?? 0) + 1;
    seenCounts.set(fingerprint, occurrence);
    return {
      id: `${sessionId}-log-${fingerprint}:${occurrence}`,
      ...normalized,
    };
  });
}

function normalizeChronicle(payload: ChroniclePayload): SessionChronicle {
  return {
    events: payload.events,
    files: payload.files,
    commits: payload.commits,
    tokenBurn: payload.tokenBurn ?? payload.token_burn ?? [],
  };
}

type SubscriberSet<T> = Set<(item: T) => void>;

interface PollingConnection<T> {
  subscribers: SubscriberSet<T>;
  knownKeys: string[];
  knownKeySet: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
  loading: boolean;
  hydrated: boolean;
}

function rememberKnownKey<T>(
  connection: PollingConnection<T>,
  key: string,
  maxEntries = 500,
): void {
  if (connection.knownKeySet.has(key)) return;
  connection.knownKeySet.add(key);
  connection.knownKeys.push(key);
  if (connection.knownKeys.length <= maxEntries) return;
  const oldest = connection.knownKeys.shift();
  if (oldest) connection.knownKeySet.delete(oldest);
}

function makeLogKey(log: VolundrLog): string {
  return log.id;
}

function applyChronicleEvent(
  existing: SessionChronicle | undefined,
  payload: ChronicleEventPayload,
): SessionChronicle {
  const nextEvent = payload.event;
  const existingEvents = existing?.events ?? [];
  const hasEvent = existingEvents.some(
    (event) =>
      event.t === nextEvent.t &&
      event.type === nextEvent.type &&
      event.label === nextEvent.label,
  );

  return {
    events: hasEvent ? existingEvents : [...existingEvents, nextEvent],
    files: payload.files,
    commits: payload.commits,
    tokenBurn: payload.token_burn ?? [],
  };
}

function inferEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  if ('active_sessions' in payload || 'activeSessions' in payload) return 'stats_updated';
  if ('id' in payload && ('status' in payload || 'name' in payload)) return 'session_updated';
  if ('id' in payload) return 'session_deleted';
  return null;
}

export function buildVolundrHttpAdapter(
  client: HttpClient,
  openStream: EventStreamOpener = openEventStream,
): IVolundrService {
  const sessionSubscribers = new Set<(sessions: VolundrSession[]) => void>();
  const statsSubscribers = new Set<(stats: VolundrStats) => void>();
  const chronicleSubscribers = new Map<string, Set<(chronicle: SessionChronicle) => void>>();
  const messageSubscribers = new Map<string, PollingConnection<VolundrMessage>>();
  const logSubscribers = new Map<string, PollingConnection<VolundrLog>>();
  const sessionCache = new Map<string, VolundrSession>();
  const chronicleCache = new Map<string, SessionChronicle>();
  let statsCache: VolundrStats | null = null;
  let streamHandle: EventStreamHandle | null = null;
  let sessionsHydration: Promise<void> | null = null;
  let statsHydration: Promise<void> | null = null;
  const chronicleHydration = new Map<string, Promise<void>>();

  function publishSessions(): void {
    const snapshot = Array.from(sessionCache.values());
    for (const subscriber of sessionSubscribers) subscriber(snapshot);
  }

  function publishStats(): void {
    if (!statsCache) return;
    for (const subscriber of statsSubscribers) subscriber(statsCache);
  }

  function publishChronicle(sessionId: string): void {
    const chronicle = chronicleCache.get(sessionId);
    if (!chronicle) return;
    for (const subscriber of chronicleSubscribers.get(sessionId) ?? []) subscriber(chronicle);
  }

  function updateSessionCache(sessions: VolundrSession[]): void {
    sessionCache.clear();
    for (const session of sessions) sessionCache.set(session.id, session);
  }

  async function loadSessions(endpoint: string): Promise<VolundrSession[]> {
    const sessions = (await client.get<SessionPayload[]>(endpoint)).map(normalizeSession);
    updateSessionCache(sessions);
    publishSessions();
    return sessions;
  }

  async function loadSession(id: string): Promise<VolundrSession | null> {
    const session = await client.get<SessionPayload | null>(`/sessions/${id}`);
    if (!session) {
      sessionCache.delete(id);
      publishSessions();
      return null;
    }
    const normalized = normalizeSession(session);
    sessionCache.set(normalized.id, normalized);
    publishSessions();
    return normalized;
  }

  async function loadStats(): Promise<VolundrStats> {
    statsCache = normalizeStats(await client.get<StatsPayload>('/stats'));
    publishStats();
    return statsCache;
  }

  async function loadChronicle(sessionId: string): Promise<SessionChronicle | null> {
    const payload = await client.get<ChroniclePayload | null>(`/chronicles/${sessionId}/timeline`);
    if (!payload) {
      chronicleCache.delete(sessionId);
      return null;
    }
    const chronicle = normalizeChronicle(payload);
    chronicleCache.set(sessionId, chronicle);
    publishChronicle(sessionId);
    return chronicle;
  }

  async function loadMessages(sessionId: string): Promise<VolundrMessage[]> {
    return client
      .get<ConversationPayload>(`/sessions/${sessionId}/conversation`)
      .then((payload) => normalizeMessages(sessionId, payload));
  }

  async function loadLogs(sessionId: string, limit?: number): Promise<VolundrLog[]> {
    return client
      .get<LogPayload>(`/sessions/${sessionId}/logs${limit ? `?lines=${limit}` : ''}`)
      .then((payload) => normalizeLogs(sessionId, payload));
  }

  function ensurePollingConnection<T>(
    registry: Map<string, PollingConnection<T>>,
    sessionId: string,
    fetchItems: () => Promise<T[]>,
    keyOf: (item: T) => string,
  ): PollingConnection<T> {
    const existing = registry.get(sessionId);
    if (existing) return existing;

    const connection: PollingConnection<T> = {
      subscribers: new Set(),
      knownKeys: [],
      knownKeySet: new Set(),
      timer: null,
      loading: false,
      hydrated: false,
    };

    const poll = async (): Promise<void> => {
      if (connection.loading) return;
      connection.loading = true;
      try {
        const items = await fetchItems();
        if (!connection.hydrated) {
          for (const item of items) rememberKnownKey(connection, keyOf(item));
          connection.hydrated = true;
          return;
        }
        for (const item of items) {
          const key = keyOf(item);
          if (connection.knownKeySet.has(key)) continue;
          rememberKnownKey(connection, key);
          for (const subscriber of connection.subscribers) subscriber(item);
        }
      } catch {
        // Best-effort live polling on top of stable snapshot endpoints.
      } finally {
        connection.loading = false;
      }
    };

    void poll();
    connection.timer = setInterval(() => {
      void poll();
    }, LIVE_POLL_MS);
    registry.set(sessionId, connection);
    return connection;
  }

  function maybeClosePollingConnection<T>(
    registry: Map<string, PollingConnection<T>>,
    sessionId: string,
  ): void {
    const connection = registry.get(sessionId);
    if (!connection || connection.subscribers.size > 0) return;
    if (connection.timer) clearInterval(connection.timer);
    registry.delete(sessionId);
  }

  function ensureStream(): void {
    if (streamHandle || !client.basePath) return;
    streamHandle = openStream(`${client.basePath}/sessions/stream`, {
      onMessage: () => {},
      onEvent: ({ event, data }) => {
        try {
          const payload = JSON.parse(data) as SessionPayload | StatsPayload | { id?: string };
          const eventType = event ?? inferEventType(payload);
          if (eventType === 'session_created' || eventType === 'session_updated') {
            const session = normalizeSession(payload as SessionPayload);
            sessionCache.set(session.id, session);
            publishSessions();
            return;
          }
          if (eventType === 'session_deleted') {
            const sessionId =
              typeof payload === 'object' && payload && 'id' in payload ? payload.id : null;
            if (typeof sessionId === 'string') {
              sessionCache.delete(sessionId);
              publishSessions();
            }
            return;
          }
          if (eventType === 'stats_updated') {
            statsCache = normalizeStats(payload as StatsPayload);
            publishStats();
            return;
          }
          if (eventType === 'chronicle_event') {
            const chronicleEvent = payload as ChronicleEventPayload;
            const sessionId = chronicleEvent.session_id;
            if (typeof sessionId !== 'string') return;
            chronicleCache.set(
              sessionId,
              applyChronicleEvent(chronicleCache.get(sessionId), chronicleEvent),
            );
            publishChronicle(sessionId);
          }
        } catch {
          // Drop malformed frames.
        }
      },
    });
  }

  function maybeCloseStream(): void {
    const hasChronicleSubscribers = Array.from(chronicleSubscribers.values()).some(
      (subscribers) => subscribers.size > 0,
    );
    if (sessionSubscribers.size > 0 || statsSubscribers.size > 0 || hasChronicleSubscribers) return;
    streamHandle?.close();
    streamHandle = null;
  }

  function hydrateSessions(): void {
    if (sessionCache.size > 0 || sessionsHydration) return;
    sessionsHydration = loadSessions('/sessions')
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        sessionsHydration = null;
      });
  }

  function hydrateStats(): void {
    if (statsCache || statsHydration) return;
    statsHydration = loadStats()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        statsHydration = null;
      });
  }

  function hydrateChronicle(sessionId: string): void {
    if (chronicleCache.has(sessionId) || chronicleHydration.has(sessionId)) return;
    chronicleHydration.set(
      sessionId,
      loadChronicle(sessionId)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          chronicleHydration.delete(sessionId);
        }),
    );
  }

  return {
    getFeatures: () => client.get<VolundrFeatures>('/features'),
    getSessions: () => loadSessions('/sessions'),
    getSession: (id) => loadSession(id),
    getActiveSessions: () => loadSessions('/sessions?active=true'),
    getStats: () => loadStats(),
    getModels: () => client.get<Record<string, VolundrModel>>('/models'),
    getRepos: () => client.get<VolundrRepo[]>('/repos'),

    subscribe: (callback) => {
      sessionSubscribers.add(callback);
      ensureStream();
      if (sessionCache.size > 0) {
        callback(Array.from(sessionCache.values()));
      } else {
        hydrateSessions();
      }
      return () => {
        sessionSubscribers.delete(callback);
        maybeCloseStream();
      };
    },
    subscribeStats: (callback) => {
      statsSubscribers.add(callback);
      ensureStream();
      if (statsCache) {
        callback(statsCache);
      } else {
        hydrateStats();
      }
      return () => {
        statsSubscribers.delete(callback);
        maybeCloseStream();
      };
    },

    getTemplates: () => client.get<VolundrTemplate[]>('/templates'),
    getTemplate: (name) => client.get<VolundrTemplate | null>(`/templates/${name}`),
    saveTemplate: (template) => client.post<VolundrTemplate>('/templates', template),

    getPresets: () => client.get<VolundrPreset[]>('/presets'),
    getPreset: (id) => client.get<VolundrPreset | null>(`/presets/${id}`),
    savePreset: (preset) =>
      preset.id
        ? client.put<VolundrPreset>(`/presets/${preset.id}`, preset)
        : client.post<VolundrPreset>('/presets', preset),
    deletePreset: (id) => client.delete<void>(`/presets/${id}`),

    getAvailableMcpServers: () => client.get<McpServerConfig[]>('/mcp-servers'),
    getAvailableSecrets: () => client.get<string[]>('/secrets'),
    createSecret: (name, data) =>
      client.post<{ name: string; keys: string[] }>('/secrets', { name, data }),
    getClusterResources: () => client.get<ClusterResourceInfo>('/cluster/resources'),

    startSession: async (config) => normalizeSession(await client.post<SessionPayload>('/sessions', config)),
    connectSession: async (config) =>
      normalizeSession(await client.post<SessionPayload>('/sessions/connect', config)),
    updateSession: (sessionId, updates) =>
      client.patch<SessionPayload>(`/sessions/${sessionId}`, updates).then(normalizeSession),
    stopSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/stop`),
    resumeSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/resume`),
    deleteSession: (sessionId, cleanup) =>
      client.delete<void>(
        `/sessions/${sessionId}${cleanup ? `?cleanup=${cleanup.join(',')}` : ''}`,
      ),
    archiveSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/archive`),
    restoreSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/restore`),
    listArchivedSessions: () =>
      client.get<SessionPayload[]>('/sessions/archived').then((sessions) => sessions.map(normalizeSession)),

    getMessages: (sessionId) =>
      loadMessages(sessionId),
    sendMessage: (sessionId, content) =>
      client.post<VolundrMessage>(`/sessions/${sessionId}/messages`, { content }),
    subscribeMessages: (sessionId, callback) => {
      const connection = ensurePollingConnection(
        messageSubscribers,
        sessionId,
        () => loadMessages(sessionId),
        (message) => message.id,
      );
      connection.subscribers.add(callback);
      return () => {
        connection.subscribers.delete(callback);
        maybeClosePollingConnection(messageSubscribers, sessionId);
      };
    },

    getLogs: (sessionId, limit) =>
      loadLogs(sessionId, limit),
    subscribeLogs: (sessionId, callback) => {
      const connection = ensurePollingConnection(
        logSubscribers,
        sessionId,
        () => loadLogs(sessionId),
        makeLogKey,
      );
      connection.subscribers.add(callback);
      return () => {
        connection.subscribers.delete(callback);
        maybeClosePollingConnection(logSubscribers, sessionId);
      };
    },

    getCodeServerUrl: (sessionId) =>
      client.get<string | null>(`/sessions/${sessionId}/code-server-url`),

    getChronicle: (sessionId) => loadChronicle(sessionId),
    subscribeChronicle: (sessionId, callback) => {
      const subscribers = chronicleSubscribers.get(sessionId) ?? new Set();
      subscribers.add(callback);
      chronicleSubscribers.set(sessionId, subscribers);
      ensureStream();
      const chronicle = chronicleCache.get(sessionId);
      if (chronicle) {
        callback(chronicle);
      } else {
        hydrateChronicle(sessionId);
      }
      return () => {
        const active = chronicleSubscribers.get(sessionId);
        if (!active) return;
        active.delete(callback);
        if (active.size === 0) chronicleSubscribers.delete(sessionId);
        maybeCloseStream();
      };
    },

    getPullRequests: (repoUrl, status) =>
      client.get<PullRequest[]>(
        `/repos/prs?url=${encodeURIComponent(repoUrl)}${status ? `&status=${status}` : ''}`,
      ),
    createPullRequest: (sessionId, title, targetBranch) =>
      client.post<PullRequest>(`/sessions/${sessionId}/pr`, { title, targetBranch }),
    mergePullRequest: (prNumber, repoUrl, mergeMethod) =>
      client.post<MergeResult>(`/repos/prs/${prNumber}/merge`, { repoUrl, mergeMethod }),
    getCIStatus: (prNumber, repoUrl, branch) =>
      client.get<CIStatusValue>(
        `/repos/prs/${prNumber}/ci?url=${encodeURIComponent(repoUrl)}&branch=${encodeURIComponent(branch)}`,
      ),

    getSessionMcpServers: (sessionId) =>
      client.get<McpServer[]>(`/sessions/${sessionId}/mcp-servers`),

    searchTrackerIssues: (query, projectId) =>
      client.get<TrackerIssue[]>(
        `/tracker/issues?q=${encodeURIComponent(query)}${projectId ? `&projectId=${projectId}` : ''}`,
      ),
    getProjectRepoMappings: () => client.get<ProjectRepoMapping[]>('/tracker/repo-mappings'),
    updateTrackerIssueStatus: (issueId, status) =>
      client.patch<TrackerIssue>(`/tracker/issues/${issueId}`, { status }),

    getIdentity: () => client.get<VolundrIdentity>('/identity'),
    listUsers: () => client.get<VolundrUser[]>('/admin/users'),

    getTenants: () => client.get<VolundrTenant[]>('/tenants'),
    getTenant: (id) => client.get<VolundrTenant | null>(`/tenants/${id}`),
    createTenant: (data) => client.post<VolundrTenant>('/tenants', data),
    deleteTenant: (id) => client.delete<void>(`/tenants/${id}`),
    updateTenant: (id, data) => client.patch<VolundrTenant>(`/tenants/${id}`, data),
    getTenantMembers: (tenantId) => client.get<VolundrMember[]>(`/tenants/${tenantId}/members`),
    reprovisionUser: (userId) =>
      client.post<VolundrProvisioningResult>(`/admin/users/${userId}/reprovision`),
    reprovisionTenant: (tenantId) =>
      client.post<VolundrProvisioningResult[]>(`/tenants/${tenantId}/reprovision`),

    getUserCredentials: () => client.get<VolundrCredential[]>('/credentials/user'),
    storeUserCredential: (name, data) => client.post<void>('/credentials/user', { name, data }),
    deleteUserCredential: (name) => client.delete<void>(`/credentials/user/${name}`),
    getTenantCredentials: () => client.get<VolundrCredential[]>('/credentials/tenant'),
    storeTenantCredential: (name, data) => client.post<void>('/credentials/tenant', { name, data }),
    deleteTenantCredential: (name) => client.delete<void>(`/credentials/tenant/${name}`),

    getIntegrationCatalog: () => client.get<CatalogEntry[]>('/integrations/catalog'),
    getIntegrations: () => client.get<IntegrationConnection[]>('/integrations'),
    createIntegration: (connection) =>
      client.post<IntegrationConnection>('/integrations', connection),
    deleteIntegration: (id) => client.delete<void>(`/integrations/${id}`),
    testIntegration: (id) => client.post<IntegrationTestResult>(`/integrations/${id}/test`),

    getCredentials: (type?: SecretType) =>
      client.get<StoredCredential[]>(`/secrets/store${type ? `?type=${type}` : ''}`),
    getCredential: (name) => client.get<StoredCredential | null>(`/secrets/store/${name}`),
    createCredential: (req: CredentialCreateRequest) =>
      client.post<StoredCredential>('/secrets/store', req),
    deleteCredential: (name) => client.delete<void>(`/secrets/store/${name}`),
    getCredentialTypes: () => client.get<SecretTypeInfo[]>('/secrets/types'),

    listWorkspaces: (status?: WorkspaceStatus) =>
      client.get<VolundrWorkspace[]>(`/workspaces${status ? `?status=${status}` : ''}`),
    listAllWorkspaces: (status?: WorkspaceStatus) =>
      client.get<VolundrWorkspace[]>(`/admin/workspaces${status ? `?status=${status}` : ''}`),
    restoreWorkspace: (id) => client.post<void>(`/workspaces/${id}/restore`),
    deleteWorkspace: (id) => client.delete<void>(`/workspaces/${id}`),
    bulkDeleteWorkspaces: (sessionIds) =>
      client.post<{ deleted: number; failed: Array<{ session_id: string; error: string }> }>(
        '/workspaces/bulk-delete',
        { sessionIds },
      ),

    getAdminSettings: () => client.get<AdminSettings>('/admin/settings'),
    updateAdminSettings: (data: { storage?: AdminStorageSettings }) =>
      client.patch<AdminSettings>('/admin/settings', data),

    getFeatureModules: (scope?: FeatureScope) =>
      client.get<FeatureModule[]>(`/features/modules${scope ? `?scope=${scope}` : ''}`),
    toggleFeature: (key, enabled) =>
      client.post<FeatureModule>(`/features/modules/${key}/toggle`, { enabled }),
    getUserFeaturePreferences: () => client.get<UserFeaturePreference[]>('/features/preferences'),
    updateUserFeaturePreferences: (preferences) =>
      client.put<UserFeaturePreference[]>('/features/preferences', preferences),

    listTokens: () => client.get<PersonalAccessToken[]>('/tokens'),
    createToken: (name) => client.post<CreatePATResult>('/tokens', { name }),
    revokeToken: (id) => client.delete<void>(`/tokens/${id}`),
  };
}
