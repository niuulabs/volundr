"""Tests for Sleipnir serialisation helpers."""

from __future__ import annotations

from unittest.mock import patch

import pytest

import sleipnir.adapters.serialization as _ser_module
from sleipnir.adapters.serialization import (
    deserialize,
    msgpack_available,
    serialize,
)
from tests.test_sleipnir.conftest import DEFAULT_TIMESTAMP, make_event

_skip_no_msgpack = pytest.mark.skipif(
    not msgpack_available(),
    reason="msgpack not installed",
)


# ---------------------------------------------------------------------------
# JSON serialisation
# ---------------------------------------------------------------------------


def test_json_serialize_returns_bytes():
    data = serialize(make_event(), fmt="json")
    assert isinstance(data, bytes)


def test_json_round_trip():
    original = make_event()
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
    original = make_event(correlation_id=None, causation_id=None, tenant_id=None, ttl=None)
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")

    assert restored.correlation_id is None
    assert restored.causation_id is None
    assert restored.tenant_id is None
    assert restored.ttl is None


def test_json_round_trip_preserves_timestamp():
    original = make_event()
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")
    assert restored.timestamp.isoformat() == DEFAULT_TIMESTAMP.isoformat()


def test_json_round_trip_complex_payload():
    original = make_event(payload={"nested": {"a": 1, "b": [1, 2, 3]}, "flag": True})
    data = serialize(original, fmt="json")
    restored = deserialize(data, fmt="json")
    assert restored.payload == original.payload


# ---------------------------------------------------------------------------
# Unknown format
# ---------------------------------------------------------------------------


def test_serialize_unknown_format_raises():
    with pytest.raises(ValueError, match="Unknown serialisation format"):
        serialize(make_event(), fmt="xml")  # type: ignore[arg-type]


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
            serialize(make_event(), fmt="msgpack")


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
    data = serialize(make_event(), fmt="msgpack")
    assert isinstance(data, bytes)


@_skip_no_msgpack
def test_msgpack_round_trip():
    original = make_event()
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
    original = make_event(correlation_id=None, causation_id=None, tenant_id=None, ttl=None)
    data = serialize(original, fmt="msgpack")
    restored = deserialize(data, fmt="msgpack")

    assert restored.correlation_id is None
    assert restored.causation_id is None
    assert restored.tenant_id is None
    assert restored.ttl is None


@_skip_no_msgpack
def test_msgpack_is_more_compact_than_json():
    evt = make_event()
    msgpack_bytes = serialize(evt, fmt="msgpack")
    json_bytes = serialize(evt, fmt="json")
    assert len(msgpack_bytes) < len(json_bytes)
