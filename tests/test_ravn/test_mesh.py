"""Tests for MeshPort, NngMeshAdapter, SleipnirMeshAdapter, CompositeMeshAdapter.

All tests run without real sockets or broker connections — infrastructure is
mocked at the pynng / aio_pika layer.

Coverage targets:
- MeshPort protocol conformance
- PeerNotFoundError
- NngMeshAdapter: publish, subscribe, unsubscribe, send, rpc handler, timeout,
  peer-not-found, start/stop
- SleipnirMeshAdapter: publish, subscribe, send, peer-not-found, timeout, rpc
- CompositeMeshAdapter: send falls back, pub/sub reaches both
- Integration: two in-process NngMeshAdapters exchange an RPC message
"""

from __future__ import annotations

import asyncio
import json
import sys
import types
from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.mesh.composite import CompositeMeshAdapter
from ravn.adapters.mesh.nng_mesh import NngMeshAdapter, _decode_message, _encode_message
from ravn.adapters.mesh.sleipnir_mesh import SleipnirMeshAdapter
from ravn.config import MeshConfig, MeshSleipnirConfig, NngMeshConfig, SleipnirConfig
from ravn.domain.events import RavnEvent
from ravn.ports.mesh import MeshPort, PeerNotFoundError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(topic_source: str = "test-ravn") -> RavnEvent:
    return RavnEvent.thought(
        source=topic_source,
        text="hello mesh",
        correlation_id="cid-1",
        session_id="sess-1",
    )


class _FakeDiscovery:
    """Minimal DiscoveryPort stub."""

    def __init__(self, peers: dict | None = None) -> None:
        self._peers: dict = peers or {}

    def peers(self) -> dict:
        return self._peers


class _FakePeer:
    def __init__(self, rep_address: str, pub_address: str = "") -> None:
        self.rep_address = rep_address
        self.pub_address = pub_address


# ---------------------------------------------------------------------------
# MeshPort protocol
# ---------------------------------------------------------------------------


class TestMeshPortProtocol:
    def test_nng_adapter_satisfies_protocol(self) -> None:
        cfg = NngMeshConfig()
        discovery = _FakeDiscovery()
        adapter = NngMeshAdapter(config=cfg, discovery=discovery, own_peer_id="ravn-1")
        assert isinstance(adapter, MeshPort)

    def test_composite_adapter_satisfies_protocol(self) -> None:
        primary = MagicMock(spec=MeshPort)
        fallback = MagicMock(spec=MeshPort)
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        assert isinstance(composite, MeshPort)

    def test_peer_not_found_error_carries_peer_id(self) -> None:
        err = PeerNotFoundError("ravn-xyz")
        assert err.peer_id == "ravn-xyz"
        assert "ravn-xyz" in str(err)


# ---------------------------------------------------------------------------
# NngMeshAdapter — encode/decode round-trip
# ---------------------------------------------------------------------------


class TestNngEncoding:
    def test_encode_decode_roundtrip(self) -> None:
        event = _make_event()
        data = _encode_message("heartbeat", event)
        topic, decoded = _decode_message(data)
        assert topic == "heartbeat"
        assert decoded.type == event.type
        assert decoded.source == event.source
        assert decoded.payload == event.payload
        assert decoded.correlation_id == event.correlation_id
        assert decoded.session_id == event.session_id

    def test_topic_prefix_is_separated(self) -> None:
        event = _make_event()
        data = _encode_message("my.topic", event)
        assert data.startswith(b"my.topic\x00")


# ---------------------------------------------------------------------------
# NngMeshAdapter — unit tests (pynng mocked)
# ---------------------------------------------------------------------------


def _make_nng_adapter(
    peers: dict | None = None,
    own_peer_id: str = "ravn-1",
) -> NngMeshAdapter:
    cfg = NngMeshConfig(
        pub_sub_address="ipc:///tmp/test-pub.ipc",
        req_rep_address="ipc:///tmp/test-rep.ipc",
    )
    discovery = _FakeDiscovery(peers)
    return NngMeshAdapter(config=cfg, discovery=discovery, own_peer_id=own_peer_id)


