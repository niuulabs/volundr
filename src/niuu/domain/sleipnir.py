"""Sleipnir event model and event type registry."""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from datetime import UTC, datetime

# ---------------------------------------------------------------------------
# Event type hierarchy
# ---------------------------------------------------------------------------

#: Known top-level namespaces and their sub-patterns.
#: Keys are namespace prefixes; values are documentation strings.
EVENT_NAMESPACES: dict[str, str] = {
    "ravn": "Ravn agent events (tool calls, reasoning steps, completions)",
    "tyr": "Tyr autonomous dispatcher events (tasks, sessions, runs)",
    "volundr": "Volundr platform events (repos, PRs, integrations)",
    "bifrost": "Bifrost gateway events (routing, connection, auth)",
    "system": "Infrastructure and lifecycle events (health, config, restart)",
}

#: Valid event type pattern: lowercase alphanumerics and dots, min 2 segments.
_EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")


def validate_event_type(event_type: str) -> None:
    """Raise ValueError if *event_type* is not a valid Sleipnir event type.

    Rules:
    - Must be lowercase, dot-separated segments (e.g. ``ravn.tool.complete``)
    - Must have at least two segments
    - First segment must be a known namespace
    """
    if not _EVENT_TYPE_RE.match(event_type):
        raise ValueError(
            f"Invalid event type {event_type!r}: must be lowercase dot-separated "
            "segments (e.g. 'ravn.tool.complete')"
        )
    namespace = event_type.split(".")[0]
    if namespace not in EVENT_NAMESPACES:
        raise ValueError(
            f"Unknown namespace {namespace!r} in event type {event_type!r}. "
            f"Known namespaces: {sorted(EVENT_NAMESPACES)}"
        )


def match_event_type(pattern: str, event_type: str) -> bool:
    """Return True if *event_type* matches *pattern*.

    Pattern syntax uses shell-style wildcards via :func:`fnmatch.fnmatch`:

    - ``ravn.*`` matches ``ravn.tool.complete`` and ``ravn.step.start``
    - ``ravn.tool.*`` matches ``ravn.tool.complete`` but not ``ravn.step.start``
    - ``*`` matches any event type
    - Exact strings match only themselves
    """
    return fnmatch.fnmatch(event_type, pattern)


# ---------------------------------------------------------------------------
# Event model
# ---------------------------------------------------------------------------


@dataclass
class SleipnirEvent:
    """A structured event published over the Sleipnir event bus.

    :param event_id: Unique identifier (UUID string).
    :param event_type: Hierarchical dot-separated type (e.g. ``ravn.tool.complete``).
    :param source: Publisher identity string (e.g. ``ravn:agent-abc123``).
    :param payload: Event-specific data dictionary.
    :param summary: Human-readable one-liner describing the event.
    :param urgency: Priority hint in the range ``0.0`` (lowest) to ``1.0`` (highest).
    :param domain: High-level domain tag (e.g. ``code``, ``infrastructure``, ``home``).
    :param timestamp: When the event occurred (UTC).
    :param correlation_id: Groups causally related events across services.
    :param causation_id: ID of the event that directly caused this one.
    :param tenant_id: Tenant scope; ``None`` for single-tenant deployments.
    :param ttl: Seconds until the event expires; ``None`` means no expiry.
    """

    event_id: str
    event_type: str
    source: str
    payload: dict
    summary: str
    urgency: float
    domain: str
    timestamp: datetime
    correlation_id: str | None = None
    causation_id: str | None = None
    tenant_id: str | None = None
    ttl: int | None = None

    def __post_init__(self) -> None:
        if not 0.0 <= self.urgency <= 1.0:
            raise ValueError(f"urgency must be between 0.0 and 1.0, got {self.urgency}")

    @staticmethod
    def now() -> datetime:
        """Return the current UTC datetime (convenience for callers)."""
        return datetime.now(UTC)

    def to_dict(self) -> dict:
        """Serialise to a plain dictionary suitable for JSON or msgpack."""
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "source": self.source,
            "payload": self.payload,
            "summary": self.summary,
            "urgency": self.urgency,
            "domain": self.domain,
            "timestamp": self.timestamp.isoformat(),
            "correlation_id": self.correlation_id,
            "causation_id": self.causation_id,
            "tenant_id": self.tenant_id,
            "ttl": self.ttl,
        }

    @classmethod
    def from_dict(cls, data: dict) -> SleipnirEvent:
        """Deserialise from a plain dictionary."""
        ts = data["timestamp"]
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        return cls(
            event_id=data["event_id"],
            event_type=data["event_type"],
            source=data["source"],
            payload=data["payload"],
            summary=data["summary"],
            urgency=data["urgency"],
            domain=data["domain"],
            timestamp=ts,
            correlation_id=data.get("correlation_id"),
            causation_id=data.get("causation_id"),
            tenant_id=data.get("tenant_id"),
            ttl=data.get("ttl"),
        )
