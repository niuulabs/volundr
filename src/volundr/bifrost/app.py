"""Bifröst FastAPI application factory."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response

from volundr.bifrost.adapters.synapse_local import LocalSynapse
from volundr.bifrost.adapters.upstream_anthropic import AnthropicDirectAdapter
from volundr.bifrost.config import (
    BifrostConfig,
    UpstreamConfig,
    UpstreamEntryConfig,
    load_config,
)
from volundr.bifrost.ports import UpstreamProvider
from volundr.bifrost.proxy import BifrostProxy
from volundr.bifrost.router import ModelRouter, RouteConfig
from volundr.bifrost.rules import DefaultRule, RuleEngine, build_rules
from volundr.bifrost.upstream_registry import UpstreamRegistry
from volundr.bifrost.workers.cost_tracker import CostTracker

logger = logging.getLogger(__name__)


def _build_upstream_provider(entry: UpstreamEntryConfig) -> UpstreamProvider:
    """Create an UpstreamProvider from an upstream entry config."""
    if entry.adapter == "litellm":
        from volundr.bifrost.adapters.litellm_adapter import LiteLLMAdapter

        return LiteLLMAdapter(entry)

    # anthropic_direct and anthropic_compatible both use the direct adapter
    upstream_cfg = UpstreamConfig(
        url=entry.url,
        auth=entry.auth,
        timeout_s=entry.timeout_s,
        connect_timeout_s=entry.connect_timeout_s,
    )
    return AnthropicDirectAdapter(upstream_cfg)


def _build_registry(config: BifrostConfig) -> UpstreamRegistry:
    """Build an UpstreamRegistry from config."""
    if config.upstreams:
        providers: dict[str, UpstreamProvider] = {}
        for name, entry in config.upstreams.items():
            providers[name] = _build_upstream_provider(entry)
        return UpstreamRegistry(providers)

    # Fallback: single upstream from Phase A config
    provider = AnthropicDirectAdapter(config.upstream)
    return UpstreamRegistry({"default": provider})


def _build_rule_engine(config: BifrostConfig) -> RuleEngine:
    """Build a RuleEngine from config."""
    if config.rules:
        rule_dicts = [{"rule": r.rule, "params": r.params} for r in config.rules]
        rules = build_rules(rule_dicts)
        if rules:
            return RuleEngine(rules)

    # Default: just the default rule
    return RuleEngine([DefaultRule()])


def _build_router(config: BifrostConfig) -> ModelRouter:
    """Build a ModelRouter from config."""
    routing: dict[str, RouteConfig] = {}

    for label, entry in config.routing.items():
        routing[label] = RouteConfig(
            upstream=entry.upstream,
            model=entry.model,
            enrich=entry.enrich,
            tool_capable=entry.tool_capable,
        )

    # Ensure a default route exists
    if "default" not in routing:
        routing["default"] = RouteConfig()

    return ModelRouter(routing)


def create_bifrost_app(
    config: BifrostConfig | None = None,
) -> FastAPI:
    """Create and return a fully wired Bifröst FastAPI application."""

    if config is None:
        config = load_config()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # --- Upstream registry ---
        registry = _build_registry(config)

        # --- Rule engine + router ---
        rule_engine = _build_rule_engine(config)
        router = _build_router(config)

        # --- Synapse (local in-process for now) ---
        synapse = LocalSynapse()

        # --- Workers ---
        cost_tracker = CostTracker(synapse)
        await cost_tracker.start()

        # --- Proxy core ---
        proxy = BifrostProxy(registry, synapse, rule_engine, router, config)

        # Stash on app state for endpoint access
        _app.state.proxy = proxy
        _app.state.cost_tracker = cost_tracker
        _app.state.synapse = synapse
        _app.state.registry = registry

        upstream_names = ", ".join(registry.names)
        rule_names = ", ".join(r.name for r in rule_engine.rules)
        logger.info(
            "Bifröst started — upstreams=[%s] rules=[%s]",
            upstream_names,
            rule_names,
        )

        yield

        # --- Cleanup ---
        await synapse.close()
        await registry.close_all()
        logger.info("Bifröst shut down")

    app = FastAPI(
        title="Bifröst",
        description="Cognitive proxy between Claude Code and upstream model APIs.",
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # ------------------------------------------------------------------
    # Endpoints
    # ------------------------------------------------------------------

    @app.post("/v1/messages")
    async def messages(request: Request) -> Response:
        proxy: BifrostProxy = request.app.state.proxy
        return await proxy.handle_request(request)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "service": "bifrost"}

    return app
