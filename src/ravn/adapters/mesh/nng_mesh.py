"""NngMeshAdapter — Pi-mode Ravn-to-Ravn mesh via nng (NIU-517).

Uses ``pynng`` for all transport.  No broker required — works across multiple
Pis on the same LAN via TCP, or within a single host via IPC.

**Topology**

- PUB socket  — listens on ``pub_sub_address``; other Ravens' SUB sockets
  connect to it.  Topic filtering uses a bytes prefix equal to the topic
  string encoded as UTF-8 followed by a NUL separator.

- SUB socket  — connects to each peer's PUB address (addresses come from the
  injected DiscoveryPort peer table).  Handlers registered via
  ``subscribe()`` are called for matching messages.

- REP socket  — listens on ``req_rep_address``; incoming RPC requests are
  deserialized, dispatched to the registered request handler (if any), and
  the reply is written back.

- REQ socket  — ephemeral; created per ``send()`` call, dialed to the target
  peer's REP address, closed when the reply is received.

**Pi-mode limitations**

No broker → no message persistence, no fan-out to peers not connected at
publish time.  This is acceptable for small, same-LAN flocks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.ports.mesh import PeerNotFoundError

if TYPE_CHECKING:
    from ravn.config import NngMeshConfig

try:
    import pynng  # type: ignore[import-untyped]
except ImportError:  # pragma: no cover
    pynng = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# Separator between topic prefix and message body in PUB/SUB frames.
_TOPIC_SEP = b"\x00"


def _encode_message(topic: str, event: RavnEvent) -> bytes:
    body = json.dumps(
        {
            "type": event.type,
            "source": event.source,
            "payload": event.payload,
            "timestamp": event.timestamp.isoformat(),
            "urgency": event.urgency,
            "correlation_id": event.correlation_id,
            "session_id": event.session_id,
            "task_id": event.task_id,
        }
    ).encode()
    return topic.encode() + _TOPIC_SEP + body


def _decode_message(data: bytes) -> tuple[str, RavnEvent]:
    sep_idx = data.index(_TOPIC_SEP)
    topic = data[:sep_idx].decode()
    raw = json.loads(data[sep_idx + 1 :])
    event = RavnEvent(
        type=RavnEventType(raw["type"]),
        source=raw["source"],
        payload=raw["payload"],
        timestamp=_parse_dt(raw["timestamp"]),
        urgency=raw["urgency"],
        correlation_id=raw["correlation_id"],
        session_id=raw["session_id"],
        task_id=raw.get("task_id"),
    )
    return topic, event


def _parse_dt(ts: str):  # type: ignore[return]
    from datetime import datetime

    return datetime.fromisoformat(ts)


class NngMeshAdapter:
    """nng-based mesh transport for Pi mode.

    Parameters
    ----------
    config:
        ``NngMeshConfig`` from settings — carries ``pub_sub_address`` and
        ``req_rep_address``.
    discovery:
        Injected DiscoveryPort used to look up peer REP addresses for
        ``send()``.  Any object with a ``peers()`` method returning a
        mapping of ``peer_id → peer`` (where ``peer.rep_address`` is the
        nng REP address) satisfies the interface.
    own_peer_id:
        This Ravn's unique peer identifier — used to label its PUB socket
        address so the DiscoveryPort can distribute it.
    """

    def __init__(
        self,
        config: NngMeshConfig,
        discovery: object,
        own_peer_id: str,
    ) -> None:
        self._config = config
        self._discovery = discovery
        self._own_peer_id = own_peer_id

        self._pub_socket: object | None = None
        self._sub_socket: object | None = None
        self._rep_socket: object | None = None

        self._handlers: dict[str, Callable[[RavnEvent], Awaitable[None]]] = {}
        self._rpc_handler: Callable[[dict], Awaitable[dict]] | None = None

        self._sub_task: asyncio.Task | None = None
        self._rep_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Public API — MeshPort interface
    # ------------------------------------------------------------------

    async def publish(self, event: RavnEvent, topic: str) -> None:
        """Broadcast *event* to all subscribers of *topic*."""
        if pynng is None:  # pragma: no cover
            logger.debug("nng_mesh: pynng not installed, publish skipped")
            return

        if self._pub_socket is None:
            logger.debug("nng_mesh: publish called before start()")
            return

        try:
            data = _encode_message(topic, event)
            await asyncio.get_running_loop().run_in_executor(
                None,
                self._pub_socket.send,
                data,  # type: ignore[attr-defined]
            )
        except Exception as exc:
            logger.debug("nng_mesh: publish failed (%s)", exc)

    async def subscribe(
        self,
        topic: str,
        handler: Callable[[RavnEvent], Awaitable[None]],
    ) -> None:
        """Register *handler* for events on *topic*."""
        self._handlers[topic] = handler
        if self._sub_socket is not None and pynng is not None:
            self._sub_socket.subscribe(topic.encode())  # type: ignore[attr-defined]

    async def unsubscribe(self, topic: str) -> None:
        """Remove handler for *topic*."""
        self._handlers.pop(topic, None)
        if self._sub_socket is not None and pynng is not None:
            try:
                self._sub_socket.unsubscribe(topic.encode())  # type: ignore[attr-defined]
            except Exception:
                pass

    async def send(
        self,
        target_peer_id: str,
        message: dict,
        *,
        timeout_s: float = 10.0,
    ) -> dict:
        """Send *message* to *target_peer_id* and await its reply.

        Raises
        ------
        PeerNotFoundError
            If the peer is not in the verified DiscoveryPort peer table.
        TimeoutError
            If no reply arrives within *timeout_s*.
        """
        # Peer lookup happens before the pynng check so PeerNotFoundError
        # is always raised when the peer is unknown, even without pynng installed.
        peer_address = self._resolve_peer_rep_address(target_peer_id)

        if pynng is None:  # pragma: no cover
            raise RuntimeError("pynng not installed — nng mesh unavailable")
        body = json.dumps(message).encode()

        async def _do_send() -> dict:
            sock = pynng.Req0(recv_timeout=int(timeout_s * 1000))  # type: ignore[attr-defined]
            try:
                sock.dial(peer_address)
                await asyncio.get_running_loop().run_in_executor(None, sock.send, body)
                reply_bytes = await asyncio.get_running_loop().run_in_executor(None, sock.recv)
                return json.loads(reply_bytes)
            finally:
                sock.close()

        try:
            return await asyncio.wait_for(_do_send(), timeout=timeout_s)
        except TimeoutError as exc:
            raise TimeoutError(
                f"No reply from peer {target_peer_id!r} within {timeout_s}s"
            ) from exc

    async def start(self) -> None:
        """Open sockets and start background receive tasks."""
        if pynng is None:  # pragma: no cover
            logger.warning("nng_mesh: pynng not installed — mesh disabled")
            return

        # PUB socket — listen for subscribers
        pub = pynng.Pub0()  # type: ignore[attr-defined]
        pub.listen(self._config.pub_sub_address)
        self._pub_socket = pub

        # SUB socket — connect to each known peer's PUB address
        sub = pynng.Sub0()  # type: ignore[attr-defined]
        sub.subscribe(b"")  # subscribe to all topics; filtered in handler
        for topic in self._handlers:
            sub.subscribe(topic.encode())
        self._sub_socket = sub
        self._connect_sub_to_peers(sub)

        # REP socket — listen for incoming RPC requests
        rep = pynng.Rep0()  # type: ignore[attr-defined]
        rep.listen(self._config.req_rep_address)
        self._rep_socket = rep

        self._sub_task = asyncio.create_task(self._sub_loop(), name="nng_mesh_sub")
        self._rep_task = asyncio.create_task(self._rep_loop(), name="nng_mesh_rep")

        logger.info(
            "nng_mesh: started peer=%s pub=%s rep=%s",
            self._own_peer_id,
            self._config.pub_sub_address,
            self._config.req_rep_address,
        )

    async def stop(self) -> None:
        """Graceful shutdown — cancel background tasks and close sockets."""
        for task in (self._sub_task, self._rep_task):
            if task is not None:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        for sock in (self._pub_socket, self._sub_socket, self._rep_socket):
            if sock is not None:
                try:
                    sock.close()  # type: ignore[attr-defined]
                except Exception:
                    pass

        self._pub_socket = None
        self._sub_socket = None
        self._rep_socket = None
        self._sub_task = None
        self._rep_task = None
        logger.info("nng_mesh: stopped peer=%s", self._own_peer_id)

    def set_rpc_handler(self, handler: Callable[[dict], Awaitable[dict]]) -> None:
        """Register the handler called for every incoming RPC request.

        The handler receives the decoded request dict and must return the
        reply dict.  The drive loop wires this up to task enqueue.
        """
        self._rpc_handler = handler

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_peer_rep_address(self, peer_id: str) -> str:
        """Look up *peer_id* in the DiscoveryPort peer table.

        Raises ``PeerNotFoundError`` if not found.
        """
        peers = self._discovery.peers()  # type: ignore[attr-defined]
        peer = peers.get(peer_id)
        if peer is None:
            raise PeerNotFoundError(peer_id)
        address = getattr(peer, "rep_address", None) or getattr(peer, "address", None)
        if not address:
            raise PeerNotFoundError(peer_id)
        return address

    def _connect_sub_to_peers(self, sub: object) -> None:
        """Dial *sub* to all currently known peers' PUB addresses."""
        try:
            peers = self._discovery.peers()  # type: ignore[attr-defined]
        except Exception:
            return
        for peer in peers.values():
            pub_address = getattr(peer, "pub_address", None)
            if pub_address:
                try:
                    sub.dial(pub_address)  # type: ignore[attr-defined]
                    logger.debug("nng_mesh: SUB dialed %s", pub_address)
                except Exception as exc:
                    logger.debug("nng_mesh: SUB dial %s failed: %s", pub_address, exc)

    async def _sub_loop(self) -> None:
        """Receive published messages and dispatch to registered handlers."""
        loop = asyncio.get_running_loop()
        while True:
            try:
                data = await loop.run_in_executor(None, self._sub_socket.recv)  # type: ignore[union-attr]
                topic, event = _decode_message(data)
                handler = self._handlers.get(topic)
                if handler is not None:
                    try:
                        await handler(event)
                    except Exception as exc:
                        logger.warning("nng_mesh: handler for %r raised: %s", topic, exc)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.debug("nng_mesh: sub_loop recv error: %s", exc)
                await asyncio.sleep(0.1)

    async def _rep_loop(self) -> None:
        """Receive RPC requests and write replies back."""
        loop = asyncio.get_running_loop()
        while True:
            try:
                data = await loop.run_in_executor(None, self._rep_socket.recv)  # type: ignore[union-attr]
                request = json.loads(data)
                reply = await self._dispatch_rpc(request)
                reply_bytes = json.dumps(reply).encode()
                await loop.run_in_executor(None, self._rep_socket.send, reply_bytes)  # type: ignore[union-attr]
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.debug("nng_mesh: rep_loop error: %s", exc)
                await asyncio.sleep(0.1)

    async def _dispatch_rpc(self, request: dict) -> dict:
        """Dispatch *request* to the registered RPC handler."""
        if self._rpc_handler is None:
            request_id = request.get("request_id", str(uuid.uuid4()))
            return {"error": "no rpc handler registered", "request_id": request_id}
        try:
            return await self._rpc_handler(request)
        except Exception as exc:
            logger.warning("nng_mesh: rpc handler raised: %s", exc)
            return {"error": str(exc), "request_id": request.get("request_id", "")}
