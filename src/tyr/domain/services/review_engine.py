"""Automated review engine — quality scoring and feedback loop for completed raids.

When a raid enters REVIEW (detected by the watcher), this engine evaluates:
  1. PR status (mergeable? conflicts?)
  2. CI status (passed? failed? pending?)
  3. Scope breach (declared_files vs actual diff)
  4. Confidence scoring based on signals
  5. (Optional) LLM-powered reviewer session for deeper code review

When reviewer sessions are enabled, the engine spawns a reviewer session via
Volundr and tracks it. The reviewer session is detected as complete by the
ActivitySubscriber (via SSE idle events), which calls back into the engine's
``handle_reviewer_completion`` method with the chronicle summary. The engine
parses the reviewer's structured output, blends its confidence score, sends
feedback to the working session, and proceeds with the auto-approve / retry /
escalate decision.

The engine then decides: auto-approve, auto-retry, or escalate to human review.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from niuu.ports.integrations import IntegrationRepository
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
from tyr.domain.services.reviewer_session import (
    ReviewerSessionService,
    parse_reviewer_response,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.event_bus import EventBusPort, TyrEvent
from tyr.ports.git import GitPort
from tyr.ports.tracker import TrackerFactory, TrackerPort
from tyr.ports.volundr import VolundrFactory

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewDecision:
    """Outcome of the automated review engine evaluation."""

    raid: Raid
    action: str  # "auto_approved", "retried", "escalated", "failed", "reviewer_pending"
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

    When reviewer sessions are enabled, the engine spawns a reviewer session
    and tracks the mapping from reviewer_session_id → raid_tracker_id. The
    ActivitySubscriber detects reviewer completion via SSE idle events and
    calls ``handle_reviewer_completion`` to close the loop.
    """

    def __init__(
        self,
        tracker_factory: TrackerFactory,
        volundr_factory: VolundrFactory,
        git: GitPort,
        review_config: ReviewConfig,
        event_bus: EventBusPort | None = None,
        reviewer_service: ReviewerSessionService | None = None,
        integration_repo: IntegrationRepository | None = None,
        dispatcher_repo: DispatcherRepository | None = None,
    ) -> None:
        self._tracker_factory = tracker_factory
        self._volundr_factory = volundr_factory
        self._git = git
        self._cfg = review_config
        self._event_bus = event_bus
        self._reviewer = reviewer_service
        self._integration_repo = integration_repo
        self._dispatcher_repo = dispatcher_repo
        self._task: asyncio.Task[None] | None = None
        self._processed: set[str] = set()
        # Maps reviewer_session_id → (raid_tracker_id, owner_id)
        self._reviewer_sessions: dict[str, tuple[str, str]] = {}

    @property
    def running(self) -> bool:
        return self._task is not None

    def get_reviewer_raid(self, session_id: str) -> tuple[str, str] | None:
        """Look up the raid tracker_id and owner_id for a reviewer session.

        Returns (tracker_id, owner_id) if the session is a tracked reviewer,
        None otherwise.
        """
        return self._reviewer_sessions.get(session_id)

    async def handle_reviewer_completion(self, session_id: str, reviewer_output: str) -> None:
        """Handle a reviewer session idle event (called by ActivitySubscriber).

        The reviewer may go idle multiple times during the review loop
        (e.g. after sending feedback to the working session). Only act
        when the output contains a structured JSON assessment — otherwise
        it's an intermediate idle and we skip.
        """
        mapping = self._reviewer_sessions.get(session_id)
        if mapping is None:
            logger.warning("Reviewer session %s not tracked — ignoring completion", session_id)
            return

        tracker_id, owner_id = mapping

        # Only process if the reviewer produced a JSON assessment
        result = parse_reviewer_response(reviewer_output)
        if result is None:
            logger.info(
                "Reviewer session %s idle without JSON assessment — intermediate, skipping",
                session_id,
            )
            return

        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            raise RuntimeError(f"No tracker for owner {owner_id[:8]}")
        tracker = trackers[0]

        raid = await tracker.get_raid(tracker_id)
        if raid.status != RaidStatus.REVIEW:
            logger.info(
                "Raid %s no longer in REVIEW (status=%s) — skipping reviewer result",
                tracker_id,
                raid.status,
            )
            self._reviewer_sessions.pop(session_id, None)
            return

        score = raid.confidence

        # Apply reviewer confidence delta
        reviewer_delta = self._cfg.reviewer_confidence_weight * (result.confidence - score)
        event = _make_event(raid.id, ConfidenceEventType.REVIEWER_SCORE, reviewer_delta, score)
        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid.id, event)
        score = event.score_after

        logger.info(
            "Reviewer session %s result (round %d): confidence=%.2f approved=%s issues=%d",
            session_id,
            raid.review_round,
            result.confidence,
            result.approved,
            len(result.issues),
        )

        # If approved with no issues → check reviewer's own confidence
        if result.approved and not result.issues:
            self._reviewer_sessions.pop(session_id, None)
            if result.confidence >= self._cfg.auto_approve_threshold:
                decision = await self._handle_auto_approve(
                    tracker, tracker_id, owner_id, raid, score
                )
            else:
                decision = await self._handle_escalation(
                    tracker, tracker_id, owner_id, raid, score
                )
            logger.info(
                "Post-reviewer decision for %s: %s (reason=%s)",
                tracker_id, decision.action, decision.reason,
            )
            return

        # Issues found — the reviewer is driving the loop directly with
        # the working session. Tyr just updates the round counter and
        # waits for the next idle event with a JSON assessment.
        new_round = raid.review_round + 1
        await tracker.update_raid_progress(tracker_id, review_round=new_round)

        if new_round >= self._cfg.max_review_rounds:
            # Max rounds exhausted — escalate
            self._reviewer_sessions.pop(session_id, None)
            decision = await self._handle_escalation(
                tracker, tracker_id, owner_id, raid, score
            )
            logger.info(
                "Max review rounds (%d) reached for %s — %s (reason=%s)",
                self._cfg.max_review_rounds, tracker_id, decision.action, decision.reason,
            )
            return

        logger.info(
            "Review round %d/%d for %s: %d issues, reviewer driving loop",
            new_round, self._cfg.max_review_rounds, tracker_id, len(result.issues),
        )

    async def start(self) -> None:
        """Subscribe to the event bus and react to raids entering REVIEW.

        Rebuilds the in-memory reviewer session mapping from the database
        so that reviewer completions are handled after a restart.
        """
        await self._rebuild_reviewer_sessions()
        if self._event_bus is None:
            return
        self._task = asyncio.create_task(self._listen())

    async def _rebuild_reviewer_sessions(self) -> None:
        """Rebuild _reviewer_sessions from DB.

        Queries all active dispatchers and their trackers to find raids
        in REVIEW state with a reviewer_session_id.
        """
        try:
            owner_ids = await self._dispatcher_repo.list_active_owner_ids()
        except Exception:
            logger.warning("Could not list active owners for reviewer rebuild", exc_info=True)
            return

        for owner_id in owner_ids:
            trackers = await self._tracker_factory.for_owner(owner_id)
            for tracker in trackers:
                raids = await tracker.list_raids_by_status(RaidStatus.REVIEW)
                for raid in raids:
                    if raid.reviewer_session_id:
                        self._reviewer_sessions[raid.reviewer_session_id] = (
                            raid.tracker_id,
                            owner_id,
                        )
        if self._reviewer_sessions:
            logger.info(
                "Rebuilt %d reviewer session mapping(s) from database",
                len(self._reviewer_sessions),
            )

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
            logger.warning("Review engine has no event bus — cannot listen")
            return
        q = self._event_bus.subscribe()
        logger.info("Review engine listening for raid.state_changed events")
        try:
            while True:
                event = await q.get()
                logger.debug(
                    "Review engine received event: %s (data=%s)",
                    event.event,
                    event.data,
                )
                if event.event != "raid.state_changed":
                    continue
                if event.data.get("status") != RaidStatus.REVIEW.value:
                    logger.debug(
                        "Skipping — status=%s (not REVIEW)",
                        event.data.get("status"),
                    )
                    continue
                tracker_id = event.data.get("tracker_id")
                owner_id = event.owner_id
                if not tracker_id or not owner_id:
                    logger.warning(
                        "Skipping — missing tracker_id=%s or owner_id=%s",
                        tracker_id,
                        owner_id,
                    )
                    continue
                if tracker_id in self._processed:
                    logger.debug(
                        "Skipping — tracker_id=%s already processed",
                        tracker_id,
                    )
                    continue
                logger.info(
                    "Review engine evaluating raid %s for owner %s",
                    tracker_id,
                    owner_id[:8],
                )
                try:
                    self._processed.add(tracker_id)
                    decision = await self.evaluate(tracker_id, owner_id)
                    logger.info(
                        "Review engine decision for %s: %s (reason=%s)",
                        tracker_id,
                        decision.action,
                        decision.reason,
                    )
                except Exception:
                    logger.warning(
                        "Review engine failed for raid %s",
                        tracker_id,
                        exc_info=True,
                    )
        except asyncio.CancelledError:
            return
        finally:
            if self._event_bus is not None:
                self._event_bus.unsubscribe(q)

    async def evaluate(self, tracker_id: str, owner_id: str) -> ReviewDecision:
        """Run the full review pipeline for a raid in REVIEW state.

        When reviewer sessions are enabled, spawns an LLM reviewer and
        defers the final decision until the reviewer completes (via
        handle_reviewer_completion). A small spawn bonus is applied
        immediately. If the reviewer is not available, falls through
        to the signal-based decision.
        """
        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            raise ValueError(f"No tracker adapter found for owner {owner_id}")
        tracker = trackers[0]

        raid = await tracker.get_raid(tracker_id)
        if raid.status != RaidStatus.REVIEW:
            raise ValueError(f"Raid {tracker_id} not in REVIEW state: {raid.status}")

        # Gather signals
        pr_status = await self._fetch_pr_status(raid)
        changed_files = await self._fetch_changed_files(raid)
        score = raid.confidence

        # Apply confidence signals
        score = await self._apply_ci_signal(tracker, tracker_id, raid.id, score, pr_status)
        score = await self._apply_mergeable_signal(tracker, tracker_id, raid.id, score, pr_status)
        score = await self._apply_scope_breach_signal(
            tracker, tracker_id, raid.id, score, raid.declared_files, changed_files
        )
        score = await self._apply_retry_penalty(
            tracker, tracker_id, raid.id, score, raid.retry_count
        )

        # Spawn reviewer session if enabled — defers final decision
        reviewer_spawned = await self._spawn_reviewer_session(
            tracker, tracker_id, raid, owner_id, score, pr_status, changed_files
        )
        if reviewer_spawned:
            # Reviewer is running; final decision deferred to handle_reviewer_completion
            return ReviewDecision(
                raid=raid,
                action="reviewer_pending",
                reason="Reviewer session spawned, awaiting completion",
            )

        # No reviewer — decide immediately based on signals
        if pr_status and not pr_status.ci_passed:
            return await self._handle_ci_failure(
                tracker, tracker_id, owner_id, raid, pr_status, score
            )

        if pr_status and not pr_status.mergeable:
            return await self._handle_conflict(tracker, tracker_id, owner_id, raid, score)

        if score >= self._cfg.auto_approve_threshold and self._can_auto_approve(pr_status):
            return await self._handle_auto_approve(tracker, tracker_id, owner_id, raid, score)

        return await self._handle_escalation(tracker, tracker_id, owner_id, raid, score)

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
        self,
        tracker: TrackerPort,
        tracker_id: str,
        raid_id: UUID,
        score: float,
        pr_status: PRStatus | None,
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

        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    async def _apply_mergeable_signal(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        raid_id: UUID,
        score: float,
        pr_status: PRStatus | None,
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

        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    async def _apply_scope_breach_signal(
        self,
        tracker: TrackerPort,
        tracker_id: str,
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
        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid_id, event)
        logger.info("Scope breach detected for raid %s", tracker_id)
        return event.score_after

    async def _apply_retry_penalty(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        raid_id: UUID,
        score: float,
        retry_count: int,
    ) -> float:
        if retry_count == 0:
            return score

        delta = self._cfg.confidence_delta_retry_multiplier * retry_count
        event = _make_event(raid_id, ConfidenceEventType.RETRY, delta, score)
        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid_id, event)
        return event.score_after

    # -- Reviewer session --

    async def _spawn_reviewer_session(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        raid: Raid,
        owner_id: str,
        score: float,
        pr_status: PRStatus | None,
        changed_files: list[str],
    ) -> bool:
        """Spawn an LLM reviewer session and track it.

        Returns True if a reviewer was spawned (decision deferred),
        False if no reviewer was spawned (decide immediately).
        """
        if not self._cfg.reviewer_session_enabled:
            return False

        if self._reviewer is None:
            return False

        integration_ids = await self._resolve_integration_ids(owner_id)

        # Get repo/branch from the working session on Volundr
        working_session = None
        if raid.session_id:
            adapters = await self._volundr_factory.for_owner(owner_id)
            for adapter in adapters:
                try:
                    working_session = await adapter.get_session(raid.session_id)
                    if working_session is not None:
                        break
                except Exception:
                    continue
            if working_session is None:
                raise ValueError(
                    f"Working session {raid.session_id} not found on any Volundr cluster"
                )

        session = await self._reviewer.spawn_reviewer(
            raid=raid,
            owner_id=owner_id,
            pr_status=pr_status,
            changed_files=changed_files,
            integration_ids=integration_ids,
            working_session=working_session,
        )
        if session is None:
            logger.warning("Reviewer session not spawned for raid %s — skipping", tracker_id)
            return False

        # Persist reviewer session mapping to DB and in-memory cache
        await tracker.update_raid_progress(
            tracker_id,
            reviewer_session_id=session.id,
        )
        self._reviewer_sessions[session.id] = (tracker_id, owner_id)

        logger.info(
            "Reviewer session %s spawned for raid %s, awaiting completion via SSE",
            session.id,
            tracker_id,
        )

        # Record a small spawn bonus
        reviewer_delta = self._cfg.reviewer_spawn_bonus
        event = _make_event(
            raid.id,
            ConfidenceEventType.REVIEWER_SCORE,
            reviewer_delta,
            score,
        )
        await tracker.add_confidence_event(tracker_id, event)
        await self._emit_confidence_updated(raid.id, event)

        return True

    # -- Integration resolution --

    async def _resolve_integration_ids(self, owner_id: str) -> list[str]:
        """Resolve integration connection IDs from Volundr for the owner."""
        try:
            adapters = await self._volundr_factory.for_owner(owner_id)
            if not adapters:
                logger.error(
                    "No authenticated Volundr adapter for owner %s — "
                    "cannot resolve integrations; user must configure a CODE_FORGE integration",
                    owner_id[:8],
                )
                return []
            return await adapters[0].list_integration_ids()
        except Exception:
            logger.warning("Failed to fetch Volundr integrations for owner %s", owner_id[:8])
        return []

    # -- Decision handlers --

    def _can_auto_approve(self, pr_status: PRStatus | None) -> bool:
        if pr_status is None:
            return False
        return bool(pr_status.ci_passed and pr_status.mergeable)

    async def _handle_auto_approve(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        raid: Raid,
        score: float,
    ) -> ReviewDecision:
        """Auto-approve: merge PR, transition REVIEW → MERGED."""
        event = _make_event(
            raid.id, ConfidenceEventType.AUTO_APPROVED, self._cfg.confidence_delta_approved, score
        )
        await tracker.add_confidence_event(tracker_id, event)

        validate_transition(raid.status, RaidStatus.MERGED)
        updated = await tracker.update_raid_progress(tracker_id, status=RaidStatus.MERGED)

        # Merge PR branch
        saga = await tracker.get_saga_for_raid(tracker_id)
        if saga and raid.branch and saga.repos:
            repo = saga.repos[0]
            try:
                await self._git.merge_branch(repo, raid.branch, saga.feature_branch)
                await self._git.delete_branch(repo, raid.branch)
            except Exception:
                logger.warning(
                    "Failed to merge/delete branch for raid %s", tracker_id, exc_info=True
                )

        # Phase gate check
        phase_gate_unlocked = await self._check_phase_gate(tracker, tracker_id, owner_id)

        await self._emit_state_changed(updated, owner_id=owner_id, action="auto_approved")

        return ReviewDecision(
            raid=updated,
            action="auto_approved",
            reason=f"Confidence {event.score_after:.2f} >= {self._cfg.auto_approve_threshold:.2f}",
            phase_gate_unlocked=phase_gate_unlocked,
        )

    async def _handle_ci_failure(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        raid: Raid,
        pr_status: PRStatus,
        score: float,
    ) -> ReviewDecision:
        """CI failed: auto-retry if retries remain, otherwise FAILED + escalate."""
        if raid.retry_count < self._cfg.max_retries:
            return await self._auto_retry(
                tracker,
                tracker_id,
                owner_id,
                raid,
                reason=f"CI failed (attempt {raid.retry_count + 1}/{self._cfg.max_retries})",
            )

        # Retries exhausted → FAILED
        validate_transition(raid.status, RaidStatus.FAILED)
        updated = await tracker.update_raid_progress(
            tracker_id, status=RaidStatus.FAILED, reason="CI failed, retries exhausted"
        )

        await self._emit_state_changed(updated, owner_id=owner_id, action="failed")
        return ReviewDecision(
            raid=updated,
            action="failed",
            reason=f"CI failed after {self._cfg.max_retries} retries",
        )

    async def _handle_conflict(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        raid: Raid,
        score: float,
    ) -> ReviewDecision:
        """PR has conflicts: auto-retry if retries remain, otherwise escalate."""
        if raid.retry_count < self._cfg.max_retries:
            return await self._auto_retry(
                tracker,
                tracker_id,
                owner_id,
                raid,
                reason=f"PR conflicts (attempt {raid.retry_count + 1}/{self._cfg.max_retries})",
            )

        validate_transition(raid.status, RaidStatus.FAILED)
        updated = await tracker.update_raid_progress(
            tracker_id, status=RaidStatus.FAILED, reason="PR conflicts, retries exhausted"
        )

        await self._emit_state_changed(updated, owner_id=owner_id, action="failed")
        return ReviewDecision(
            raid=updated,
            action="failed",
            reason=f"PR conflicts after {self._cfg.max_retries} retries",
        )

    async def _handle_escalation(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        raid: Raid,
        score: float,
    ) -> ReviewDecision:
        """Confidence too low or conditions not met — escalate to human review."""
        validate_transition(raid.status, RaidStatus.ESCALATED)
        updated = await tracker.update_raid_progress(tracker_id, status=RaidStatus.ESCALATED)
        await self._emit_state_changed(updated, owner_id=owner_id, action="escalated")
        return ReviewDecision(
            raid=updated,
            action="escalated",
            reason=(
                f"Confidence {score:.2f} < {self._cfg.auto_approve_threshold:.2f},"
                " escalating to human review"
            ),
        )

    async def _auto_retry(
        self,
        tracker: TrackerPort,
        tracker_id: str,
        owner_id: str,
        raid: Raid,
        *,
        reason: str,
    ) -> ReviewDecision:
        """Transition raid back to PENDING for re-dispatch."""
        event = _make_event(
            raid.id,
            ConfidenceEventType.RETRY,
            self._cfg.confidence_delta_retry,
            raid.confidence,
        )
        await tracker.add_confidence_event(tracker_id, event)

        # Send failure context to the running session before resetting
        await self._send_retry_feedback(raid, owner_id, reason)

        validate_transition(raid.status, RaidStatus.PENDING)
        updated = await tracker.update_raid_progress(
            tracker_id, status=RaidStatus.PENDING, retry_count=raid.retry_count + 1
        )

        await self._emit_state_changed(updated, owner_id=owner_id, action="retried")
        return ReviewDecision(raid=updated, action="retried", reason=reason)

    # -- Session feedback --

    async def _send_retry_feedback(self, raid: Raid, owner_id: str, reason: str) -> None:
        """Send failure context to the session before retrying."""
        if not raid.session_id:
            return
        adapters = await self._volundr_factory.for_owner(owner_id)
        if not adapters:
            logger.warning(
                "No authenticated Volundr adapter for owner %s — cannot send feedback",
                owner_id[:8],
            )
            return
        try:
            await adapters[0].send_message(
                raid.session_id,
                f"Review failed: {reason}. Please fix and push again.",
            )
            logger.info("Sent retry feedback to session %s", raid.session_id)
        except Exception:
            logger.warning(
                "Failed to send retry feedback to session %s for raid %s",
                raid.session_id,
                raid.id,
            )

    # -- Phase gate --

    async def _check_phase_gate(self, tracker: TrackerPort, tracker_id: str, owner_id: str) -> bool:
        """Check if all raids in the phase are merged, and unlock next phase if so."""
        phase = await tracker.get_phase_for_raid(tracker_id)
        if phase is None:
            return False

        if not await tracker.all_raids_merged(phase.tracker_id):
            return False

        logger.info("Phase gate unlocked — all raids merged in phase %s", phase.tracker_id)

        # Unlock the next phase
        saga = await tracker.get_saga_for_raid(tracker_id)
        if saga is None:
            return True

        phases = await tracker.list_phases_for_saga(saga.tracker_id)
        current_idx = next(
            (i for i, p in enumerate(phases) if p.tracker_id == phase.tracker_id), -1
        )
        if current_idx < 0 or current_idx + 1 >= len(phases):
            return True

        next_phase = phases[current_idx + 1]
        if next_phase.status == PhaseStatus.GATED:
            await tracker.update_phase_status(next_phase.tracker_id, PhaseStatus.ACTIVE)
            logger.info("Next phase %s unlocked (GATED → ACTIVE)", next_phase.tracker_id)

            if self._event_bus:
                await self._event_bus.emit(
                    TyrEvent(
                        event="phase.unlocked",
                        owner_id=owner_id,
                        data={
                            "phase_id": next_phase.tracker_id,
                            "saga_id": saga.tracker_id,
                            "phase_number": next_phase.number,
                            "phase_name": next_phase.name,
                            "owner_id": owner_id,
                        },
                    )
                )

        return True

    # -- Event emission --

    async def _emit_state_changed(self, raid: Raid, *, owner_id: str, action: str) -> None:
        if self._event_bus is None:
            return
        await self._event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                owner_id=owner_id,
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
