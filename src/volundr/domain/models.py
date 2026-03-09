"""Domain models for Völundr session management."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class UserStatus(StrEnum):
    """Status of a user account."""

    PROVISIONING = "provisioning"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    FAILED = "failed"


class TenantTier(StrEnum):
    """Tier classification for a tenant."""

    DEVELOPER = "developer"
    TEAM = "team"
    ENTERPRISE = "enterprise"


class TenantRole(StrEnum):
    """Role within a tenant."""

    ADMIN = "volundr:admin"
    DEVELOPER = "volundr:developer"
    VIEWER = "volundr:viewer"


@dataclass(frozen=True)
class Tenant:
    """A tenant in the hierarchy."""

    id: str
    path: str
    name: str
    parent_id: str | None = None
    tier: TenantTier = TenantTier.DEVELOPER
    max_sessions: int = 5
    max_storage_gb: int = 50
    created_at: datetime | None = None


@dataclass(frozen=True)
class User:
    """A provisioned user."""

    id: str  # IDP sub claim
    email: str
    display_name: str = ""
    status: UserStatus = UserStatus.ACTIVE
    home_pvc: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class TenantMembership:
    """A user's membership in a tenant."""

    user_id: str
    tenant_id: str
    role: TenantRole = TenantRole.DEVELOPER
    granted_at: datetime | None = None


@dataclass(frozen=True)
class Principal:
    """Authenticated identity extracted from JWT."""

    user_id: str
    email: str
    tenant_id: str
    roles: list[str]


@dataclass(frozen=True)
class QuotaCheck:
    """Result of a quota check along the tenant ancestor chain."""

    allowed: bool
    tenant_id: str
    max_sessions: int
    current_sessions: int
    reason: str = ""


class SessionStatus(StrEnum):
    """Status of a coding session."""

    CREATED = "created"
    STARTING = "starting"
    PROVISIONING = "provisioning"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"
    ARCHIVED = "archived"


class EventType(StrEnum):
    """Type of real-time event."""

    SESSION_CREATED = "session_created"
    SESSION_UPDATED = "session_updated"
    SESSION_DELETED = "session_deleted"
    STATS_UPDATED = "stats_updated"
    HEARTBEAT = "heartbeat"
    CHRONICLE_CREATED = "chronicle_created"
    CHRONICLE_UPDATED = "chronicle_updated"
    CHRONICLE_DELETED = "chronicle_deleted"
    CHRONICLE_EVENT = "chronicle_event"
    PR_CREATED = "pr_created"
    PR_MERGED = "pr_merged"


class IntegrationType(StrEnum):
    """Category of integration."""

    SOURCE_CONTROL = "source_control"
    ISSUE_TRACKER = "issue_tracker"
    MESSAGING = "messaging"
    AI_PROVIDER = "ai_provider"


class GitProviderType(StrEnum):
    """Type of git hosting provider."""

    GITHUB = "github"
    GITLAB = "gitlab"
    BITBUCKET = "bitbucket"
    GENERIC = "generic"


@dataclass(frozen=True)
class RepoInfo:
    """Information about a git repository."""

    provider: GitProviderType
    org: str
    name: str
    clone_url: str
    url: str  # Web URL for the repo
    default_branch: str = "main"
    branches: tuple[str, ...] = ()


class ModelProvider(StrEnum):
    """Provider type for LLM models."""

    CLOUD = "cloud"
    LOCAL = "local"


class ModelTier(StrEnum):
    """Tier classification for LLM models."""

    FRONTIER = "frontier"
    BALANCED = "balanced"
    EXECUTION = "execution"
    REASONING = "reasoning"


@dataclass(frozen=True)
class Model:
    """An available LLM model with pricing and metadata."""

    id: str
    name: str
    description: str
    provider: ModelProvider
    tier: ModelTier
    color: str
    cost_per_million_tokens: float | None = None
    vram_required: str | None = None


@dataclass(frozen=True)
class TokenUsageRecord:
    """A record of token usage for a session."""

    id: UUID
    session_id: UUID
    recorded_at: datetime
    tokens: int
    provider: ModelProvider
    model: str
    cost: Decimal | None


