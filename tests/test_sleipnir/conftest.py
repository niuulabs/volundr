"""Shared helpers for the Sleipnir test suite."""

from __future__ import annotations

from datetime import UTC, datetime

from sleipnir.domain.events import SleipnirEvent

DEFAULT_TIMESTAMP = datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC)


def make_event(**kwargs) -> SleipnirEvent:
    """Return a :class:`SleipnirEvent` with sensible test defaults.

    All fields can be overridden via keyword arguments.
    """
    defaults: dict = dict(
        event_id="evt-001",
        event_type="ravn.tool.complete",
        source="ravn:agent-abc123",
        payload={"tool": "bash", "exit_code": 0},
        summary="Bash tool completed successfully",
        urgency=0.5,
        domain="code",
        timestamp=DEFAULT_TIMESTAMP,
    )
    defaults.update(kwargs)
    return SleipnirEvent(**defaults)
