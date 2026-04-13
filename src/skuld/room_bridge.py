"""RoomBridge — Ravn WebSocket ingress and event aggregation for multi-agent rooms.

Accepts WebSocket connections from Ravn daemons, translates their NDJSON event
frames into browser-facing room events, and broadcasts them via ChannelRegistry.

Only active when ``room.enabled = true`` in the broker configuration.

Wire events emitted to browsers:
    participant_joined   {participant: ParticipantMeta}
    participant_left     {participantId: str}
    room_state           {participants: list[ParticipantMeta]}
    room_message         {id, participantId, participant, content, threadId?, visibility}
    room_activity        {participantId, activityType, detail?}
"""

from __future__ import annotations

import itertools
import json
import logging
import uuid
from dataclasses import asdict
from typing import TYPE_CHECKING

from fastapi import WebSocket

from skuld.room_models import ParticipantMeta

if TYPE_CHECKING:
    from skuld.channels import ChannelRegistry
    from skuld.config import RoomConfig

logger = logging.getLogger(__name__)

# Maps RavnEvent type strings to room activity types
_RAVN_ACTIVITY_MAP: dict[str, str] = {
    "thought": "thinking",
    "thinking": "thinking",
    "tool_start": "tool_executing",
    "tool_result": "idle",
}


class RoomBridge:
    """Bridges Ravn WebSocket connections into the multi-agent room.

    Manages participant registration, color assignment, event translation,
    history persistence, and directed message routing.

    Args:
        config:   Room configuration (colors pool, max participants, etc.).
        channels: Shared channel registry used to broadcast room events.
        append_turn: Callback to persist a ConversationTurn (injected by Broker).
    """

    def __init__(
        self,
        config: RoomConfig,
        channels: ChannelRegistry,
        append_turn: object = None,
    ) -> None:
        self._config = config
        self._channels = channels
        self._append_turn = append_turn  # Callable[[ConversationTurn], None] | None
        self._participants: dict[str, ParticipantMeta] = {}
        self._websockets: dict[str, WebSocket] = {}
        self._color_cycle = itertools.cycle(list(config.participant_colors))

    # ------------------------------------------------------------------
    # Participant management
    # ------------------------------------------------------------------

    async def register(
        self,
        peer_id: str,
        persona: str,
        websocket: WebSocket,
    ) -> ParticipantMeta:
        """Register a new Ravn participant and broadcast ``participant_joined``.

        If a participant with *peer_id* already exists (reconnect), the
        existing record is reused and a fresh ``participant_joined`` is broadcast.
        """
        if peer_id not in self._participants:
            color = next(self._color_cycle)
            meta = ParticipantMeta(
                peer_id=peer_id,
                persona=persona,
                color=color,
                participant_type="ravn",
            )
            self._participants[peer_id] = meta
        else:
            meta = self._participants[peer_id]

        self._websockets[peer_id] = websocket
        logger.info("RoomBridge: participant registered peer_id=%s persona=%s", peer_id, persona)

        await self._channels.broadcast({"type": "participant_joined", "participant": asdict(meta)})
        return meta

    async def unregister(self, peer_id: str) -> None:
        """Remove a participant and broadcast ``participant_left``."""
        self._participants.pop(peer_id, None)
        self._websockets.pop(peer_id, None)
        logger.info("RoomBridge: participant unregistered peer_id=%s", peer_id)

        await self._channels.broadcast({"type": "participant_left", "participantId": peer_id})

    # ------------------------------------------------------------------
    # Event translation
    # ------------------------------------------------------------------

    async def handle_ravn_frame(self, peer_id: str, frame: dict) -> None:
        """Translate a raw NDJSON frame from a Ravn into room wire events.

        Frame schema (from SkuldChannel):
            session_id, type, data, metadata, source (peer_id), persona

        Routing:
            type "response"             → room_message
            type "error"                → room_message (error=True)
            type "thought"/"tool_start"/"tool_result" → room_activity
        """
        meta = self._participants.get(peer_id)
        if meta is None:
            logger.warning("RoomBridge: frame from unknown peer_id=%s, dropping", peer_id)
            return

        event_type = frame.get("type", "")
        data = frame.get("data", "")

        if event_type in ("response", "error"):
            await self._handle_response_frame(meta, frame, is_error=(event_type == "error"))
            return

        activity_type = _RAVN_ACTIVITY_MAP.get(event_type)
        if activity_type:
            await self._handle_activity_frame(meta, activity_type, data)

    async def _handle_response_frame(
        self,
        meta: ParticipantMeta,
        frame: dict,
        is_error: bool,
    ) -> None:
        """Translate a response/error frame into a room_message event."""
        msg_id = str(uuid.uuid4())
        content = frame.get("data", "")
        thread_id = frame.get("metadata", {}).get("thread_id")

        room_event: dict = {
            "type": "room_message",
            "id": msg_id,
            "participantId": meta.peer_id,
            "participant": asdict(meta),
            "content": content,
            "visibility": "public",
        }
        if is_error:
            room_event["error"] = True
        if thread_id:
            room_event["threadId"] = thread_id

        await self._channels.broadcast(room_event)

        # Persist as ConversationTurn
        if self._append_turn is not None:
            from skuld.broker import ConversationTurn  # late import — avoids circular

            turn = ConversationTurn(
                id=msg_id,
                role="assistant",
                content=content,
                participant_id=meta.peer_id,
                participant_meta=asdict(meta),
                thread_id=thread_id,
                visibility="public",
            )
            self._append_turn(turn)

    async def _handle_activity_frame(
        self,
        meta: ParticipantMeta,
        activity_type: str,
        detail: str,
    ) -> None:
        """Translate a thought/tool frame into a room_activity event."""
        event: dict = {
            "type": "room_activity",
            "participantId": meta.peer_id,
            "activityType": activity_type,
        }
        if detail:
            event["detail"] = detail[:200]

        await self._channels.broadcast(event)

    # ------------------------------------------------------------------
    # Directed routing
    # ------------------------------------------------------------------

    async def route_directed_message(
        self,
        target_peer_id: str,
        content: str,
    ) -> bool:
        """Forward a directed message from the browser to a specific Ravn WebSocket.

        Returns True if the message was delivered, False if the target is not connected.
        """
        ws = self._websockets.get(target_peer_id)
        if ws is None:
            logger.warning(
                "RoomBridge: directed_message to unknown peer_id=%s, dropping",
                target_peer_id,
            )
            return False

        try:
            payload = json.dumps({"type": "directed_message", "content": content})
            await ws.send_text(payload)
            logger.debug("RoomBridge: directed_message sent to peer_id=%s", target_peer_id)
            return True
        except Exception:
            logger.warning(
                "RoomBridge: failed to send directed_message to peer_id=%s",
                target_peer_id,
                exc_info=True,
            )
            return False

    # ------------------------------------------------------------------
    # Room state
    # ------------------------------------------------------------------

    def get_room_state_event(self) -> dict:
        """Return a ``room_state`` event with the current participant list."""
        return {
            "type": "room_state",
            "participants": [asdict(p) for p in self._participants.values()],
        }

    @property
    def participant_count(self) -> int:
        """Number of currently registered participants."""
        return len(self._participants)

    @property
    def participants(self) -> dict[str, ParticipantMeta]:
        """Snapshot of current participants (copy)."""
        return dict(self._participants)
