"""Event-driven raid completion — replaces polling-based RaidWatcher.

Subscribes to Volundr's SSE stream for session_activity events, evaluates
completion signals, and transitions raids accordingly.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from tyr.config import WatcherConfig
from tyr.domain.models import Raid, RaidStatus
from tyr.events import EventBus, TyrEvent
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.raid_repository import RaidRepository
from tyr.ports.volundr import ActivityEvent, VolundrPort

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompletionEvaluation:
    """Result of evaluating whether a raid's work is complete."""

    is_complete: bool
    signals: dict[str, bool]
    confidence: float
    pr_id: str | None = None
    pr_url: str | None = None


class SessionActivitySubscriber:
    """Subscribes to Volundr SSE and evaluates raid completion on activity events."""

    def __init__(
        self,
        volundr: VolundrPort,
        raid_repo: RaidRepository,
        dispatcher_repo: DispatcherRepository,
        event_bus: EventBus,
        config: WatcherConfig,
    ) -> None:
        self._volundr = volundr
        self._raid_repo = raid_repo
        self._dispatcher_repo = dispatcher_repo
        self._event_bus = event_bus
        self._config = config
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._pending_evaluations: dict[str, asyncio.Task[None]] = {}

    @property
    def running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start the SSE subscriber background loop."""
        if not self._config.enabled:
            logger.info("Session activity subscriber disabled by configuration")
            return

        self._running = True
        self._task = asyncio.create_task(self._run(), name="activity-subscriber")
        logger.info(
            "Session activity subscriber started (idle_threshold=%.1fs)",
            self._config.idle_threshold,
        )

    async def stop(self) -> None:
        """Gracefully stop the subscriber."""
        self._running = False
        # Cancel any pending evaluations
        for task in self._pending_evaluations.values():
            task.cancel()
        self._pending_evaluations.clear()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Session activity subscriber stopped")

    async def _run(self) -> None:
        """Main loop — subscribe to SSE, reconnect on failure."""
        while self._running:
            try:
                async for event in self._volundr.subscribe_activity():
                    if not self._running:
                        break
                    await self._on_activity_event(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("SSE subscription failed, reconnecting")
            if self._running:
                await asyncio.sleep(self._config.reconnect_delay)

    _FAILED_STATUSES: frozenset[str] = frozenset({"stopped", "failed"})

    async def _on_activity_event(self, event: ActivityEvent) -> None:
        """Handle a single activity or session lifecycle event from the SSE stream."""
        # Session lifecycle event (stopped/failed) — handle failure
        if event.session_status in self._FAILED_STATUSES:
            await self._on_session_failed(event)
            return

        if event.state != "idle":
            # Cancel any pending evaluation for this session — it's still working
            pending = self._pending_evaluations.pop(event.session_id, None)
            if pending is not None:
                pending.cancel()
            return

        # Session went idle — schedule a debounced completion check
        if event.session_id in self._pending_evaluations:
            return

        task = asyncio.create_task(
            self._debounced_evaluation(event),
            name=f"eval-{event.session_id}",
        )
        self._pending_evaluations[event.session_id] = task

    async def _debounced_evaluation(self, event: ActivityEvent) -> None:
        """Wait for the debounce delay, then evaluate completion."""
        try:
            await asyncio.sleep(self._config.completion_check_delay)
        except asyncio.CancelledError:
            return
        finally:
            self._pending_evaluations.pop(event.session_id, None)

        raid = await self._find_raid_by_session(event.session_id)
        if raid is None:
            return

        # Verify session still exists and is running before evaluating
        session = await self._volundr.get_session(event.session_id)
        if session is None:
            await self._handle_failure(raid, reason="Session not found")
            return
        if session.status in ("stopped", "failed"):
            await self._handle_failure(raid, reason=f"Session {session.status}")
            return

        # Check dispatcher pause state
        if not await self._is_owner_active(raid):
            return

        completion = await self._evaluate_completion(raid, event.metadata)
        if not completion.is_complete:
            return

        await self._handle_completion(raid, completion)

    async def _find_raid_by_session(self, session_id: str) -> Raid | None:
        """Find a RUNNING raid by its session ID."""
        running = await self._raid_repo.list_by_status(RaidStatus.RUNNING)
        for raid in running:
            if raid.session_id == session_id:
                return raid
        return None

    async def _is_owner_active(self, raid: Raid) -> bool:
        """Check if the raid owner's dispatcher is running."""
        owner_id = await self._raid_repo.get_owner_for_raid(raid.id)
        if owner_id is None:
            return True

        state = await self._dispatcher_repo.get_or_create(owner_id)
        return state.running

    async def _evaluate_completion(self, raid: Raid, metadata: dict) -> CompletionEvaluation:
        """Evaluate whether a raid's work is complete based on signals."""
        signals: dict[str, bool] = {}

        # Signal 1: Session went idle after processing turns
        signals["session_idle"] = True
        signals["has_turns"] = metadata.get("turn_count", 0) > 1

        # Signal 2: PR exists (optional — not all raids produce PRs)
        signals["pr_exists"] = False
        signals["ci_passed"] = False
        pr_id: str | None = None
        pr_url: str | None = None
        if raid.branch:
            try:
                pr = await self._volundr.get_pr_status(raid.session_id or "")
                signals["pr_exists"] = bool(pr.pr_id)
                signals["ci_passed"] = bool(pr.ci_passed)
                if pr.pr_id:
                    pr_id = pr.pr_id
                    pr_url = pr.url
            except Exception:
                pass

        # Signal 3: Extended idle (metadata.duration_seconds as proxy)
        idle_seconds = metadata.get("duration_seconds", 0)
        signals["extended_idle"] = idle_seconds > self._config.idle_threshold

        # Minimum requirement: session idle + has processed turns
        is_complete = signals["session_idle"] and signals["has_turns"]

        # Apply require_pr / require_ci constraints
        if self._config.require_pr and not signals["pr_exists"]:
            is_complete = False
        if self._config.require_ci and not signals["ci_passed"]:
            is_complete = False

        # Calculate confidence based on configurable signal strength
        cfg = self._config
        confidence = cfg.confidence_base if is_complete else 0.0
        if signals["pr_exists"]:
            confidence += cfg.confidence_pr_bonus
        if signals["ci_passed"]:
            confidence += cfg.confidence_ci_bonus
        if signals["extended_idle"]:
            confidence += cfg.confidence_idle_bonus

        return CompletionEvaluation(
            is_complete=is_complete,
            signals=signals,
            confidence=min(confidence, 1.0),
            pr_id=pr_id,
            pr_url=pr_url,
        )

    async def _handle_completion(
        self, raid: Raid, evaluation: CompletionEvaluation | None = None
    ) -> None:
        """Transition a raid to REVIEW on session completion."""
        chronicle_summary = None
        if self._config.chronicle_on_complete and raid.session_id:
            try:
                chronicle_summary = await self._volundr.get_chronicle_summary(raid.session_id)
            except Exception:
                logger.warning("Failed to fetch chronicle for session %s", raid.session_id)

        # Reuse PR info from evaluation to avoid a redundant HTTP call
        pr_id = evaluation.pr_id if evaluation else None
        pr_url = evaluation.pr_url if evaluation else None

        updated = await self._raid_repo.update_raid_completion(
            raid.id,
            status=RaidStatus.REVIEW,
            chronicle_summary=chronicle_summary,
            pr_url=pr_url,
            pr_id=pr_id,
        )

        if updated:
            await self._emit_state_changed(updated)
            logger.info(
                "Raid %s transitioned to REVIEW (session=%s, pr=%s)",
                raid.id,
                raid.session_id,
                pr_id or "none",
            )

    async def _on_session_failed(self, event: ActivityEvent) -> None:
        """Handle a session stopped/failed lifecycle event."""
        # Cancel any pending completion evaluation for this session
        pending = self._pending_evaluations.pop(event.session_id, None)
        if pending is not None:
            pending.cancel()

        raid = await self._find_raid_by_session(event.session_id)
        if raid is None:
            return

        await self._handle_failure(raid, reason=f"Session {event.session_status}")

    async def _handle_failure(self, raid: Raid, *, reason: str) -> None:
        """Transition a raid to FAILED when its session crashes or stops."""
        chronicle_summary = None
        if self._config.chronicle_on_complete and raid.session_id:
            try:
                chronicle_summary = await self._volundr.get_chronicle_summary(raid.session_id)
            except Exception:
                logger.warning("Failed to fetch chronicle for session %s", raid.session_id)

        updated = await self._raid_repo.update_raid_completion(
            raid.id,
            status=RaidStatus.FAILED,
            chronicle_summary=chronicle_summary,
            reason=reason,
            increment_retry=True,
        )

        if updated:
            await self._emit_state_changed(updated)
            logger.info(
                "Raid %s transitioned to FAILED (session=%s, reason=%s)",
                raid.id,
                raid.session_id,
                reason,
            )

    async def _emit_state_changed(self, raid: Raid) -> None:
        """Emit a raid.state_changed event via the event bus."""
        await self._event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid.id),
                    "status": raid.status.value,
                    "session_id": raid.session_id,
                    "pr_url": raid.pr_url,
                    "pr_id": raid.pr_id,
                },
            )
        )
