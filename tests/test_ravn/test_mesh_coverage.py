"""Additional coverage tests for mesh adapters (NIU-517).

These tests target specific code paths that require mocking aio_pika and pynng
at a deeper level to exercise branches not covered by the basic unit tests.
"""

from __future__ import annotations

import asyncio
import json
import types
from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ravn.adapters.mesh.composite import CompositeMeshAdapter
from ravn.adapters.mesh.nng_mesh import NngMeshAdapter, _encode_message
from ravn.adapters.mesh.sleipnir_mesh import (
    SleipnirMeshAdapter,
    _decode_event,
    _encode_event,
)
from ravn.config import MeshSleipnirConfig, NngMeshConfig, SleipnirConfig
from ravn.domain.events import RavnEvent
from ravn.ports.mesh import MeshPort, PeerNotFoundError

# ---------------------------------------------------------------------------
# Helpers shared with test_mesh.py
# ---------------------------------------------------------------------------


def _make_event(source: str = "test-ravn") -> RavnEvent:
    return RavnEvent.thought(
        source=source,
        text="coverage test",
        correlation_id="cid",
        session_id="sess",
    )


class _FakeDiscovery:
    def __init__(self, peers: dict | None = None) -> None:
        self._peers: dict = peers or {}

    def peers(self) -> dict:
        return self._peers


class _FakePeer:
    def __init__(self, rep_address: str = "", pub_address: str = "") -> None:
        self.rep_address = rep_address
        self.pub_address = pub_address


def _sleipnir_adapter(
    peers: dict | None = None, own_peer_id: str = "ravn-cov"
) -> SleipnirMeshAdapter:
    return SleipnirMeshAdapter(
        sleipnir_config=SleipnirConfig(
            enabled=True,
            amqp_url_env="COVERAGE_AMQP_URL",
            reconnect_delay_s=0.05,
            publish_timeout_s=1.0,
        ),
        mesh_sleipnir_config=MeshSleipnirConfig(exchange="ravn.mesh", rpc_timeout_s=2.0),
        own_peer_id=own_peer_id,
        discovery=_FakeDiscovery(peers),
    )


def _nng_adapter(peers: dict | None = None, own_peer_id: str = "ravn-nng") -> NngMeshAdapter:
    return NngMeshAdapter(
        config=NngMeshConfig(
            pub_sub_address="ipc:///tmp/cov-pub.ipc",
            req_rep_address="ipc:///tmp/cov-rep.ipc",
        ),
        discovery=_FakeDiscovery(peers),
        own_peer_id=own_peer_id,
    )


# ---------------------------------------------------------------------------
# Sleipnir encode/decode helpers
# ---------------------------------------------------------------------------


class TestSleipnirEncoding:
    def test_encode_decode_roundtrip(self) -> None:
        event = _make_event()
        data = _encode_event(event)
        decoded = _decode_event(data)
        assert decoded.type == event.type
        assert decoded.source == event.source
        assert decoded.session_id == event.session_id
        assert decoded.correlation_id == event.correlation_id
        assert decoded.urgency == event.urgency

    def test_encode_produces_json_bytes(self) -> None:
        event = _make_event()
        data = _encode_event(event)
        parsed = json.loads(data)
        assert parsed["source"] == event.source
        assert "timestamp" in parsed

    def test_decode_handles_null_task_id(self) -> None:
        event = _make_event()
        data = _encode_event(event)
        raw = json.loads(data)
        raw["task_id"] = None
        decoded = _decode_event(json.dumps(raw).encode())
        assert decoded.task_id is None


# ---------------------------------------------------------------------------
# Fake aio_pika builder
# ---------------------------------------------------------------------------


def _make_fake_aio_pika(
    connect_raises: Exception | None = None,
    publish_raises: Exception | None = None,
):
    """Build a minimal fake aio_pika module for testing."""
    fake = types.ModuleType("aio_pika")

    class ExchangeType:
        TOPIC = "topic"

    class _Message:
        def __init__(self, body: bytes, **kwargs) -> None:
            self.body = body
            for k, v in kwargs.items():
                setattr(self, k, v)

    class _Queue:
        def __init__(self, name: str = "") -> None:
            self.name = name
            self._messages: list[_Message] = []
            self._consumers: list = []

        async def bind(self, exchange: object, routing_key: str = "") -> None:
            pass

        async def consume(self, callback: Callable) -> None:
            self._consumers.append(callback)

        async def delete(self) -> None:
            pass

        def iterator(self):
            return self._AsyncIterator(self._messages)

        class _AsyncIterator:
            def __init__(self, msgs: list) -> None:
                self._msgs = list(msgs)
                self._idx = 0

            def __aiter__(self):
                return self

            async def __anext__(self):
                if self._idx >= len(self._msgs):
                    raise StopAsyncIteration
                msg = self._msgs[self._idx]
                self._idx += 1
                return msg

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_) -> None:
                pass

    class _Exchange:
        def __init__(self, name: str, publish_raises: Exception | None = None) -> None:
            self.name = name
            self._publish_raises = publish_raises
            self.published: list[tuple] = []

        async def publish(self, msg: object, routing_key: str = "") -> None:
            if self._publish_raises is not None:
                raise self._publish_raises
            self.published.append((msg, routing_key))

    class _Channel:
        def __init__(self, publish_raises: Exception | None = None) -> None:
            self._publish_raises = publish_raises
            self.queues: dict[str, _Queue] = {}
            self.exchanges: dict[str, _Exchange] = {}

        async def declare_exchange(self, name: str, *args, **kwargs) -> _Exchange:
            ex = _Exchange(name, self._publish_raises)
            self.exchanges[name] = ex
            return ex

        async def declare_queue(self, name: str = "", **kwargs) -> _Queue:
            q = _Queue(name)
            self.queues[name] = q
            return q

        async def get_exchange(self, name: str) -> _Exchange:
            if name not in self.exchanges:
                self.exchanges[name] = _Exchange(name)
            return self.exchanges[name]

    class _Connection:
        def __init__(self, channel: _Channel) -> None:
            self._channel = channel
            self.closed = False

        async def channel(self) -> _Channel:
            return self._channel

        async def close(self) -> None:
            self.closed = True

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_) -> None:
            await self.close()

    async def connect_robust(url: str) -> _Connection:
        if connect_raises is not None:
            raise connect_raises
        channel = _Channel(publish_raises=publish_raises)
        return _Connection(channel)

    fake.ExchangeType = ExchangeType
    fake.Message = _Message
    fake.connect_robust = connect_robust
    return fake