@dataclass(frozen=True)
class Stats:
    """Aggregate statistics for the dashboard."""

    active_sessions: int
    total_sessions: int
    tokens_today: int
    local_tokens: int
    cloud_tokens: int
    cost_today: Decimal


@dataclass(frozen=True)
class RealtimeEvent:
    """A real-time event for SSE streaming."""

    type: EventType
    data: dict
    timestamp: datetime


class Session(BaseModel):
    """A Claude Code coding session."""

    id: UUID = Field(default_factory=uuid4)
    name: str = Field(..., min_length=1, max_length=255)
    model: str = Field(default="", max_length=100)
    repo: str = Field(default="", max_length=500)
    branch: str = Field(default="main", max_length=255)
    status: SessionStatus = Field(default=SessionStatus.CREATED)
    chat_endpoint: str | None = Field(default=None)
    code_endpoint: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_active: datetime | None = Field(default=None)
    message_count: int = Field(default=0, ge=0)
    tokens_used: int = Field(default=0, ge=0)
    pod_name: str | None = Field(default=None)
    error: str | None = Field(default=None)
    tracker_issue_id: str | None = Field(default=None)
    preset_id: UUID | None = Field(default=None)
    archived_at: datetime | None = Field(default=None)
    owner_id: str | None = Field(default=None)
    tenant_id: str | None = Field(default=None)
    workspace_id: UUID | None = Field(default=None)

    model_config = {"frozen": False}

    def model_post_init(self, __context) -> None:
        """Initialize last_active to created_at if not set."""
        if self.last_active is None:
            object.__setattr__(self, "last_active", self.created_at)

    def can_start(self) -> bool:
        """Check if session can be started."""
        return self.status in (SessionStatus.CREATED, SessionStatus.STOPPED, SessionStatus.FAILED)

    def can_stop(self) -> bool:
        """Check if session can be stopped."""
        return self.status in (SessionStatus.RUNNING, SessionStatus.PROVISIONING)

    def with_status(self, status: SessionStatus) -> Session:
        """Return a copy with updated status and timestamp."""
        return self.model_copy(update={"status": status, "updated_at": datetime.utcnow()})

    def with_endpoints(self, chat_endpoint: str, code_endpoint: str) -> Session:
        """Return a copy with updated endpoints and timestamp."""
        return self.model_copy(
            update={
                "chat_endpoint": chat_endpoint,
                "code_endpoint": code_endpoint,
                "updated_at": datetime.utcnow(),
            }
        )

    def with_cleared_endpoints(self) -> Session:
        """Return a copy with cleared endpoints and timestamp."""
        return self.model_copy(
            update={
                "chat_endpoint": None,
                "code_endpoint": None,
                "updated_at": datetime.utcnow(),
            }
        )

    def with_pod_name(self, pod_name: str) -> Session:
        """Return a copy with updated pod_name and timestamp."""
        return self.model_copy(
            update={
                "pod_name": pod_name,
                "updated_at": datetime.utcnow(),
            }
        )

    def with_error(self, error: str) -> Session:
        """Return a copy with error message and timestamp."""
        return self.model_copy(
            update={
                "error": error,
                "updated_at": datetime.utcnow(),
            }
        )

    def with_activity(self, message_count: int, tokens: int) -> Session:
        """Return a copy with updated activity metrics and timestamp."""
        now = datetime.utcnow()
        return self.model_copy(
            update={
                "message_count": message_count,
                "tokens_used": tokens,
                "last_active": now,
                "updated_at": now,
            }
        )


class TimelineEventType(StrEnum):
    """Type of timeline event within a chronicle."""

    SESSION = "session"
    MESSAGE = "message"
    FILE = "file"
    GIT = "git"
    TERMINAL = "terminal"
    ERROR = "error"


@dataclass(frozen=True)
class TimelineEvent:
    """A single event in a chronicle's timeline."""

    id: UUID
    chronicle_id: UUID
    session_id: UUID
    t: int  # seconds elapsed since session start
    type: TimelineEventType
    label: str
    tokens: int | None = None
    action: str | None = None  # created, modified, deleted (file events)
    ins: int | None = None
    del_: int | None = None
    hash: str | None = None  # short commit hash (git events)
    exit_code: int | None = None  # terminal events
    created_at: datetime | None = None


