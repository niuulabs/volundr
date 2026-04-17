"""RoomMeshBridge — Sleipnir mesh subscriber that feeds room wire events.

Subscribes to ``ravn.mesh.*`` Sleipnir events so that outcomes from any mesh
peer (Skuld coder, reviewer, security scanner, …) flow into the room UI
without the publisher needing to broadcast them separately.

Architecture
------------
Before NIU-624 the broker had a dual-publish pattern:

    mesh.publish(outcome_event, "code.changed")   # → other ravens
    channels.broadcast(room_outcome)              # → browser (manual copy)

After NIU-624 the broker publishes once to the mesh, and this bridge
translates the resulting ``ravn.mesh.*`` Sleipnir events into room wire
events:

    mesh.publish(outcome_event, "code.changed")
        ↓  (via Sleipnir)
    RoomMeshBridge._handle_event()
        ↓
    RoomBridge._handle_outcome_frame()  /  _handle_activity_frame()
        ↓
    ChannelRegistry.broadcast()  →  browser WebSocket

Session filtering
-----------------
When *session_id* is set, only events whose ``correlation_id`` or
``payload["ravn_session_id"]`` match are forwarded.  Pass ``None`` to
receive all mesh events (useful in shared-bus deployments).

Multiple Skuld support
-----------------------
Each Skuld instance is a distinct mesh peer.  The bridge auto-registers
unknown peers as room participants via
:meth:`~skuld.room_bridge.RoomBridge.register_mesh_peer` when their first
event arrives, so the browser learns about them without any extra wiring.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sleipnir.domain.events import SleipnirEvent
from sleipnir.ports.events import SleipnirSubscriber, Subscription

if TYPE_CHECKING:
    from skuld.room_bridge import RoomBridge

logger = logging.getLogger(__name__)

#: Sleipnir event-type patterns this bridge subscribes to.
MESH_PATTERNS: list[str] = ["ravn.mesh.*"]

#: RavnEventType string fragments → room activity type.
_RAVN_TYPE_TO_ACTIVITY: dict[str, str] = {
    "TOOL_START": "tool_executing",
    "TOOL_RESULT": "idle",
    "THOUGHT": "thinking",
}


def _extract_peer_id(event: SleipnirEvent) -> str:
    """Return the originating peer_id from a mesh Sleipnir event.

    Tries ``payload["ravn_source"]`` first (set by :func:`_ravn_to_sleipnir`),
    then falls back to stripping the ``"ravn:"`` / ``"skuld:"`` prefix from
    the ``source`` field.
    """
    ravn_source = event.payload.get("ravn_source", "")
    if ravn_source:
        # ravn_source may already be a plain peer_id or "<prefix>:<peer_id>"
        if ":" in ravn_source:
            return ravn_source.split(":", 1)[1]
        return ravn_source

    source = event.source or ""
    if ":" in source:
        return source.split(":", 1)[1]
    return source


def _extract_persona(event: SleipnirEvent, peer_id: str) -> str:
    """Return the best persona name for a peer from the event payload."""
    ravn_event = event.payload.get("ravn_event", {})
    return ravn_event.get("persona", peer_id)


class RoomMeshBridge:
    """Subscribes to Sleipnir mesh events and translates them to room wire events.

    This makes the room the single downstream consumer of all mesh activity.
    Any peer that publishes to the mesh (regardless of transport) will have
    its events appear in the browser room UI automatically.

    Lifecycle::

        bridge = RoomMeshBridge(subscriber, room_bridge, session_id="abc")
        await bridge.start()   # subscribes to ravn.mesh.*
        # … events translated and broadcast …
        await bridge.stop()    # unsubscribes

    Also usable as an async context manager::

        async with RoomMeshBridge(subscriber, room_bridge, session_id="abc"):
            ...
    """

    def __init__(
        self,
        subscriber: SleipnirSubscriber,
        room_bridge: RoomBridge,
        session_id: str | None = None,
        patterns: list[str] | None = None,
    ) -> None:
        self._subscriber = subscriber
        self._room_bridge = room_bridge
        self._session_id = session_id
        self._patterns = patterns if patterns is not None else list(MESH_PATTERNS)
        self._subscription: Subscription | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Subscribe to mesh event patterns and begin bridging."""
        if self._subscription is not None:
            logger.warning("RoomMeshBridge.start() called while already running — ignored")
            return
        self._subscription = await self._subscriber.subscribe(
            self._patterns,
            self._handle_event,
        )
        logger.info(
            "RoomMeshBridge started: session_id=%s, patterns=%s",
            self._session_id,
            self._patterns,
        )

    async def stop(self) -> None:
        """Unsubscribe and release resources."""
        if self._subscription is None:
            return
        await self._subscription.unsubscribe()
        self._subscription = None
        logger.info("RoomMeshBridge stopped: session_id=%s", self._session_id)

    async def __aenter__(self) -> RoomMeshBridge:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.stop()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _handle_event(self, event: SleipnirEvent) -> None:
        """Translate a single mesh Sleipnir event into room wire events."""
        if not self._matches_session(event):
            return

        peer_id = _extract_peer_id(event)
        if not peer_id:
            logger.debug("RoomMeshBridge: cannot determine peer_id for event %s", event.event_type)
            return

        await self._ensure_peer_registered(event, peer_id)

        ravn_type = event.payload.get("ravn_type", "")
        ravn_event_payload = event.payload.get("ravn_event", {})

        # Mesh topic derived from event_type: "ravn.mesh.<topic>"
        parts = event.event_type.split(".", 2)
        mesh_topic = parts[2] if len(parts) == 3 else ""

        if "OUTCOME" in ravn_type:
            await self._translate_outcome(peer_id, mesh_topic, ravn_event_payload)
            return

        activity_type = self._ravn_type_to_activity(ravn_type)
        if activity_type:
            await self._translate_activity(peer_id, activity_type, ravn_event_payload)

    def _matches_session(self, event: SleipnirEvent) -> bool:
        """Return True if the event belongs to this bridge's session context."""
        if self._session_id is None:
            return True

        if event.correlation_id == self._session_id:
            return True

        if event.payload.get("ravn_session_id") == self._session_id:
            return True

        return False

    async def _ensure_peer_registered(self, event: SleipnirEvent, peer_id: str) -> None:
        """Auto-register *peer_id* as a mesh participant if not already known."""
        if self._room_bridge.has_participant(peer_id):
            return

        persona = _extract_persona(event, peer_id)
        await self._room_bridge.register_mesh_peer(
            peer_id=peer_id,
            persona=persona,
            display_name=persona,
        )
        logger.info("RoomMeshBridge: auto-registered peer_id=%s persona=%s", peer_id, persona)

    async def _translate_outcome(
        self,
        peer_id: str,
        mesh_topic: str,
        ravn_event_payload: dict,
    ) -> None:
        """Translate an OUTCOME mesh event into a ``room_outcome`` wire event."""
        # Build a frame in the shape that RoomBridge.handle_ravn_frame() expects
        frame: dict = {
            "type": "outcome",
            "data": ravn_event_payload,
            "metadata": {
                "event_type": ravn_event_payload.get("event_type", mesh_topic),
            },
        }
        await self._room_bridge.handle_ravn_frame(peer_id, frame)

    async def _translate_activity(
        self,
        peer_id: str,
        activity_type: str,
        ravn_event_payload: dict,
    ) -> None:
        """Translate a tool/thought mesh event into a ``room_activity`` wire event."""
        ravn_frame_type = _ACTIVITY_TO_FRAME_TYPE.get(activity_type)
        if not ravn_frame_type:
            return
        frame = {"type": ravn_frame_type, "data": ravn_event_payload.get("detail", "")}
        await self._room_bridge.handle_ravn_frame(peer_id, frame)

    @staticmethod
    def _ravn_type_to_activity(ravn_type: str) -> str:
        """Map a RavnEventType string to a room activity type, or '' if unknown."""
        for fragment, activity in _RAVN_TYPE_TO_ACTIVITY.items():
            if fragment in ravn_type:
                return activity
        return ""


#: Maps room activity types back to the NDJSON frame type names that
#: RoomBridge.handle_ravn_frame() understands.
_ACTIVITY_TO_FRAME_TYPE: dict[str, str] = {
    "tool_executing": "tool_start",
    "idle": "tool_result",
    "thinking": "thought",
}