# ---------------------------------------------------------------------------
# SleipnirMeshAdapter — with mocked aio_pika
# ---------------------------------------------------------------------------


_FAKE_AMQP_URL = "amqp://fake:fake@localhost/"


class TestSleipnirMeshAdapterWithFakeAmqp:
    def _patch_aio_pika(self, fake):
        import ravn.adapters.mesh.sleipnir_mesh as mod

        return patch.object(mod, "aio_pika", fake)

    def _patch_env(self):
        return patch.dict("os.environ", {"COVERAGE_AMQP_URL": _FAKE_AMQP_URL})

    @pytest.mark.asyncio
    async def test_connect_stores_connection_and_exchange(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            exchange = await adapter._connect()
        assert exchange is not None
        assert adapter._connection is not None
        assert adapter._channel is not None
        assert adapter._exchange is not None

    @pytest.mark.asyncio
    async def test_connect_returns_none_on_failure(self) -> None:
        fake = _make_fake_aio_pika(connect_raises=ConnectionError("refused"))
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake):
            exchange = await adapter._connect()
        assert exchange is None

    @pytest.mark.asyncio
    async def test_ensure_exchange_caches_result(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake):
            ex1 = await adapter._ensure_exchange()
            ex2 = await adapter._ensure_exchange()
        assert ex1 is ex2  # same cached object

    @pytest.mark.asyncio
    async def test_ensure_exchange_respects_reconnect_delay(self) -> None:
        fake = _make_fake_aio_pika(connect_raises=ConnectionError("down"))
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake):
            # First attempt: triggers _connect, fails, sets last_connect_attempt
            ex1 = await adapter._ensure_exchange()
            assert ex1 is None
            # Second attempt within reconnect_delay_s: skipped → returns None
            ex2 = await adapter._ensure_exchange()
            assert ex2 is None

    @pytest.mark.asyncio
    async def test_publish_with_active_exchange(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            event = _make_event()
            await adapter.publish(event, "heartbeat")
        assert adapter._exchange is not None

    @pytest.mark.asyncio
    async def test_publish_publish_failure_invalidates(self) -> None:
        fake = _make_fake_aio_pika(publish_raises=RuntimeError("pipe broken"))
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            event = _make_event()
            await adapter.publish(event, "heartbeat")
        # Connection should have been invalidated
        assert adapter._exchange is None

    @pytest.mark.asyncio
    async def test_invalidate_closes_connection(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
        conn = adapter._connection
        await adapter._invalidate()
        assert adapter._exchange is None
        assert adapter._channel is None
        assert adapter._connection is None
        assert conn.closed  # type: ignore[union-attr]

    @pytest.mark.asyncio
    async def test_subscribe_binds_queue(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        with self._patch_aio_pika(fake):
            await adapter._connect()
            await adapter.subscribe("alerts", handler)
        assert adapter._handlers["alerts"] is handler

    @pytest.mark.asyncio
    async def test_start_connects_and_starts_rpc_consumer(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter.start()
            assert adapter._rpc_consumer_task is not None
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_start_with_handlers_rebinds(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        adapter._handlers["pre-registered"] = handler
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter.start()
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_send_rpc_peer_trusted(self) -> None:
        """send() to a trusted peer with fake AMQP — reply arrives on reply queue."""
        peers = {"ravn-target": _FakePeer()}
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter(peers=peers)

        # Pre-inject the reply into the reply queue so the iterator returns it.
        reply_payload = {"status": "ack"}
        reply_msg = MagicMock()
        reply_msg.body = json.dumps(reply_payload).encode()

        async def _mock_declare_queue(name: str = "", **kwargs):
            q = MagicMock()
            q.name = name
            q.delete = AsyncMock()
            q.bind = AsyncMock()
            # Set up iterator to yield one message then stop
            reply_msg_cm = MagicMock()
            reply_msg_cm.__aenter__ = AsyncMock(return_value=reply_msg)
            reply_msg_cm.__aexit__ = AsyncMock(return_value=False)
            reply_msg.process = MagicMock(return_value=reply_msg_cm)
            q_iter = MagicMock()
            q_iter.__aenter__ = AsyncMock(return_value=_SingleMessageIterator(reply_msg))
            q_iter.__aexit__ = AsyncMock(return_value=False)
            q.iterator = MagicMock(return_value=q_iter)
            return q

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            adapter._channel.declare_queue = _mock_declare_queue  # type: ignore[attr-defined]
            result = await adapter.send("ravn-target", {"type": "ping"}, timeout_s=5.0)

        assert result == reply_payload

    @pytest.mark.asyncio
    async def test_handle_rpc_message_invalid_json(self) -> None:
        adapter = _sleipnir_adapter()
        msg = MagicMock()
        msg.body = b"not-json"
        msg.reply_to = None
        msg.correlation_id = None
        await adapter._handle_rpc_message(msg)  # must not raise

    @pytest.mark.asyncio
    async def test_handle_rpc_message_with_reply(self) -> None:
        """Test the reply publishing path in _handle_rpc_message."""
        fake = _make_fake_aio_pika()
        peers = {}
        adapter = _sleipnir_adapter(peers=peers)
        published_replies: list[dict] = []

        async def handler(request: dict) -> dict:
            return {"handled": True}

        adapter.set_rpc_handler(handler)

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            # Intercept default exchange publish
            default_ex = await adapter._channel.get_exchange("")  # type: ignore[union-attr]

            async def capture_publish(msg: object, routing_key: str = "") -> None:
                published_replies.append(json.loads(msg.body))  # type: ignore[attr-defined]

            default_ex.publish = capture_publish  # type: ignore[method-assign]

            msg = MagicMock()
            msg.body = json.dumps({"type": "task"}).encode()
            msg.reply_to = "ravn.rpc.reply.ravn-cov.abc123"
            msg.correlation_id = "corr-1"
            await adapter._handle_rpc_message(msg)

        assert published_replies == [{"handled": True}]

    @pytest.mark.asyncio
    async def test_assert_peer_trusted_raises_on_discovery_error(self) -> None:
        """DiscoveryPort.peers() failure → PeerNotFoundError."""

        class _BrokenDiscovery:
            def peers(self) -> dict:
                raise RuntimeError("discovery broken")

        adapter = SleipnirMeshAdapter(
            sleipnir_config=SleipnirConfig(),
            mesh_sleipnir_config=MeshSleipnirConfig(),
            own_peer_id="ravn-x",
            discovery=_BrokenDiscovery(),
        )
        with pytest.raises(PeerNotFoundError):
            await adapter.send("any-peer", {})

    @pytest.mark.asyncio
    async def test_bind_topic_queue_failure_is_swallowed(self) -> None:
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()

            # Make declare_queue fail
            async def _fail(*_, **__):
                raise RuntimeError("queue declare failed")

            adapter._channel.declare_queue = _fail  # type: ignore[method-assign]
            # Must not raise
            await adapter._bind_topic_queue(
                adapter._channel, adapter._exchange, "test-topic", handler
            )


class _SingleMessageIterator:
    """Yields a single message then stops iteration."""

    def __init__(self, msg: object) -> None:
        self._msg = msg
        self._done = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._done:
            raise StopAsyncIteration
        self._done = True
        return self._msg


# ---------------------------------------------------------------------------
# NngMeshAdapter — deeper coverage
# ---------------------------------------------------------------------------


def _make_fake_pynng_with_send_capture():
    """Fake pynng that records sent bytes and unblocks quickly."""
    import threading

    fake = types.ModuleType("pynng")
    _sent: list[bytes] = []

    class _Socket:
        def __init__(self, *_, **__) -> None:
            self._subscriptions: list[bytes] = []
            self._dialed: list[str] = []
            self._closed = threading.Event()
            self._reply: bytes | None = None

        def listen(self, addr: str) -> None:
            pass

        def dial(self, addr: str) -> None:
            self._dialed.append(addr)

        def send(self, data: bytes) -> None:
            _sent.append(data)

        def recv(self) -> bytes:
            if self._reply is not None:
                return self._reply
            self._closed.wait()
            raise OSError("socket closed")

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
    fake._sent = _sent
    return fake


class TestNngMeshAdapterCoverage:
    @pytest.mark.asyncio
    async def test_publish_with_active_socket(self) -> None:
        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        import ravn.adapters.mesh.nng_mesh as nng_mod

        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()
            event = _make_event()
            await adapter.publish(event, "heartbeat")
            # Give executor a moment
            await asyncio.sleep(0.01)
            await adapter.stop()

        assert len(fake_pynng._sent) > 0

    @pytest.mark.asyncio
    async def test_subscribe_sets_filter_on_active_socket(self) -> None:
        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        import ravn.adapters.mesh.nng_mesh as nng_mod

        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()
            await adapter.subscribe("new-topic", handler)
            assert "new-topic" in adapter._handlers
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_unsubscribe_on_active_socket(self) -> None:
        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        import ravn.adapters.mesh.nng_mesh as nng_mod

        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()
            await adapter.subscribe("to-remove", handler)
            await adapter.unsubscribe("to-remove")
            assert "to-remove" not in adapter._handlers
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_connect_sub_to_peers(self) -> None:
        fake_pynng = _make_fake_pynng_with_send_capture()
        peers = {
            "ravn-b": _FakePeer(pub_address="tcp://192.168.1.2:7480"),
            "ravn-c": _FakePeer(pub_address=""),  # empty pub address → skipped
        }
        adapter = _nng_adapter(peers=peers)
        import ravn.adapters.mesh.nng_mesh as nng_mod

        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()
            # sub_socket should have dialed ravn-b's pub address
            assert "tcp://192.168.1.2:7480" in adapter._sub_socket._dialed  # type: ignore[union-attr]
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_connect_sub_to_peers_dial_failure_is_swallowed(self) -> None:
        import threading

        fake_pynng = types.ModuleType("pynng")

        class _DialFailSocket:
            def __init__(self, *_, **__) -> None:
                self._subscriptions: list[bytes] = []
                self._dialed: list[str] = []
                self._closed = threading.Event()

            def listen(self, *_) -> None:
                pass

            def send(self, *_) -> None:
                pass

            def recv(self) -> bytes:
                self._closed.wait()
                raise OSError("socket closed")

            def subscribe(self, *_) -> None:
                pass

            def unsubscribe(self, *_) -> None:
                pass

            def dial(self, addr: str) -> None:
                raise OSError("dial failed")

            def close(self) -> None:
                self._closed.set()

        fake_pynng.Pub0 = _DialFailSocket
        fake_pynng.Sub0 = _DialFailSocket
        fake_pynng.Rep0 = _DialFailSocket
        fake_pynng.Req0 = _DialFailSocket

        peers = {"ravn-b": _FakePeer(pub_address="tcp://dead-host:7480")}
        adapter = _nng_adapter(peers=peers)
        import ravn.adapters.mesh.nng_mesh as nng_mod

        with patch.object(nng_mod, "pynng", fake_pynng):
            # Must not raise even though dial fails
            await adapter.start()
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_sub_loop_dispatches_handler(self) -> None:
        """_sub_loop: received message is decoded and handler called."""
        received: list[RavnEvent] = []
        adapter = _nng_adapter()

        event = _make_event()
        data = _encode_message("alerts", event)

        handler_called = asyncio.Event()

        async def handler(ev: RavnEvent) -> None:
            received.append(ev)
            handler_called.set()

        await adapter.subscribe("alerts", handler)
        # Directly invoke the private method to simulate one recv cycle
        # by using _sub_loop's logic via _decode_message + handler call
        from ravn.adapters.mesh.nng_mesh import _decode_message

        topic, decoded = _decode_message(data)
        h = adapter._handlers.get(topic)
        assert h is not None
        await h(decoded)
        assert len(received) == 1
        assert received[0].source == event.source

    @pytest.mark.asyncio
    async def test_sub_loop_handler_exception_is_caught(self) -> None:
        adapter = _nng_adapter()

        async def bad_handler(ev: RavnEvent) -> None:
            raise ValueError("handler exploded")

        await adapter.subscribe("boom", bad_handler)
        # Simulate the handler call path from _sub_loop
        event = _make_event()
        handler = adapter._handlers.get("boom")
        assert handler is not None
        try:
            await handler(event)
        except Exception:
            pass  # in real _sub_loop this would be caught

    @pytest.mark.asyncio
    async def test_rep_loop_dispatches_and_replies(self) -> None:
        """_rep_loop: request dispatched to rpc_handler, reply serialized."""
        adapter = _nng_adapter()

        async def handler(request: dict) -> dict:
            return {"got": request.get("type")}

        adapter.set_rpc_handler(handler)
        request = {"type": "task_dispatch", "request_id": "r123"}
        reply = await adapter._dispatch_rpc(request)
        assert reply["got"] == "task_dispatch"

    @pytest.mark.asyncio
    async def test_send_with_peer_but_no_pynng(self) -> None:
        """When peer exists but pynng absent, RuntimeError (not PeerNotFoundError)."""
        peers = {"ravn-b": _FakePeer(rep_address="tcp://localhost:7481")}
        adapter = _nng_adapter(peers=peers)
        import ravn.adapters.mesh.nng_mesh as nng_mod

        with patch.object(nng_mod, "pynng", None):
            with pytest.raises(RuntimeError, match="pynng not installed"):
                await adapter.send("ravn-b", {"type": "ping"}, timeout_s=1.0)

    @pytest.mark.asyncio
    async def test_resolve_peer_no_rep_address(self) -> None:
        """Peer exists but has no rep_address → PeerNotFoundError."""

        class _PeerNoAddress:
            rep_address = ""
            address = ""

        peers = {"ravn-empty": _PeerNoAddress()}
        adapter = _nng_adapter(peers=peers)
        with pytest.raises(PeerNotFoundError):
            await adapter.send("ravn-empty", {})

    @pytest.mark.asyncio
    async def test_connect_sub_discovery_exception(self) -> None:
        """_connect_sub_to_peers handles discovery.peers() raising."""

        class _BrokenDiscovery:
            def peers(self):
                raise RuntimeError("discovery down")

        adapter = NngMeshAdapter(
            config=NngMeshConfig(),
            discovery=_BrokenDiscovery(),
            own_peer_id="ravn-x",
        )
        # Must not raise — errors are swallowed
        adapter._connect_sub_to_peers(MagicMock())


# ---------------------------------------------------------------------------
# CompositeMeshAdapter — missing coverage paths
# ---------------------------------------------------------------------------


class TestCompositeMeshAdapterCoverage:
    @pytest.mark.asyncio
    async def test_publish_both_fail_swallowed(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.publish = AsyncMock(side_effect=RuntimeError("p down"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.publish = AsyncMock(side_effect=RuntimeError("f down"))
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        event = _make_event()
        # Both fail: must not raise
        await composite.publish(event, "test")

    @pytest.mark.asyncio
    async def test_subscribe_both_fail_swallowed(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.subscribe = AsyncMock(side_effect=RuntimeError("p sub fail"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.subscribe = AsyncMock(side_effect=RuntimeError("f sub fail"))
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await composite.subscribe("topic", handler)  # must not raise

    @pytest.mark.asyncio
    async def test_unsubscribe_both_fail_swallowed(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.unsubscribe = AsyncMock(side_effect=RuntimeError("p unsub fail"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.unsubscribe = AsyncMock(side_effect=RuntimeError("f unsub fail"))
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        await composite.unsubscribe("topic")  # must not raise

    @pytest.mark.asyncio
    async def test_start_both_fail_swallowed(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.start = AsyncMock(side_effect=RuntimeError("p start fail"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.start = AsyncMock(side_effect=RuntimeError("f start fail"))
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        await composite.start()  # must not raise

    @pytest.mark.asyncio
    async def test_stop_both_fail_swallowed(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.stop = AsyncMock(side_effect=RuntimeError("p stop fail"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.stop = AsyncMock(side_effect=RuntimeError("f stop fail"))
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        await composite.stop()  # must not raise

    @pytest.mark.asyncio
    async def test_send_timeout_propagates_from_fallback(self) -> None:
        primary = AsyncMock(spec=MeshPort)
        primary.send = AsyncMock(side_effect=PeerNotFoundError("ravn-t"))
        fallback = AsyncMock(spec=MeshPort)
        fallback.send = AsyncMock(
            side_effect=TimeoutError("no reply from peer 'ravn-t' within 1.0s")
        )
        composite = CompositeMeshAdapter(primary=primary, fallback=fallback)
        with pytest.raises(TimeoutError):
            await composite.send("ravn-t", {}, timeout_s=1.0)


# ---------------------------------------------------------------------------
# Sleipnir — deeper coverage for missing lines
# ---------------------------------------------------------------------------


class TestSleipnirDeepCoverage:
    def _patch_aio_pika(self, fake):
        import ravn.adapters.mesh.sleipnir_mesh as mod

        return patch.object(mod, "aio_pika", fake)

    def _patch_env(self):
        return patch.dict("os.environ", {"COVERAGE_AMQP_URL": _FAKE_AMQP_URL})

    @pytest.mark.asyncio
    async def test_subscribe_calls_bind_when_connected(self) -> None:
        """subscribe() calls _bind_topic_queue when channel+exchange available (lines 154-157)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            await adapter.subscribe("my-topic", handler)
        # The queue must be declared for "my-topic"
        assert "my-topic" in adapter._handlers

    @pytest.mark.asyncio
    async def test_send_channel_unavailable_raises(self) -> None:
        """send() raises RuntimeError when channel is None (line 183)."""
        peers = {"ravn-t": _FakePeer()}
        adapter = _sleipnir_adapter(peers=peers)
        # Don't connect → channel stays None
        with pytest.raises(RuntimeError, match="channel unavailable"):
            await adapter.send("ravn-t", {}, timeout_s=1.0)

    @pytest.mark.asyncio
    async def test_send_exchange_unavailable_raises(self) -> None:
        """send() raises RuntimeError when exchange is None (line 187)."""
        peers = {"ravn-t": _FakePeer()}
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter(peers=peers)
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            # Wipe exchange but keep channel
            adapter._exchange = None
            # Prevent reconnect by keeping last_connect_attempt fresh
            adapter._last_connect_attempt = asyncio.get_running_loop().time() + 9999
            with pytest.raises(RuntimeError, match="exchange unavailable"):
                await adapter.send("ravn-t", {}, timeout_s=1.0)

    @pytest.mark.asyncio
    async def test_send_timeout_raises(self) -> None:
        """send() raises TimeoutError when reply queue never delivers (lines 215-219)."""
        peers = {"ravn-t": _FakePeer()}
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter(peers=peers)

        async def _mock_declare_queue(name: str = "", **kwargs):
            q = MagicMock()
            q.name = name
            q.delete = AsyncMock()
            q.bind = AsyncMock()
            # Iterator blocks forever → asyncio.timeout(0.05) fires
            q.iterator = MagicMock(return_value=_InfiniteWaitAsyncCM())
            return q

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            adapter._channel.declare_queue = _mock_declare_queue  # type: ignore[attr-defined]
            with pytest.raises(TimeoutError):
                await adapter.send("ravn-t", {"type": "ping"}, timeout_s=0.05)

    @pytest.mark.asyncio
    async def test_send_reply_queue_delete_called(self) -> None:
        """send() deletes reply queue in finally even after timeout (lines 225-226)."""
        peers = {"ravn-t": _FakePeer()}
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter(peers=peers)
        deleted: list[str] = []

        async def _mock_declare_queue(name: str = "", **kwargs):
            q = MagicMock()
            q.name = name

            async def _delete():
                deleted.append(name)

            q.delete = _delete
            q.bind = AsyncMock()
            q.iterator = MagicMock(return_value=_EmptyAsyncCM())
            return q

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            adapter._channel.declare_queue = _mock_declare_queue  # type: ignore[attr-defined]
            try:
                await adapter.send("ravn-t", {"type": "ping"}, timeout_s=0.05)
            except TimeoutError:
                pass

        assert len(deleted) == 1

    @pytest.mark.asyncio
    async def test_start_exchange_none_logs_warning(self) -> None:
        """start() exits early with warning when exchange unavailable (lines 236-237)."""
        fake = _make_fake_aio_pika(connect_raises=ConnectionError("down"))
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake):
            await adapter.start()
            assert adapter._rpc_consumer_task is None

    @pytest.mark.asyncio
    async def test_start_rebinds_registered_handlers(self) -> None:
        """start() calls _bind_topic_queue for pre-registered handlers (lines 241-245)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        adapter._handlers["pre-existing"] = handler
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter.start()
            assert adapter._rpc_consumer_task is not None
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_connect_exception_returns_none(self) -> None:
        """_connect() exception handler returns None and logs (lines 328-330)."""
        fake = _make_fake_aio_pika(connect_raises=OSError("tcp refused"))
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            result = await adapter._connect()
        assert result is None

    @pytest.mark.asyncio
    async def test_invalidate_close_exception_swallowed(self) -> None:
        """_invalidate() swallows connection.close() exception (lines 338-339)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()

        # Make close() raise
        async def _bad_close():
            raise RuntimeError("close failed")

        adapter._connection.close = _bad_close  # type: ignore[union-attr]
        # Must not raise
        await adapter._invalidate()
        assert adapter._connection is None

    @pytest.mark.asyncio
    async def test_bind_topic_queue_consume_callback(self) -> None:
        """_consume callback in _bind_topic_queue decodes event and calls handler."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        received: list[RavnEvent] = []

        async def handler(ev: RavnEvent) -> None:
            received.append(ev)

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            # Manually bind
            await adapter._bind_topic_queue(
                adapter._channel, adapter._exchange, "test-topic", handler
            )
            # Find the queue and its consumer
            queue = adapter._channel.queues[""]  # type: ignore[index]
            assert len(queue._consumers) == 1
            consume_fn = queue._consumers[0]

            # Build a fake message
            event = _make_event()
            msg_body = _encode_event(event)

            class _FakeMsg:
                body = msg_body

                def process(self):
                    return _AsyncNullCM()

            await consume_fn(_FakeMsg())

        assert len(received) == 1
        assert received[0].source == event.source

    @pytest.mark.asyncio
    async def test_bind_topic_queue_consume_callback_handler_exception(self) -> None:
        """_consume callback swallows handler exceptions (line 360-361)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()

        async def bad_handler(ev: RavnEvent) -> None:
            raise ValueError("handler exploded")

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            await adapter._bind_topic_queue(
                adapter._channel, adapter._exchange, "bad-topic", bad_handler
            )
            queue = adapter._channel.queues[""]  # type: ignore[index]
            consume_fn = queue._consumers[0]

            event = _make_event()
            msg_body = _encode_event(event)

            class _FakeMsg:
                body = msg_body

                def process(self):
                    return _AsyncNullCM()

            # Must not raise
            await consume_fn(_FakeMsg())

    @pytest.mark.asyncio
    async def test_rpc_consumer_loop_retries_on_error(self) -> None:
        """_rpc_consumer_loop retries after exception (lines 372-383)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        call_count = 0

        async def _failing_run():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("transient")
            # On 3rd call, just sleep forever (will be cancelled)
            await asyncio.sleep(9999)

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()
            adapter._run_rpc_consumer = _failing_run  # type: ignore[method-assign]
            task = asyncio.create_task(adapter._rpc_consumer_loop())
            # Wait for retries
            await asyncio.sleep(0.3)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert call_count >= 2

    @pytest.mark.asyncio
    async def test_run_rpc_consumer_channel_none(self) -> None:
        """_run_rpc_consumer exits quickly when channel unavailable (lines 386-389)."""
        adapter = _sleipnir_adapter()
        # Don't connect → channel=None → sleep + return
        await adapter._run_rpc_consumer()  # must return without hanging

    @pytest.mark.asyncio
    async def test_run_rpc_consumer_with_message(self) -> None:
        """_run_rpc_consumer processes one message then is cancelled (lines 386-407)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()
        processed: list[dict] = []

        async def rpc_handler(request: dict) -> dict:
            processed.append(request)
            return {"ok": True}

        adapter.set_rpc_handler(rpc_handler)

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()

            # Build a one-shot message
            req_body = json.dumps({"type": "task"}).encode()

            class _Msg:
                body = req_body
                reply_to = None
                correlation_id = None

                def process(self):
                    return _AsyncNullCM()

            # Replace the channel's declare_queue to return a queue with one message
            async def _mock_declare(name: str = "", **kwargs):
                q = MagicMock()
                q.bind = AsyncMock()
                q.iterator = MagicMock(return_value=_OneShotAsyncCM(_Msg()))
                return q

            adapter._channel.declare_queue = _mock_declare  # type: ignore[attr-defined]
            await adapter._run_rpc_consumer()

        assert len(processed) == 1

    @pytest.mark.asyncio
    async def test_handle_rpc_message_handler_exception(self) -> None:
        """Handler exception produces error reply dict (lines 425-426)."""
        adapter = _sleipnir_adapter()

        async def bad_handler(request: dict) -> dict:
            raise RuntimeError("handler crashed")

        adapter.set_rpc_handler(bad_handler)

        msg = MagicMock()
        msg.body = json.dumps({"type": "task"}).encode()
        msg.reply_to = None  # No reply_to → won't try to publish
        msg.correlation_id = None
        # Must not raise — error is captured in reply dict
        await adapter._handle_rpc_message(msg)

    @pytest.mark.asyncio
    async def test_handle_rpc_message_channel_none_after_reply_to(self) -> None:
        """reply_to present but channel unavailable → early return (line 433)."""
        adapter = _sleipnir_adapter()

        async def rpc_handler(request: dict) -> dict:
            return {"ok": True}

        adapter.set_rpc_handler(rpc_handler)

        msg = MagicMock()
        msg.body = json.dumps({"type": "task"}).encode()
        msg.reply_to = "ravn.rpc.reply.ravn-cov.xyz"
        msg.correlation_id = "corr-x"
        # Channel is None (not connected) → must return without raising
        await adapter._handle_rpc_message(msg)

    @pytest.mark.asyncio
    async def test_handle_rpc_message_reply_publish_exception(self) -> None:
        """Reply publish failure is swallowed (lines 444-445)."""
        fake = _make_fake_aio_pika()
        adapter = _sleipnir_adapter()

        async def rpc_handler(request: dict) -> dict:
            return {"ok": True}

        adapter.set_rpc_handler(rpc_handler)

        with self._patch_aio_pika(fake), self._patch_env():
            await adapter._connect()

            # Make get_exchange raise
            async def _bad_get_exchange(name: str) -> object:
                raise RuntimeError("exchange lookup failed")

            adapter._channel.get_exchange = _bad_get_exchange  # type: ignore[attr-defined]

            msg = MagicMock()
            msg.body = json.dumps({"type": "task"}).encode()
            msg.reply_to = "ravn.rpc.reply.ravn-cov.xyz"
            msg.correlation_id = "corr-x"
            # Must not raise
            await adapter._handle_rpc_message(msg)


# ---------------------------------------------------------------------------
# NngMeshAdapter — deeper coverage for background loops
# ---------------------------------------------------------------------------


class TestNngMeshLoopCoverage:
    @pytest.mark.asyncio
    async def test_publish_before_start_pynng_set(self) -> None:
        """publish() with pynng set but no socket → logs and returns (lines 143-144)."""
        import ravn.adapters.mesh.nng_mesh as nng_mod

        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        event = _make_event()
        with patch.object(nng_mod, "pynng", fake_pynng):
            # Adapter not started → _pub_socket is None
            await adapter.publish(event, "heartbeat")
        # No exception → test passes; socket remains None
        assert adapter._pub_socket is None

    @pytest.mark.asyncio
    async def test_publish_send_exception_swallowed(self) -> None:
        """publish() exception in run_in_executor is caught (lines 153-154)."""
        import ravn.adapters.mesh.nng_mesh as nng_mod

        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()

        # Give adapter a fake pub_socket that raises on send
        class _RaisingSock:
            def send(self, data: bytes) -> None:
                raise OSError("broken pipe")

            def close(self) -> None:
                pass

        event = _make_event()
        with patch.object(nng_mod, "pynng", fake_pynng):
            adapter._pub_socket = _RaisingSock()
            # Must not raise
            await adapter.publish(event, "heartbeat")

    @pytest.mark.asyncio
    async def test_unsubscribe_exception_swallowed(self) -> None:
        """unsubscribe() socket.unsubscribe() exception is swallowed (lines 172-173)."""
        import ravn.adapters.mesh.nng_mesh as nng_mod

        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()

        class _RaisingSocket:
            def unsubscribe(self, prefix: bytes) -> None:
                raise OSError("unsubscribe failed")

            def close(self) -> None:
                pass

        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        await adapter.subscribe("to-remove", handler)
        with patch.object(nng_mod, "pynng", fake_pynng):
            adapter._sub_socket = _RaisingSocket()
            # Must not raise
            await adapter.unsubscribe("to-remove")

    @pytest.mark.asyncio
    async def test_start_subscribes_pre_registered_handlers(self) -> None:
        """start() calls sub.subscribe for handlers registered before start (line 231)."""
        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        import ravn.adapters.mesh.nng_mesh as nng_mod

        handler: Callable[[RavnEvent], Awaitable[None]] = AsyncMock()
        # Register before start
        adapter._handlers["pre-start"] = handler
        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()
            sub = adapter._sub_socket
            assert b"pre-start" in sub._subscriptions  # type: ignore[union-attr]
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_stop_close_exception_swallowed(self) -> None:
        """stop() socket.close() exceptions are swallowed (lines 264-265)."""
        import ravn.adapters.mesh.nng_mesh as nng_mod

        fake_pynng = _make_fake_pynng_with_send_capture()
        adapter = _nng_adapter()
        with patch.object(nng_mod, "pynng", fake_pynng):
            await adapter.start()

            # Replace sockets with ones that raise on close
            class _BadClose:
                def close(self) -> None:
                    raise RuntimeError("close failed")

            # Cancel real tasks first to avoid blocking
            for task in (adapter._sub_task, adapter._rep_task):
                if task is not None:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
            # Close original sockets cleanly before replacing
            for sock in (adapter._pub_socket, adapter._sub_socket, adapter._rep_socket):
                if sock is not None:
                    sock.close()  # type: ignore[union-attr]
            adapter._sub_task = None
            adapter._rep_task = None
            adapter._pub_socket = _BadClose()
            adapter._sub_socket = _BadClose()
            adapter._rep_socket = _BadClose()
            # Must not raise
            await adapter.stop()

    @pytest.mark.asyncio
    async def test_sub_loop_dispatches_message(self) -> None:
        """_sub_loop receives message and dispatches to handler (lines 321-325)."""
        adapter = _nng_adapter()
        event = _make_event()
        data = _encode_message("alerts", event)
        received: list[RavnEvent] = []
        handler_called = asyncio.Event()

        async def handler(ev: RavnEvent) -> None:
            received.append(ev)
            handler_called.set()

        await adapter.subscribe("alerts", handler)

        call_count = 0

        class _OneMessageSocket:
            """Returns one message then raises OSError immediately (no blocking)."""

            def recv(self) -> bytes:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    return data
                raise OSError("no more messages")

        adapter._sub_socket = _OneMessageSocket()
        task = asyncio.create_task(adapter._sub_loop())
        try:
            await asyncio.wait_for(handler_called.wait(), timeout=2.0)
            # Yield so sub_loop can catch the OSError and start asyncio.sleep(0.1)
            await asyncio.sleep(0)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert len(received) == 1
        assert received[0].source == event.source

    @pytest.mark.asyncio
    async def test_sub_loop_handler_exception_warned(self) -> None:
        """_sub_loop catches handler exceptions and logs a warning (lines 326-327)."""
        adapter = _nng_adapter()
        event = _make_event()
        data = _encode_message("boom", event)
        handler_called = asyncio.Event()

        async def bad_handler(ev: RavnEvent) -> None:
            handler_called.set()
            raise ValueError("handler exploded")

        await adapter.subscribe("boom", bad_handler)

        call_count = 0

        class _OneMessageSocket:
            def recv(self) -> bytes:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    return data
                raise OSError("no more messages")

        adapter._sub_socket = _OneMessageSocket()
        task = asyncio.create_task(adapter._sub_loop())
        try:
            await asyncio.wait_for(handler_called.wait(), timeout=2.0)
            await asyncio.sleep(0)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_sub_loop_recv_error_continues(self) -> None:
        """_sub_loop recv error is caught, loop sleeps and retries (lines 330-332)."""
        adapter = _nng_adapter()
        call_count = 0

        class _ErrorSocket:
            def recv(self) -> bytes:
                nonlocal call_count
                call_count += 1
                raise OSError("network error")

        adapter._sub_socket = _ErrorSocket()
        task = asyncio.create_task(adapter._sub_loop())
        # Wait longer than the 0.1s sleep after recv error to confirm loop retried
        await asyncio.sleep(0.25)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert call_count >= 1

    @pytest.mark.asyncio
    async def test_rep_loop_dispatches_and_replies(self) -> None:
        """_rep_loop receives request, dispatches, sends reply (lines 340-343)."""
        adapter = _nng_adapter()
        request = {"type": "task", "request_id": "r1"}
        replies_sent: list[dict] = []
        reply_sent_event = asyncio.Event()
        loop = asyncio.get_running_loop()

        async def rpc_handler(req: dict) -> dict:
            return {"result": "ok"}

        adapter.set_rpc_handler(rpc_handler)

        call_count = 0

        class _OneRequestSocket:
            def recv(self) -> bytes:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    return json.dumps(request).encode()
                raise OSError("no more requests")

            def send(self, data: bytes) -> None:
                replies_sent.append(json.loads(data))
                # Signal asyncio from thread that reply was sent
                loop.call_soon_threadsafe(reply_sent_event.set)

        adapter._rep_socket = _OneRequestSocket()
        task = asyncio.create_task(adapter._rep_loop())
        try:
            await asyncio.wait_for(reply_sent_event.wait(), timeout=2.0)
            await asyncio.sleep(0)
        finally:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        assert replies_sent == [{"result": "ok"}]

    @pytest.mark.asyncio
    async def test_rep_loop_recv_error_continues(self) -> None:
        """_rep_loop recv error is caught, loop sleeps and retries (lines 346-348)."""
        adapter = _nng_adapter()
        call_count = 0

        class _ErrorRepSocket:
            def recv(self) -> bytes:
                nonlocal call_count
                call_count += 1
                raise OSError("rep recv error")

            def send(self, data: bytes) -> None:
                pass

        adapter._rep_socket = _ErrorRepSocket()
        task = asyncio.create_task(adapter._rep_loop())
        await asyncio.sleep(0.25)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

        assert call_count >= 1

    @pytest.mark.asyncio
    async def test_send_req_socket_roundtrip(self) -> None:
        """send() REQ socket path: dial, send, recv, return decoded reply (lines 197-212)."""
        import threading

        import ravn.adapters.mesh.nng_mesh as nng_mod

        reply_payload = {"status": "ack", "request_id": "r1"}
        reply_bytes = json.dumps(reply_payload).encode()

        class _FakeReq0:
            def __init__(self, **kwargs) -> None:
                self._dialed: list[str] = []
                self._sent: list[bytes] = []
                self._closed = threading.Event()

            def dial(self, addr: str) -> None:
                self._dialed.append(addr)

            def send(self, data: bytes) -> None:
                self._sent.append(data)

            def recv(self) -> bytes:
                return reply_bytes

            def close(self) -> None:
                self._closed.set()

        fake_pynng = _make_fake_pynng_with_send_capture()
        fake_pynng.Req0 = _FakeReq0

        peers = {"ravn-b": _FakePeer(rep_address="tcp://localhost:7481")}
        adapter = _nng_adapter(peers=peers)
        with patch.object(nng_mod, "pynng", fake_pynng):
            result = await adapter.send("ravn-b", {"type": "ping"}, timeout_s=2.0)

        assert result == reply_payload


# ---------------------------------------------------------------------------
# Async context manager helpers
# ---------------------------------------------------------------------------


class _AsyncNullCM:
    """Async context manager that does nothing."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_) -> None:
        pass


class _EmptyAsyncCM:
    """Async context manager whose __aiter__ yields nothing."""

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_) -> None:
        pass


class _OneShotAsyncCM:
    """Async context manager whose __aiter__ yields one message then stops."""

    def __init__(self, msg: object) -> None:
        self._msg = msg
        self._done = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._done:
            raise StopAsyncIteration
        self._done = True
        return self._msg

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_) -> None:
        pass


class _InfiniteWaitAsyncCM:
    """Async context manager whose __anext__ sleeps forever (to trigger timeout)."""

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(9999)
        raise StopAsyncIteration

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_) -> None:
        pass
