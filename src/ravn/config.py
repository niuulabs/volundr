"""Configuration settings for Ravn.

Config file locations (first found wins):
- ~/.ravn/config.yaml
- ./ravn.yaml
- /etc/ravn/config.yaml

Override with RAVN_CONFIG env var to point to a custom file.

Environment variable override format (RAVN_ prefix, double underscore for nesting):
- RAVN_ANTHROPIC__API_KEY
- RAVN_LLM__MODEL
- RAVN_MEMORY__BACKEND

Precedence (highest to lowest):
  env vars > yaml file > defaults

Note: project context files (.ravn.yaml, RAVN.md, CLAUDE.md) discovered by
`ravn.context.discover()` are a *separate* mechanism — they enrich the agent's
system prompt with project-specific instructions and are not config overrides.

ProjectConfig is the structured config overlay parsed from RAVN.md.  It lets
a project define allowed/forbidden tools, a persona, and an iteration budget
without modifying the global ravn.yaml.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

# ---------------------------------------------------------------------------
# Config file resolution
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG_PATHS: tuple[Path, ...] = (
    Path.home() / ".ravn" / "config.yaml",
    Path("./ravn.yaml"),
    Path("/etc/ravn/config.yaml"),
)


def _config_paths() -> tuple[Path, ...]:
    env = os.environ.get("RAVN_CONFIG")
    if env:
        return (Path(env),)
    return _DEFAULT_CONFIG_PATHS


# ---------------------------------------------------------------------------
# Sub-config models
# ---------------------------------------------------------------------------


class AnthropicConfig(BaseModel):
    """Anthropic API configuration."""

    api_key: str = Field(default="", description="Anthropic API key (or set ANTHROPIC_API_KEY).")
    base_url: str = Field(default="https://api.anthropic.com")


class LLMProviderConfig(BaseModel):
    """A single LLM provider entry in the fallback chain."""

    adapter: str = Field(
        default="ravn.adapters.llm.anthropic.AnthropicAdapter",
        description="Fully-qualified class path for the LLM adapter.",
    )
    kwargs: dict[str, Any] = Field(
        default_factory=dict,
        description="Extra kwargs forwarded to the adapter constructor.",
    )
    secret_kwargs_env: dict[str, str] = Field(
        default_factory=dict,
        description="Maps kwarg names to env var names for credential injection.",
    )


class ExtendedThinkingConfig(BaseModel):
    """Extended thinking (extended reasoning budget) configuration.

    Extended thinking allocates a deliberate reasoning budget to hard problems
    before the model produces its response.  Anthropic-only — FallbackAdapter
    skips this when routing to a non-Anthropic provider.
    """

    enabled: bool = Field(
        default=False,
        description="Allow extended thinking to be activated.",
    )
    budget_tokens: int = Field(
        default=8000,
        description="Token budget allocated for thinking per activation.",
    )
    auto_trigger: bool = Field(
        default=True,
        description="Automatically activate thinking on planning/ambiguous inputs.",
    )
    auto_trigger_on_retry: bool = Field(
        default=True,
        description="Automatically activate thinking after the first tool failure.",
    )


class LLMConfig(BaseModel):
    """LLM provider configuration: primary provider and optional fallback chain."""

    model: str = Field(default="claude-sonnet-4-6")
    max_tokens: int = Field(default=8192)
    max_retries: int = Field(default=3)
    retry_base_delay: float = Field(default=1.0)
    timeout: float = Field(default=120.0)
    provider: LLMProviderConfig = Field(default_factory=LLMProviderConfig)
    fallbacks: list[LLMProviderConfig] = Field(
        default_factory=list,
        description="Ordered list of fallback providers tried when the primary fails.",
    )
    extended_thinking: ExtendedThinkingConfig = Field(
        default_factory=ExtendedThinkingConfig,
        description="Extended thinking (deliberate reasoning budget) configuration.",
    )


class ToolAdapterConfig(BaseModel):
    """A single custom tool adapter entry."""

    adapter: str = Field(description="Fully-qualified class path for the tool adapter.")
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)


class FileToolsConfig(BaseModel):
    """File operation tool limits and thresholds."""

    max_read_bytes: int = Field(
        default=1 * 1024 * 1024,
        description="Maximum file size allowed for read_file (bytes).",
    )
    max_write_bytes: int = Field(
        default=5 * 1024 * 1024,
        description="Maximum content size allowed for write_file / edit_file (bytes).",
    )
    binary_check_bytes: int = Field(
        default=8 * 1024,
        description="Number of bytes inspected for binary (NUL-byte) detection.",
    )


class DockerTerminalConfig(BaseModel):
    """Docker-specific settings for the docker terminal backend."""

    image: str = Field(
        default="python:3.11-slim",
        description="Docker image used for the sandboxed container.",
    )
    network: str = Field(
        default="none",
        description="Docker network mode: 'none' (isolated), 'bridge', or 'host'.",
    )
    mount_workspace: bool = Field(
        default=True,
        description="Mount the workspace directory read-write inside the container.",
    )
    extra_mounts: list[str] = Field(
        default_factory=list,
        description="Additional volume mounts in 'host:container' format.",
    )


class TerminalToolConfig(BaseModel):
    """Terminal tool configuration."""

    backend: str = Field(
        default="local",
        description="Terminal backend: 'local' (host shell) or 'docker' (sandboxed container).",
    )
    persistent_shell: bool = Field(
        default=True,
        description="Keep a single shell process alive across tool calls.",
    )
    shell: str = Field(
        default="/bin/bash",
        description="Shell executable used for command execution.",
    )
    timeout_seconds: float = Field(
        default=30.0,
        description="Seconds to wait for a command to complete before timing out.",
    )
    docker: DockerTerminalConfig = Field(
        default_factory=DockerTerminalConfig,
        description="Docker backend configuration (used when backend='docker').",
    )


class WebFetchConfig(BaseModel):
    """web_fetch tool configuration."""

    timeout: float = Field(
        default=30.0,
        description="HTTP request timeout in seconds.",
    )
    user_agent: str = Field(
        default="Ravn/1.0 (+https://github.com/niuulabs/volundr)",
        description="User-Agent header sent with web_fetch requests.",
    )
    content_budget: int = Field(
        default=20_000,
        description="Maximum characters of extracted text returned by web_fetch.",
    )


class WebSearchConfig(BaseModel):
    """web_search tool configuration."""

    provider: ToolAdapterConfig = Field(
        default_factory=lambda: ToolAdapterConfig(
            adapter="ravn.adapters.tools.web_search.MockWebSearchProvider"
        ),
        description="Web search provider adapter configuration.",
    )
    num_results: int = Field(
        default=5,
        description="Default number of search results to return.",
    )


class WebToolsConfig(BaseModel):
    """Configuration for built-in web tools."""

    fetch: WebFetchConfig = Field(default_factory=WebFetchConfig)
    search: WebSearchConfig = Field(default_factory=WebSearchConfig)


class BashToolConfig(BaseModel):
    """Bash tool configuration (non-persistent, validation-gated execution)."""

    mode: str = Field(
        default="workspace_write",
        description=(
            "Permission mode for the bash tool. Mirrors PermissionConfig.mode. "
            "Controls which commands are allowed, denied, or require approval."
        ),
    )
    timeout_seconds: float = Field(
        default=120.0,
        description="Seconds to wait for a bash command before timing out.",
    )
    max_output_bytes: int = Field(
        default=100 * 1024,
        description=(
            "Maximum output size in bytes returned to the caller. "
            "Output exceeding this limit is truncated with a notice."
        ),
    )
    workspace_root: str = Field(
        default="",
        description=(
            "Absolute path to the workspace root used as the working directory "
            "and for path boundary checks. Defaults to CWD when empty."
        ),
    )


class ToolsConfig(BaseModel):
    """Tool availability and custom adapter configuration."""

    enabled: list[str] = Field(
        default_factory=list,
        description=(
            "Allowlist of built-in tool names to enable. "
            "Empty list means all built-in tools are enabled."
        ),
    )
    disabled: list[str] = Field(
        default_factory=list,
        description="Blocklist of built-in tool names to disable.",
    )
    custom: list[ToolAdapterConfig] = Field(
        default_factory=list,
        description="Custom tool adapters to register alongside built-ins.",
    )
    file: FileToolsConfig = Field(
        default_factory=FileToolsConfig,
        description="Limits and thresholds for the built-in file tools.",
    )
    terminal: TerminalToolConfig = Field(
        default_factory=TerminalToolConfig,
        description="Persistent shell configuration for the built-in terminal tool.",
    )
    web: WebToolsConfig = Field(
        default_factory=WebToolsConfig,
        description="Configuration for the built-in web tools (web_fetch, web_search).",
    )
    bash: BashToolConfig = Field(
        default_factory=BashToolConfig,
        description="Configuration for the bash tool (non-persistent, validation-gated).",
    )


class EmbeddingConfig(BaseModel):
    """Embedding backend configuration for semantic memory search."""

    enabled: bool = Field(
        default=False,
        description="Enable embedding-based semantic search in episodic memory.",
    )
    adapter: str = Field(
        default="ravn.adapters.embedding.sentence_transformer.SentenceTransformerEmbeddingAdapter",
        description="Fully-qualified class path for the embedding adapter.",
    )
    kwargs: dict[str, Any] = Field(
        default_factory=dict,
        description="Extra kwargs forwarded to the embedding adapter constructor.",
    )
    secret_kwargs_env: dict[str, str] = Field(
        default_factory=dict,
        description="Maps kwarg names to env var names for credential injection.",
    )
    rrf_k: int = Field(
        default=60,
        description="Reciprocal Rank Fusion constant k (higher = less top-rank bias).",
    )
    semantic_candidate_limit: int = Field(
        default=50,
        description="Maximum number of episodes scanned for cosine similarity.",
    )


class SkillConfig(BaseModel):
    """Skill extraction and discovery configuration."""

    enabled: bool = Field(
        default=True,
        description="Enable automatic skill extraction from recurring episode patterns.",
    )
    backend: Literal["file", "sqlite"] = Field(
        default="file",
        description="Skill storage backend: 'file' (Markdown registry) or 'sqlite'.",
    )
    path: str = Field(
        default="~/.ravn/skills.db",
        description="SQLite database path for skill storage.",
    )
    suggestion_threshold: int = Field(
        default=3,
        description="Minimum matching SUCCESS episodes before a skill is synthesised.",
    )
    cache_max_entries: int = Field(
        default=128,
        description="Maximum entries in the in-process LRU skill cache.",
    )
    skill_dirs: list[str] = Field(
        default_factory=list,
        description=(
            "Extra directories to search for user-defined skill Markdown files, "
            "in addition to the default .ravn/skills/ and ~/.ravn/skills/ paths. "
            "Paths are searched in order; earlier entries have higher priority."
        ),
    )
    include_builtin: bool = Field(
        default=True,
        description="Include the built-in skills shipped with Ravn in the skill registry.",
    )


class MemoryConfig(BaseModel):
    """Conversation memory / persistence backend configuration."""

    backend: Literal["sqlite", "postgres", "buri"] | str = Field(
        default="sqlite",
        description=(
            "Backend to use: 'sqlite', 'postgres', 'buri', or a fully-qualified class path "
            "for a custom backend adapter."
        ),
    )
    path: str = Field(
        default="~/.ravn/memory.db",
        description="File path for sqlite backend.",
    )
    dsn: str = Field(
        default="",
        description="PostgreSQL DSN for postgres backend.",
    )
    dsn_env: str = Field(
        default="",
        description="Env var name to read the DSN from (takes precedence over dsn).",
    )
    prefetch_budget: int = Field(
        default=2000,
        description="Maximum approximate tokens of past context injected per turn.",
    )
    prefetch_limit: int = Field(
        default=5,
        description="Maximum number of episodes retrieved during prefetch.",
    )
    prefetch_min_relevance: float = Field(
        default=0.3,
        description="Minimum relevance score (0–1) for an episode to appear in prefetch.",
    )
    recency_half_life_days: float = Field(
        default=14.0,
        description="Half-life in days for the exponential recency decay applied to episodes.",
    )
    max_retries: int = Field(
        default=15,
        description="Maximum retry attempts on SQLite 'database is locked' errors.",
    )
    min_retry_jitter_ms: float = Field(
        default=20.0,
        description="Minimum random jitter (ms) between SQLite retry attempts.",
    )
    max_retry_jitter_ms: float = Field(
        default=150.0,
        description="Maximum random jitter (ms) between SQLite retry attempts.",
    )
    checkpoint_interval: int = Field(
        default=50,
        description="Number of writes between passive WAL checkpoints.",
    )
    session_search_truncate_chars: int = Field(
        default=100_000,
        description="Maximum characters of episode content returned per session in session_search.",
    )


class PermissionRuleConfig(BaseModel):
    """A single permission rule entry."""

    pattern: str = Field(description="Permission name or glob pattern.")
    action: Literal["allow", "deny", "ask"] = Field(
        default="ask",
        description="Action to take: 'allow', 'deny', or 'ask'.",
    )


class PermissionConfig(BaseModel):
    """Permission enforcement configuration."""

    mode: Literal[
        "read_only",
        "workspace_write",
        "full_access",
        "prompt",
        # Legacy aliases kept for backwards compatibility
        "allow_all",
        "deny_all",
    ] = Field(
        default="workspace_write",
        description=(
            "Permission mode: "
            "'read_only' (no mutations), "
            "'workspace_write' (writes within workspace only), "
            "'full_access' (unrestricted, explicit opt-in), "
            "'prompt' (interactive confirmation per action)."
        ),
    )
    workspace_root: str = Field(
        default="",
        description=(
            "Absolute path to the workspace root enforced in workspace_write mode. "
            "Defaults to the current working directory when empty."
        ),
    )
    allow: list[str] = Field(
        default_factory=list,
        description="Tool names or permission strings always granted without prompting.",
    )
    deny: list[str] = Field(
        default_factory=list,
        description="Tool names or permission strings always denied.",
    )
    ask: list[str] = Field(
        default_factory=list,
        description="Tool names or permission strings that always prompt the user.",
    )
    rules: list[PermissionRuleConfig] = Field(
        default_factory=list,
        description="Ordered rules evaluated before the default mode.",
    )


class MCPAuthConfig(BaseModel):
    """Authentication configuration for a single MCP server.

    auth_type determines which flow is used when ``mcp_auth`` is called.
    All sensitive values (secrets, API keys) must be referenced via env-var
    names rather than inlined — Bifrost or the RAVN.md secrets block injects
    the actual values at runtime.
    """

    auth_type: str | None = Field(
        default=None,
        description=(
            "Auth flow: 'api_key', 'device_flow', or 'client_credentials'. "
            "None means no auth required."
        ),
    )
    # OAuth 2.0 (device_flow + client_credentials)
    token_url: str = Field(default="", description="OAuth token endpoint URL.")
    client_id: str = Field(default="", description="OAuth client ID.")
    client_secret_env: str = Field(
        default="",
        description="Environment variable name holding the OAuth client secret.",
    )
    scope: str = Field(default="", description="Space-separated OAuth scopes.")
    audience: str = Field(default="", description="OAuth audience claim (optional).")
    # API key
    api_key_env: str = Field(
        default="",
        description="Environment variable name holding the API key value.",
    )
    api_key_header: str = Field(
        default="Authorization",
        description="HTTP header used to send the API key.",
    )
    api_key_prefix: str = Field(
        default="Bearer",
        description="Value prefix, e.g. 'Bearer' or 'ApiKey'.",
    )


class MCPTokenStoreConfig(BaseModel):
    """Configuration for the MCP token persistence backend.

    'local' (Pi mode): tokens stored in an encrypted JSON file.
    'openbao' (infra mode): tokens stored in an OpenBao KV v2 secret.
    """

    backend: Literal["local", "openbao"] = Field(
        default="local",
        description="Token store backend: 'local' (encrypted file) or 'openbao'.",
    )
    local_path: str = Field(
        default="~/.ravn/mcp_tokens.json",
        description="Path for the local encrypted token file.",
    )
    openbao_url: str = Field(
        default="http://openbao:8200",
        description="OpenBao base URL.",
    )
    openbao_token_env: str = Field(
        default="OPENBAO_TOKEN",
        description="Environment variable name holding the OpenBao token.",
    )
    openbao_mount: str = Field(
        default="secret",
        description="OpenBao KV secrets engine mount path.",
    )
    openbao_path_prefix: str = Field(
        default="ravn/mcp",
        description="Sub-path prefix within the KV mount.",
    )


class MCPServerConfig(BaseModel):
    """Configuration for a single MCP server."""

    name: str = Field(description="Human-readable name for this server.")
    transport: Literal["stdio", "sse", "http"] = Field(
        default="stdio",
        description="Transport type: 'stdio', 'sse', or 'http'.",
    )
    command: str = Field(
        default="",
        description="Command to launch the server (stdio transport).",
    )
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(
        default_factory=dict,
        description="Extra environment variables passed to the server process.",
    )
    url: str = Field(
        default="",
        description="URL for http/sse transport.",
    )
    timeout: float = Field(
        default=30.0,
        description="Request/read timeout in seconds.",
    )
    connect_timeout: float = Field(
        default=10.0,
        description="Connection timeout in seconds (SSE transport).",
    )
    enabled: bool = Field(default=True)
    auth: MCPAuthConfig = Field(
        default_factory=MCPAuthConfig,
        description="Authentication configuration for this server.",
    )


class HookConfig(BaseModel):
    """Configuration for a single pre/post tool hook."""

    adapter: str = Field(description="Fully-qualified class path for the hook.")
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)
    events: list[str] = Field(
        default_factory=lambda: ["pre_tool", "post_tool"],
        description="Events this hook fires on: 'pre_tool', 'post_tool'.",
    )


class HooksConfig(BaseModel):
    """Pre/post tool hook configuration."""

    pre_tool: list[HookConfig] = Field(default_factory=list)
    post_tool: list[HookConfig] = Field(default_factory=list)


class ChannelConfig(BaseModel):
    """Configuration for a single output channel."""

    adapter: str = Field(
        default="ravn.adapters.cli_channel.CliChannel",
        description="Fully-qualified class path for the channel adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)


class ContextConfig(BaseModel):
    """Project context discovery configuration."""

    per_file_limit: int = Field(
        default=4096,
        description="Maximum characters read from a single context file.",
    )
    total_budget: int = Field(
        default=12288,
        description="Maximum total characters of context injected into the system prompt.",
    )


class OutcomeConfig(BaseModel):
    """Task outcome recording and post-task reflection configuration."""

    enabled: bool = Field(
        default=True,
        description="Enable outcome recording and self-reflection after each task.",
    )
    path: str = Field(
        default="~/.ravn/memory.db",
        description="SQLite database path for outcome storage (can share with memory backend).",
    )
    reflection_model: str = Field(
        default="claude-haiku-4-5-20251001",
        description="Model alias used for the compact post-task reflection call ('fast').",
    )
    reflection_max_tokens: int = Field(
        default=512,
        description="Maximum tokens for the reflection LLM call.",
    )
    lessons_limit: int = Field(
        default=3,
        description="Number of past outcomes injected as 'lessons learned' per turn.",
    )
    task_summary_max_chars: int = Field(
        default=200,
        description="Maximum characters of the user input stored as the task summary.",
    )
    lessons_token_budget: int = Field(
        default=1500,
        description="Maximum approximate tokens of lessons-learned content injected per turn.",
    )
    input_token_cost_per_million: float = Field(
        default=3.0,
        description="Input token cost in USD per million tokens (used to estimate cost_usd).",
    )
    output_token_cost_per_million: float = Field(
        default=15.0,
        description="Output token cost in USD per million tokens (used to estimate cost_usd).",
    )


class AgentConfig(BaseModel):
    """Core agent behaviour configuration."""

    model: str = Field(default="claude-sonnet-4-6")
    max_tokens: int = Field(default=8192)
    max_iterations: int = Field(default=20, description="Max tool-call iterations per turn.")
    system_prompt: str = Field(
        default=(
            "You are Ravn, a helpful AI assistant. "
            "Be concise, accurate, and use tools when they help."
        )
    )
    episode_summary_max_chars: int = Field(
        default=500,
        description="Maximum characters of the agent response stored as an episode summary.",
    )
    episode_task_max_chars: int = Field(
        default=200,
        description="Maximum characters of the user input stored as the episode task description.",
    )
    outcome: OutcomeConfig = Field(
        default_factory=OutcomeConfig,
        description="Task outcome recording and self-reflection configuration.",
    )


# ---------------------------------------------------------------------------
# Context management config (NIU-431)
# ---------------------------------------------------------------------------


class IterationBudgetConfig(BaseModel):
    """Iteration budget configuration."""

    total: int = Field(
        default=90,
        description="Total iterations allowed across a session or cascade.",
    )
    near_limit_threshold: float = Field(
        default=0.8,
        description=(
            "Fraction of total iterations consumed before 'near limit' warnings are emitted "
            "(0.0–1.0, default 0.8 = 80%)."
        ),
    )


class ContextManagementConfig(BaseModel):
    """Context compression and prompt-builder configuration."""

    compression_threshold: float = Field(
        default=0.8,
        description=(
            "Fraction of the model's context window that triggers compaction "
            "(0.0–1.0, default 0.8 — fires when <20% of the context window remains)."
        ),
    )
    protect_first_messages: int = Field(
        default=2,
        description="Number of messages at the start of history to preserve unchanged.",
    )
    protect_last_messages: int = Field(
        default=6,
        description="Number of messages at the end of history to preserve unchanged.",
    )
    compact_recent_turns: int = Field(
        default=3,
        description=(
            "Number of recent conversation turns (user+assistant pairs) to preserve "
            "verbatim at the end of the history.  Overrides protect_last_messages when "
            "non-zero: protect_last = compact_recent_turns * 2."
        ),
    )
    compression_max_tokens: int = Field(
        default=1024,
        description="Max tokens for compaction document generation.",
    )
    prompt_cache_max_entries: int = Field(
        default=16,
        description="Maximum number of entries in the in-process LRU prompt cache.",
    )
    prompt_cache_dir: str = Field(
        default="~/.ravn/prompt_cache",
        description="Directory for disk-snapshot prompt cache entries.",
    )

    def effective_protect_last(self) -> int:
        """Return the protect_last value to pass to ContextCompressor.

        When ``compact_recent_turns`` is non-zero it takes precedence:
        ``protect_last = compact_recent_turns * 2`` (one turn = user + assistant).
        Falls back to ``protect_last_messages`` when ``compact_recent_turns`` is 0.
        """
        if self.compact_recent_turns > 0:
            return self.compact_recent_turns * 2
        return self.protect_last_messages


# ---------------------------------------------------------------------------
# Legacy adapter config (kept for backwards compat with NIU-426 wiring)
# ---------------------------------------------------------------------------


class LLMAdapterConfig(BaseModel):
    """Dynamic LLM adapter configuration (legacy; prefer llm.provider)."""

    adapter: str = Field(
        default="ravn.adapters.llm.anthropic.AnthropicAdapter",
        description="Fully-qualified class path for the LLM adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    max_retries: int = Field(default=3)
    retry_base_delay: float = Field(default=1.0)
    timeout: float = Field(default=120.0)


class EvolutionConfig(BaseModel):
    """Self-improvement loop configuration (NIU-501).

    Controls when the pattern extraction pass runs and how many samples it
    analyses when looking for recurring tool sequences, error patterns, and
    effective strategies.
    """

    enabled: bool = Field(
        default=True,
        description="Enable the self-improvement pattern extraction pass.",
    )
    min_new_outcomes: int = Field(
        default=10,
        description=(
            "Minimum number of new outcomes recorded since the last extraction "
            "before the pass is triggered automatically on startup."
        ),
    )
    state_path: str = Field(
        default="~/.ravn/evolution_state.json",
        description="Path to the JSON file that persists the last-run state.",
    )
    max_episodes_to_analyze: int = Field(
        default=100,
        description="Maximum number of episodes loaded per extraction pass.",
    )
    max_outcomes_to_analyze: int = Field(
        default=50,
        description="Maximum number of task outcomes loaded per extraction pass.",
    )
    skill_suggestion_min_occurrences: int = Field(
        default=3,
        description="Minimum times a tool pattern must appear before a skill is suggested.",
    )
    error_warning_min_occurrences: int = Field(
        default=3,
        description="Minimum times an error keyword must appear before a warning is proposed.",
    )
    strategy_min_occurrences: int = Field(
        default=3,
        description=(
            "Minimum times a domain tag must appear in SUCCESS episodes "
            "before a strategy injection is proposed."
        ),
    )
    max_skill_suggestions: int = Field(
        default=5,
        description="Maximum skill suggestions to include in one evolution proposal.",
    )
    max_system_warnings: int = Field(
        default=5,
        description="Maximum system-prompt warnings to include in one proposal.",
    )
    max_strategy_injections: int = Field(
        default=3,
        description="Maximum strategy injections to include in one proposal.",
    )


class TelegramChannelConfig(BaseModel):
    """Telegram channel configuration."""

    enabled: bool = Field(default=False)
    token_env: str = Field(
        default="TELEGRAM_BOT_TOKEN",
        description="Environment variable name containing the Telegram bot token.",
    )
    allowed_chat_ids: list[int] = Field(
        default_factory=list,
        description="Chat IDs allowed to interact with the bot. Empty list means all.",
    )
    poll_timeout: int = Field(
        default=30,
        description="Long-poll timeout in seconds for getUpdates.",
    )
    retry_delay: float = Field(
        default=5.0,
        description="Seconds to wait after a poll error before retrying.",
    )
    message_max_chars: int = Field(
        default=4096,
        description="Maximum characters per outbound Telegram message (API limit).",
    )


class HttpChannelConfig(BaseModel):
    """Local HTTP gateway channel configuration."""

    enabled: bool = Field(default=False)
    host: str = Field(
        default="127.0.0.1",
        description="Host/IP to bind the HTTP gateway server.",
    )
    port: int = Field(
        default=7477,
        description="TCP port for the HTTP gateway server.",
    )
    translator: str = Field(
        default="ravn.adapters.events.cli_translator.CliFormatTranslator",
        description="Fully-qualified class path for the EventTranslatorPort implementation.",
    )


class SkuldChannelConfig(BaseModel):
    """Skuld WebSocket channel configuration for gateway mode."""

    enabled: bool = Field(default=False)
    broker_url: str = Field(
        default="ws://localhost:9000/ws/ravn",
        description="WebSocket URL of the Skuld broker endpoint.",
    )


class PlatformToolsConfig(BaseModel):
    """Platform integration tools (Volundr sessions, git, Tyr sagas, tracker)."""

    enabled: bool = Field(
        default=False,
        description="Register platform tools (requires Volundr/Tyr backend).",
    )
    base_url: str = Field(default="http://localhost:8080")
    timeout: float = Field(default=30.0)


class GatewayChannelsConfig(BaseModel):
    """Per-channel gateway configuration."""

    telegram: TelegramChannelConfig = Field(default_factory=TelegramChannelConfig)
    http: HttpChannelConfig = Field(default_factory=HttpChannelConfig)
    skuld: SkuldChannelConfig = Field(default_factory=SkuldChannelConfig)


class GatewayConfig(BaseModel):
    """Pi-mode gateway — Telegram + local HTTP access without Kubernetes.

    When enabled, Ravn runs two extra asyncio tasks:
    - A Telegram long-poll loop (no webhook, no open inbound port required).
    - A FastAPI HTTP server on localhost (or LAN IP).

    Each channel+user pair gets its own isolated agent session.
    """

    enabled: bool = Field(default=False)
    channels: GatewayChannelsConfig = Field(default_factory=GatewayChannelsConfig)
    platform: PlatformToolsConfig = Field(default_factory=PlatformToolsConfig)


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="warning")
    format: str = Field(default="text")


class BuriConfig(BaseModel):
    """Búri knowledge memory substrate configuration (NIU-541).

    Controls typed fact graph, proto-RWKV session state, and proto-vMF
    embedding cluster behaviour.  Active when ``memory.backend = 'buri'``.
    """

    enabled: bool = Field(
        default=True,
        description="Enable Búri knowledge memory features.",
    )
    cluster_merge_threshold: float = Field(
        default=0.15,
        description=(
            "Cosine distance below which a new fact is merged into an existing cluster "
            "rather than creating a new one.  Lower = tighter clusters."
        ),
    )
    extraction_model: str = Field(
        default="",
        description=(
            "Model to use for fact extraction. Empty = use settings.agent.outcome.reflection_model."
        ),
    )
    min_confidence: float = Field(
        default=0.6,
        description=(
            "Facts classified with confidence below this threshold are stored as "
            "'observation' regardless of the inferred type."
        ),
    )
    session_summary_max_tokens: int = Field(
        default=400,
        description="Maximum tokens for the proto-RWKV rolling session summary.",
    )
    supersession_cosine_threshold: float = Field(
        default=0.85,
        description=(
            "Cosine similarity threshold above which an existing fact is considered "
            "superseded by a new one (requires type match + entity overlap)."
        ),
    )


# ---------------------------------------------------------------------------
# Root settings
# ---------------------------------------------------------------------------


class Settings(BaseSettings):
    """Ravn application settings.

    Loaded from YAML with RAVN_ environment variable overrides.
    Precedence: env vars > yaml file > defaults.
    """

    model_config = SettingsConfigDict(
        yaml_file_encoding="utf-8",
        env_prefix="RAVN_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # Core sections
    anthropic: AnthropicConfig = Field(default_factory=AnthropicConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)

    # New NIU-427 sections
    context: ContextConfig = Field(default_factory=ContextConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    tools: ToolsConfig = Field(default_factory=ToolsConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    permission: PermissionConfig = Field(default_factory=PermissionConfig)
    mcp_servers: list[MCPServerConfig] = Field(default_factory=list)
    mcp_token_store: MCPTokenStoreConfig = Field(default_factory=MCPTokenStoreConfig)
    hooks: HooksConfig = Field(default_factory=HooksConfig)
    channels: list[ChannelConfig] = Field(
        default_factory=list,
        deprecated="Use gateway.channels instead. This field is ignored.",
    )

    # NIU-431: context management
    iteration_budget: IterationBudgetConfig = Field(default_factory=IterationBudgetConfig)
    context_management: ContextManagementConfig = Field(default_factory=ContextManagementConfig)

    # NIU-436: semantic memory
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    skill: SkillConfig = Field(default_factory=SkillConfig)

    # NIU-501: self-improvement loop
    evolution: EvolutionConfig = Field(default_factory=EvolutionConfig)

    # NIU-516: Pi-mode gateway
    gateway: GatewayConfig = Field(default_factory=GatewayConfig)

    # NIU-541: Búri knowledge memory substrate
    buri: BuriConfig = Field(default_factory=lambda: BuriConfig())

    # Legacy — kept so existing CLI wiring (NIU-426) continues to work
    llm_adapter: LLMAdapterConfig = Field(default_factory=LLMAdapterConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls, yaml_file=_config_paths()),
            file_secret_settings,
        )

    def effective_api_key(self) -> str:
        """Return the API key, preferring ANTHROPIC_API_KEY env var."""
        return os.environ.get("ANTHROPIC_API_KEY", "") or self.anthropic.api_key

    def effective_model(self) -> str:
        """Return the resolved model name.

        Prefers ``llm.model``.  Falls back to ``agent.model`` when
        ``llm.model`` is at its default but ``agent.model`` has been
        explicitly set (backward-compat with pre-consolidation configs).
        """
        _default = "claude-sonnet-4-6"
        if self.llm.model != _default:
            return self.llm.model
        if self.agent.model != _default:
            import logging as _log

            _log.getLogger(__name__).warning(
                "agent.model is deprecated — use llm.model instead",
            )
            return self.agent.model
        return _default

    def effective_max_tokens(self) -> int:
        """Return the resolved max_tokens.

        Same backward-compat logic as :meth:`effective_model`.
        """
        _default = 8192
        if self.llm.max_tokens != _default:
            return self.llm.max_tokens
        if self.agent.max_tokens != _default:
            import logging as _log

            _log.getLogger(__name__).warning(
                "agent.max_tokens is deprecated — use llm.max_tokens instead",
            )
            return self.agent.max_tokens
        return _default


# ---------------------------------------------------------------------------
# Project-level config overlay (RAVN.md)
# ---------------------------------------------------------------------------


def _safe_int(val: object, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on ValueError/TypeError."""
    try:
        return int(val)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return default


