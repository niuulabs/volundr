"""Tests for the SleipnirEvent model and event type registry."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from sleipnir.domain.events import (
    EVENT_NAMESPACES,
    SleipnirEvent,
    match_event_type,
    validate_event_type,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(**kwargs) -> SleipnirEvent:
    defaults = dict(
        event_id="evt-001",
        event_type="ravn.tool.complete",
        source="ravn:agent-abc123",
        payload={"tool": "bash", "exit_code": 0},
        summary="Bash tool completed successfully",
        urgency=0.5,
        domain="code",
        timestamp=datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC),
    )
    defaults.update(kwargs)
    return SleipnirEvent(**defaults)


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def test_event_construction_minimal():
    evt = _make_event()
    assert evt.event_id == "evt-001"
    assert evt.event_type == "ravn.tool.complete"
    assert evt.source == "ravn:agent-abc123"
    assert evt.urgency == 0.5
    assert evt.correlation_id is None
    assert evt.causation_id is None
    assert evt.tenant_id is None
    assert evt.ttl is None


def test_event_construction_full():
    evt = _make_event(
        correlation_id="corr-123",
        causation_id="cause-456",
        tenant_id="tenant-789",
        ttl=300,
    )
    assert evt.correlation_id == "corr-123"
    assert evt.causation_id == "cause-456"
    assert evt.tenant_id == "tenant-789"
    assert evt.ttl == 300


def test_event_urgency_boundaries():
    lo = _make_event(urgency=0.0)
    hi = _make_event(urgency=1.0)
    assert lo.urgency == 0.0
    assert hi.urgency == 1.0


def test_event_urgency_invalid_low():
    with pytest.raises(ValueError, match="urgency"):
        _make_event(urgency=-0.1)


def test_event_urgency_invalid_high():
    with pytest.raises(ValueError, match="urgency"):
        _make_event(urgency=1.1)


# ---------------------------------------------------------------------------
# Serialisation round-trip (JSON path, no msgpack needed)
# ---------------------------------------------------------------------------


def test_to_dict_contains_all_fields():
    evt = _make_event(correlation_id="corr-1", tenant_id="t-1", ttl=60)
    d = evt.to_dict()
    assert d["event_id"] == "evt-001"
    assert d["event_type"] == "ravn.tool.complete"
    assert d["source"] == "ravn:agent-abc123"
    assert d["summary"] == "Bash tool completed successfully"
    assert d["urgency"] == 0.5
    assert d["domain"] == "code"
    assert d["correlation_id"] == "corr-1"
    assert d["causation_id"] is None
    assert d["tenant_id"] == "t-1"
    assert d["ttl"] == 60
    assert isinstance(d["timestamp"], str)


def test_round_trip_from_dict():
    original = _make_event(
        correlation_id="c1",
        causation_id="c2",
        tenant_id="t1",
        ttl=120,
    )
    restored = SleipnirEvent.from_dict(original.to_dict())
    assert restored.event_id == original.event_id
    assert restored.event_type == original.event_type
    assert restored.source == original.source
    assert restored.payload == original.payload
    assert restored.summary == original.summary
    assert restored.urgency == original.urgency
    assert restored.domain == original.domain
    assert restored.correlation_id == original.correlation_id
    assert restored.causation_id == original.causation_id
    assert restored.tenant_id == original.tenant_id
    assert restored.ttl == original.ttl


def test_from_dict_parses_iso_timestamp():
    d = _make_event().to_dict()
    assert isinstance(d["timestamp"], str)
    restored = SleipnirEvent.from_dict(d)
    assert isinstance(restored.timestamp, datetime)


def test_from_dict_accepts_datetime_object():
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    d = _make_event().to_dict()
    d["timestamp"] = ts  # already a datetime
    restored = SleipnirEvent.from_dict(d)
    assert restored.timestamp == ts


def test_now_returns_utc_datetime():
    ts = SleipnirEvent.now()
    assert ts.tzinfo is not None


# ---------------------------------------------------------------------------
# Validate event type
# ---------------------------------------------------------------------------


def test_validate_known_namespaces():
    for ns in EVENT_NAMESPACES:
        validate_event_type(f"{ns}.something")
        validate_event_type(f"{ns}.a.b.c")


def test_validate_unknown_namespace():
    with pytest.raises(ValueError, match="Unknown namespace"):
        validate_event_type("unknown.event.type")


def test_validate_single_segment():
    with pytest.raises(ValueError, match="Invalid event type"):
        validate_event_type("ravn")


def test_validate_uppercase_rejected():
    with pytest.raises(ValueError, match="Invalid event type"):
        validate_event_type("Ravn.tool.complete")


def test_validate_empty_string():
    with pytest.raises(ValueError, match="Invalid event type"):
        validate_event_type("")


def test_validate_numeric_first_char():
    with pytest.raises(ValueError, match="Invalid event type"):
        validate_event_type("1ravn.tool")


# ---------------------------------------------------------------------------
# Pattern matching
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "pattern,event_type,expected",
    [
        # Wildcard namespace match
        ("ravn.*", "ravn.tool.complete", True),
        ("ravn.*", "ravn.step.start", True),
        ("ravn.*", "tyr.saga.created", False),
        # Sub-namespace wildcard
        ("ravn.tool.*", "ravn.tool.complete", True),
        ("ravn.tool.*", "ravn.tool.start", True),
        ("ravn.tool.*", "ravn.step.start", False),
        # Exact match
        ("ravn.tool.complete", "ravn.tool.complete", True),
        ("ravn.tool.complete", "ravn.tool.start", False),
        # Global wildcard
        ("*", "ravn.tool.complete", True),
        ("*", "system.health.ping", True),
        # No match across namespaces
        ("tyr.*", "ravn.tool.complete", False),
        ("volundr.*", "bifrost.connection.open", False),
    ],
)
def test_match_event_type(pattern: str, event_type: str, expected: bool):
    assert match_event_type(pattern, event_type) is expected