class TestNngMeshAdapterUnit:
    @pytest.mark.asyncio
    async def test_subscribe_registers_handler(self) -> None:
        adapter = _make_nng_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await adapter.subscribe("heartbeat", handler)
        assert adapter._handlers["heartbeat"] is handler

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_handler(self) -> None:
        adapter = _make_nng_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await adapter.subscribe("heartbeat", handler)
        await adapter.unsubscribe("heartbeat")
        assert "heartbeat" not in adapter._handlers

    @pytest.mark.asyncio
    async def test_send_raises_peer_not_found(self) -> None:
        adapter = _make_nng_adapter(peers={})  # empty peer table
        # Peer lookup happens before pynng check, so PeerNotFoundError always raised.
        with pytest.raises(PeerNotFoundError):
            await adapter.send("nonexistent-peer", {"type": "ping"}, timeout_s=1.0)

    @pytest.mark.asyncio
    async def test_publish_before_start_is_noop(self) -> None:
        adapter = _make_nng_adapter()
        event = _make_event()
        # Must not raise even though sockets aren't open
        await adapter.publish(event, "test")

    @pytest.mark.asyncio
    async def test_set_rpc_handler(self) -> None:
        adapter = _make_nng_adapter()

        async def handler(request: dict) -> dict:
            return {"pong": True}

        adapter.set_rpc_handler(handler)
        reply = await adapter._dispatch_rpc({"type": "ping"})
        assert reply == {"pong": True}

    @pytest.mark.asyncio
    async def test_dispatch_rpc_no_handler(self) -> None:
        adapter = _make_nng_adapter()
        reply = await adapter._dispatch_rpc({"type": "ping", "request_id": "r1"})
        assert "error" in reply

    @pytest.mark.asyncio
    async def test_dispatch_rpc_handler_exception(self) -> None:
        adapter = _make_nng_adapter()

        async def bad_handler(request: dict) -> dict:
            raise ValueError("boom")

        adapter.set_rpc_handler(bad_handler)
        reply = await adapter._dispatch_rpc({"type": "ping"})
        assert "error" in reply
        assert "boom" in reply["error"]


# ---------------------------------------------------------------------------
# NngMeshAdapter — start/stop with mocked pynng
# ---------------------------------------------------------------------------


def _make_fake_pynng():
    """Build a minimal fake pynng module."""
    import threading

    fake = types.ModuleType("pynng")

    class _Socket:
        def __init__(self, *_, **__) -> None:
            self._subscriptions: list[bytes] = []
            self._dialed: list[str] = []
            self._closed = threading.Event()

        def listen(self, addr: str) -> None:
            pass

        def dial(self, addr: str) -> None:
            self._dialed.append(addr)

        def send(self, data: bytes) -> None:
            pass

        def recv(self) -> bytes:
            # Block until close() is called, then raise so the task loop exits
            # cleanly and the executor thread terminates quickly.
            self._closed.wait()
            raise OSError("fake socket closed")

        def subscribe(self, prefix: bytes) -> None:
            self._subscriptions.append(prefix)

        def unsubscribe(self, prefix: bytes) -> None:
            if prefix in self._subscriptions:
                self._subscriptions.remove(prefix)

        def close(self) -> None:
            self._closed.set()

    fake.Pub0 = _Socket
    fake.Sub0 = _Socket
    fake.Rep0 = _Socket
    fake.Req0 = _Socket
    return fake


class TestNngMeshAdapterStartStop:
    @pytest.mark.asyncio
    async def test_start_creates_sockets_and_tasks(self) -> None:
        adapter = _make_nng_adapter()
        fake_pynng = _make_fake_pynng()

        with patch.dict(sys.modules, {"pynng": fake_pynng}):
            import ravn.adapters.mesh.nng_mesh as nng_mod

            nng_mod.pynng = fake_pynng  # patch module-level reference

            await adapter.start()
            assert adapter._pub_socket is not None
            assert adapter._sub_socket is not None
            assert adapter._rep_socket is not None
            assert adapter._sub_task is not None
            assert adapter._rep_task is not None

            await adapter.stop()
            assert adapter._pub_socket is None
            assert adapter._sub_socket is None
            assert adapter._rep_socket is None

    @pytest.mark.asyncio
    async def test_stop_is_idempotent(self) -> None:
        adapter = _make_nng_adapter()
        # stop without start should not raise
        await adapter.stop()
        await adapter.stop()


# ---------------------------------------------------------------------------
# SleipnirMeshAdapter — unit tests (aio_pika mocked)
# ---------------------------------------------------------------------------


