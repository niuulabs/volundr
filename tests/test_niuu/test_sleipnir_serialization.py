"""Tests for Sleipnir serialisation helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

import niuu.adapters.sleipnir.serialization as _ser_module
from niuu.adapters.sleipnir.serialization import (
    deserialize,
    msgpack_available,
    serialize,
)
from niuu.domain.sleipnir import SleipnirEvent

_TS = datetime(2026, 4, 5, 12, 0, 0, tzinfo=UTC)

_skip_no_msgpack = pytest.mark.skipif(
    not msgpack_available(),
    reason="msgpack not installed",
)


def _event(**kwargs) -> SleipnirEvent:
    defaults = dict(
        event_id="evt-serial-01",
        event_type="ravn.tool.complete",
        source="ravn:agent-serial",
        payload={"key": "value", "count": 42},
        summary="serialisation test event",
        urgency=0.7,
        domain="code",
        timestamp=_TS,
        correlation_id="corr-1",
        causation_id="cause-1",
        tenant_id="tenant-abc",
        ttl=120,
    )
    defaults.update(kwargs)
    return SleipnirEvent(**defaults)


# ---------------------------------------------------------------------------
# JSON serialisation
# ---------------------------------------------------------------------------


def test_json_serialize_returns_bytes():
    data = serialize(_event(), fmt="json")
    assert isinstance(data, bytes)


def test_json_round_trip():
    original = _event()
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")

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


def test_json_round_trip_none_fields():
    original = _event(correlation_id=None, causation_id=None, tenant_id=None, ttl=None)
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")

    assert restored.correlation_id is None
    assert restored.causation_id is None
    assert restored.tenant_id is None
    assert restored.ttl is None


def test_json_round_trip_preserves_timestamp():
    original = _event()
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")
    assert restored.timestamp.isoformat() == _TS.isoformat()


def test_json_round_trip_complex_payload():
    original = _event(payload={"nested": {"a": 1, "b": [1, 2, 3]}, "flag": True})
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")
    assert restored.payload == original.payload


# ---------------------------------------------------------------------------
# Unknown format
# ---------------------------------------------------------------------------


def test_serialize_unknown_format_raises():
    with pytest.raises(ValueError, match="Unknown serialisation format"):
        serialize(_event(), fmt="xml")  # type: ignore[arg-type]


def test_deserialize_unknown_format_raises():
    with pytest.raises(ValueError, match="Unknown serialisation format"):
        deserialize(b"data", fmt="xml")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# msgpack unavailable path (always tested via mock)
# ---------------------------------------------------------------------------


def test_msgpack_available_returns_bool():
    assert isinstance(msgpack_available(), bool)


def test_serialize_msgpack_raises_import_error_when_unavailable():
    with patch.object(_ser_module, "_MSGPACK_AVAILABLE", False):
        with pytest.raises(ImportError, match="msgpack is not installed"):
            serialize(_event(), fmt="msgpack")


def test_deserialize_msgpack_raises_import_error_when_unavailable():
    with patch.object(_ser_module, "_MSGPACK_AVAILABLE", False):
        with pytest.raises(ImportError, match="msgpack is not installed"):
            deserialize(b"\x80", fmt="msgpack")


# ---------------------------------------------------------------------------
# msgpack serialisation (skipped if not installed)
# ---------------------------------------------------------------------------


@_skip_no_msgpack
def test_msgpack_available_returns_true_when_installed():
    assert msgpack_available() is True


@_skip_no_msgpack
def test_msgpack_serialize_returns_bytes():
    data = serialize(_event(), fmt="msgpack")
    assert isinstance(data, bytes)


@_skip_no_msgpack
def test_msgpack_round_trip():
    original = _event()
    data = serialize(original, fmt="msgpack")
    restored = deserialize(data, fmt="msgpack")

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


@_skip_no_msgpack
def test_msgpack_round_trip_none_fields():
    original = _event(correlation_id=None, causation_id=None, tenant_id=None, ttl=None)
    data = serialize(original, fmt="msgpack")
    restored = deserialize(data, fmt="msgpack")

    assert restored.correlation_id is None
    assert restored.causation_id is None
    assert restored.tenant_id is None
    assert restored.ttl is None


@_skip_no_msgpack
def test_msgpack_is_more_compact_than_json():
    evt = _event()
    msgpack_bytes = serialize(evt, fmt="msgpack")
    json_bytes = serialize(evt, fmt="json")
    assert len(msgpack_bytes) < len(json_bytes)
