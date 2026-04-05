"""Bifröst configuration: providers, aliases, routing settings, auth, and quotas."""

from __future__ import annotations

import fnmatch
import os
import re
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from bifrost.auth import AuthMode


class RoutingStrategy(StrEnum):
    """How the router selects and orders provider candidates for a request."""

    DIRECT = "direct"
    """Try only the first configured provider for the model. No failover."""

    FAILOVER = "failover"
    """Try the primary provider; fall back to alternatives on retryable errors."""

    COST_OPTIMISED = "cost_optimised"
    """Order providers by cost_per_token ascending (cheapest first)."""

    ROUND_ROBIN = "round_robin"
    """Cycle through all providers that serve the model on each request."""

    LATENCY_OPTIMISED = "latency_optimised"
    """Order providers by recent P99 latency ascending (fastest first)."""


class ProviderConfig(BaseModel):
    """Configuration for a single LLM provider."""

    api_key_env: str = Field(default="", description="Environment variable holding the API key.")
    api_key_file: str = Field(
        default="",
        description=(
            "Path to a file whose contents are the API key. "
            "Used as a fallback when api_key_env is absent or empty. "
            "Suitable for Kubernetes secret mounts."
        ),
    )
    base_url: str = Field(default="", description="Base URL for the provider's API.")
    models: list[str] = Field(
        default_factory=list, description="Models supported by this provider."
    )
    timeout: float = Field(default=120.0, description="Request timeout in seconds.")
    cost_per_token: float = Field(
        default=0.0,
        description=(
            "Relative cost per token (arbitrary units). Used by the cost_optimised "
            "routing strategy to prefer cheaper providers. Lower is cheaper."
        ),
    )

    @property
    def api_key(self) -> str:
        if not self.api_key_env:
            return ""
        return os.environ.get(self.api_key_env, "")


class PricingOverride(BaseModel):
    """USD per million tokens for a single model (overrides built-in snapshot)."""

    input_per_million: float = 0.0
    output_per_million: float = 0.0
    cache_creation_per_million: float = 0.0
    cache_read_per_million: float = 0.0


class QuotaConfig(BaseModel):
    """Quota limits for a tenant or agent."""

    max_tokens_per_day: int = Field(
        default=0,
        description="Maximum total tokens (input + output) per day. 0 = unlimited.",
    )
    max_cost_per_day: float = Field(
        default=0.0,
        description="Maximum USD cost per day. 0.0 = unlimited.",
    )
    max_requests_per_hour: int = Field(
        default=0,
        description="Maximum requests per calendar hour. 0 = unlimited.",
    )
    soft_limit_fraction: float = Field(
        default=0.9,
        description=(
            "Fraction of any hard limit at which a warning header is injected "
            "(0 < fraction < 1). Default: 0.9 (warn at 90% of the limit)."
        ),
    )


class AgentPermissions(BaseModel):
    """Per-agent access control and optional budget."""

    allowed_models: list[str] = Field(
        default_factory=list,
        description=(
            "Models this agent is permitted to use. Empty list means all models are allowed."
        ),
    )
    quota: QuotaConfig = Field(
        default_factory=QuotaConfig,
        description="Optional per-agent quota (zero values mean no limit).",
    )


class RuleCondition(BaseModel):
    """Conditions that must all match for a rule to fire (AND semantics).

    Numeric fields accept comparison expressions like ``'<= 512'`` or ``'>= 80'``.
    Plain numbers are treated as equality checks.
    """

    model: str | None = Field(
        default=None,
        description="Match when the request model equals this alias or model ID.",
    )
    max_tokens: str | None = Field(
        default=None,
        description="Numeric comparison expression for max_tokens (e.g. '<= 512').",
    )
    thinking: bool | None = Field(
        default=None,
        description="Match when thinking is enabled (true) or disabled (false).",
    )
    agent_budget_pct: str | None = Field(
        default=None,
        description="Numeric comparison expression for remaining agent budget % (e.g. '>= 80').",
    )
    provider: str | None = Field(
        default=None,
        description="Match when the resolved primary provider name equals this value.",
    )
    has_tools: bool | None = Field(
        default=None,
        description="Match when the request includes tool definitions (true) or not (false).",
    )
    content_matches: str | None = Field(
        default=None,
        description="Regex pattern applied to the full concatenated message content.",
    )
    system_prompt_matches: str | None = Field(
        default=None,
        description="Regex pattern applied to the system prompt text.",
    )
    message_count: str | None = Field(
        default=None,
        description="Numeric comparison expression for the number of messages (e.g. '>= 10').",
    )
    has_image: bool | None = Field(
        default=None,
        description="Match when the request contains image blocks (true) or not (false).",
    )

    @model_validator(mode="after")
    def _validate_regex_fields(self) -> RuleCondition:
        for field_name in ("content_matches", "system_prompt_matches"):
            pattern = getattr(self, field_name)
            if pattern is not None:
                try:
                    re.compile(pattern)
                except re.error as exc:
                    raise ValueError(f"Invalid regex in {field_name}: {exc}") from None
        return self


