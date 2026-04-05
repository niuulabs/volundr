"""SSE token tracking helpers for the Bifröst inbound layer.

Provides utilities for extracting token usage from Anthropic SSE events and
wrapping async streams with per-request usage recording.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from bifrost.auth import AgentIdentity
from bifrost.domain.models import RequestLog, TokenUsage
from bifrost.ports.usage_store import UsageRecord, UsageStore
from bifrost.pricing import ModelPricing, calculate_cost

logger = logging.getLogger(__name__)

# Header names for quota warnings.
_HEADER_QUOTA_WARNING = "X-Quota-Warning"
_HEADER_QUOTA_REMAINING = "X-Quota-Remaining"


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
