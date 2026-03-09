"""Bifröst configuration."""

from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel, Field


class UpstreamAuthConfig(BaseModel):
    """Authentication configuration for an upstream provider."""

    mode: str = Field(
        default="passthrough",
        description='Authentication mode: "passthrough" forwards client '
        'headers, "api_key" injects an explicit key.',
    )
    key: str | None = Field(
        default=None,
        description="API key (or env-var reference like ${ANTHROPIC_API_KEY}).",
    )

    def resolve_key(self) -> str | None:
        """Resolve ``${VAR}`` references in *key* from the environment."""
        if self.key is None:
            return None
        if self.key.startswith("${") and self.key.endswith("}"):
            var = self.key[2:-1]
            return os.environ.get(var)
        return self.key


class UpstreamConfig(BaseModel):
    """Configuration for a single upstream model provider."""

    url: str = Field(default="https://api.anthropic.com")
    auth: UpstreamAuthConfig = Field(default_factory=UpstreamAuthConfig)
    timeout_s: float = Field(
        default=300.0,
        description="Total request timeout in seconds (long for agentic turns).",
    )
    connect_timeout_s: float = Field(
        default=10.0,
        description="TCP connect timeout in seconds.",
    )


# ------------------------------------------------------------------
# Phase B: multi-upstream, rules, routing config
# ------------------------------------------------------------------


class UpstreamEntryConfig(BaseModel):
    """Named upstream provider entry."""

    adapter: str = Field(
        default="anthropic_direct",
        description='Adapter type: "anthropic_direct" or "litellm".',
    )
    url: str = Field(default="https://api.anthropic.com")
    auth: UpstreamAuthConfig = Field(default_factory=UpstreamAuthConfig)
    timeout_s: float = Field(default=300.0)
    connect_timeout_s: float = Field(default=10.0)
    tool_capable: bool = Field(
        default=True,
        description="Whether this upstream supports tool calling.",
    )


class RuleEntryConfig(BaseModel):
    """A single rule in the ordered rule list."""

    rule: str = Field(description="Rule class name (e.g. BackgroundRule).")
    params: dict = Field(default_factory=dict)


class RouteEntryConfig(BaseModel):
    """Routing decision for a label."""

    upstream: str = Field(default="default")
    model: str | None = Field(default=None)
    enrich: bool = Field(default=True)
    tool_capable: bool = Field(default=True)


class ServerConfig(BaseModel):
    """HTTP server configuration."""

    host: str = "127.0.0.1"
    port: int = 8200


class SynapseConfig(BaseModel):
    """Event transport configuration."""

    adapter: str = Field(
        default="local",
        description='Transport adapter: "local" (asyncio in-process), "nng", or "sleipnir".',
    )


class BifrostConfig(BaseModel):
    """Top-level Bifröst configuration."""

    server: ServerConfig = Field(default_factory=ServerConfig)

    # Phase A: single upstream (backwards compatible)
    upstream: UpstreamConfig = Field(default_factory=UpstreamConfig)

    # Phase B: multi-upstream, rules, routing
    upstreams: dict[str, UpstreamEntryConfig] = Field(default_factory=dict)
    rules: list[RuleEntryConfig] = Field(default_factory=list)
    routing: dict[str, RouteEntryConfig] = Field(default_factory=dict)

    synapse: SynapseConfig = Field(default_factory=SynapseConfig)


def load_config(path: str | Path | None = None) -> BifrostConfig:
    """Load configuration from a YAML file, falling back to defaults.

    Environment variables override YAML values using double-underscore
    nesting: ``BIFROST__SERVER__PORT=9000``.

    Backwards-compatible: if the old single ``upstream`` key is present
    but ``upstreams`` is absent, the single upstream is promoted to
    ``upstreams["default"]``.
    """
    data: dict = {}

    if path is not None:
        p = Path(path)
        if p.exists():
            data = yaml.safe_load(p.read_text()) or {}
    else:
        for candidate in [
            Path("bifrost.yaml"),
            Path.home() / ".config" / "bifrost" / "bifrost.yaml",
        ]:
            if candidate.exists():
                data = yaml.safe_load(candidate.read_text()) or {}
                break

    _apply_env_overrides(data, prefix="BIFROST")

    # Backwards compat: promote single upstream to upstreams dict
    if "upstream" in data and "upstreams" not in data:
        upstream_data = data["upstream"]
        data["upstreams"] = {
            "default": {
                "adapter": "anthropic_direct",
                "url": upstream_data.get("url", "https://api.anthropic.com"),
                "auth": upstream_data.get("auth", {}),
                "timeout_s": upstream_data.get("timeout_s", 300.0),
                "connect_timeout_s": upstream_data.get("connect_timeout_s", 10.0),
            },
        }

    return BifrostConfig(**data)


def _apply_env_overrides(data: dict, prefix: str) -> None:
    """Overlay ``PREFIX__KEY__SUBKEY=val`` environment variables onto *data*."""
    target_prefix = f"{prefix}__"
    for key, value in os.environ.items():
        if not key.startswith(target_prefix):
            continue
        parts = key[len(target_prefix) :].lower().split("__")
        node = data
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
