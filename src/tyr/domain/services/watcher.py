"""Raid completion watcher — background task that polls dispatched sessions.

Tyr is the active party: it polls Volundr's session API, detects when a session
has completed or failed, and transitions the corresponding raid accordingly.
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
from tyr.ports.volundr import VolundrPort, VolundrSession

logger = logging.getLogger(__name__)

_COMPLETED_STATUSES = frozenset({"completed", "stopped"})
_FAILED_STATUSES = frozenset({"failed"})


@dataclass(frozen=True)
class WatcherStats:
    """Snapshot of watcher activity for a single poll cycle."""

    checked: int = 0
    transitioned: int = 0
    errors: int = 0


class RaidWatcher:
    """Background task that polls RUNNING raids for session completion."""

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

    @property
    def running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start the watcher background loop."""
        if not self._config.enabled:
            logger.info("Raid watcher disabled by configuration")
            return

        self._running = True
        self._task = asyncio.create_task(self._run(), name="raid-watcher")
        logger.info(
            "Raid watcher started (poll_interval=%.1fs, batch_size=%d)",
            self._config.poll_interval,
            self._config.batch_size,
        )

    async def stop(self) -> None:
        """Gracefully stop the watcher."""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Raid watcher stopped")

    async def _run(self) -> None:
        """Main loop — poll RUNNING raids, detect completion, transition state."""
        while self._running:
            try:
                await self._poll_cycle()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Watcher poll cycle failed")
            await asyncio.sleep(self._config.poll_interval)

    async def _poll_cycle(self) -> WatcherStats:
        """Execute one poll cycle over all RUNNING raids."""
        running_raids = await self._raid_repo.list_by_status(RaidStatus.RUNNING)
        if not running_raids:
            return WatcherStats()

        # Filter out raids whose owner has paused the dispatcher
        active_raids = await self._filter_paused_owners(running_raids)
        if not active_raids:
            return WatcherStats()

        semaphore = asyncio.Semaphore(self._config.batch_size)

        async def _check_with_semaphore(raid: Raid) -> bool:
            async with semaphore:
                return await self._check_raid(raid)

        results = await asyncio.gather(
            *[_check_with_semaphore(r) for r in active_raids],
            return_exceptions=True,
        )

        checked = len(active_raids)
        transitioned = 0
        errors = 0
        for result in results:
            if isinstance(result, Exception):
                errors += 1
                logger.error("Error checking raid: %s", result)
            elif result:
                transitioned += 1

        stats = WatcherStats(checked=checked, transitioned=transitioned, errors=errors)
        if transitioned:
            logger.info(
                "Watcher cycle: checked=%d transitioned=%d errors=%d",
                stats.checked,
                stats.transitioned,
                stats.errors,
            )
        return stats

    async def _filter_paused_owners(self, raids: list[Raid]) -> list[Raid]:
        """Remove raids whose owner has paused the dispatcher.

        Resolves the owning saga for each raid, then checks that owner's
        dispatcher state. Results are cached per owner within a single cycle.
        """
        cache: dict[str, bool] = {}
        active: list[Raid] = []

        for raid in raids:
            saga = await self._raid_repo.get_saga_for_raid(raid.id)
            if saga is None:
                active.append(raid)
                continue

            owner_id = saga.owner_id
            if owner_id not in cache:
                state = await self._dispatcher_repo.get_or_create(owner_id)
                cache[owner_id] = state.running

            if cache[owner_id]:
                active.append(raid)

        return active

    async def _check_raid(self, raid: Raid) -> bool:
        """Check a single raid's session and transition if complete.

        Returns True if a state transition occurred.
        """
        if not raid.session_id:
            return False

        session = await self._volundr.get_session(raid.session_id)
        if session is None:
            logger.warning("Session %s not found for raid %s", raid.session_id, raid.id)
            return False

        if session.status in _COMPLETED_STATUSES:
            await self._handle_completion(raid, session)
            return True

        if session.status in _FAILED_STATUSES:
            await self._handle_failure(raid, session)
            return True

        return False

    async def _handle_completion(self, raid: Raid, session: VolundrSession) -> None:
        """Transition a raid to REVIEW on session completion."""
        chronicle_summary = None
        if self._config.chronicle_on_complete:
            try:
                chronicle_summary = await self._volundr.get_chronicle_summary(raid.session_id)
            except Exception:
                logger.warning("Failed to fetch chronicle for session %s", raid.session_id)

        # Attempt to get PR info
        pr_url: str | None = None
        pr_id: str | None = None
        try:
            pr_status = await self._volundr.get_pr_status(raid.session_id)
            if pr_status.pr_id:
                pr_id = pr_status.pr_id
                pr_url = pr_status.url
        except Exception:
            logger.debug("No PR found for session %s", raid.session_id)

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

    async def _handle_failure(self, raid: Raid, session: VolundrSession) -> None:
        """Transition a raid to FAILED on session failure."""
        chronicle_summary = None
        if self._config.chronicle_on_complete:
            try:
                chronicle_summary = await self._volundr.get_chronicle_summary(raid.session_id)
            except Exception:
                logger.warning("Failed to fetch chronicle for session %s", raid.session_id)

        updated = await self._raid_repo.update_raid_completion(
            raid.id,
            status=RaidStatus.FAILED,
            chronicle_summary=chronicle_summary,
            reason=f"Session {session.status}",
            increment_retry=True,
        )

        if updated:
            await self._emit_state_changed(updated)
            logger.info(
                "Raid %s transitioned to FAILED (session=%s)",
                raid.id,
                raid.session_id,
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
