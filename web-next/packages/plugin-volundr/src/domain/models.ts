/**
 * Legacy model types lifted from web/src/modules/volundr/models/.
 *
 * These types serve the lifted IVolundrService port. New code should use
 * the domain types in session.ts / pod.ts / template.ts / cluster.ts / quota.ts
 * instead.
 */

// Re-export feature-catalog types from plugin-sdk.
export type {
  FeatureScope,
  FeatureModule,
  UserFeaturePreference,
} from '@niuulabs/plugin-sdk';

/* ── Session status (legacy, matches backend API) ──────────────── */

export type SessionStatus =
  | 'created'
  | 'starting'
  | 'provisioning'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'archived';

export type SessionOrigin = 'managed' | 'manual';

export type ModelTier = 'frontier' | 'balanced' | 'execution' | 'reasoning';
export type ModelProvider = 'cloud' | 'local';

/* ── Session source ─────────────────────────────────────────────── */

export interface GitSource {
  readonly type: 'git';
  readonly repo: string;
  readonly branch: string;
}

export interface MountMapping {
  readonly host_path: string;
  readonly mount_path: string;
  readonly read_only: boolean;
}

export interface LocalMountSource {
  readonly type: 'local_mount';
  readonly local_path?: string;
  readonly paths: readonly MountMapping[];
  readonly node_selector?: Readonly<Record<string, string>>;
}

export type SessionSource = GitSource | LocalMountSource;

/* ── Tracker ────────────────────────────────────────────────────── */

export type TrackerIssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'done'
  | 'cancelled';

export interface TrackerIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly status: TrackerIssueStatus;
  readonly assignee?: string;
  readonly labels?: readonly string[];
  readonly priority?: number;
  readonly url: string;
}

export interface ProjectRepoMapping {
  readonly linearProjectId: string;
  readonly linearProjectName: string;
  readonly repoUrl: string;
}

/* ── Session ────────────────────────────────────────────────────── */

export interface VolundrSession {
  readonly id: string;
  readonly name: string;
  readonly source: SessionSource;
  readonly status: SessionStatus;
  readonly model: string;
  readonly lastActive: number;
  readonly messageCount: number;
  readonly tokensUsed: number;
  readonly podName?: string;
  readonly error?: string;
  readonly origin?: SessionOrigin;
  readonly hostname?: string;
  readonly chatEndpoint?: string;
  readonly codeEndpoint?: string;
  readonly taskType?: string;
  readonly archivedAt?: Date;
  readonly trackerIssue?: TrackerIssue;
  readonly activityState?: 'active' | 'idle' | 'tool_executing' | null;
  readonly ownerId?: string;
  readonly tenantId?: string;
}

/* ── Stats ──────────────────────────────────────────────────────── */

export interface VolundrStats {
  readonly activeSessions: number;
  readonly totalSessions: number;
  readonly tokensToday: number;
  readonly localTokens: number;
  readonly cloudTokens: number;
  readonly costToday: number;
}

export interface VolundrFeatures {
  readonly localMountsEnabled: boolean;
  readonly fileManagerEnabled: boolean;
  readonly miniMode: boolean;
}

/* ── Models / repos ─────────────────────────────────────────────── */

export interface VolundrModel {
  readonly name: string;
  readonly provider: ModelProvider;
  readonly tier: ModelTier;
  readonly color: string;
  readonly cost?: string;
  readonly vram?: string;
}

export type RepoProvider = 'github' | 'gitlab' | 'bitbucket';

export interface VolundrRepo {
  readonly provider: RepoProvider;
  readonly org: string;
  readonly name: string;
  readonly cloneUrl: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly branches: readonly string[];
}

/* ── Messages / logs ────────────────────────────────────────────── */

export type MessageRole = 'user' | 'assistant';

export interface VolundrMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly timestamp: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly latency?: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface VolundrLog {
  readonly id: string;
  readonly sessionId: string;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
}

/* ── Chronicle ──────────────────────────────────────────────────── */

export type ChronicleEventType = 'message' | 'file' | 'git' | 'terminal' | 'error' | 'session';

export interface ChronicleEvent {
  readonly t: number;
  readonly type: ChronicleEventType;
  readonly label: string;
  readonly tokens?: number;
  readonly action?: string;
  readonly ins?: number;
  readonly del?: number;
  readonly hash?: string;
  readonly exit?: number;
}

export interface SessionFile {
  readonly path: string;
  readonly status: 'new' | 'mod' | 'del';
  readonly ins: number;
  readonly del: number;
}

export interface SessionCommit {
  readonly hash: string;
  readonly msg: string;
  readonly time: string;
}

export interface SessionChronicle {
  readonly events: readonly ChronicleEvent[];
  readonly files: readonly SessionFile[];
  readonly commits: readonly SessionCommit[];
  readonly tokenBurn: readonly number[];
}

/* ── Cluster resources ──────────────────────────────────────────── */

export interface ResourceType {
  readonly name: string;
  readonly resourceKey: string;
  readonly displayName: string;
  readonly unit: string;
  readonly category: string;
}

export interface NodeResourceSummary {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly allocatable: Readonly<Record<string, string>>;
  readonly allocated: Readonly<Record<string, string>>;
  readonly available: Readonly<Record<string, string>>;
}

export interface ClusterResourceInfo {
  readonly resourceTypes: readonly ResourceType[];
  readonly nodes: readonly NodeResourceSummary[];
}

/* ── Pull requests / CI ─────────────────────────────────────────── */

