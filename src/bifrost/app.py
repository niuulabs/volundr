"""Bifröst FastAPI application.

Exposes an Anthropic-compatible HTTP API that routes requests to the
configured providers (Anthropic, OpenAI, Ollama, generic).

Phase 3 additions:
- Agent authentication (open / PAT / mesh)
- Per-agent model access control
- Per-request cost tracking with attribution
- Quota enforcement (soft warn + hard 429 reject)
- Usage query endpoint (GET /v1/usage)
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from bifrost.auth import AgentIdentity, extract_identity
from bifrost.config import AgentPermissions, BifrostConfig
from bifrost.domain.models import ModelInfo, RequestLog, TokenUsage
from bifrost.ports.usage_store import UsageRecord, UsageStore
from bifrost.pricing import ModelPricing, calculate_cost
from bifrost.router import ModelRouter, RouterError
from bifrost.translation.models import AnthropicRequest

logger = logging.getLogger(__name__)

# Header names for quota warnings.
_HEADER_QUOTA_WARNING = "X-Quota-Warning"
_HEADER_QUOTA_REMAINING = "X-Quota-Remaining"


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
# SSE / streaming helpers
# ---------------------------------------------------------------------------


def _extract_usage_from_sse_line(line: str, usage: TokenUsage) -> None:
    """Parse one SSE data line and update *usage* in-place."""
    if not line.startswith("data: "):
        return
    try:
        payload = json.loads(line[6:])
    except (json.JSONDecodeError, ValueError):
        return

    event_type = payload.get("type", "")

    if event_type == "message_start":
        msg_usage = payload.get("message", {}).get("usage", {})
        usage.input_tokens += msg_usage.get("input_tokens", 0)
        usage.cache_creation_input_tokens += msg_usage.get("cache_creation_input_tokens", 0)
        usage.cache_read_input_tokens += msg_usage.get("cache_read_input_tokens", 0)
    elif event_type == "message_delta":
        delta_usage = payload.get("usage", {})
        usage.output_tokens += delta_usage.get("output_tokens", 0)


def _log_request(log: RequestLog) -> None:
    logger.info(
        "request ts=%s model=%s input=%d output=%d cache_read=%d cache_write=%d "
        "latency=%.1fms stream=%s",
        log.timestamp.isoformat(),
        log.model,
        log.usage.input_tokens,
        log.usage.output_tokens,
        log.usage.cache_read_input_tokens,
        log.usage.cache_creation_input_tokens,
        log.latency_ms,
        log.stream,
    )


# ---------------------------------------------------------------------------
# Quota enforcement
# ---------------------------------------------------------------------------


async def _check_quotas(
    identity: AgentIdentity,
    config: BifrostConfig,
    store: UsageStore,
    agent_perms: AgentPermissions,
) -> list[str]:
    """Check quota limits and return a list of warning strings (empty = OK).

    Args:
        agent_perms: Pre-resolved permissions for the caller (avoids a second
                     ``config.permissions_for_agent()`` lookup per request).

    Raises:
        HTTPException(429): If any hard limit is exceeded.
    """
    warnings: list[str] = []

    tenant_quota = config.quota_for_tenant(identity.tenant_id)
    agent_quota = agent_perms.quota

    # Tenant: tokens per day
    if tenant_quota.max_tokens_per_day > 0:
        used = await store.tokens_today(identity.tenant_id)
        limit = tenant_quota.max_tokens_per_day
        fraction = used / limit
        if fraction >= 1.0:
            raise HTTPException(
                status_code=429,
                detail=f"Tenant daily token quota exceeded ({used}/{limit}).",
            )
        if fraction >= tenant_quota.soft_limit_fraction:
            warnings.append(f"tenant_tokens_per_day={used}/{limit} ({fraction:.0%})")

    # Tenant: cost per day
    if tenant_quota.max_cost_per_day > 0.0:
        used_cost = await store.cost_today(identity.tenant_id)
        limit_cost = tenant_quota.max_cost_per_day
        fraction = used_cost / limit_cost
        if fraction >= 1.0:
            raise HTTPException(
                status_code=429,
                detail=f"Tenant daily cost quota exceeded (${used_cost:.4f}/${limit_cost:.4f}).",
            )
        if fraction >= tenant_quota.soft_limit_fraction:
            warnings.append(
                f"tenant_cost_per_day=${used_cost:.4f}/${limit_cost:.4f} ({fraction:.0%})"
            )

    # Tenant: requests per hour
    if tenant_quota.max_requests_per_hour > 0:
        used_req = await store.requests_this_hour(identity.tenant_id)
        limit_req = tenant_quota.max_requests_per_hour
        fraction = used_req / limit_req
        if fraction >= 1.0:
            raise HTTPException(
                status_code=429,
                detail=f"Tenant hourly request quota exceeded ({used_req}/{limit_req}).",
            )
        if fraction >= tenant_quota.soft_limit_fraction:
            warnings.append(f"tenant_requests_per_hour={used_req}/{limit_req} ({fraction:.0%})")

    # Agent: cost per day (only when a per-agent budget is configured)
    if agent_quota.max_cost_per_day > 0.0:
        agent_cost = await store.agent_cost_today(identity.agent_id)
        limit_cost = agent_quota.max_cost_per_day
        fraction = agent_cost / limit_cost
        if fraction >= 1.0:
            raise HTTPException(
                status_code=429,
                detail=(f"Agent daily cost quota exceeded (${agent_cost:.4f}/${limit_cost:.4f})."),
            )
        if fraction >= agent_quota.soft_limit_fraction:
            warnings.append(
                f"agent_cost_per_day=${agent_cost:.4f}/${limit_cost:.4f} ({fraction:.0%})"
            )

    return warnings


def _check_model_access(
    identity: AgentIdentity,
    model: str,
    agent_perms: AgentPermissions,
) -> None:
    """Raise 403 if the agent does not have permission to use *model*.

    An empty ``allowed_models`` list means all models are permitted.

    Args:
        agent_perms: Pre-resolved permissions for the caller.
    """
    if not agent_perms.allowed_models:
        return
    if model not in agent_perms.allowed_models:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Agent '{identity.agent_id}' is not permitted to use model '{model}'. "
                f"Allowed: {agent_perms.allowed_models}"
            ),
        )


# ---------------------------------------------------------------------------
# Streaming wrapper with tracking
# ---------------------------------------------------------------------------


async def _stream_with_tracking(
    source: AsyncIterator[str],
    model: str,
    start: float,
    identity: AgentIdentity,
    store: UsageStore,
    pricing_overrides: dict[str, ModelPricing],
    request_id: str,
) -> AsyncIterator[str]:
    """Yield SSE lines from *source* while tracking token usage."""
    usage = TokenUsage()

    async for line in source:
        _extract_usage_from_sse_line(line, usage)
        yield line

    latency_ms = (time.monotonic() - start) * 1000
    _log_request(
        RequestLog(
            timestamp=datetime.now(UTC),
            model=model,
            usage=usage,
            latency_ms=latency_ms,
            stream=True,
        )
    )

    cost = calculate_cost(model, usage, pricing_overrides)
    await store.record(
        UsageRecord(
            request_id=request_id,
            agent_id=identity.agent_id,
            tenant_id=identity.tenant_id,
            session_id=identity.session_id,
            saga_id=identity.saga_id,
            model=model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cost_usd=cost,
            timestamp=datetime.now(UTC),
        )
    )


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
    router = ModelRouter(config)
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

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.get("/v1/models")
    async def list_models() -> dict:
        """List models available across all configured providers.

        Returns an OpenAI-compatible list response including both canonical
        model IDs and any configured aliases.
        """
        models: list[ModelInfo] = []
        seen: set[str] = set()

        for provider_name, provider_cfg in config.providers.items():
            for model_id in provider_cfg.models:
                if model_id in seen:
                    continue
                seen.add(model_id)
                models.append(ModelInfo(id=model_id, display_name=model_id, owned_by=provider_name))

        for alias, canonical in config.aliases.items():
            if alias in seen:
                continue
            seen.add(alias)
            provider_name = config.provider_for_model(canonical) or "unknown"
            models.append(ModelInfo(id=alias, display_name=canonical, owned_by=provider_name))

        return {
            "object": "list",
            "data": [
                {
                    "id": m.id,
                    "object": "model",
                    "owned_by": m.owned_by,
                    "display_name": m.display_name,
                }
                for m in models
            ],
        }

    @app.post("/v1/messages", response_model=None)
    async def messages(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Anthropic-compatible Messages endpoint.

        Accepts an Anthropic Messages API request body, routes it to the
        configured provider, and returns the response in Anthropic format.
        Token usage is tracked per-request and attributed to the caller.
        """
        # --- Authentication ---
        identity = extract_identity(raw_request, auth_mode, pat_secret)

        try:
            body = await raw_request.json()
            request = AnthropicRequest.model_validate(body)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # Resolve permissions once — used by both access control and quota checks.
        agent_perms = config.permissions_for_agent(identity.agent_id)

        # --- Model access control ---
        _check_model_access(identity, request.model, agent_perms)

        # --- Quota check (before routing) ---
        warnings = await _check_quotas(identity, config, store, agent_perms)

        request_id = str(raw_request.state.correlation_id)
        start = time.monotonic()

        try:
            if request.stream:
                stream_resp = StreamingResponse(
                    _stream_with_tracking(
                        router.stream(request),
                        request.model,
                        start,
                        identity,
                        store,
                        pricing_overrides,
                        request_id,
                    ),
                    media_type="text/event-stream",
                    headers={
                        "cache-control": "no-cache",
                        "x-accel-buffering": "no",
                        "connection": "keep-alive",
                    },
                )
                if warnings:
                    stream_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
                return stream_resp

            response = await router.complete(request)
            latency_ms = (time.monotonic() - start) * 1000
            data = response.model_dump()
            raw_usage = data.get("usage", {})
            usage = TokenUsage(
                input_tokens=raw_usage.get("input_tokens", 0),
                output_tokens=raw_usage.get("output_tokens", 0),
                cache_creation_input_tokens=raw_usage.get("cache_creation_input_tokens", 0),
                cache_read_input_tokens=raw_usage.get("cache_read_input_tokens", 0),
            )
            _log_request(
                RequestLog(
                    timestamp=datetime.now(UTC),
                    model=request.model,
                    usage=usage,
                    latency_ms=latency_ms,
                    stream=False,
                )
            )

            cost = calculate_cost(request.model, usage, pricing_overrides)
            await store.record(
                UsageRecord(
                    request_id=request_id,
                    agent_id=identity.agent_id,
                    tenant_id=identity.tenant_id,
                    session_id=identity.session_id,
                    saga_id=identity.saga_id,
                    model=request.model,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cost_usd=cost,
                    timestamp=datetime.now(UTC),
                )
            )

            json_resp = JSONResponse(content=data)
            if warnings:
                json_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
            return json_resp

        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.get("/v1/usage")
    async def usage_endpoint(
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 1000,
    ) -> dict:
        """Return aggregated usage statistics with optional filters.

        Query parameters:
            agent_id:  Filter by agent identifier.
            tenant_id: Filter by tenant identifier.
            model:     Filter by model name.
            since:     ISO-8601 datetime (inclusive lower bound).
            until:     ISO-8601 datetime (inclusive upper bound).
            limit:     Maximum number of raw records returned (default 1000).

        Returns a summary (totals + per-model breakdown) and the raw record list.
        """
        since_dt: datetime | None = None
        until_dt: datetime | None = None

        if since is not None:
            try:
                _dt = datetime.fromisoformat(since)
                since_dt = _dt.replace(tzinfo=UTC) if _dt.tzinfo is None else _dt.astimezone(UTC)
            except ValueError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid 'since' datetime: {exc}",
                ) from exc

        if until is not None:
            try:
                _dt = datetime.fromisoformat(until)
                until_dt = _dt.replace(tzinfo=UTC) if _dt.tzinfo is None else _dt.astimezone(UTC)
            except ValueError as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid 'until' datetime: {exc}",
                ) from exc

        summary = await store.summarise(
            agent_id=agent_id,
            tenant_id=tenant_id,
            model=model,
            since=since_dt,
            until=until_dt,
        )
        records = await store.query(
            agent_id=agent_id,
            tenant_id=tenant_id,
            model=model,
            since=since_dt,
            until=until_dt,
            limit=limit,
        )

        return {
            "summary": {
                "total_requests": summary.total_requests,
                "total_input_tokens": summary.total_input_tokens,
                "total_output_tokens": summary.total_output_tokens,
                "total_cost_usd": round(summary.total_cost_usd, 6),
                "by_model": summary.by_model,
            },
            "records": [
                {
                    "request_id": r.request_id,
                    "agent_id": r.agent_id,
                    "tenant_id": r.tenant_id,
                    "session_id": r.session_id,
                    "saga_id": r.saga_id,
                    "model": r.model,
                    "input_tokens": r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "cost_usd": round(r.cost_usd, 6),
                    "timestamp": r.timestamp.isoformat(),
                }
                for r in records
            ],
        }

    return app
