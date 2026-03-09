"""Bifröst domain models."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SynapseEnvelope:
    """Transport-agnostic message envelope.

    Wraps every message published to or consumed from the Synapse,
    regardless of whether the underlying transport is local asyncio,
    nng, or RabbitMQ.
    """

    topic: str
    session_id: str | None
    project_id: str | None
    timestamp: datetime
    trace_id: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class MetricsEvent:
    """Published to ``bifrost.metrics`` after each completed turn."""

    session_id: str | None
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    cost_estimate_usd: float | None
    upstream: str
    timestamp: datetime


@dataclass(frozen=True)
class TurnRecord:
    """Buffered response metadata extracted from a single proxy turn."""

    request_model: str
    response_model: str | None
    input_tokens: int
    output_tokens: int
    stop_reason: str | None
    latency_ms: float
    streamed: bool


# ------------------------------------------------------------------
# Phase B: request parsing + routing models
# ------------------------------------------------------------------


@dataclass(frozen=True)
class ParsedRequest:
    """Request parsed just enough for rule evaluation."""

    model: str
    messages: list[dict[str, Any]]
    stream: bool
    tools: list[dict[str, Any]]
    thinking_enabled: bool
    max_tokens: int
    system: str | None
    raw_body: bytes

    @property
    def last_message_role(self) -> str | None:
        if not self.messages:
            return None
        return self.messages[-1].get("role")

    @property
    def last_message_is_tool_result(self) -> bool:
        """True if last message is role=user with only tool_result blocks."""
        if not self.messages:
            return False
        last = self.messages[-1]
        if last.get("role") != "user":
            return False
        content = last.get("content")
        if not isinstance(content, list):
            return False
        if not content:
            return False
        return all(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)

    @property
    def has_tools(self) -> bool:
        return len(self.tools) > 0

    @property
    def estimated_tokens(self) -> int:
        """Rough estimate: total chars in messages / 4."""
        total = 0
        for msg in self.messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += len(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        total += len(str(block.get("text", "")))
                        total += len(str(block.get("input", "")))
                        total += len(str(block.get("content", "")))
        if self.system:
            total += len(self.system)
        return total // 4


@dataclass
class RequestContext:
    """Context available to rules.  Grows in later phases."""

    request: ParsedRequest
    # Phase E: budget_remaining, budget_total
    # Phase F: trajectory, error_streak, active_sessions


@dataclass(frozen=True)
class RouteDecision:
    """Output of the ModelRouter."""

    upstream_name: str
    model: str | None
    enrich: bool
    label: str


def parse_request(body: bytes) -> ParsedRequest:
    """Parse a raw request body into a ``ParsedRequest``."""
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ParsedRequest(
            model="unknown",
            messages=[],
            stream=False,
            tools=[],
            thinking_enabled=False,
            max_tokens=4096,
            system=None,
            raw_body=body,
        )

    thinking = data.get("thinking", {})
    thinking_enabled = False
    if isinstance(thinking, dict):
        thinking_enabled = thinking.get("budget_tokens", 0) > 0

    system = data.get("system")
    if isinstance(system, list):
        system = " ".join(b.get("text", "") for b in system if isinstance(b, dict))

    return ParsedRequest(
        model=data.get("model", "unknown"),
        messages=data.get("messages", []),
        stream=bool(data.get("stream", False)),
        tools=data.get("tools", []),
        thinking_enabled=thinking_enabled,
        max_tokens=data.get("max_tokens", 4096),
        system=system if isinstance(system, str) else None,
        raw_body=body,
    )