export type PRStatus = 'open' | 'closed' | 'merged';
export type CIStatusValue = 'pending' | 'running' | 'passed' | 'failed' | 'unknown';

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repoUrl: string;
  readonly provider: string;
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly status: PRStatus;
  readonly description?: string;
  readonly ciStatus?: CIStatusValue;
  readonly reviewStatus?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface MergeResult {
  readonly merged: boolean;
}

/* ── MCP servers ────────────────────────────────────────────────── */

export type McpServerStatus = 'connected' | 'disconnected';

export interface McpServer {
  readonly name: string;
  readonly status: McpServerStatus;
  readonly tools: number;
}

export type McpServerType = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  readonly name: string;
  readonly type: McpServerType;
  readonly command?: string;
  readonly url?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/* ── Credentials ────────────────────────────────────────────────── */

export type SecretType =
  | 'api_key'
  | 'oauth_token'
  | 'git_credential'
  | 'ssh_key'
  | 'tls_cert'
  | 'generic';

export interface StoredCredential {
  readonly id: string;
  readonly name: string;
  readonly secretType: SecretType;
  readonly keys: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CredentialCreateRequest {
  readonly name: string;
  readonly secretType: SecretType;
  readonly data: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SecretTypeField {
  readonly key: string;
  readonly label: string;
  readonly type: 'text' | 'password' | 'textarea';
  readonly required: boolean;
}

export interface SecretTypeInfo {
  readonly type: SecretType;
  readonly label: string;
  readonly description: string;
  readonly fields: readonly SecretTypeField[];
  readonly defaultMountType: 'env' | 'file' | 'template';
}

export interface VolundrCredential {
  readonly name: string;
  readonly keys: readonly string[];
}

/* ── Integrations ───────────────────────────────────────────────── */

export interface IntegrationConnection {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly [key: string]: unknown;
}

export interface IntegrationTestResult {
  readonly success: boolean;
  readonly message: string;
}

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/* ── Users / tenants ────────────────────────────────────────────── */

export interface VolundrUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
  readonly tenantId?: string;
  readonly provisionError?: string;
  readonly createdAt?: string;
}

export type VolundrIdentity = {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly displayName: string;
  readonly status: string;
};

export interface VolundrTenant {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly parentId?: string;
  readonly tier: string;
  readonly maxSessions: number;
  readonly maxStorageGb: number;
  readonly createdAt?: string;
}

export interface VolundrMember {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: string;
  readonly grantedAt?: string;
}

export interface VolundrProvisioningResult {
  readonly success: boolean;
  readonly userId: string;
  readonly homePvc?: string;
  readonly errors: readonly string[];
}

/* ── Workspaces ─────────────────────────────────────────────────── */

export type WorkspaceStatus = 'active' | 'archived' | 'deleted';

export interface VolundrWorkspace {
  readonly id: string;
  readonly pvcName: string;
  readonly sessionId: string;
  readonly ownerId: string;
  readonly tenantId: string;
  readonly sizeGb: number;
  readonly status: WorkspaceStatus;
  readonly createdAt: string;
  readonly archivedAt?: string;
  readonly sessionName?: string;
  readonly sourceUrl?: string;
  readonly sourceRef?: string;
}

/* ── Admin ──────────────────────────────────────────────────────── */

export interface AdminStorageSettings {
  readonly homeEnabled: boolean;
  readonly fileManagerEnabled: boolean;
}

export interface AdminSettings {
  readonly storage: AdminStorageSettings;
}

/* ── Templates / presets ────────────────────────────────────────── */

export interface ResourceConfig {
  readonly cpu?: string;
  readonly memory?: string;
  readonly gpu?: string;
  readonly [key: string]: string | undefined;
}

export interface TerminalSidecarConfig {
  readonly enabled: boolean;
  readonly allowedCommands: readonly string[];
  readonly restricted?: boolean;
}

export interface SkillConfig {
  readonly name: string;
  readonly path?: string;
  readonly inline?: string;
}

export interface RuleConfig {
  readonly path?: string;
  readonly inline?: string;
}

export interface TemplateRepo {
  readonly repo: string;
  readonly branch?: string;
  readonly [key: string]: unknown;
}

export interface VolundrTemplate {
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly repos: readonly TemplateRepo[];
  readonly setupScripts: readonly string[];
  readonly workspaceLayout: Readonly<Record<string, unknown>>;
  readonly cliTool: string;
  readonly workloadType: string;
  readonly model: string | null;
  readonly systemPrompt: string | null;
  readonly resourceConfig: ResourceConfig;
  readonly mcpServers: readonly McpServerConfig[];
  readonly envVars: Readonly<Record<string, string>>;
  readonly envSecretRefs: readonly string[];
  readonly workloadConfig: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly terminalSidecar: TerminalSidecarConfig;
  readonly skills: readonly SkillConfig[];
  readonly rules: readonly RuleConfig[];
}

export interface VolundrPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cliTool: string;
  readonly workloadType: string;
  readonly model: string | null;
  readonly systemPrompt: string | null;
  readonly resourceConfig: ResourceConfig;
  readonly mcpServers: readonly McpServerConfig[];
  readonly terminalSidecar: TerminalSidecarConfig;
  readonly skills: readonly SkillConfig[];
  readonly rules: readonly RuleConfig[];
  readonly envVars: Readonly<Record<string, string>>;
  readonly envSecretRefs: readonly string[];
  readonly source: SessionSource | null;
  readonly integrationIds: readonly string[];
  readonly setupScripts: readonly string[];
  readonly workloadConfig: Readonly<Record<string, string | number | boolean | undefined>>;
}

/* ── Personal Access Tokens ─────────────────────────────────────── */

export interface PersonalAccessToken {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface CreatePATResult {
  readonly id: string;
  readonly name: string;
  readonly token: string;
  readonly createdAt: string;
}
