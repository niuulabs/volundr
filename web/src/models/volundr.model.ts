import type { SessionStatus } from './status.model';

export interface VolundrFeatures {
  localMountsEnabled: boolean;
}

export interface ResourceType {
  name: string;
  resourceKey: string;
  displayName: string;
  unit: string;
  category: string;
}

export interface NodeResourceSummary {
  name: string;
  labels: Record<string, string>;
  allocatable: Record<string, string>;
  allocated: Record<string, string>;
  available: Record<string, string>;
}

export interface ClusterResourceInfo {
  resourceTypes: ResourceType[];
  nodes: NodeResourceSummary[];
}

export type ModelTier = 'frontier' | 'balanced' | 'execution' | 'reasoning';
export type ModelProvider = 'cloud' | 'local';
export type SessionOrigin = 'managed' | 'manual';

export interface GitSource {
  type: 'git';
  repo: string;
  branch: string;
}

export interface MountMapping {
  host_path: string;
  mount_path: string;
  read_only: boolean;
}

export interface LocalMountSource {
  type: 'local_mount';
  paths: MountMapping[];
  node_selector?: Record<string, string>;
}

export type SessionSource = GitSource | LocalMountSource;

export type LinearIssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  status: LinearIssueStatus;
  assignee?: string;
  labels?: string[];
  priority?: number;
  url: string;
}

export interface ProjectRepoMapping {
  linearProjectId: string;
  linearProjectName: string;
  repoUrl: string;
}

export interface VolundrModel {
  name: string;
  provider: ModelProvider;
  tier: ModelTier;
  color: string;
  cost?: string;
  vram?: string;
}

export interface TaskType {
  name: string;
  description: string;
  defaultModel?: string;
}

export const TASK_TYPES: Record<string, TaskType> = {
  'skuld-claude': {
    name: 'Skuld Claude',
    description: 'Interactive Claude Code CLI session',
    defaultModel: 'claude-sonnet',
  },
  'skuld-codex': {
    name: 'Skuld Codex',
    description: 'OpenAI Codex CLI coding agent',
    defaultModel: 'codex',
  },
  'skuld-gemini': {
    name: 'Skuld Gemini',
    description: 'Google Gemini CLI coding agent',
    defaultModel: 'gemini',
  },
};

export interface VolundrSession {
  id: string;
  name: string;
  source: SessionSource;
  status: SessionStatus;
  model: string;
  lastActive: number;
  messageCount: number;
  tokensUsed: number;
  podName?: string;
  error?: string;
  origin?: SessionOrigin;
  hostname?: string;
  chatEndpoint?: string;
  codeEndpoint?: string;
  taskType?: string;
  archivedAt?: Date;
  linearIssue?: LinearIssue;
  ownerId?: string;
  tenantId?: string;
}

export interface VolundrUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  tenantId?: string;
  provisionError?: string;
  createdAt?: string;
}

export interface VolundrIdentity {
  userId: string;
  email: string;
  tenantId: string;
  roles: string[];
  displayName: string;
  status: string;
}

export interface VolundrTenant {
  id: string;
  path: string;
  name: string;
  parentId?: string;
  tier: string;
  maxSessions: number;
  maxStorageGb: number;
  createdAt?: string;
}

export interface VolundrMember {
  userId: string;
  tenantId: string;
  role: string;
  grantedAt?: string;
}

export interface VolundrProvisioningResult {
  success: boolean;
  userId: string;
  homePvc?: string;
  errors: string[];
}

export type SecretType =
  | 'api_key'
  | 'oauth_token'
  | 'git_credential'
  | 'ssh_key'
  | 'tls_cert'
  | 'generic';

export interface StoredCredential {
  id: string;
  name: string;
  secretType: SecretType;
  keys: string[];
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialCreateRequest {
  name: string;
  secretType: SecretType;
  data: Record<string, string>;
  metadata?: Record<string, string>;
}

export interface SecretTypeField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required: boolean;
}

export interface SecretTypeInfo {
  type: SecretType;
  label: string;
  description: string;
  fields: SecretTypeField[];
  defaultMountType: 'env' | 'file' | 'template';
}

export interface VolundrCredential {
  name: string;
  keys: string[];
}

export interface VolundrCredentialCreate {
  name: string;
  data: Record<string, string>;
}

export interface VolundrStats {
  activeSessions: number;
  totalSessions: number;
  tokensToday: number;
  localTokens: number;
  cloudTokens: number;
  costToday: number;
}

export type MessageRole = 'user' | 'assistant';

export interface VolundrMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  tokensIn?: number;
  tokensOut?: number;
  latency?: number;
}

export type RepoProvider = 'github' | 'gitlab' | 'bitbucket';

