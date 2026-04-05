"""Bifröst configuration: providers, aliases, and routing settings."""

from __future__ import annotations

import os
from enum import StrEnum

from pydantic import BaseModel, Field


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
    host: str = Field(default="0.0.0.0", description="Host to bind the gateway server.")
    port: int = Field(default=8088, description="Port to bind the gateway server.")

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
