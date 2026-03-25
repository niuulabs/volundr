"""Notification service — subscribes to EventBus and dispatches to channels.

Maps domain events (raid state changes, saga completions, etc.) to
user-facing notifications and delivers them through configured channels
(Telegram, Slack, etc.) using the dynamic adapter pattern.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from tyr.adapters.notification_channel_factory import NotificationChannelFactory
from tyr.events import EventBus, TyrEvent
from tyr.ports.notification_channel import (
    Notification,
    NotificationUrgency,
)
from tyr.ports.raid_repository import RaidRepository

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Event → Notification mapping configuration
# ---------------------------------------------------------------------------

_STATUS_NOTIFICATION_MAP: dict[str, dict[str, Any]] = {
    "REVIEW": {
        "title": "Raid ready for review",
        "body_template": "Raid {tracker_id} is ready for review.",
        "urgency": NotificationUrgency.HIGH,
    },
    "FAILED": {
        "title": "Raid failed",
        "body_template": "Raid {tracker_id} failed (retry #{retry_count}).",
        "urgency": NotificationUrgency.HIGH,
    },
    "MERGED": {
        "title": "Raid merged",
        "body_template": "Raid {tracker_id} has been merged.",
        "urgency": NotificationUrgency.LOW,
    },
}

_CONFIDENCE_THRESHOLD = 0.3


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class NotificationService:
    """Subscribes to EventBus events and dispatches notifications to channels.

    Runs as a background task alongside the main application. For each event,
    it resolves the owning user, builds a Notification, resolves that user's
    configured channels, and delivers.
    """

    def __init__(
        self,
        event_bus: EventBus,
        channel_factory: NotificationChannelFactory,
        raid_repo: RaidRepository,
        *,
        confidence_threshold: float = _CONFIDENCE_THRESHOLD,
    ) -> None:
        self._event_bus = event_bus
        self._channel_factory = channel_factory
        self._raid_repo = raid_repo
        self._confidence_threshold = confidence_threshold
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._queue: asyncio.Queue[TyrEvent] | None = None

    @property
    def running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start the notification background loop."""
        self._queue = self._event_bus.subscribe()
        self._running = True
        self._task = asyncio.create_task(self._run(), name="notification-service")
        logger.info("Notification service started")

    async def stop(self) -> None:
        """Gracefully stop the notification service."""
        self._running = False
        if self._queue is not None:
            self._event_bus.unsubscribe(self._queue)
            self._queue = None
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Notification service stopped")

    async def _run(self) -> None:
        """Main loop — consume events and dispatch notifications."""
        while self._running:
            try:
                if self._queue is None:
                    break
                event = await asyncio.wait_for(self._queue.get(), timeout=5.0)
                await self._handle_event(event)
            except TimeoutError:
                continue
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error processing notification event")

    async def _handle_event(self, event: TyrEvent) -> None:
        """Map an event to a notification and dispatch it."""
        notification = await self._map_event(event)
        if notification is None:
            return

        channels = await self._channel_factory.for_owner(notification.owner_id)
        if not channels:
            return

        for channel in channels:
            if not channel.should_notify(notification):
                continue
            try:
                await channel.send(notification)
            except Exception:
                logger.warning(
                    "Failed to send notification via %s",
                    type(channel).__name__,
                    exc_info=True,
                )

    async def _map_event(self, event: TyrEvent) -> Notification | None:
        """Convert a TyrEvent into a Notification, or None if unmapped."""
        match event.event:
            case "raid.state_changed":
                return await self._map_raid_state_changed(event.data)
            case "confidence.updated":
                return await self._map_confidence_updated(event.data)
            case "saga.pr_created":
                return self._map_saga_pr_created(event.data)
            case "phase.unlocked":
                return self._map_phase_unlocked(event.data)
            case _:
                return None

    async def _map_raid_state_changed(self, data: dict[str, Any]) -> Notification | None:
        """Map a raid.state_changed event to a notification."""
        status = data.get("status", "")
        mapping = _STATUS_NOTIFICATION_MAP.get(status)
        if mapping is None:
            return None

        raid_id = data.get("raid_id", "")
        tracker_id = data.get("tracker_id", "")
        pr_url = data.get("pr_url", "")

        # Resolve owner_id from the raid's parent saga
        owner_id = await self._resolve_owner(raid_id)
        if not owner_id:
            return None

        # Resolve tracker_id from raid if not in event data
        if not tracker_id:
            tracker_id = await self._resolve_tracker_id(raid_id)

        retry_count = data.get("retry_count", 0)

        body = mapping["body_template"].format(
            tracker_id=tracker_id or raid_id,
            retry_count=retry_count,
        )

        if pr_url:
            body += f"\nPR: {pr_url}"

        metadata: dict[str, str] = {}
        if pr_url:
            metadata["pr_url"] = pr_url
        if tracker_id:
            metadata["tracker_id"] = tracker_id

        return Notification(
            title=mapping["title"],
            body=body,
            urgency=mapping["urgency"],
            owner_id=owner_id,
            event_type=f"raid.{status.lower()}",
            metadata=metadata,
        )

    async def _map_confidence_updated(self, data: dict[str, Any]) -> Notification | None:
        """Map a confidence.updated event when confidence drops below threshold."""
        confidence = data.get("confidence", 1.0)
        if confidence >= self._confidence_threshold:
            return None

        raid_id = data.get("raid_id", "")
        tracker_id = data.get("tracker_id", "")

        owner_id = await self._resolve_owner(raid_id)
        if not owner_id:
            return None

        if not tracker_id:
            tracker_id = await self._resolve_tracker_id(raid_id)

        return Notification(
            title="Confidence dropped",
            body=f"Raid {tracker_id or raid_id} confidence dropped to {confidence:.0%}.",
            urgency=NotificationUrgency.MEDIUM,
            owner_id=owner_id,
            event_type="confidence.low",
            metadata={"tracker_id": tracker_id} if tracker_id else {},
        )

    @staticmethod
    def _map_saga_pr_created(data: dict[str, Any]) -> Notification | None:
        """Map a saga.pr_created event."""
        owner_id = data.get("owner_id", "")
        if not owner_id:
            return None

        saga_name = data.get("saga_name", "")
        pr_url = data.get("pr_url", "")

        body = f'Saga "{saga_name}" complete — final PR ready.'
        if pr_url:
            body += f"\nPR: {pr_url}"

        metadata: dict[str, str] = {}
        if pr_url:
            metadata["pr_url"] = pr_url

        return Notification(
            title="Saga complete",
            body=body,
            urgency=NotificationUrgency.HIGH,
            owner_id=owner_id,
            event_type="saga.complete",
            metadata=metadata,
        )

    @staticmethod
    def _map_phase_unlocked(data: dict[str, Any]) -> Notification | None:
        """Map a phase.unlocked event."""
        owner_id = data.get("owner_id", "")
        if not owner_id:
            return None

        phase_number = data.get("phase_number", "?")
        queued_raids = data.get("queued_raids", 0)

        return Notification(
            title="Phase unlocked",
            body=f"Phase {phase_number} unlocked, {queued_raids} raids queued.",
            urgency=NotificationUrgency.MEDIUM,
            owner_id=owner_id,
            event_type="phase.unlocked",
        )

    async def _resolve_owner(self, raid_id: str) -> str:
        """Resolve the owner_id for a raid via its parent saga."""
        if not raid_id:
            return ""
        try:
            from uuid import UUID

            saga = await self._raid_repo.get_saga_for_raid(UUID(raid_id))
            if saga is not None:
                return saga.owner_id
        except (ValueError, Exception):
            logger.debug("Could not resolve owner for raid %s", raid_id)
        return ""

    async def _resolve_tracker_id(self, raid_id: str) -> str:
        """Resolve the tracker_id for a raid."""
        if not raid_id:
            return ""
        try:
            from uuid import UUID

            raid = await self._raid_repo.get_raid(UUID(raid_id))
            if raid is not None:
                return raid.tracker_id
        except (ValueError, Exception):
            logger.debug("Could not resolve tracker_id for raid %s", raid_id)
        return ""
