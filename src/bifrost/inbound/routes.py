"""Route handlers for the Bifröst inbound HTTP layer.

Contains all FastAPI route handler functions and quota/access enforcement
helpers. ``create_router()`` returns a configured ``APIRouter`` ready to be
mounted on the main ``FastAPI`` application.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from bifrost.auth import AgentIdentity
from bifrost.config import AgentPermissions, BifrostConfig
from bifrost.domain.models import RequestLog, TokenUsage
from bifrost.domain.routing import RuleRejectError
from bifrost.inbound.chat_completions import (
    OpenAIChatRequest,
    anthropic_response_to_openai,
    anthropic_stream_to_openai,
    openai_error_response,
    openai_request_to_anthropic,
)
from bifrost.inbound.ollama import (
    OllamaChatRequest,
    OllamaGenerateRequest,
    anthropic_response_to_ollama_chat,
    anthropic_response_to_ollama_generate,
    anthropic_stream_to_ollama_chat,
    anthropic_stream_to_ollama_generate,
    ollama_chat_to_anthropic,
    ollama_error_response,
    ollama_generate_to_anthropic,
)
from bifrost.inbound.tracking import (
    _HEADER_QUOTA_WARNING,
    _log_request,
    _stream_with_tracking,
    emit_cost_events,
)
from bifrost.ports.auth import AuthPort
from bifrost.ports.events import CostEventEmitter
from bifrost.ports.usage_store import UsageRecord, UsageStore
from bifrost.pricing import ModelPricing, calculate_cost
from bifrost.router import ModelRouter, RouterError
from bifrost.translation.models import AnthropicRequest

logger = logging.getLogger(__name__)

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

    Rules:
    - An empty ``allowed_models`` list means all models are permitted.
    - ``'*'`` in the list means all models are permitted (unrestricted).
    - Other entries are matched exactly against *model*.

    Args:
        agent_perms: Pre-resolved permissions for the caller.
    """
    if not agent_perms.allowed_models:
        return
    if "*" in agent_perms.allowed_models:
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
# Model enumeration helper (shared between /v1/models and /api/tags)
# ---------------------------------------------------------------------------


def _enumerate_models(config: BifrostConfig) -> list[tuple[str, str]]:
    """Return ``(model_id, provider_name)`` pairs for all models and aliases.

    Iterates configured providers first, then aliases, using a seen-set to
    deduplicate entries that appear under multiple names.

    Args:
        config: The gateway configuration.

    Returns:
        An ordered list of ``(model_id, provider_name)`` 2-tuples.
    """
    result: list[tuple[str, str]] = []
    seen: set[str] = set()

    for provider_name, provider_cfg in config.providers.items():
        for model_id in provider_cfg.models:
            if model_id in seen:
                continue
            seen.add(model_id)
            result.append((model_id, provider_name))

    for alias, canonical in config.aliases.items():
        if alias in seen:
            continue
        seen.add(alias)
        provider_name = config.provider_for_model(canonical) or "unknown"
        result.append((alias, provider_name))

    return result


# ---------------------------------------------------------------------------
# Router factory
# ---------------------------------------------------------------------------