@dataclass(frozen=True)
class FileSummary:
    """Aggregated file change summary for a timeline."""

    path: str
    status: str  # new, mod, del
    ins: int
    del_: int


@dataclass(frozen=True)
class CommitSummary:
    """Commit summary for a timeline."""

    hash: str
    msg: str
    time: str  # wall clock time, e.g. "14:35"


@dataclass(frozen=True)
class TimelineResponse:
    """Full timeline response for a session chronicle."""

    events: list[TimelineEvent]
    files: list[FileSummary]
    commits: list[CommitSummary]
    token_burn: list[int]


class ChronicleStatus(StrEnum):
    """Status of a chronicle entry."""

    DRAFT = "draft"
    COMPLETE = "complete"


class Chronicle(BaseModel):
    """A chronicle entry capturing session metadata for continuity."""

    id: UUID = Field(default_factory=uuid4)
    session_id: UUID | None = None
    status: ChronicleStatus = Field(default=ChronicleStatus.DRAFT)
    project: str = Field(..., min_length=1, max_length=255)
    repo: str = Field(..., min_length=1, max_length=500)
    branch: str = Field(..., min_length=1, max_length=255)
    model: str = Field(..., min_length=1, max_length=100)
    config_snapshot: dict = Field(default_factory=dict)
    summary: str | None = Field(default=None)
    key_changes: list[str] = Field(default_factory=list)
    unfinished_work: str | None = Field(default=None)
    token_usage: int = Field(default=0, ge=0)
    cost: Decimal | None = Field(default=None)
    duration_seconds: int | None = Field(default=None, ge=0)
    tags: list[str] = Field(default_factory=list)
    parent_chronicle_id: UUID | None = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"frozen": False}


class PullRequestStatus(StrEnum):
    """Status of a pull request."""

    OPEN = "open"
    MERGED = "merged"
    CLOSED = "closed"


class CIStatus(StrEnum):
    """CI pipeline status."""

    PASSING = "passing"
    FAILING = "failing"
    PENDING = "pending"
    UNKNOWN = "unknown"


class ReviewStatus(StrEnum):
    """Code review status."""

    APPROVED = "approved"
    CHANGES_REQUESTED = "changes_requested"
    PENDING = "pending"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class PullRequest:
    """A pull request / merge request from a git provider."""

    number: int
    title: str
    url: str
    repo_url: str
    provider: GitProviderType
    source_branch: str
    target_branch: str
    status: PullRequestStatus
    description: str | None = None
    ci_status: CIStatus | None = None
    review_status: ReviewStatus | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class MergeConfidence:
    """Confidence assessment for merging a pull request."""

    score: float  # 0.0 - 1.0
    factors: dict[str, float]
    action: str  # "auto_merge", "notify_then_merge", "require_approval"
    reason: str


class SessionEventType(StrEnum):
    """Type of raw session event for the event pipeline."""

    MESSAGE_USER = "message_user"
    MESSAGE_ASSISTANT = "message_assistant"
    FILE_CREATED = "file_created"
    FILE_MODIFIED = "file_modified"
    FILE_DELETED = "file_deleted"
    GIT_COMMIT = "git_commit"
    GIT_PUSH = "git_push"
    GIT_BRANCH = "git_branch"
    GIT_CHECKOUT = "git_checkout"
    TERMINAL_COMMAND = "terminal_command"
    TOOL_USE = "tool_use"
    ERROR = "error"
    TOKEN_USAGE = "token_usage"
    SESSION_START = "session_start"
    SESSION_STOP = "session_stop"


@dataclass(frozen=True)
class SessionEvent:
    """A raw event from a session, dispatched through the event pipeline.

    Data payloads by event_type (not enforced by schema):

    message_user:      {"content_length": int, "content_preview": str}
    message_assistant:  {"content_length": int, "content_preview": str, "finish_reason": str}
    file_created:       {"path": str, "size_bytes": int}
    file_modified:      {"path": str, "insertions": int, "deletions": int}
    file_deleted:       {"path": str}
    git_commit:         {"hash": str, "message": str, "files_changed": int}
    git_push:           {"branch": str, "commits_count": int, "remote": str}
    git_branch:         {"name": str, "from_branch": str}
    git_checkout:       {"branch": str}
    terminal_command:   {"command": str, "exit_code": int, "duration_ms": int}
    tool_use:           {"tool": str, "arguments_preview": str, "duration_ms": int}
    error:              {"source": str, "message": str}
    token_usage:        {"provider": str, "model": str, "tokens_in": int, "tokens_out": int}
    session_start:      {"model": str, "repo": str, "branch": str}
    session_stop:       {"reason": str, "total_tokens": int}
    """

    id: UUID
    session_id: UUID
    event_type: SessionEventType
    timestamp: datetime
    data: dict
    sequence: int
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost: Decimal | None = None
    duration_ms: int | None = None
    model: str | None = None


