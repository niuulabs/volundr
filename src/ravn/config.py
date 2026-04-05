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
        default="ravn.adapters.anthropic_adapter.AnthropicAdapter",
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


class MemoryConfig(BaseModel):
    """Conversation memory / persistence backend configuration."""

    backend: Literal["sqlite", "postgres"] | str = Field(
        default="sqlite",
        description=(
            "Backend to use: 'sqlite', 'postgres', or a fully-qualified class path "
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


class MCPServerConfig(BaseModel):
    """Configuration for a single MCP server."""

    name: str = Field(description="Human-readable name for this server.")
    transport: Literal["stdio", "http"] = Field(
        default="stdio",
        description="Transport type: 'stdio' or 'http'.",
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
        description="URL for http transport.",
    )
    enabled: bool = Field(default=True)


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


# ---------------------------------------------------------------------------
# Legacy adapter config (kept for backwards compat with NIU-426 wiring)
# ---------------------------------------------------------------------------


class LLMAdapterConfig(BaseModel):
    """Dynamic LLM adapter configuration (legacy; prefer llm.provider)."""

    adapter: str = Field(
        default="ravn.adapters.anthropic_adapter.AnthropicAdapter",
        description="Fully-qualified class path for the LLM adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    max_retries: int = Field(default=3)
    retry_base_delay: float = Field(default=1.0)
    timeout: float = Field(default=120.0)


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="warning")
    format: str = Field(default="text")


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
    hooks: HooksConfig = Field(default_factory=HooksConfig)
    channels: list[ChannelConfig] = Field(default_factory=list)

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


# ---------------------------------------------------------------------------
# Project-level config overlay (RAVN.md)
# ---------------------------------------------------------------------------


def _safe_int(val: object, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on ValueError/TypeError."""
    try:
        return int(val)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return default


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
        iteration_budget: 30
        notes: >
          This is a FastAPI service. Always run tests before committing.
    """

    project_name: str = ""
    persona: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    forbidden_tools: list[str] = field(default_factory=list)
    permission_mode: str = ""
    iteration_budget: int = 0
    notes: str = ""

    @classmethod
    def from_text(cls, text: str) -> ProjectConfig:
        """Parse RAVN.md *text* into a ProjectConfig.

        The file must start with a ``# RAVN Project: <name>`` header.
        Everything after the header is treated as YAML.  If the header is
        absent or the YAML is malformed the method returns an empty
        ProjectConfig rather than raising.
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

        return cls(
            project_name=project_name,
            persona=str(raw.get("persona", "")),
            allowed_tools=list(raw.get("allowed_tools", [])),
            forbidden_tools=list(raw.get("forbidden_tools", [])),
            permission_mode=str(raw.get("permission_mode", "")),
            iteration_budget=_safe_int(raw.get("iteration_budget", 0)),
            notes=str(raw.get("notes", "")),
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

        Returns the first ProjectConfig found, or None if no RAVN.md exists
        in any ancestor directory.
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
        return None