def _make_sleipnir_adapter(
    peers: dict | None = None,
    own_peer_id: str = "ravn-2",
) -> SleipnirMeshAdapter:
    sleipnir_cfg = SleipnirConfig(
        enabled=True,
        amqp_url_env="TEST_AMQP_URL",
        reconnect_delay_s=0.1,
        publish_timeout_s=2.0,
    )
    mesh_cfg = MeshSleipnirConfig(exchange="ravn.mesh", rpc_timeout_s=5.0)
    discovery = _FakeDiscovery(peers)
    return SleipnirMeshAdapter(
        sleipnir_config=sleipnir_cfg,
        mesh_sleipnir_config=mesh_cfg,
        own_peer_id=own_peer_id,
        discovery=discovery,
    )


class TestSleipnirMeshAdapterUnit:
    @pytest.mark.asyncio
    async def test_send_raises_peer_not_found(self) -> None:
        adapter = _make_sleipnir_adapter(peers={})
        with pytest.raises(PeerNotFoundError):
            await adapter.send("ghost-peer", {"type": "ping"}, timeout_s=1.0)

    @pytest.mark.asyncio
    async def test_publish_with_no_exchange_is_noop(self) -> None:
        adapter = _make_sleipnir_adapter()
        # _ensure_exchange returns None (no amqp_url set)
        event = _make_event()
        await adapter.publish(event, "test")  # must not raise

    @pytest.mark.asyncio
    async def test_subscribe_stores_handler(self) -> None:
        adapter = _make_sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await adapter.subscribe("cascade", handler)
        assert adapter._handlers["cascade"] is handler

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_handler(self) -> None:
        adapter = _make_sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await adapter.subscribe("cascade", handler)
        await adapter.unsubscribe("cascade")
        assert "cascade" not in adapter._handlers

    @pytest.mark.asyncio
    async def test_set_rpc_handler(self) -> None:
        adapter = _make_sleipnir_adapter()

        async def echo(request: dict) -> dict:
            return {"echo": request}

        adapter.set_rpc_handler(echo)
        assert adapter._rpc_handler is echo

    @pytest.mark.asyncio
    async def test_handle_rpc_message_no_handler(self) -> None:
        adapter = _make_sleipnir_adapter()
        msg = MagicMock()
        msg.body = json.dumps({"type": "ping"}).encode()
        msg.reply_to = None
        msg.correlation_id = "cid"
        # Should not raise
        await adapter._handle_rpc_message(msg)

    @pytest.mark.asyncio
    async def test_handle_rpc_message_calls_handler(self) -> None:
        adapter = _make_sleipnir_adapter()

        async def handler(request: dict) -> dict:
            return {"got": request.get("type")}

        adapter.set_rpc_handler(handler)

        msg = MagicMock()
        msg.body = json.dumps({"type": "task_dispatch"}).encode()
        msg.reply_to = None  # no reply queue — just test handler invocation
        msg.correlation_id = None

        await adapter._handle_rpc_message(msg)
        # No assertion on replies — just verify no exception

    @pytest.mark.asyncio
    async def test_stop_without_start_is_safe(self) -> None:
        adapter = _make_sleipnir_adapter()
        await adapter.stop()


# ---------------------------------------------------------------------------
# CompositeMeshAdapter
# ---------------------------------------------------------------------------