class PromptScope(StrEnum):
    """Scope of a saved prompt."""

    GLOBAL = "global"
    PROJECT = "project"


class SavedPrompt(BaseModel):
    """A reusable saved prompt."""

    id: UUID = Field(default_factory=uuid4)
    name: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    scope: PromptScope = Field(default=PromptScope.GLOBAL)
    project_repo: str | None = Field(default=None, max_length=500)
    tags: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"frozen": False}


class TrackerIssue(BaseModel):
    """Issue from an external issue tracker (Linear, Jira, GitHub Issues, etc.)."""

    id: str
    identifier: str  # e.g., "NIU-57"
    title: str
    status: str
    assignee: str | None = None
    labels: list[str] = Field(default_factory=list)
    priority: int = 0
    url: str

    model_config = {"frozen": False}


class ProjectMapping(BaseModel):
    """Maps a git repo URL to an issue tracker project."""

    id: UUID = Field(default_factory=uuid4)
    repo_url: str
    project_id: str
    project_name: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"frozen": False}


class TrackerConnectionStatus(BaseModel):
    """Connection status for an issue tracker."""

    connected: bool
    provider: str  # "linear", "jira", etc.
    workspace: str | None = None
    user: str | None = None

    model_config = {"frozen": False}


@dataclass(frozen=True)
class MCPServerSpec:
    """MCP server specification for an integration.

    Describes how to launch an MCP server when a session uses this
    integration. Credential fields are mapped to environment variables
    via ``env_from_credentials``.
    """

    name: str
    command: str
    args: tuple[str, ...] = ()
    env_from_credentials: dict[str, str] = ()  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if not isinstance(self.args, tuple):
            object.__setattr__(self, "args", tuple(self.args))
        if not isinstance(self.env_from_credentials, dict):
            object.__setattr__(
                self,
                "env_from_credentials",
                dict(self.env_from_credentials),
            )


@dataclass(frozen=True)
class IntegrationDefinition:
    """A known integration type in the catalog.

    Describes what an integration is, how to instantiate its adapter,
    what credentials it needs, and optionally an MCP server spec.

    ``env_from_credentials`` maps environment variable names to credential
    field names for non-MCP integrations (e.g. ``{"ANTHROPIC_API_KEY": "api_key"}``).
    For MCP integrations use ``MCPServerSpec.env_from_credentials`` instead.
    """

    slug: str
    name: str
    description: str
    integration_type: IntegrationType
    adapter: str  # fully-qualified class path
    icon: str = ""
    credential_schema: dict = ()  # type: ignore[assignment]
    config_schema: dict = ()  # type: ignore[assignment]
    mcp_server: MCPServerSpec | None = None
    env_from_credentials: dict[str, str] = ()  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if not isinstance(self.credential_schema, dict):
            object.__setattr__(self, "credential_schema", dict(self.credential_schema))
        if not isinstance(self.config_schema, dict):
            object.__setattr__(self, "config_schema", dict(self.config_schema))
        if not isinstance(self.env_from_credentials, dict):
            object.__setattr__(self, "env_from_credentials", dict(self.env_from_credentials))


@dataclass(frozen=True)
class IntegrationConnection:
    """A configured integration connection (e.g., issue tracker)."""

    id: str
    user_id: str
    integration_type: IntegrationType
    adapter: str  # fully-qualified class path
    credential_name: str  # reference to stored credential
    config: dict  # adapter-specific config
    enabled: bool
    created_at: datetime
    updated_at: datetime
    slug: str = ""  # references IntegrationDefinition.slug


