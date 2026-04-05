"""Bifrost domain models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class TokenUsage:
    """Token usage from an LLM response."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class ModelInfo:
    """A model available via this proxy."""

    id: str
    display_name: str


@dataclass
class RequestLog:
    """Recorded metadata for a completed proxy request."""

    timestamp: datetime
    model: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    latency_ms: float = 0.0
    stream: bool = False
