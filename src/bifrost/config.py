"""Bifröst configuration: providers, aliases, routing settings, auth, and quotas."""

from __future__ import annotations

import os
from enum import StrEnum

from pydantic import BaseModel, Field

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
        description="PostgreSQL DSN for the postgres backend (ignored for other adapters).",
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

    # ── Usage storage ────────────────────────────────────────────────────────
    usage_store: UsageStoreConfig = Field(
        default_factory=UsageStoreConfig,
        description="Configuration for the usage persistence backend.",
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
        """Return the permissions for *agent_id* (empty = unrestricted)."""
        return self.agent_permissions.get(agent_id, AgentPermissions())