def _safe_bool(val: object, default: bool = False) -> bool:
    """Convert *val* to bool, returning *default* on unrecognised input."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "yes", "1", "on")
    if isinstance(val, int):
        return bool(val)
    return default


# ---------------------------------------------------------------------------
# Valid schema values
# ---------------------------------------------------------------------------

_VALID_PERMISSION_MODES: frozenset[str] = frozenset(
    {
        "read_only",
        "workspace_write",
        "workspace-write",
        "full_access",
        "full-access",
        "prompt",
        # Legacy aliases
        "allow_all",
        "deny_all",
    }
)

_VALID_PERSONAS: frozenset[str] = frozenset(
    {
        "coding-agent",
        "assistant",
        "researcher",
        "reviewer",
        "planner",
    }
)


@dataclass
class ProjectConfig:
    """Project-level configuration overlay parsed from a RAVN.md file.

    When Ravn starts in a directory containing RAVN.md it reads this as a
    lightweight config overlay on top of the global Settings.  Only fields
    explicitly present in the file are populated; absent fields keep their
    zero/empty defaults so callers can safely merge them with Settings.

    Format (Markdown header + YAML body)::

        # RAVN Project: my-service

        persona: coding-agent
        allowed_tools: [file, git, terminal, web]
        forbidden_tools: [volundr, cascade]
        permission_mode: workspace-write
        primary_alias: balanced
        thinking_enabled: true
        iteration_budget: 30
        notes: >
          This is a FastAPI service. Always run tests before committing.

    Attributes:
        warnings: Non-fatal schema validation messages populated by
            ``from_text()``.  Callers may display these to the user.
    """

    project_name: str = ""
    persona: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    forbidden_tools: list[str] = field(default_factory=list)
    permission_mode: str = ""
    primary_alias: str = ""
    thinking_enabled: bool = False
    iteration_budget: int = 0
    notes: str = ""
    warnings: list[str] = field(default_factory=list)

    @classmethod
    def from_text(cls, text: str) -> ProjectConfig:
        """Parse RAVN.md *text* into a ProjectConfig.

        The file must start with a ``# RAVN Project: <name>`` header.
        Everything after the header is treated as YAML.  If the header is
        absent or the YAML is malformed the method returns an empty
        ProjectConfig rather than raising.

        Schema validation warnings are stored in ``ProjectConfig.warnings``.
        """
        import yaml  # PyYAML — present via pydantic-settings[yaml]

        project_name = ""
        yaml_lines: list[str] = []
        past_header = False

        for line in text.splitlines():
            if not past_header:
                if line.startswith("# RAVN Project:"):
                    project_name = line[len("# RAVN Project:") :].strip()
                    past_header = True
                continue
            yaml_lines.append(line)

        raw: dict = {}
        if yaml_lines:
            try:
                parsed = yaml.safe_load("\n".join(yaml_lines))
                if isinstance(parsed, dict):
                    raw = parsed
            except Exception:
                pass

        warnings: list[str] = []

        permission_mode = str(raw.get("permission_mode", ""))
        if permission_mode and permission_mode not in _VALID_PERMISSION_MODES:
            warnings.append(
                f"Unknown permission_mode {permission_mode!r}. "
                f"Valid values: {sorted(_VALID_PERMISSION_MODES)}"
            )

        persona = str(raw.get("persona", ""))
        if persona and persona not in _VALID_PERSONAS:
            warnings.append(
                f"Unknown persona {persona!r}. Known personas: {sorted(_VALID_PERSONAS)}"
            )

        iteration_budget = _safe_int(raw.get("iteration_budget", 0))
        if iteration_budget < 0:
            warnings.append(f"iteration_budget must be >= 0, got {iteration_budget}. Using 0.")
            iteration_budget = 0

        return cls(
            project_name=project_name,
            persona=persona,
            allowed_tools=list(raw.get("allowed_tools", [])),
            forbidden_tools=list(raw.get("forbidden_tools", [])),
            permission_mode=permission_mode,
            primary_alias=str(raw.get("primary_alias", "")),
            thinking_enabled=_safe_bool(raw.get("thinking_enabled", False)),
            iteration_budget=iteration_budget,
            notes=str(raw.get("notes", "")),
            warnings=warnings,
        )

    @classmethod
    def load(cls, path: Path) -> ProjectConfig | None:
        """Load a ProjectConfig from *path*, or None if the file is unreadable."""
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return cls.from_text(text)

    @classmethod
    def discover(cls, cwd: Path | None = None) -> ProjectConfig | None:
        """Walk from *cwd* toward the filesystem root looking for RAVN.md.

        Discovery order:
        1. *cwd* (defaults to ``Path.cwd()``)
        2. Each ancestor directory up to the filesystem root
        3. ``~/.ravn/default.md`` — user-level global default

        Returns the first ``ProjectConfig`` found, or ``None`` if no file
        exists in any of the above locations.
        """
        start = Path(cwd) if cwd is not None else Path.cwd()
        current = start.resolve()
        while True:
            candidate = current / "RAVN.md"
            if candidate.is_file():
                return cls.load(candidate)
            parent = current.parent
            if parent == current:
                break
            current = parent

        # Global user default — ~/.ravn/default.md
        global_default = Path.home() / ".ravn" / "default.md"
        if global_default.is_file():
            return cls.load(global_default)

        return None