@dataclass(frozen=True)
class MCPServerConfig:
    """An available MCP server configuration."""

    name: str
    type: str = "stdio"
    command: str | None = None
    url: str | None = None
    args: list[str] = ()  # type: ignore[assignment]
    description: str = ""

    def __post_init__(self) -> None:
        # Ensure args is always a tuple for immutability
        if not isinstance(self.args, tuple):
            object.__setattr__(self, "args", tuple(self.args))


@dataclass(frozen=True)
class PodSpecAdditions:
    """Pod spec contributions for secret injection via CSI driver.

    Returned by SecretInjectionPort adapters to tell the orchestrator
    how to configure volumes, mounts, labels, and annotations for
    CSI-based secret injection. Volundr never sees secret values.
    """

    volumes: tuple[dict, ...] = ()
    volume_mounts: tuple[dict, ...] = ()
    labels: dict[str, str] = ()  # type: ignore[assignment]
    annotations: dict[str, str] = ()  # type: ignore[assignment]
    env: tuple[dict, ...] = ()
    service_account: str | None = None

    def __post_init__(self) -> None:
        # Ensure dict fields default to empty dicts, not empty tuples
        if not isinstance(self.labels, dict):
            object.__setattr__(self, "labels", {})
        if not isinstance(self.annotations, dict):
            object.__setattr__(self, "annotations", {})


class SecretType(StrEnum):
    """Type of stored credential."""

    API_KEY = "api_key"
    OAUTH_TOKEN = "oauth_token"
    GIT_CREDENTIAL = "git_credential"
    SSH_KEY = "ssh_key"
    TLS_CERT = "tls_cert"
    GENERIC = "generic"


@dataclass(frozen=True)
class StoredCredential:
    """Metadata for a stored credential (never contains secret values)."""

    id: str
    name: str
    secret_type: SecretType
    keys: tuple[str, ...]
    metadata: dict
    owner_id: str
    owner_type: str  # "user" | "tenant"
    created_at: datetime
    updated_at: datetime


class MountType(StrEnum):
    """How a secret should be mounted into a session pod."""

    ENV_FILE = "env_file"
    FILE = "file"
    TEMPLATE = "template"


@dataclass(frozen=True)
class SecretMountSpec:
    """Specification for how a secret should be mounted."""

    secret_path: str
    mount_type: MountType
    destination: str
    template: str | None = None
    renewal: bool = False


@dataclass(frozen=True)
class SecretProfile:
    """Named collection of secret mount specs for a tenant or user."""

    owner_id: str
    owner_type: str  # "tenant" or "user"
    mounts: tuple[SecretMountSpec, ...] = ()


@dataclass(frozen=True)
class StorageQuota:
    """Storage quota for a user."""

    home_gb: int = 1
    workspace_gb: int = 1


class WorkspaceStatus(StrEnum):
    """Lifecycle status of a workspace."""

    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


@dataclass(frozen=True)
class Workspace:
    """A per-session workspace with storage isolation."""

    id: UUID
    session_id: UUID
    user_id: str
    tenant_id: str
    pvc_name: str
    status: WorkspaceStatus = WorkspaceStatus.ACTIVE
    size_gb: int = 1
    created_at: datetime | None = None
    archived_at: datetime | None = None
    deleted_at: datetime | None = None


@dataclass(frozen=True)
class ProvisioningResult:
    """Result of a user provisioning or reprovisioning operation."""

    success: bool
    user_id: str
    home_pvc: str | None = None
    errors: list[str] = field(default_factory=list)


# Kubernetes label keys used for PVC isolation (Kyverno policy enforcement).
# Keep in sync with charts/volundr/templates/kyverno-pvc-isolation.yaml.
LABEL_OWNER = "volundr/owner"
LABEL_SESSION_ID = "volundr/session-id"
LABEL_PVC_TYPE = "volundr/pvc-type"
LABEL_TENANT_ID = "volundr/tenant-id"
LABEL_MANAGED_BY = "app.kubernetes.io/managed-by"
LABEL_WORKSPACE_STATUS = "volundr/workspace-status"


@dataclass(frozen=True)
class PVCRef:
    """Reference to a Kubernetes PersistentVolumeClaim."""

    name: str
    namespace: str = "volundr-sessions"