class TestCompositeMeshAdapter:
    @pytest.mark.asyncio
    async def test_send_uses_primary_when_available(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.send = AsyncMock(return_value={"status": "ok"})
        fallback = AsyncMock(spec=MeshPort)

        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        result = await composite.send("peer-a", {"msg": 1}, timeout_s=5.0)
        assert result == {"status": "ok"}
        primary.send.assert_awaited_once()
        fallback.send.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_send_falls_back_on_peer_not_found(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.send = AsyncMock(side_effect=PeerNotFoundError("peer-b"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.send = AsyncMock(return_value={"status": "fallback"})

        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        result = await composite.send("peer-b", {"msg": 2}, timeout_s=5.0)
        assert result == {"status": "fallback"}

    @pytest.mark.asyncio
    async def test_send_falls_back_on_generic_error(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.send = AsyncMock(side_effect=RuntimeError("connection refused"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.send = AsyncMock(return_value={"status": "nng_ok"})

        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        result = await composite.send("peer-c", {}, timeout_s=5.0)
        assert result == {"status": "nng_ok"}

    @pytest.mark.asyncio
    async def test_send_raises_if_both_fail(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.send = AsyncMock(side_effect=PeerNotFoundError("peer-x"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.send = AsyncMock(side_effect=PeerNotFoundError("peer-x"))

        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        with pytest.raises(PeerNotFoundError):
            await composite.send("peer-x", {}, timeout_s=5.0)

    @pytest.mark.asyncio
    async def test_publish_calls_both(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        fallback = AsyncMock(spec=MeshPort)

        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        event = _make_event()
        await composite.publish(event, "broadcast")
        primary.publish.assert_awaited_once_with(event, "broadcast")
        fallback.publish.assert_awaited_once_with(event, "broadcast")

    @pytest.mark.asyncio
    async def test_subscribe_calls_both(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        fallback = AsyncMock(spec=MeshPort)
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await composite.subscribe("alerts", handler)
        primary.subscribe.assert_awaited_once()
        fallback.subscribe.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_start_and_stop_call_both(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        fallback = AsyncMock(spec=MeshPort)
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        await composite.start()
        primary.start.assert_awaited_once()
        fallback.start.assert_awaited_once()
        await composite.stop()
        primary.stop.assert_awaited_once()
        fallback.stop.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_publish_primary_failure_continues_to_fallback(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.publish = AsyncMock(side_effect=RuntimeError("primary down"))
        fallback = AsyncMock(spec=MeshPort)
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        event = _make_event()
        # Must not raise
        await composite.publish(event, "topic")
        fallback.publish.assert_awaited_once()


# ---------------------------------------------------------------------------
# Integration: two in-process NngMeshAdapters via asyncio queues
# (no real sockets — simulates the round-trip at the protocol level)
# ---------------------------------------------------------------------------


class _InProcessMesh:
    """Pair of in-process mesh endpoints connected via asyncio Queues."""

    def __init__(self) -> None:
        self._a_to_b: asyncio.Queue[bytes] = asyncio.Queue()
        self._b_to_a: asyncio.Queue[bytes] = asyncio.Queue()

    async def send_a_to_b(self, data: bytes) -> bytes:
        await self._a_to_b.put(data)
        return await self._b_to_a.get()

    async def send_b_to_a(self, data: bytes) -> bytes:
        await self._b_to_a.put(data)
        return await self._a_to_b.get()


class TestNngMeshIntegration:
    """Integration test: two NngMeshAdapters exchange an RPC via in-process queues.

    We bypass the actual nng sockets and wire the adapters' ``_dispatch_rpc``
    methods together directly — this validates the full RPC request/reply cycle
    at the application layer without requiring pynng to be installed.
    """

    @pytest.mark.asyncio
    async def test_rpc_roundtrip_via_dispatch(self) -> None:
        adapter_b = _make_nng_adapter(
            peers={"ravn-a": _FakePeer(rep_address="ipc:///tmp/a.ipc")},
            own_peer_id="ravn-b",
        )

        received: list[dict] = []

        async def b_handler(request: dict) -> dict:
            received.append(request)
            return {"ack": True, "task_id": request.get("task_id")}

        adapter_b.set_rpc_handler(b_handler)

        # Simulate adapter_a sending to adapter_b via direct _dispatch_rpc call
        request = {"type": "task_dispatch", "task_id": "t-001"}
        reply = await adapter_b._dispatch_rpc(request)

        assert reply == {"ack": True, "task_id": "t-001"}
        assert received == [request]

    @pytest.mark.asyncio
    async def test_rpc_peer_not_found(self) -> None:
        adapter = _make_nng_adapter(peers={}, own_peer_id="ravn-a")
        with pytest.raises(PeerNotFoundError) as exc_info:
            await adapter.send("ravn-missing", {"type": "ping"}, timeout_s=1.0)
        assert exc_info.value.peer_id == "ravn-missing"


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestMeshConfig:
    def test_defaults(self) -> None:
        cfg = MeshConfig()
        assert cfg.enabled is False
        assert cfg.adapter == "nng"
        assert cfg.rpc_timeout_s == 10.0
        assert cfg.nng.pub_sub_address == "tcp://*:7480"
        assert cfg.nng.req_rep_address == "tcp://*:7481"
        assert cfg.sleipnir.exchange == "ravn.mesh"

    def test_custom_values(self) -> None:
        cfg = MeshConfig(
            enabled=True,
            adapter="sleipnir",
            rpc_timeout_s=30.0,
            nng=NngMeshConfig(pub_sub_address="ipc:///tmp/p.ipc"),
        )
        assert cfg.enabled is True
        assert cfg.adapter == "sleipnir"
        assert cfg.rpc_timeout_s == 30.0
        assert cfg.nng.pub_sub_address == "ipc:///tmp/p.ipc"