def create_router(
    config: BifrostConfig,
    router: ModelRouter,
    store: UsageStore,
    pricing_overrides: dict[str, ModelPricing],
    auth_adapter: AuthPort,
    event_emitter: CostEventEmitter | None = None,
) -> APIRouter:
    """Build and return a configured ``APIRouter`` with all Bifröst routes.

    Args:
        config:           Gateway configuration.
        router:           Routing layer that dispatches to LLM providers.
        store:            Usage store for recording and querying usage records.
        pricing_overrides: Per-model pricing overrides from config.
        auth_adapter:     Authentication adapter (open / pat / mesh).

    Returns:
        A ``fastapi.APIRouter`` with all routes registered.
    """
    api_router = APIRouter()

    @api_router.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @api_router.post("/admin/reload-keys")
    async def admin_reload_keys(raw_request: Request) -> dict:
        """Reload provider API keys from their source without restarting.

        Triggers the same key-rotation logic as a SIGHUP signal.  Useful
        in environments where sending UNIX signals is inconvenient (e.g.
        containers without a shell, or Windows).

        Authentication is enforced according to the configured auth mode —
        in PAT or mesh mode a valid credential is required to call this
        endpoint, preventing unauthenticated disruption of the adapter cache.

        After this call, all cached provider adapters are discarded and
        will be rebuilt with the freshly loaded keys on the next request.

        Returns:
            ``{"status": "ok"}``
        """
        auth_adapter.extract(raw_request)
        router.reload_keys()
        return {"status": "ok"}

    @api_router.get("/v1/models")
    async def list_models() -> dict:
        """List models available across all configured providers.

        Returns an OpenAI-compatible list response including both canonical
        model IDs and any configured aliases.
        """
        return {
            "object": "list",
            "data": [
                {
                    "id": model_id,
                    "object": "model",
                    "owned_by": provider_name,
                    "display_name": config.aliases.get(model_id, model_id),
                }
                for model_id, provider_name in _enumerate_models(config)
            ],
        }

    @api_router.post("/v1/messages", response_model=None)
    async def messages(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Anthropic-compatible Messages endpoint.

        Accepts an Anthropic Messages API request body, routes it to the
        configured provider, and returns the response in Anthropic format.
        Token usage is tracked per-request and attributed to the caller.
        """
        # --- Authentication ---
        identity = auth_adapter.extract(raw_request)

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

        provider = config.provider_for_model(request.model) or ""

        agent_budget_limit = agent_perms.quota.max_cost_per_day

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
                        provider=provider,
                        emitter=event_emitter,
                        agent_budget_limit=agent_budget_limit,
                        budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
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
                reasoning_tokens=raw_usage.get("reasoning_tokens", 0),
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
                    provider=provider,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_tokens=usage.cache_read_input_tokens,
                    cache_write_tokens=usage.cache_creation_input_tokens,
                    reasoning_tokens=usage.reasoning_tokens,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    streaming=False,
                    timestamp=datetime.now(UTC),
                )
            )
            if event_emitter is not None:
                await emit_cost_events(
                    emitter=event_emitter,
                    store=store,
                    identity=identity,
                    cost=cost,
                    tokens_used=usage.input_tokens + usage.output_tokens,
                    model=request.model,
                    agent_budget_limit=agent_budget_limit,
                    budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
                )

            json_resp = JSONResponse(content=data)
            if warnings:
                json_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
            return json_resp

        except RuleRejectError as exc:
            raise HTTPException(status_code=400, detail=exc.message) from exc
        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @api_router.get("/v1/usage")
    async def usage_endpoint(
        agent_id: str | None = None,
        tenant_id: str | None = None,
        model: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 1000,
        granularity: str | None = None,
    ) -> dict:
        """Return aggregated usage statistics with optional filters.

        Query parameters:
            agent_id:    Filter by agent identifier.
            tenant_id:   Filter by tenant identifier.
            model:       Filter by model name.
            since:       ISO-8601 datetime (inclusive lower bound).
            until:       ISO-8601 datetime (inclusive upper bound).
            limit:       Maximum number of raw records returned (default 1000).
            granularity: Time-series bucket size — 'hour' (default) or 'day'.
                         When provided, the response includes a ``timeseries``
                         array with per-bucket aggregates.

        Returns a summary (totals + per-model/provider breakdown), an optional
        time-series breakdown, and the raw record list.
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

        if granularity is not None and granularity not in ("hour", "day"):
            raise HTTPException(
                status_code=422,
                detail="'granularity' must be 'hour' or 'day'.",
            )

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

        response_body: dict = {
            "summary": {
                "total_requests": summary.total_requests,
                "total_input_tokens": summary.total_input_tokens,
                "total_output_tokens": summary.total_output_tokens,
                "total_cost_usd": round(summary.total_cost_usd, 6),
                "by_model": summary.by_model,
                "by_provider": summary.by_provider,
            },
            "records": [
                {
                    "request_id": r.request_id,
                    "agent_id": r.agent_id,
                    "tenant_id": r.tenant_id,
                    "session_id": r.session_id,
                    "saga_id": r.saga_id,
                    "model": r.model,
                    "provider": r.provider,
                    "input_tokens": r.input_tokens,
                    "output_tokens": r.output_tokens,
                    "cache_read_tokens": r.cache_read_tokens,
                    "cache_write_tokens": r.cache_write_tokens,
                    "reasoning_tokens": r.reasoning_tokens,
                    "cost_usd": round(r.cost_usd, 6),
                    "latency_ms": round(r.latency_ms, 2),
                    "streaming": r.streaming,
                    "timestamp": r.timestamp.isoformat(),
                }
                for r in records
            ],
        }

        if granularity is not None:
            ts_entries = await store.time_series(
                granularity=granularity,
                agent_id=agent_id,
                tenant_id=tenant_id,
                model=model,
                since=since_dt,
                until=until_dt,
            )
            response_body["timeseries"] = [
                {
                    "bucket": e.bucket,
                    "requests": e.requests,
                    "input_tokens": e.input_tokens,
                    "output_tokens": e.output_tokens,
                    "cost_usd": round(e.cost_usd, 6),
                }
                for e in ts_entries
            ]

        return response_body

    @api_router.post("/v1/chat/completions", response_model=None)
    async def chat_completions(raw_request: Request) -> JSONResponse | StreamingResponse:
        """OpenAI Chat Completions-compatible endpoint.

        Accepts an OpenAI Chat Completions request, translates it to the
        internal Anthropic canonical format, routes via the shared ModelRouter,
        then translates the response back to OpenAI format.  The full streaming
        path is supported; token usage is extracted and logged on each request.
        """
        # --- Authentication ---
        identity = auth_adapter.extract(raw_request)

        try:
            body = await raw_request.json()
            oai_request = OpenAIChatRequest.model_validate(body)
        except Exception as exc:
            return openai_error_response(422, str(exc), "invalid_request_error")

        request = openai_request_to_anthropic(oai_request)

        # --- Model access control ---
        agent_perms = config.permissions_for_agent(identity.agent_id)
        try:
            _check_model_access(identity, request.model, agent_perms)
        except HTTPException as exc:
            return openai_error_response(exc.status_code, exc.detail, "invalid_request_error")

        # --- Quota check (before routing) ---
        try:
            warnings = await _check_quotas(identity, config, store, agent_perms)
        except HTTPException as exc:
            return openai_error_response(exc.status_code, exc.detail, "rate_limit_error")

        request_id = str(raw_request.state.correlation_id)
        start = time.monotonic()
        provider = config.provider_for_model(request.model) or ""
        agent_budget_limit = agent_perms.quota.max_cost_per_day

        try:
            if request.stream:
                message_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
                stream_resp = StreamingResponse(
                    anthropic_stream_to_openai(
                        _stream_with_tracking(
                            router.stream(request),
                            request.model,
                            start,
                            identity,
                            store,
                            pricing_overrides,
                            request_id,
                            provider=provider,
                            emitter=event_emitter,
                            agent_budget_limit=agent_budget_limit,
                            budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
                        ),
                        message_id=message_id,
                        model=request.model,
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
            usage = TokenUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_creation_input_tokens=0,
                cache_read_input_tokens=0,
                reasoning_tokens=0,
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
                    provider=provider,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_tokens=0,
                    cache_write_tokens=0,
                    reasoning_tokens=0,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    streaming=False,
                    timestamp=datetime.now(UTC),
                )
            )
            if event_emitter is not None:
                await emit_cost_events(
                    emitter=event_emitter,
                    store=store,
                    identity=identity,
                    cost=cost,
                    tokens_used=usage.input_tokens + usage.output_tokens,
                    model=request.model,
                    agent_budget_limit=agent_budget_limit,
                    budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
                )

            json_resp = JSONResponse(content=anthropic_response_to_openai(response))
            if warnings:
                json_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
            return json_resp

        except RuleRejectError as exc:
            return openai_error_response(400, exc.message, "invalid_request_error")
        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            return openai_error_response(502, str(exc), "server_error")

    # -----------------------------------------------------------------------
    # Ollama-compatible endpoints
    # -----------------------------------------------------------------------

    async def _handle_ollama_request(
        raw_request: Request,
        parse_fn: Callable,
        translate_fn: Callable,
        stream_translate_fn: Callable,
        response_translate_fn: Callable,
    ) -> JSONResponse | StreamingResponse:
        """Shared handler for Ollama /api/generate and /api/chat.

        Handles auth, request parsing + translation, quota enforcement,
        routing, usage tracking, and response translation.  The four
        callables let callers plug in endpoint-specific logic without
        duplicating the common plumbing.

        Args:
            raw_request: The incoming FastAPI request.
            parse_fn: ``body_dict → OllamaXxxRequest`` — validates the raw body.
            translate_fn: ``OllamaXxxRequest → AnthropicRequest`` — converts to
                the internal canonical format.
            stream_translate_fn: ``(source, *, model, start) → AsyncIterator[str]``
                — translates Anthropic SSE to Ollama NDJSON for streaming responses.
            response_translate_fn: ``(response, *, created_at, total_duration_ns)
                → dict`` — translates a non-streaming Anthropic response to Ollama
                format.
        """
        identity = auth_adapter.extract(raw_request)

        try:
            body = await raw_request.json()
            ollama_req = parse_fn(body)
        except Exception as exc:
            return ollama_error_response(422, str(exc))

        request = translate_fn(ollama_req)

        agent_perms = config.permissions_for_agent(identity.agent_id)
        try:
            _check_model_access(identity, request.model, agent_perms)
        except HTTPException as exc:
            return ollama_error_response(exc.status_code, exc.detail)

        try:
            warnings = await _check_quotas(identity, config, store, agent_perms)
        except HTTPException as exc:
            return ollama_error_response(exc.status_code, exc.detail)

        request_id = str(raw_request.state.correlation_id)
        start = time.monotonic()
        provider = config.provider_for_model(request.model) or ""
        agent_budget_limit = agent_perms.quota.max_cost_per_day

        try:
            if request.stream:
                stream_resp = StreamingResponse(
                    stream_translate_fn(
                        _stream_with_tracking(
                            router.stream(request),
                            request.model,
                            start,
                            identity,
                            store,
                            pricing_overrides,
                            request_id,
                            provider=provider,
                            emitter=event_emitter,
                            agent_budget_limit=agent_budget_limit,
                            budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
                        ),
                        model=request.model,
                        start=start,
                    ),
                    media_type="application/x-ndjson",
                )
                if warnings:
                    stream_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
                return stream_resp

            response = await router.complete(request)
            latency_ms = (time.monotonic() - start) * 1000
            usage = TokenUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
                cache_creation_input_tokens=0,
                cache_read_input_tokens=0,
                reasoning_tokens=0,
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
                    provider=provider,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_tokens=0,
                    cache_write_tokens=0,
                    reasoning_tokens=0,
                    cost_usd=cost,
                    latency_ms=latency_ms,
                    streaming=False,
                    timestamp=datetime.now(UTC),
                )
            )
            if event_emitter is not None:
                await emit_cost_events(
                    emitter=event_emitter,
                    store=store,
                    identity=identity,
                    cost=cost,
                    tokens_used=usage.input_tokens + usage.output_tokens,
                    model=request.model,
                    agent_budget_limit=agent_budget_limit,
                    budget_warning_threshold_pct=config.events.budget_warning_threshold_pct,
                )

            created_at = datetime.now(UTC).isoformat()
            total_ns = int(latency_ms * 1e6)
            json_resp = JSONResponse(
                content=response_translate_fn(
                    response, created_at=created_at, total_duration_ns=total_ns
                )
            )
            if warnings:
                json_resp.headers[_HEADER_QUOTA_WARNING] = "; ".join(warnings)
            return json_resp

        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            return ollama_error_response(502, str(exc))

    @api_router.get("/api/tags")
    async def ollama_tags() -> dict:
        """List available models in Ollama /api/tags format.

        Maps the internal model registry to the Ollama model list shape so
        that tools like Open WebUI can discover available models automatically.
        """
        return {
            "models": [
                {
                    "name": model_id,
                    "model": model_id,
                    "modified_at": "2024-01-01T00:00:00Z",
                    "size": 0,
                    "digest": "",
                    "details": {
                        "format": "unknown",
                        "family": provider_name,
                        "families": None,
                        "parameter_size": "unknown",
                        "quantization_level": "unknown",
                    },
                }
                for model_id, provider_name in _enumerate_models(config)
            ]
        }

    @api_router.post("/api/generate", response_model=None)
    async def ollama_generate(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Ollama /api/generate endpoint (prompt-based completion).

        Accepts a native Ollama generate request, translates it to the
        internal Anthropic canonical format, routes via the shared
        ModelRouter, and returns the response in Ollama format.
        Streaming uses newline-delimited JSON (NDJSON), not SSE.
        """
        return await _handle_ollama_request(
            raw_request,
            OllamaGenerateRequest.model_validate,
            ollama_generate_to_anthropic,
            anthropic_stream_to_ollama_generate,
            anthropic_response_to_ollama_generate,
        )

    @api_router.post("/api/chat", response_model=None)
    async def ollama_chat(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Ollama /api/chat endpoint (messages-based chat).

        Accepts a native Ollama chat request, translates it to the internal
        Anthropic canonical format, routes via the shared ModelRouter, and
        returns the response in Ollama format.
        Streaming uses newline-delimited JSON (NDJSON), not SSE.
        """
        return await _handle_ollama_request(
            raw_request,
            OllamaChatRequest.model_validate,
            ollama_chat_to_anthropic,
            anthropic_stream_to_ollama_chat,
            anthropic_response_to_ollama_chat,
        )

    return api_router