class RuleConfig(BaseModel):
    """A single declarative routing rule."""

    name: str = Field(description="Human-readable rule identifier (used in logs).")
    when: RuleCondition = Field(description="Conditions that must all match for the rule to fire.")
    action: Literal["route_to", "reject", "log", "tag", "strip_images"] = Field(
        description="Action to take when the rule matches.",
    )
    target: str | None = Field(
        default=None,
        description="Model or alias to route to (required for action='route_to').",
    )
    message: str | None = Field(
        default=None,
        description="Rejection message returned to the caller (for action='reject').",
    )
    tags: dict[str, str] = Field(
        default_factory=dict,
        description="Metadata key-value pairs added to the audit entry (for action='tag').",
    )

    @model_validator(mode="after")
    def _validate_action_fields(self) -> RuleConfig:
        if self.action == "route_to" and not self.target:
            raise ValueError("target is required when action is 'route_to'")
        return self


class UsageStoreConfig(BaseModel):
    """Configuration for the usage persistence backend."""

    adapter: str = Field(
        default="memory",
        description=("Storage backend. Accepted values: 'memory' (default), 'sqlite', 'postgres'."),
    )
    path: str = Field(
        default="./bifrost_usage.db",
        description="File path for the SQLite backend (ignored for other adapters).",
    )
    dsn: str = Field(
        default="",
        description=(
            "PostgreSQL DSN for the postgres backend (ignored for other adapters). "
            "Falls back to the BIFROST_USAGE_DSN environment variable when blank."
        ),
    )
    dsn_env: str = Field(
        default="BIFROST_USAGE_DSN",
        description="Environment variable holding the PostgreSQL DSN (used when dsn is blank).",
    )

    def effective_dsn(self) -> str:
        """Return the DSN, falling back to the configured environment variable."""
        return self.dsn or os.environ.get(self.dsn_env, "")


class KeyVaultConfig(BaseModel):
    """Configuration for the provider key vault."""

    secrets_file: str = Field(
        default="",
        description=(
            "Path to a YAML file mapping provider names to API keys. "
            "When set, keys are loaded from this file instead of (or in "
            "addition to) environment variables. "
            "File format: ``provider_name: api_key_value``."
        ),
    )


# Default base URLs per provider type.
_DEFAULT_BASE_URLS: dict[str, str] = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
    "ollama": "http://localhost:11434",
}


