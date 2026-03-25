"""Automated review engine — quality scoring and feedback loop for completed raids.

When a raid enters REVIEW (detected by the watcher), this engine evaluates:
  1. PR status (mergeable? conflicts?)
  2. CI status (passed? failed? pending?)
  3. Scope breach (declared_files vs actual diff)
  4. Confidence scoring based on signals

The engine then decides: auto-approve, auto-retry, or escalate to human review.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from tyr.config import ReviewConfig
from tyr.domain.models import (
    ConfidenceEvent,
    ConfidenceEventType,
    PhaseStatus,
    PRStatus,
    Raid,
    RaidStatus,
    validate_transition,
)
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.git import GitPort
from tyr.ports.raid_repository import RaidRepository
from tyr.ports.volundr import VolundrPort

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewDecision:
    """Outcome of the automated review engine evaluation."""

    raid: Raid
    action: str  # "auto_approved", "retried", "escalated", "failed"
    reason: str
    phase_gate_unlocked: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_event(
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


def detect_scope_breach(
    declared_files: list[str],
    changed_files: list[str],
    threshold: float,
) -> bool:
    """Return True if the fraction of undeclared changed files exceeds the threshold."""
    if not changed_files:
        return False

    declared_set = set(declared_files)
    undeclared = [f for f in changed_files if f not in declared_set]
    ratio = len(undeclared) / len(changed_files)
    return ratio > threshold


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class ReviewEngine:
    """Autonomous review engine that scores and acts on raids in REVIEW state.

    Called by the watcher after a raid transitions to REVIEW. Gathers signals,
    scores confidence, and decides whether to auto-approve, auto-retry, or
    escalate.
    """

    def __init__(
        self,
        raid_repo: RaidRepository,
        git: GitPort,
        review_config: ReviewConfig,
        event_bus: EventBusPort | None = None,
        volundr: VolundrPort | None = None,
    ) -> None:
        self._raid_repo = raid_repo
        self._git = git
        self._cfg = review_config
        self._event_bus = event_bus
        self._volundr = volundr
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Subscribe to the event bus and react to raids entering REVIEW."""
        if self._event_bus is None:
            return
        self._task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        """Cancel the event listener task."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _listen(self) -> None:
        """Listen for raid.state_changed events where status == REVIEW."""
        if self._event_bus is None:
            return
        q = self._event_bus.subscribe()
        try:
            while True:
                event = await q.get()
                if event.event != "raid.state_changed":
                    continue
                if event.data.get("status") != RaidStatus.REVIEW.value:
                    continue
                raid_id_str = event.data.get("raid_id")
                if not raid_id_str:
                    continue
                try:
                    raid_id = UUID(raid_id_str)
                    await self.evaluate(raid_id)
                except Exception:
                    logger.warning(
                        "Review engine failed for raid %s",
                        raid_id_str,
                        exc_info=True,
                    )
        except asyncio.CancelledError:
            return
        finally:
            if self._event_bus is not None:
                self._event_bus.unsubscribe(q)

    async def evaluate(self, raid_id: UUID) -> ReviewDecision:
        """Run the full review pipeline for a raid in REVIEW state."""
        raid = await self._raid_repo.get_raid(raid_id)
        if raid is None:
            raise ValueError(f"Raid not found: {raid_id}")

        if raid.status != RaidStatus.REVIEW:
            raise ValueError(f"Raid {raid_id} not in REVIEW state: {raid.status}")

        # Gather signals
        pr_status = await self._fetch_pr_status(raid)
        changed_files = await self._fetch_changed_files(raid)
        score = raid.confidence

        # Apply confidence signals
        score = await self._apply_ci_signal(raid.id, score, pr_status)
        score = await self._apply_mergeable_signal(raid.id, score, pr_status)
        score = await self._apply_scope_breach_signal(
            raid.id, score, raid.declared_files, changed_files
        )
        score = await self._apply_retry_penalty(raid.id, score, raid.retry_count)

        # Decision logic
        if pr_status and not pr_status.ci_passed:
            return await self._handle_ci_failure(raid, pr_status, score)

        if pr_status and not pr_status.mergeable:
            return await self._handle_conflict(raid, score)

        if score >= self._cfg.auto_approve_threshold and self._can_auto_approve(pr_status):
            return await self._handle_auto_approve(raid, score)

        return await self._handle_escalation(raid, score)

    # -- Signal fetchers --

    async def _fetch_pr_status(self, raid: Raid) -> PRStatus | None:
        if not raid.pr_id:
            return None
        try:
            return await self._git.get_pr_status(raid.pr_id)
        except Exception:
            logger.warning("Failed to fetch PR status for raid %s (pr=%s)", raid.id, raid.pr_id)
            return None

    async def _fetch_changed_files(self, raid: Raid) -> list[str]:
        if not raid.pr_id:
            return []
        try:
            return await self._git.get_pr_changed_files(raid.pr_id)
        except Exception:
            logger.warning("Failed to fetch changed files for raid %s", raid.id)
            return []

    # -- Confidence signal application --

    async def _apply_ci_signal(
        self, raid_id: UUID, score: float, pr_status: PRStatus | None
    ) -> float:
        if pr_status is None or pr_status.ci_passed is None:
            return score

        if pr_status.ci_passed:
            event = _make_event(
                raid_id, ConfidenceEventType.CI_PASS, self._cfg.confidence_delta_ci_pass, score
            )
        else:
            event = _make_event(
                raid_id, ConfidenceEventType.CI_FAIL, self._cfg.confidence_delta_ci_fail, score
            )

        await self._raid_repo.add_confidence_event(event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    async def _apply_mergeable_signal(
        self, raid_id: UUID, score: float, pr_status: PRStatus | None
    ) -> float:
        if pr_status is None:
            return score

        if pr_status.mergeable:
            event = _make_event(
                raid_id,
                ConfidenceEventType.PR_MERGEABLE,
                self._cfg.confidence_delta_mergeable,
                score,
            )
        else:
            event = _make_event(
                raid_id, ConfidenceEventType.PR_CONFLICT, self._cfg.confidence_delta_conflict, score
            )

        await self._raid_repo.add_confidence_event(event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    async def _apply_scope_breach_signal(
        self,
        raid_id: UUID,
        score: float,
        declared_files: list[str],
        changed_files: list[str],
    ) -> float:
        if not detect_scope_breach(declared_files, changed_files, self._cfg.scope_breach_threshold):
            return score

        event = _make_event(
            raid_id,
            ConfidenceEventType.SCOPE_BREACH,
            self._cfg.confidence_delta_scope_breach,
            score,
        )
        await self._raid_repo.add_confidence_event(event)
        await self._emit_confidence_updated(raid_id, event)
        logger.info("Scope breach detected for raid %s", raid_id)
        return event.score_after

    async def _apply_retry_penalty(self, raid_id: UUID, score: float, retry_count: int) -> float:
        if retry_count == 0:
            return score

        delta = self._cfg.confidence_delta_retry_multiplier * retry_count
        event = _make_event(raid_id, ConfidenceEventType.RETRY, delta, score)
        await self._raid_repo.add_confidence_event(event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    # -- Decision handlers --

    def _can_auto_approve(self, pr_status: PRStatus | None) -> bool:
        if pr_status is None:
            return False
        return bool(pr_status.ci_passed and pr_status.mergeable)

    async def _handle_auto_approve(self, raid: Raid, score: float) -> ReviewDecision:
        """Auto-approve: merge PR, transition REVIEW → MERGED."""
        event = _make_event(
            raid.id, ConfidenceEventType.AUTO_APPROVED, self._cfg.confidence_delta_approved, score
        )
        await self._raid_repo.add_confidence_event(event)

        validate_transition(raid.status, RaidStatus.MERGED)
        updated = await self._raid_repo.update_raid_status(raid.id, RaidStatus.MERGED)
        if updated is None:
            raise ValueError(f"Failed to update raid {raid.id}")

        # Merge PR branch
        saga = await self._raid_repo.get_saga_for_raid(raid.id)
        if saga and raid.branch and saga.repos:
            repo = saga.repos[0]
            try:
                await self._git.merge_branch(repo, raid.branch, saga.feature_branch)
                await self._git.delete_branch(repo, raid.branch)
            except Exception:
                logger.warning("Failed to merge/delete branch for raid %s", raid.id, exc_info=True)

        # Phase gate check
        phase_gate_unlocked = await self._check_phase_gate(raid.id)

        await self._emit_state_changed(updated, action="auto_approved")

        return ReviewDecision(
            raid=updated,
            action="auto_approved",
            reason=f"Confidence {event.score_after:.2f} >= {self._cfg.auto_approve_threshold:.2f}",
            phase_gate_unlocked=phase_gate_unlocked,
        )

    async def _handle_ci_failure(
        self, raid: Raid, pr_status: PRStatus, score: float
    ) -> ReviewDecision:
        """CI failed: auto-retry if retries remain, otherwise FAILED + escalate."""
        if raid.retry_count < self._cfg.max_retries:
            return await self._auto_retry(
                raid, reason=f"CI failed (attempt {raid.retry_count + 1}/{self._cfg.max_retries})"
            )

        # Retries exhausted → FAILED
        validate_transition(raid.status, RaidStatus.FAILED)
        updated = await self._raid_repo.update_raid_status(
            raid.id, RaidStatus.FAILED, reason="CI failed, retries exhausted"
        )
        if updated is None:
            raise ValueError(f"Failed to update raid {raid.id}")

        await self._emit_state_changed(updated, action="failed")
        return ReviewDecision(
            raid=updated,
            action="failed",
            reason=f"CI failed after {self._cfg.max_retries} retries",
        )

    async def _handle_conflict(self, raid: Raid, score: float) -> ReviewDecision:
        """PR has conflicts: auto-retry if retries remain, otherwise escalate."""
        if raid.retry_count < self._cfg.max_retries:
            return await self._auto_retry(
                raid,
                reason=f"PR conflicts (attempt {raid.retry_count + 1}/{self._cfg.max_retries})",
            )

        validate_transition(raid.status, RaidStatus.FAILED)
        updated = await self._raid_repo.update_raid_status(
            raid.id, RaidStatus.FAILED, reason="PR conflicts, retries exhausted"
        )
        if updated is None:
            raise ValueError(f"Failed to update raid {raid.id}")

        await self._emit_state_changed(updated, action="failed")
        return ReviewDecision(
            raid=updated,
            action="failed",
            reason=f"PR conflicts after {self._cfg.max_retries} retries",
        )

    async def _handle_escalation(self, raid: Raid, score: float) -> ReviewDecision:
        """Confidence too low or conditions not met — escalate to human review."""
        await self._emit_state_changed(raid, action="escalated")
        return ReviewDecision(
            raid=raid,
            action="escalated",
            reason=(
                f"Confidence {score:.2f} < {self._cfg.auto_approve_threshold:.2f},"
                " escalating to human review"
            ),
        )

    async def _auto_retry(self, raid: Raid, *, reason: str) -> ReviewDecision:
        """Transition raid back to PENDING for re-dispatch."""
        event = _make_event(
            raid.id,
            ConfidenceEventType.RETRY,
            self._cfg.confidence_delta_retry,
            raid.confidence,
        )
        await self._raid_repo.add_confidence_event(event)

        # Send failure context to the running session before resetting
        await self._send_retry_feedback(raid, reason)

        validate_transition(raid.status, RaidStatus.PENDING)
        updated = await self._raid_repo.update_raid_status(
            raid.id, RaidStatus.PENDING, increment_retry=True
        )
        if updated is None:
            raise ValueError(f"Failed to update raid {raid.id}")

        await self._emit_state_changed(updated, action="retried")
        return ReviewDecision(raid=updated, action="retried", reason=reason)

    # -- Session feedback --

    async def _send_retry_feedback(self, raid: Raid, reason: str) -> None:
        """Send failure context to the session before retrying."""
        if self._volundr is None or not raid.session_id:
            return
        try:
            await self._volundr.send_message(
                raid.session_id,
                f"Review failed: {reason}. Please fix and push again.",
            )
        except Exception:
            logger.warning(
                "Failed to send retry feedback to session %s for raid %s",
                raid.session_id,
                raid.id,
            )

    # -- Phase gate --

    async def _check_phase_gate(self, raid_id: UUID) -> bool:
        """Check if all raids in the phase are merged, and unlock next phase if so."""
        phase = await self._raid_repo.get_phase_for_raid(raid_id)
        if phase is None:
            return False

        if not await self._raid_repo.all_raids_merged(phase.id):
            return False

        logger.info("Phase gate unlocked — all raids merged in phase %s", phase.id)

        # Unlock the next phase
        saga = await self._raid_repo.get_saga_for_raid(raid_id)
        if saga is None:
            return True

        phases = await self._raid_repo.list_phases_for_saga(saga.id)
        current_idx = next((i for i, p in enumerate(phases) if p.id == phase.id), -1)
        if current_idx < 0 or current_idx + 1 >= len(phases):
            return True

        next_phase = phases[current_idx + 1]
        if next_phase.status == PhaseStatus.GATED:
            await self._raid_repo.update_phase_status(next_phase.id, PhaseStatus.ACTIVE)
            logger.info("Next phase %s unlocked (GATED → ACTIVE)", next_phase.id)

            if self._event_bus:
                await self._event_bus.emit(
                    TyrEvent(
                        event="phase.unlocked",
                        data={
                            "phase_id": str(next_phase.id),
                            "saga_id": str(saga.id),
                            "phase_number": next_phase.number,
                            "phase_name": next_phase.name,
                            "owner_id": saga.owner_id,
                        },
                    )
                )

        return True

    # -- Event emission --

    async def _emit_state_changed(self, raid: Raid, *, action: str) -> None:
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

    async def _emit_confidence_updated(self, raid_id: UUID, event: ConfidenceEvent) -> None:
        if self._event_bus is None:
            return
        await self._event_bus.emit(
            TyrEvent(
                event="confidence.updated",
                data={
                    "raid_id": str(raid_id),
                    "event_type": event.event_type.value,
                    "delta": event.delta,
                    "score_after": event.score_after,
                },
            )
        )
