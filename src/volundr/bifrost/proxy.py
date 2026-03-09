"""Bifröst proxy core — receive, classify, route, forward, stream, publish metrics."""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from volundr.bifrost.config import BifrostConfig
from volundr.bifrost.models import (
    MetricsEvent,
    RequestContext,
    RouteDecision,
    SynapseEnvelope,
    TurnRecord,
    parse_request,
)
from volundr.bifrost.ports import Synapse, UpstreamProvider
from volundr.bifrost.router import ModelRouter
from volundr.bifrost.rules import RuleEngine
from volundr.bifrost.upstream_registry import UpstreamRegistry

logger = logging.getLogger(__name__)

METRICS_TOPIC = "bifrost.metrics"


class BifrostProxy:
    """Core proxy that sits between Claude Code and the upstream model API.

    Phase B flow: parse → classify (rules) → route (label → upstream +
    model) → mutate request → forward to selected upstream → stream back.
    """

    def __init__(
        self,
        registry: UpstreamRegistry,
        synapse: Synapse,
        rule_engine: RuleEngine,
        router: ModelRouter,
        config: BifrostConfig,
    ) -> None:
        self._registry = registry
        self._synapse = synapse
        self._rule_engine = rule_engine
        self._router = router
        self._config = config

    async def handle_request(self, request: Request) -> Response:
        body = await request.body()
        headers = dict(request.headers)

        # Phase B: parse → classify → route
        parsed = parse_request(body)
        context = RequestContext(request=parsed)
        label = self._rule_engine.evaluate(parsed, context)
        decision = self._router.route(label, parsed)

        # Select upstream
        upstream = self._registry.get(decision.upstream_name)

        # Mutate model in request body if routing overrides it
        if decision.model:
            body = _mutate_model(body, decision.model)

        if parsed.stream:
            return await self._handle_streaming(
                body,
                headers,
                upstream,
                decision,
            )
        return await self._handle_non_streaming(
            body,
            headers,
            upstream,
            decision,
        )

    # ------------------------------------------------------------------
    # Non-streaming path
    # ------------------------------------------------------------------

    async def _handle_non_streaming(
        self,
        body: bytes,
        headers: dict[str, str],
        upstream: UpstreamProvider,
        decision: RouteDecision,
    ) -> Response:
        request_model = decision.model or "unknown"
        start = time.monotonic()

        try:
            status, resp_headers, resp_body = await upstream.forward(
                body,
                headers,
            )
        except Exception:
            logger.exception("Upstream unreachable")
            err = {
                "type": "error",
                "error": {
                    "type": "proxy_error",
                    "message": "upstream unreachable",
                },
            }
            return JSONResponse(err, status_code=502)

        latency_ms = (time.monotonic() - start) * 1000
        turn = _extract_turn_from_json(resp_body, request_model, latency_ms)

        await self._publish_metrics(turn, headers, decision)

        return Response(
            content=resp_body,
            status_code=status,
            headers=resp_headers,
        )

    # ------------------------------------------------------------------
    # Streaming path
    # ------------------------------------------------------------------

    async def _handle_streaming(
        self,
        body: bytes,
        headers: dict[str, str],
        upstream: UpstreamProvider,
        decision: RouteDecision,
    ) -> Response:
        request_model = decision.model or "unknown"
        start = time.monotonic()

        try:
            status, resp_headers, chunks = await upstream.stream_forward(
                body,
                headers,
            )
        except Exception:
            logger.exception("Upstream unreachable (streaming)")
            err = {
                "type": "error",
                "error": {
                    "type": "proxy_error",
                    "message": "upstream unreachable",
                },
            }
            return JSONResponse(err, status_code=502)

        return StreamingResponse(
            self._stream_and_capture(
                chunks,
                request_model,
                start,
                headers,
                decision,
            ),
            status_code=status,
            headers=resp_headers,
            media_type="text/event-stream",
        )

    async def _stream_and_capture(
        self,
        chunks: AsyncIterator[bytes],
        request_model: str,
        start: float,
        client_headers: dict[str, str],
        decision: RouteDecision,
    ) -> AsyncIterator[bytes]:
        buffer = bytearray()

        async for chunk in chunks:
            buffer.extend(chunk)
            yield chunk

        latency_ms = (time.monotonic() - start) * 1000
        turn = _extract_turn_from_sse(buffer, request_model, latency_ms)
        await self._publish_metrics(turn, client_headers, decision)

    # ------------------------------------------------------------------
    # Metrics publishing
    # ------------------------------------------------------------------

    async def _publish_metrics(
        self,
        turn: TurnRecord,
        client_headers: dict[str, str],
        decision: RouteDecision,
    ) -> None:
        session_id = client_headers.get("x-session-id")

        event = MetricsEvent(
            session_id=session_id,
            model=turn.response_model or turn.request_model,
            input_tokens=turn.input_tokens,
            output_tokens=turn.output_tokens,
            latency_ms=turn.latency_ms,
            cost_estimate_usd=None,
            upstream=decision.upstream_name,
            timestamp=datetime.now(UTC),
        )

        envelope = SynapseEnvelope(
            topic=METRICS_TOPIC,
            session_id=session_id,
            project_id=None,
            timestamp=event.timestamp,
            trace_id=uuid.uuid4().hex,
            payload={
                "session_id": event.session_id,
                "model": event.model,
                "input_tokens": event.input_tokens,
                "output_tokens": event.output_tokens,
                "latency_ms": event.latency_ms,
                "cost_estimate_usd": event.cost_estimate_usd,
                "upstream": event.upstream,
                "label": decision.label,
                "timestamp": event.timestamp.isoformat(),
            },
        )

        try:
            await self._synapse.publish(METRICS_TOPIC, envelope)
        except Exception:
            logger.exception("Failed to publish metrics (swallowed)")


