"""Bifröst FastAPI application factory.

Wires the inbound routing layer (route handlers, middleware) to the
infrastructure adapters (usage store, model router) and returns a configured
``FastAPI`` instance.

The inbound HTTP layer lives in ``bifrost.inbound``:
  - ``inbound/routes.py``   — route handlers and quota/access enforcement
  - ``inbound/tracking.py`` — SSE token-tracking helpers
  - ``inbound/chat_completions.py`` — OpenAI Chat Completions translation
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response

from bifrost.config import BifrostConfig
from bifrost.inbound.routes import create_router
from bifrost.ports.rules import RuleEnginePort
from bifrost.ports.usage_store import UsageStore
from bifrost.pricing import ModelPricing
from bifrost.router import ModelRouter

# ---------------------------------------------------------------------------
# Rule engine factory
# ---------------------------------------------------------------------------


def _build_rule_engine(config: BifrostConfig) -> RuleEnginePort | None:
    """Instantiate a ``YamlRuleEngine`` when rules are configured, else return ``None``."""
    if not config.rules:
        return None
    from bifrost.adapters.rules.yaml_engine import YamlRuleEngine

    return YamlRuleEngine(rules=config.rules, config=config)


# ---------------------------------------------------------------------------
# Usage store factory
# ---------------------------------------------------------------------------


def _build_usage_store(config: BifrostConfig) -> UsageStore:
    """Instantiate the configured usage store adapter."""
    match config.usage_store.adapter:
        case "sqlite":
            from bifrost.adapters.sqlite_store import SQLiteUsageStore

            return SQLiteUsageStore(path=config.usage_store.path)
        case _:
            from bifrost.adapters.memory_store import MemoryUsageStore

            return MemoryUsageStore()


# ---------------------------------------------------------------------------
# Pricing helpers
# ---------------------------------------------------------------------------


def _pricing_overrides(config: BifrostConfig) -> dict[str, ModelPricing]:
    """Convert PricingOverride config objects to ModelPricing instances."""
    result: dict[str, ModelPricing] = {}
    for model, override in config.pricing.items():
        result[model] = ModelPricing(
            input_per_million=override.input_per_million,
            output_per_million=override.output_per_million,
            cache_creation_per_million=override.cache_creation_per_million,
            cache_read_per_million=override.cache_read_per_million,
        )
    return result


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app(config: BifrostConfig) -> FastAPI:
    """Create and return the Bifröst FastAPI application.

    Args:
        config: Gateway configuration (providers, aliases, auth, quotas, etc.).

    Returns:
        A configured ``FastAPI`` instance.
    """
    rule_engine = _build_rule_engine(config)
    router = ModelRouter(config, rule_engine=rule_engine)
    store = _build_usage_store(config)
    pricing_overrides = _pricing_overrides(config)
    auth_mode = config.auth_mode
    pat_secret = config.effective_pat_secret()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await router.close()
        if hasattr(store, "close"):
            await store.close()

    app = FastAPI(
        title="Bifröst LLM Gateway",
        description="Multi-provider LLM gateway with Anthropic-compatible API.",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def correlation_id_middleware(request: Request, call_next):  # noqa: ANN001
        correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
        request.state.correlation_id = correlation_id
        response: Response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response

    api_router = create_router(
        config=config,
        router=router,
        store=store,
        pricing_overrides=pricing_overrides,
        auth_mode=auth_mode,
        pat_secret=pat_secret,
    )
    app.include_router(api_router)

    return app