class BifrostConfig(BaseModel):
    """Top-level Bifröst gateway configuration."""

    providers: dict[str, ProviderConfig] = Field(
        default_factory=dict,
        description="Map of provider name → provider config.",
    )
    aliases: dict[str, str] = Field(
        default_factory=dict,
        description="Model alias → canonical model name.",
    )
    routing_strategy: RoutingStrategy = Field(
        default=RoutingStrategy.FAILOVER,
        description=(
            "How to select and order provider candidates. "
            "Defaults to 'failover' for backwards compatibility."
        ),
    )
    latency_ewma_alpha: float = Field(
        default=0.2,
        description=(
            "Smoothing factor for the EWMA latency estimator used by the "
            "latency_optimised strategy (0 < alpha <= 1). Higher values weight "
            "recent observations more heavily."
        ),
    )
    host: str = Field(default="0.0.0.0", description="Host to bind the gateway server.")
    port: int = Field(default=8088, description="Port to bind the gateway server.")

    # ── Authentication ───────────────────────────────────────────────────────
    auth_mode: AuthMode = Field(
        default=AuthMode.OPEN,
        description=(
            "Authentication mode: 'open' (trust headers), "
            "'pat' (Bearer JWT), or 'mesh' (Envoy injected headers)."
        ),
    )
    pat_secret: str = Field(
        default="",
        description=(
            "HS256 signing secret for PAT verification. "
            "Required when auth_mode = 'pat'. "
            "Read from the PAT_SECRET environment variable if blank."
        ),
    )

    # ── Pricing overrides ───────────────────────────────────────────────────
    pricing: dict[str, PricingOverride] = Field(
        default_factory=dict,
        description=(
            "Per-model pricing overrides (USD / million tokens). "
            "Unspecified models fall back to the built-in snapshot."
        ),
    )
    pricing_file: str = Field(
        default="",
        description=(
            "Path to a YAML file containing per-model pricing (USD / million tokens). "
            "Loaded at startup and merged with the built-in snapshot. "
            "Inline ``pricing`` overrides take precedence over this file. "
            "Format: ``model_id: {input_per_million, output_per_million, "
            "cache_creation_per_million, cache_read_per_million}``."
        ),
    )

    # ── Quota enforcement ────────────────────────────────────────────────────
    default_quota: QuotaConfig = Field(
        default_factory=QuotaConfig,
        description="Default quota applied to all tenants (zero values = unlimited).",
    )
    tenant_quotas: dict[str, QuotaConfig] = Field(
        default_factory=dict,
        description="Per-tenant quota overrides (keyed by tenant_id).",
    )
    agent_permissions: dict[str, AgentPermissions] = Field(
        default_factory=dict,
        description="Per-agent model access control and optional budget.",
    )

    # ── Routing rules ────────────────────────────────────────────────────────
    rules: list[RuleConfig] = Field(
        default_factory=list,
        description=(
            "Declarative routing rules evaluated in order before the routing strategy runs. "
            "First match wins."
        ),
    )

    # ── Usage storage ────────────────────────────────────────────────────────
    usage_store: UsageStoreConfig = Field(
        default_factory=UsageStoreConfig,
        description="Configuration for the usage persistence backend.",
    )

    # ── Key vault ────────────────────────────────────────────────────────────
    key_vault: KeyVaultConfig = Field(
        default_factory=KeyVaultConfig,
        description=(
            "Provider API key vault configuration. "
            "Keys are loaded at startup and never returned in responses or logs."
        ),
    )

    # ── Helpers ──────────────────────────────────────────────────────────────

    def resolve_alias(self, model: str) -> str:
        """Expand a model alias to its canonical name."""
        return self.aliases.get(model, model)

    def provider_for_model(self, model: str) -> str | None:
        """Return the provider name that owns *model*, or None if unknown."""
        for name, cfg in self.providers.items():
            if model in cfg.models:
                return name
        return None

    def providers_for_model(self, model: str) -> list[str]:
        """Return all provider names that serve *model*, in config order."""
        return [name for name, cfg in self.providers.items() if model in cfg.models]

    def effective_base_url(self, provider_name: str) -> str:
        """Return the effective base URL for a provider, using defaults when absent."""
        cfg = self.providers.get(provider_name)
        if cfg and cfg.base_url:
            return cfg.base_url
        return _DEFAULT_BASE_URLS.get(provider_name, "")

    def effective_pat_secret(self) -> str:
        """Return the PAT signing secret, falling back to the PAT_SECRET env var."""
        return self.pat_secret or os.environ.get("PAT_SECRET", "")

    def quota_for_tenant(self, tenant_id: str) -> QuotaConfig:
        """Return the quota config for *tenant_id*, falling back to the default."""
        return self.tenant_quotas.get(tenant_id, self.default_quota)

    def permissions_for_agent(self, agent_id: str) -> AgentPermissions:
        """Return the permissions for *agent_id* (empty = unrestricted).

        Exact matches take priority over glob patterns.  When multiple
        patterns match, the first matching pattern (in config file order)
        is used.

        Examples of supported patterns::

            volundr-session-*   # matches volundr-session-abc, volundr-session-xyz
            tyr                 # exact match
            claude-code         # exact match
        """
        # Exact match takes priority.
        if agent_id in self.agent_permissions:
            return self.agent_permissions[agent_id]

        # Glob pattern match (first match wins, preserving config order).
        for pattern, perms in self.agent_permissions.items():
            if fnmatch.fnmatch(agent_id, pattern):
                return perms

        return AgentPermissions()
