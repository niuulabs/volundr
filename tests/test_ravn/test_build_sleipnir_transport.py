"""Tests for transport builder and _resolve_transport_kwargs (NIU-629, NIU-634).

_build_sleipnir_transport was deleted in NIU-634; the logic now lives in
_build_mesh via niuu.mesh.transport_builder.build_transport directly.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

from niuu.mesh.transport_builder import TRANSPORT_ALIASES as _TRANSPORT_ALIASES
from ravn.cli.commands import _resolve_transport_kwargs
from ravn.config import Settings


def _make_settings(**overrides: Any) -> Settings:
    """Create a minimal Settings with sensible defaults for transport tests."""
    s = Settings()
    # Wire up mesh.nng defaults
    s.mesh.nng.pub_sub_address = "ipc:///tmp/test.ipc"
    s.mesh.own_peer_id = "test-peer"
    for key, val in overrides.items():
        parts = key.split(".")
        obj = s
        for part in parts[:-1]:
            obj = getattr(obj, part)
        setattr(obj, parts[-1], val)
    return s


class TestTransportAliases:
    """Verify the alias map covers all known transport short names."""

    def test_all_short_names_present(self):
        expected = {"nng", "sleipnir", "rabbitmq", "nats", "redis", "in_process"}
        assert set(_TRANSPORT_ALIASES.keys()) == expected

    def test_aliases_are_fully_qualified(self):
        for alias, fq in _TRANSPORT_ALIASES.items():
            parts = fq.rsplit(".", 1)
            assert len(parts) == 2, f"alias {alias!r} is not a dotted class path"

    def test_sleipnir_and_rabbitmq_resolve_to_same_class(self):
        assert _TRANSPORT_ALIASES["sleipnir"] == _TRANSPORT_ALIASES["rabbitmq"]


class TestResolveTransportKwargs:
    """Verify _resolve_transport_kwargs returns correct kwargs per adapter."""

    def test_nng_kwargs(self):
        settings = _make_settings()
        kwargs = _resolve_transport_kwargs(settings, "nng")
        assert kwargs["address"] == "ipc:///tmp/test.ipc"
        assert kwargs["service_id"] == "ravn:test-peer"
        assert "peer_addresses" in kwargs

    def test_rabbitmq_kwargs_with_env(self):
        settings = _make_settings()
        with patch.dict("os.environ", {"SLEIPNIR_AMQP_URL": "amqp://host"}):
            kwargs = _resolve_transport_kwargs(settings, "rabbitmq")
        assert kwargs == {"amqp_url": "amqp://host"}

    def test_rabbitmq_kwargs_empty_when_env_missing(self):
        settings = _make_settings()
        with patch.dict("os.environ", {}, clear=True):
            kwargs = _resolve_transport_kwargs(settings, "rabbitmq")
        assert kwargs == {}

    def test_sleipnir_alias_same_as_rabbitmq(self):
        settings = _make_settings()
        with patch.dict("os.environ", {"SLEIPNIR_AMQP_URL": "amqp://host"}):
            kwargs = _resolve_transport_kwargs(settings, "sleipnir")
        assert kwargs == {"amqp_url": "amqp://host"}

    def test_nats_kwargs(self):
        settings = _make_settings()
        with patch.dict("os.environ", {"NATS_URL": "nats://custom:4222"}):
            kwargs = _resolve_transport_kwargs(settings, "nats")
        assert kwargs == {"servers": ["nats://custom:4222"]}

    def test_nats_kwargs_default(self):
        settings = _make_settings()
        with patch.dict("os.environ", {}, clear=True):
            kwargs = _resolve_transport_kwargs(settings, "nats")
        assert kwargs == {"servers": ["nats://localhost:4222"]}

    def test_redis_kwargs(self):
        settings = _make_settings()
        with patch.dict("os.environ", {"REDIS_URL": "redis://custom:6379"}):
            kwargs = _resolve_transport_kwargs(settings, "redis")
        assert kwargs == {"redis_url": "redis://custom:6379"}

    def test_redis_kwargs_default(self):
        settings = _make_settings()
        with patch.dict("os.environ", {}, clear=True):
            kwargs = _resolve_transport_kwargs(settings, "redis")
        assert kwargs == {"redis_url": "redis://localhost:6379"}

    def test_in_process_kwargs_empty(self):
        settings = _make_settings()
        kwargs = _resolve_transport_kwargs(settings, "in_process")
        assert kwargs == {}

    def test_unknown_adapter_returns_empty(self):
        settings = _make_settings()
        kwargs = _resolve_transport_kwargs(settings, "unknown_thing")
        assert kwargs == {}


class TestBuildMeshTransport:
    """Verify _resolve_transport_kwargs + niuu.mesh.transport_builder.build_transport
    together produce the correct kwargs for each transport type.

    _build_sleipnir_transport was deleted in NIU-634; these tests cover
    _resolve_transport_kwargs, which is still used by _build_mesh.
    """

    def test_nng_kwargs_with_cluster(self):
        """NNG kwargs include peer addresses from cluster.yaml."""
        settings = _make_settings()
        with patch("niuu.mesh.cluster.read_cluster_pub_addresses", return_value=["tcp://p:7480"]):
            kwargs = _resolve_transport_kwargs(settings, "nng")
        assert kwargs["address"] == "ipc:///tmp/test.ipc"
        assert kwargs["service_id"] == "ravn:test-peer"
        assert kwargs["peer_addresses"] == ["tcp://p:7480"]

    def test_rabbitmq_returns_none_when_env_missing(self):
        settings = _make_settings()
        with patch.dict("os.environ", {}, clear=True):
            kwargs = _resolve_transport_kwargs(settings, "rabbitmq")
        assert kwargs == {}

    def test_rabbitmq_kwargs_with_env(self):
        settings = _make_settings()
        with patch.dict("os.environ", {"SLEIPNIR_AMQP_URL": "amqp://host"}):
            kwargs = _resolve_transport_kwargs(settings, "rabbitmq")
        assert kwargs == {"amqp_url": "amqp://host"}

    def test_in_process_kwargs_empty(self):
        settings = _make_settings()
        kwargs = _resolve_transport_kwargs(settings, "in_process")
        assert kwargs == {}