export interface VolundrRepo {
  provider: RepoProvider;
  org: string;
  name: string;
  cloneUrl: string;
  url: string;
  defaultBranch: string;
  branches: string[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface VolundrLog {
  id: string;
  sessionId: string;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
}

export type ChronicleEventType = 'message' | 'file' | 'git' | 'terminal' | 'error' | 'session';

export interface ChronicleEvent {
  t: number;
  type: ChronicleEventType;
  label: string;
  tokens?: number;
  action?: string;
  ins?: number;
  del?: number;
  hash?: string;
  exit?: number;
}

export interface SessionFile {
  path: string;
  status: 'new' | 'mod' | 'del';
  ins: number;
  del: number;
}

export interface SessionCommit {
  hash: string;
  msg: string;
  time: string;
}

export interface SessionChronicle {
  events: ChronicleEvent[];
  files: SessionFile[];
  commits: SessionCommit[];
  tokenBurn: number[];
}

export type DiffBase = 'last-commit' | 'default-branch';

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffData {
  filePath: string;
  hunks: DiffHunk[];
}

export type PRStatus = 'open' | 'closed' | 'merged';
export type CIStatusValue = 'pending' | 'running' | 'passed' | 'failed' | 'unknown';

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  repoUrl: string;
  provider: string;
  sourceBranch: string;
  targetBranch: string;
  status: PRStatus;
  description?: string;
  ciStatus?: CIStatusValue;
  reviewStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MergeResult {
  merged: boolean;
}

export type McpServerStatus = 'connected' | 'disconnected';

export interface McpServer {
  name: string;
  status: McpServerStatus;
  tools: number;
}

export interface MergeConfidence {
  score: number;
  factors: Record<string, number>;
  action: string;
  reason: string;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export type WorkspaceStatus = 'active' | 'archived' | 'deleted';

export interface VolundrWorkspace {
  id: string;
  pvcName: string;
  sessionId: string;
  ownerId: string;
  tenantId: string;
  sizeGb: number;
  status: WorkspaceStatus;
  createdAt: string;
  archivedAt?: string;
}

export interface AdminStorageSettings {
  homeEnabled: boolean;
}

export interface AdminSettings {
  storage: AdminStorageSettings;
}

export type FeatureScope = 'admin' | 'user';

export interface FeatureModule {
  key: string;
  label: string;
  icon: string;
  scope: FeatureScope;
  enabled: boolean;
  defaultEnabled: boolean;
  adminOnly: boolean;
  order: number;
}

export interface UserFeaturePreference {
  featureKey: string;
  visible: boolean;
  sortOrder: number;
}

// Types merged from forgeProfile.model.ts
export type McpServerType = 'stdio' | 'sse' | 'http';

export interface McpServerConfig {
  name: string;
  type: McpServerType;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ResourceConfig {
  cpu?: string;
  memory?: string;
  gpu?: string;
  [key: string]: string | undefined;
}

export interface WorkloadConfig {
  [key: string]: string | number | boolean | undefined;
}

export type CliTool = 'claude' | 'codex';

export interface TerminalSidecarConfig {
  enabled: boolean;
  allowedCommands: string[];
  restricted?: boolean;
}

export interface TerminalTab {
  id: string;
  label: string;
  restricted: boolean;
  cliType?: string;
}

export interface SkillConfig {
  name: string;
  path?: string;
  inline?: string;
}

export interface RuleConfig {
  path?: string;
  inline?: string;
}

export interface TemplateRepo {
  repo: string;
  branch?: string;
  [key: string]: unknown;
}

export interface VolundrPreset {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  cliTool: CliTool;
  workloadType: string;
  model: string | null;
  systemPrompt: string | null;
  resourceConfig: ResourceConfig;
  mcpServers: McpServerConfig[];
  terminalSidecar: TerminalSidecarConfig;
  skills: SkillConfig[];
  rules: RuleConfig[];
  envVars: Record<string, string>;
  envSecretRefs: string[];
  workloadConfig: WorkloadConfig;
}

export interface VolundrTemplate {
  name: string;
  description: string;
  isDefault: boolean;
  // Workspace
  repos: TemplateRepo[];
  setupScripts: string[];
  workspaceLayout: Record<string, unknown>;
  // Runtime (merged from profile)
  cliTool: CliTool;
  workloadType: string;
  model: string | null;
  systemPrompt: string | null;
  resourceConfig: ResourceConfig;
  mcpServers: McpServerConfig[];
  envVars: Record<string, string>;
  envSecretRefs: string[];
  workloadConfig: WorkloadConfig;
  // Terminal sidecar
  terminalSidecar: TerminalSidecarConfig;
  // Skills & Rules (Claude Code specific)
  skills: SkillConfig[];
  rules: RuleConfig[];
}
