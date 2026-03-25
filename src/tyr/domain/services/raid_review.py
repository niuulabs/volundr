"""Shared raid review service — approve, reject, retry with full domain logic.

Both the REST API and the Telegram command handler delegate to this service
so that confidence events, state transitions, and phase gate checks are
always applied consistently.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from tyr.config import ReviewConfig
from tyr.domain.exceptions import InvalidStateTransitionError, RaidNotFoundError
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    Raid,
    RaidStatus,
    validate_transition,
)
from tyr.events import EventBus, TyrEvent
from tyr.ports.raid_repository import RaidRepository

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewResult:
    """Outcome of a review action (approve / reject / retry)."""

    raid: Raid
    reason: str | None = None
    phase_gate_unlocked: bool = False


class InvalidRaidStateError(Exception):
    def __init__(self, raid_id: UUID | str, current: str, action: str) -> None:
        self.raid_id = raid_id
        self.current = current
        self.action = action
        super().__init__(f"Cannot {action} raid {raid_id} in {current} state")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_confidence_event(
    raid_id: UUID,
    event_type: ConfidenceEventType,
    delta: float,
    current_score: float,
) -> ConfidenceEvent:
    new_score = max(0.0, min(1.0, current_score + delta))
    return ConfidenceEvent(
        id=uuid4(),
        raid_id=raid_id,
        event_type=event_type,
        delta=delta,
        score_after=new_score,
        created_at=datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RaidReviewService:
    """Encapsulates the domain logic for raid review actions.

    Callers (REST, Telegram, autonomous dispatcher) use this service
    so that confidence history, state transitions, and phase gate checks
    are never skipped.
    """

    def __init__(
        self,
        raid_repo: RaidRepository,
        review_config: ReviewConfig,
        event_bus: EventBus | None = None,
    ) -> None:
        self._raid_repo = raid_repo
        self._cfg = review_config
        self._event_bus = event_bus

    async def _emit_state_changed(self, raid: Raid, *, action: str) -> None:
        """Emit a raid.state_changed event if an EventBus is wired."""
        if self._event_bus is None:
            return
        await self._event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid.id),
                    "status": raid.status.value,
                    "confidence": raid.confidence,
                    "action": action,
                    "tracker_id": raid.tracker_id,
                },
            )
        )

    async def approve(self, raid_id: UUID) -> ReviewResult:
        """Approve a raid: HUMAN_APPROVED event → MERGED → phase gate check."""
        raid = await self._raid_repo.get_raid(raid_id)
        if raid is None:
            raise RaidNotFoundError(raid_id)

        try:
            validate_transition(raid.status, RaidStatus.MERGED)
        except InvalidStateTransitionError:
            raise InvalidRaidStateError(raid_id, raid.status.value, "approve")

        # Record confidence event
        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.HUMAN_APPROVED,
            self._cfg.confidence_delta_approved,
            raid.confidence,
        )
        await self._raid_repo.add_confidence_event(event)

        # Transition state
        updated = await self._raid_repo.update_raid_status(raid_id, RaidStatus.MERGED)
        if updated is None:
            raise RaidNotFoundError(raid_id)

        # Phase gate check
        phase_gate_unlocked = False
        phase = await self._raid_repo.get_phase_for_raid(raid_id)
        if phase and await self._raid_repo.all_raids_merged(phase.id):
            logger.info("Phase gate unlocked — all raids merged in phase %s", phase.id)
            phase_gate_unlocked = True

        await self._emit_state_changed(updated, action="approved")

        return ReviewResult(raid=updated, phase_gate_unlocked=phase_gate_unlocked)

    async def reject(
        self,
        raid_id: UUID,
        *,
        reason: str | None = None,
    ) -> ReviewResult:
        """Reject a raid: HUMAN_REJECT event → FAILED."""
        raid = await self._raid_repo.get_raid(raid_id)
        if raid is None:
            raise RaidNotFoundError(raid_id)

        try:
            validate_transition(raid.status, RaidStatus.FAILED)
        except InvalidStateTransitionError:
            raise InvalidRaidStateError(raid_id, raid.status.value, "reject")

        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.HUMAN_REJECT,
            self._cfg.confidence_delta_rejected,
            raid.confidence,
        )
        await self._raid_repo.add_confidence_event(event)

        updated = await self._raid_repo.update_raid_status(
            raid_id, RaidStatus.FAILED, reason=reason
        )
        if updated is None:
            raise RaidNotFoundError(raid_id)

        await self._emit_state_changed(updated, action="rejected")

        return ReviewResult(raid=updated, reason=reason)

    async def retry(self, raid_id: UUID) -> ReviewResult:
        """Retry a raid: RETRY event → re-queued with incremented retry_count.

        REVIEW → PENDING, FAILED → QUEUED (per RAID_TRANSITIONS).
        """
        raid = await self._raid_repo.get_raid(raid_id)
        if raid is None:
            raise RaidNotFoundError(raid_id)

        # Determine target status based on current state
        target = RaidStatus.QUEUED if raid.status == RaidStatus.FAILED else RaidStatus.PENDING

        try:
            validate_transition(raid.status, target)
        except InvalidStateTransitionError:
            raise InvalidRaidStateError(raid_id, raid.status.value, "retry")

        event = _make_confidence_event(
            raid.id,
            ConfidenceEventType.RETRY,
            self._cfg.confidence_delta_retry,
            raid.confidence,
        )
        await self._raid_repo.add_confidence_event(event)

        updated = await self._raid_repo.update_raid_status(raid_id, target, increment_retry=True)
        if updated is None:
            raise RaidNotFoundError(raid_id)

        await self._emit_state_changed(updated, action="retried")

        return ReviewResult(raid=updated)