# ------------------------------------------------------------------
# Request mutation
# ------------------------------------------------------------------


def _mutate_model(body: bytes, new_model: str) -> bytes:
    """Replace the ``model`` field in the request JSON body."""
    try:
        data = json.loads(body)
        data["model"] = new_model
        return json.dumps(data).encode()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return body


# ------------------------------------------------------------------
# Response parsing (module-level helpers)
# ------------------------------------------------------------------


def _extract_turn_from_json(
    body: bytes,
    request_model: str,
    latency_ms: float,
) -> TurnRecord:
    """Extract turn metadata from a non-streaming JSON response."""
    try:
        data = json.loads(body)
        usage = data.get("usage", {})
        return TurnRecord(
            request_model=request_model,
            response_model=data.get("model"),
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            stop_reason=data.get("stop_reason"),
            latency_ms=latency_ms,
            streamed=False,
        )
    except (json.JSONDecodeError, UnicodeDecodeError):
        return TurnRecord(
            request_model=request_model,
            response_model=None,
            input_tokens=0,
            output_tokens=0,
            stop_reason=None,
            latency_ms=latency_ms,
            streamed=False,
        )


def _extract_turn_from_sse(
    buffer: bytearray,
    request_model: str,
    latency_ms: float,
) -> TurnRecord:
    """Extract turn metadata from a buffered SSE stream.

    Scans for ``message_start`` (input_tokens, model) and
    ``message_delta`` (output_tokens, stop_reason) events.
    """
    text = buffer.decode("utf-8", errors="replace")

    response_model: str | None = None
    input_tokens = 0
    output_tokens = 0
    stop_reason: str | None = None

    for line in text.splitlines():
        if not line.startswith("data: "):
            continue

        json_str = line[6:]
        if json_str == "[DONE]":
            continue

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            continue

        event_type = data.get("type")

        if event_type == "message_start":
            message = data.get("message", {})
            response_model = message.get("model")
            usage = message.get("usage", {})
            input_tokens = usage.get("input_tokens", 0)

        elif event_type == "message_delta":
            delta_usage = data.get("usage", {})
            output_tokens = delta_usage.get("output_tokens", 0)
            delta = data.get("delta", {})
            stop_reason = delta.get("stop_reason")

    return TurnRecord(
        request_model=request_model,
        response_model=response_model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        stop_reason=stop_reason,
        latency_ms=latency_ms,
        streamed=True,
    )