@dataclass(frozen=True)
class SecretInfo:
    """Metadata about an available Kubernetes secret."""

    name: str
    keys: list[str] = ()  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if not isinstance(self.keys, tuple):
            object.__setattr__(self, "keys", tuple(self.keys))


class ForgeProfile(BaseModel):
    """Argument template for workload instantiation.

    .. deprecated::
        ForgeProfile fields have been merged into WorkspaceTemplate.
        Use WorkspaceTemplate directly for new code. This class is kept
        for backward compatibility during migration.

    Defines the base set of values that Volundr assembles into Farm task_args.
    The Helm chart for the target task_type gives these values meaning.
    """

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    workload_type: str = Field(default="session")
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict = Field(default_factory=dict)
    mcp_servers: list[dict] = Field(default_factory=list)
    env_vars: dict[str, str] = Field(default_factory=dict)
    env_secret_refs: list[str] = Field(default_factory=list)
    workload_config: dict = Field(default_factory=dict)
    is_default: bool = Field(default=False)
    session_definition: str | None = Field(default=None)

    model_config = {"frozen": False}


class Preset(BaseModel):
    """A portable runtime configuration preset (DB-stored).

    Presets capture runtime config (model, MCP servers, resources, etc.)
    independently from workspace templates (which are CRD/config-driven).
    """

    id: UUID = Field(default_factory=uuid4)
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    is_default: bool = Field(default=False)
    cli_tool: str = Field(default="")
    workload_type: str = Field(default="session")
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict = Field(default_factory=dict)
    mcp_servers: list[dict] = Field(default_factory=list)
    terminal_sidecar: dict = Field(default_factory=dict)
    skills: list[dict] = Field(default_factory=list)
    rules: list[dict] = Field(default_factory=list)
    env_vars: dict[str, str] = Field(default_factory=dict)
    env_secret_refs: list[str] = Field(default_factory=list)
    workload_config: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"frozen": False}


class WorkspaceTemplate(BaseModel):
    """Complete session blueprint combining workspace and runtime config.

    Templates are configuration-driven — loaded from YAML config or
    Kubernetes CRDs rather than stored in a database. Each template
    is a self-contained session blueprint with all config needed to
    launch a session.
    """

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="")
    # Workspace config
    repos: list[dict] = Field(default_factory=list)
    setup_scripts: list[str] = Field(default_factory=list)
    workspace_layout: dict = Field(default_factory=dict)
    is_default: bool = Field(default=False)
    # Runtime config (merged from ForgeProfile)
    workload_type: str = Field(default="session")
    model: str | None = Field(default=None, max_length=100)
    system_prompt: str | None = Field(default=None)
    resource_config: dict = Field(default_factory=dict)
    mcp_servers: list[dict] = Field(default_factory=list)
    env_vars: dict[str, str] = Field(default_factory=dict)
    env_secret_refs: list[str] = Field(default_factory=list)
    workload_config: dict = Field(default_factory=dict)
    session_definition: str | None = Field(default=None)

    model_config = {"frozen": False}


@dataclass
class SessionSpec:
    """Merged result from all contributors."""

    values: dict[str, Any]
    pod_spec: PodSpecAdditions

    @staticmethod
    def merge(contributions: list) -> SessionSpec:
        """Merge multiple SessionContribution objects into a single spec."""
        merged_values: dict[str, Any] = {}
        merged_pod_spec = PodSpecAdditions()

        for c in contributions:
            _deep_merge(merged_values, c.values)
            if c.pod_spec is not None:
                merged_pod_spec = _merge_pod_specs(merged_pod_spec, c.pod_spec)

        return SessionSpec(values=merged_values, pod_spec=merged_pod_spec)


def _deep_merge(base: dict, override: dict) -> None:
    """Deep-merge override into base in place."""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _merge_pod_specs(a: PodSpecAdditions, b: PodSpecAdditions) -> PodSpecAdditions:
    """Merge two PodSpecAdditions, concatenating sequences and merging dicts."""
    return PodSpecAdditions(
        volumes=a.volumes + b.volumes,
        volume_mounts=a.volume_mounts + b.volume_mounts,
        labels={**a.labels, **b.labels},
        annotations={**a.annotations, **b.annotations},
        env=a.env + b.env,
        service_account=b.service_account or a.service_account,
    )
