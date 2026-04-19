/**
 * HTTP adapter for IVolundrService.
 *
 * Accepts any HTTP client with `get` and `post` / `delete` methods —
 * structurally compatible with `createApiClient(baseUrl)` from @niuulabs/query.
 */
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
  TrackerIssue as TrackerIssueType,
} from '../models/volundr.model';

/** Minimal HTTP client — structurally compatible with ApiClient from @niuulabs/query. */
export interface HttpClient {
  get<T>(endpoint: string): Promise<T>;
  post<T>(endpoint: string, body?: unknown): Promise<T>;
  delete<T>(endpoint: string): Promise<T>;
  patch<T>(endpoint: string, body?: unknown): Promise<T>;
  put<T>(endpoint: string, body?: unknown): Promise<T>;
}

export function buildVolundrHttpAdapter(client: HttpClient): IVolundrService {
  return {
    getFeatures: () => client.get<VolundrFeatures>('/features'),
    getSessions: () => client.get<VolundrSession[]>('/sessions'),
    getSession: (id) => client.get<VolundrSession | null>(`/sessions/${id}`),
    getActiveSessions: () => client.get<VolundrSession[]>('/sessions?active=true'),
    getStats: () => client.get<VolundrStats>('/stats'),
    getModels: () => client.get<Record<string, VolundrModel>>('/models'),
    getRepos: () => client.get<VolundrRepo[]>('/repos'),

    subscribe: (_callback) => () => {},
    subscribeStats: (_callback) => () => {},

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
    createSecret: (name, data) => client.post<{ name: string; keys: string[] }>('/secrets', { name, data }),
    getClusterResources: () => client.get<ClusterResourceInfo>('/cluster/resources'),

    startSession: (config) => client.post<VolundrSession>('/sessions', config),
    connectSession: (config) => client.post<VolundrSession>('/sessions/connect', config),
    updateSession: (sessionId, updates) =>
      client.patch<VolundrSession>(`/sessions/${sessionId}`, updates),
    stopSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/stop`),
    resumeSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/resume`),
    deleteSession: (sessionId, cleanup) =>
      client.delete<void>(`/sessions/${sessionId}${cleanup ? `?cleanup=${cleanup.join(',')}` : ''}`),
    archiveSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/archive`),
    restoreSession: (sessionId) => client.post<void>(`/sessions/${sessionId}/restore`),
    listArchivedSessions: () => client.get<VolundrSession[]>('/sessions/archived'),

    getMessages: (sessionId) => client.get<VolundrMessage[]>(`/sessions/${sessionId}/messages`),
    sendMessage: (sessionId, content) =>
      client.post<VolundrMessage>(`/sessions/${sessionId}/messages`, { content }),
    subscribeMessages: (_sessionId, _callback) => () => {},

    getLogs: (sessionId, limit) =>
      client.get<VolundrLog[]>(`/sessions/${sessionId}/logs${limit ? `?limit=${limit}` : ''}`),
    subscribeLogs: (_sessionId, _callback) => () => {},

    getCodeServerUrl: (sessionId) =>
      client.get<string | null>(`/sessions/${sessionId}/code-server-url`),

    getChronicle: (sessionId) =>
      client.get<SessionChronicle | null>(`/sessions/${sessionId}/chronicle`),
    subscribeChronicle: (_sessionId, _callback) => () => {},

    getPullRequests: (repoUrl, status) =>
      client.get<PullRequest[]>(`/repos/prs?url=${encodeURIComponent(repoUrl)}${status ? `&status=${status}` : ''}`),
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
      client.patch<TrackerIssueType>(`/tracker/issues/${issueId}`, { status }),

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
    storeUserCredential: (name, data) =>
      client.post<void>('/credentials/user', { name, data }),
    deleteUserCredential: (name) => client.delete<void>(`/credentials/user/${name}`),
    getTenantCredentials: () => client.get<VolundrCredential[]>('/credentials/tenant'),
    storeTenantCredential: (name, data) =>
      client.post<void>('/credentials/tenant', { name, data }),
    deleteTenantCredential: (name) => client.delete<void>(`/credentials/tenant/${name}`),

    getIntegrationCatalog: () => client.get<CatalogEntry[]>('/integrations/catalog'),
    getIntegrations: () => client.get<IntegrationConnection[]>('/integrations'),
    createIntegration: (connection) => client.post<IntegrationConnection>('/integrations', connection),
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
    getUserFeaturePreferences: () =>
      client.get<UserFeaturePreference[]>('/features/preferences'),
    updateUserFeaturePreferences: (preferences) =>
      client.put<UserFeaturePreference[]>('/features/preferences', preferences),

    listTokens: () => client.get<PersonalAccessToken[]>('/tokens'),
    createToken: (name) => client.post<CreatePATResult>('/tokens', { name }),
    revokeToken: (id) => client.delete<void>(`/tokens/${id}`),
  };
}
