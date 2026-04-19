/**
 * Port interface for the Völundr service.
 *
 * Lifted from web/src/modules/volundr/ports/volundr.port.ts.
 * Imports updated from @/modules/volundr/models to ../domain/models.
 * Editor-related methods dropped (Monaco is gone).
 */
import type {
  VolundrFeatures,
  VolundrSession,
  VolundrStats,
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
  SessionSource,
  AdminSettings,
  AdminStorageSettings,
  FeatureModule,
  FeatureScope,
  UserFeaturePreference,
  PersonalAccessToken,
  CreatePATResult,
} from '../domain/models';

export interface IVolundrService {
  getFeatures(): Promise<VolundrFeatures>;
  getSessions(): Promise<VolundrSession[]>;
  getSession(id: string): Promise<VolundrSession | null>;
  getActiveSessions(): Promise<VolundrSession[]>;
  getStats(): Promise<VolundrStats>;
  getModels(): Promise<Record<string, VolundrModel>>;
  getRepos(): Promise<VolundrRepo[]>;
  subscribe(callback: (sessions: VolundrSession[]) => void): () => void;
  subscribeStats(callback: (stats: VolundrStats) => void): () => void;
  getTemplates(): Promise<VolundrTemplate[]>;
  getTemplate(name: string): Promise<VolundrTemplate | null>;
  saveTemplate(template: VolundrTemplate): Promise<VolundrTemplate>;
  getPresets(): Promise<VolundrPreset[]>;
  getPreset(id: string): Promise<VolundrPreset | null>;
  savePreset(
    preset: Omit<VolundrPreset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<VolundrPreset>;
  deletePreset(id: string): Promise<void>;
  getAvailableMcpServers(): Promise<McpServerConfig[]>;
  getAvailableSecrets(): Promise<string[]>;
  createSecret(
    name: string,
    data: Record<string, string>,
  ): Promise<{ name: string; keys: string[] }>;
  getClusterResources(): Promise<ClusterResourceInfo>;
  startSession(config: {
    name: string;
    source: SessionSource;
    model: string;
    templateName?: string;
    taskType?: string;
    trackerIssue?: TrackerIssue;
    terminalRestricted?: boolean;
    workspaceId?: string;
    credentialNames?: string[];
    integrationIds?: string[];
    resourceConfig?: Record<string, string | undefined>;
    systemPrompt?: string;
    initialPrompt?: string;
  }): Promise<VolundrSession>;
  connectSession(config: { name: string; hostname: string }): Promise<VolundrSession>;
  updateSession(
    sessionId: string,
    updates: { name?: string; model?: string; branch?: string; tracker_issue_id?: string },
  ): Promise<VolundrSession>;
  stopSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string, cleanup?: string[]): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
  listArchivedSessions(): Promise<VolundrSession[]>;
  getMessages(sessionId: string): Promise<VolundrMessage[]>;
  sendMessage(sessionId: string, content: string): Promise<VolundrMessage>;
  subscribeMessages(sessionId: string, callback: (message: VolundrMessage) => void): () => void;
  getLogs(sessionId: string, limit?: number): Promise<VolundrLog[]>;
  subscribeLogs(sessionId: string, callback: (log: VolundrLog) => void): () => void;
  getCodeServerUrl(sessionId: string): Promise<string | null>;
  getChronicle(sessionId: string): Promise<SessionChronicle | null>;
  subscribeChronicle(
    sessionId: string,
    callback: (chronicle: SessionChronicle) => void,
  ): () => void;
  getPullRequests(repoUrl: string, status?: string): Promise<PullRequest[]>;
  createPullRequest(sessionId: string, title?: string, targetBranch?: string): Promise<PullRequest>;
  mergePullRequest(prNumber: number, repoUrl: string, mergeMethod?: string): Promise<MergeResult>;
  getCIStatus(prNumber: number, repoUrl: string, branch: string): Promise<CIStatusValue>;
  getSessionMcpServers(sessionId: string): Promise<McpServer[]>;
  searchTrackerIssues(query: string, projectId?: string): Promise<TrackerIssue[]>;
  getProjectRepoMappings(): Promise<ProjectRepoMapping[]>;
  updateTrackerIssueStatus(issueId: string, status: TrackerIssue['status']): Promise<TrackerIssue>;
  getIdentity(): Promise<VolundrIdentity>;
  listUsers(): Promise<VolundrUser[]>;
  getTenants(): Promise<VolundrTenant[]>;
  getTenant(id: string): Promise<VolundrTenant | null>;
  createTenant(data: {
    name: string;
    tier: string;
    maxSessions: number;
    maxStorageGb: number;
  }): Promise<VolundrTenant>;
  deleteTenant(id: string): Promise<void>;
  updateTenant(
    id: string,
    data: { tier?: string; maxSessions?: number; maxStorageGb?: number },
  ): Promise<VolundrTenant>;
  getTenantMembers(tenantId: string): Promise<VolundrMember[]>;
  reprovisionUser(userId: string): Promise<VolundrProvisioningResult>;
  reprovisionTenant(tenantId: string): Promise<VolundrProvisioningResult[]>;
  getUserCredentials(): Promise<VolundrCredential[]>;
  storeUserCredential(name: string, data: Record<string, string>): Promise<void>;
  deleteUserCredential(name: string): Promise<void>;
  getTenantCredentials(): Promise<VolundrCredential[]>;
  storeTenantCredential(name: string, data: Record<string, string>): Promise<void>;
  deleteTenantCredential(name: string): Promise<void>;
  getIntegrationCatalog(): Promise<CatalogEntry[]>;
  getIntegrations(): Promise<IntegrationConnection[]>;
  createIntegration(
    connection: Omit<IntegrationConnection, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<IntegrationConnection>;
  deleteIntegration(id: string): Promise<void>;
  testIntegration(id: string): Promise<IntegrationTestResult>;
  getCredentials(type?: SecretType): Promise<StoredCredential[]>;
  getCredential(name: string): Promise<StoredCredential | null>;
  createCredential(req: CredentialCreateRequest): Promise<StoredCredential>;
  deleteCredential(name: string): Promise<void>;
  getCredentialTypes(): Promise<SecretTypeInfo[]>;
  listWorkspaces(status?: WorkspaceStatus): Promise<VolundrWorkspace[]>;
  listAllWorkspaces(status?: WorkspaceStatus): Promise<VolundrWorkspace[]>;
  restoreWorkspace(id: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  bulkDeleteWorkspaces(
    sessionIds: string[],
  ): Promise<{ deleted: number; failed: Array<{ session_id: string; error: string }> }>;
  getAdminSettings(): Promise<AdminSettings>;
  updateAdminSettings(data: { storage?: AdminStorageSettings }): Promise<AdminSettings>;
  getFeatureModules(scope?: FeatureScope): Promise<FeatureModule[]>;
  toggleFeature(key: string, enabled: boolean): Promise<FeatureModule>;
  getUserFeaturePreferences(): Promise<UserFeaturePreference[]>;
  updateUserFeaturePreferences(
    preferences: UserFeaturePreference[],
  ): Promise<UserFeaturePreference[]>;
  listTokens(): Promise<PersonalAccessToken[]>;
  createToken(name: string): Promise<CreatePATResult>;
  revokeToken(id: string): Promise<void>;
}
