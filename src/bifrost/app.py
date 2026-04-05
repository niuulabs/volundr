"""Bifröst FastAPI application.

Exposes an Anthropic-compatible HTTP API that routes requests to the
configured providers (Anthropic, OpenAI, Ollama, generic).

Phase 1 additions integrated here: correlation-ID middleware, token
tracking with request logging, and the GET /v1/models endpoint.
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

from bifrost.config import BifrostConfig
from bifrost.domain.models import ModelInfo, RequestLog, TokenUsage
from bifrost.inbound.chat_completions import (
    OpenAIChatRequest,
    anthropic_response_to_openai,
    anthropic_stream_to_openai,
    openai_error_response,
    openai_request_to_anthropic,
)
from bifrost.router import ModelRouter, RouterError
from bifrost.translation.models import AnthropicRequest

logger = logging.getLogger(__name__)


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


async def _stream_with_tracking(
    source: AsyncIterator[str],
    model: str,
    start: float,
) -> AsyncIterator[str]:
    """Yield SSE lines from *source* while tracking token usage for logging."""
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


def create_app(config: BifrostConfig) -> FastAPI:
    """Create and return the Bifröst FastAPI application.

    Args:
        config: Gateway configuration (providers, aliases, etc.).

    Returns:
        A configured ``FastAPI`` instance.
    """
    router = ModelRouter(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await router.close()

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
        """List models available across all configured providers."""
        models: list[ModelInfo] = []
        for provider_cfg in config.providers.values():
            for model_id in provider_cfg.models:
                models.append(ModelInfo(id=model_id, display_name=model_id))
        return {
            "data": [{"id": m.id, "type": "model", "display_name": m.display_name} for m in models]
        }

    @app.post("/v1/messages", response_model=None)
    async def messages(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Anthropic-compatible Messages endpoint.

        Accepts an Anthropic Messages API request body, routes it to the
        configured provider, and returns the response in Anthropic format.
        Token usage is extracted and logged on each request.
        """
        try:
            body = await raw_request.json()
            request = AnthropicRequest.model_validate(body)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        start = time.monotonic()

        try:
            if request.stream:
                return StreamingResponse(
                    _stream_with_tracking(router.stream(request), request.model, start),
                    media_type="text/event-stream",
                    headers={
                        "cache-control": "no-cache",
                        "x-accel-buffering": "no",
                        "connection": "keep-alive",
                    },
                )
            response = await router.complete(request)
            latency_ms = (time.monotonic() - start) * 1000
            data = response.model_dump()
            raw_usage = data.get("usage", {})
            _log_request(
                RequestLog(
                    timestamp=datetime.now(UTC),
                    model=request.model,
                    usage=TokenUsage(
                        input_tokens=raw_usage.get("input_tokens", 0),
                        output_tokens=raw_usage.get("output_tokens", 0),
                        cache_creation_input_tokens=raw_usage.get("cache_creation_input_tokens", 0),
                        cache_read_input_tokens=raw_usage.get("cache_read_input_tokens", 0),
                    ),
                    latency_ms=latency_ms,
                    stream=False,
                )
            )
            return JSONResponse(content=data)
        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/v1/chat/completions", response_model=None)
    async def chat_completions(raw_request: Request) -> JSONResponse | StreamingResponse:
        """OpenAI Chat Completions-compatible endpoint.

        Accepts an OpenAI Chat Completions request, translates it to the
        internal Anthropic canonical format, routes via the shared ModelRouter,
        then translates the response back to OpenAI format.  The full streaming
        path is supported; token usage is extracted and logged on each request.
        """
        try:
            body = await raw_request.json()
            oai_request = OpenAIChatRequest.model_validate(body)
        except Exception as exc:
            return openai_error_response(422, str(exc), "invalid_request_error")

        request = openai_request_to_anthropic(oai_request)
        start = time.monotonic()

        try:
            if request.stream:
                message_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
                return StreamingResponse(
                    anthropic_stream_to_openai(
                        _stream_with_tracking(router.stream(request), request.model, start),
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
            response = await router.complete(request)
            latency_ms = (time.monotonic() - start) * 1000
            _log_request(
                RequestLog(
                    timestamp=datetime.now(UTC),
                    model=request.model,
                    usage=TokenUsage(
                        input_tokens=response.usage.input_tokens,
                        output_tokens=response.usage.output_tokens,
                        cache_creation_input_tokens=0,
                        cache_read_input_tokens=0,
                    ),
                    latency_ms=latency_ms,
                    stream=False,
                )
            )
            return JSONResponse(content=anthropic_response_to_openai(response))
        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            return openai_error_response(502, str(exc), "server_error")

    return app
