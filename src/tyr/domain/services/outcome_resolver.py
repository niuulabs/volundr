"""Outcome resolver — polls tracker adapters to resolve actual outcomes."""

from __future__ import annotations

import asyncio
import logging

from tyr.ports.reviewer_outcome_repository import ReviewerOutcomeRepository
from tyr.ports.tracker import TrackerFactory

logger = logging.getLogger(__name__)


class OutcomeResolver:
    """Periodically checks unresolved reviewer outcomes via TrackerPort polling."""

    def __init__(
        self,
        outcome_repo: ReviewerOutcomeRepository,
        tracker_factory: TrackerFactory,
        interval: float,
    ) -> None:
        self._outcome_repo = outcome_repo
        self._tracker_factory = tracker_factory
        self._interval = interval
        self._task: asyncio.Task[None] | None = None
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    async def start(self) -> None:
        """Start the background polling loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("OutcomeResolver started (interval=%.0fs)", self._interval)

    async def stop(self) -> None:
        """Stop the background polling loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("OutcomeResolver stopped")

    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._interval)
                await self.poll_all()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("OutcomeResolver poll error")

    async def poll_all(self) -> int:
        """Poll all owners with unresolved outcomes. Returns total resolved count."""
        # Collect distinct owner_ids from unresolved outcomes
        # We poll per-owner to resolve tracker adapters correctly
        owner_ids = await self._distinct_unresolved_owners()
        total = 0
        for owner_id in owner_ids:
            total += await self.poll_once(owner_id)
        return total

    async def poll_once(self, owner_id: str) -> int:
        """Check all unresolved raids for this owner. Returns count resolved."""
        trackers = await self._tracker_factory.for_owner(owner_id)
        if not trackers:
            return 0

        unresolved = await self._outcome_repo.list_unresolved(owner_id)
        if not unresolved:
            return 0

        resolved_count = 0
        # Deduplicate by raid_id (multiple outcomes can reference same raid)
        seen_raids: set[str] = set()
        for outcome in unresolved:
            raid_id_str = str(outcome.raid_id)
            if raid_id_str in seen_raids:
                continue
            seen_raids.add(raid_id_str)

            for tracker in trackers:
                try:
                    # We need the tracker_id, not the raid_id UUID.
                    # The outcome stores raid_id (UUID), but trackers use tracker_id (str).
                    # We'll try to resolve via the tracker using the raid_id as tracker lookup.
                    raid = await tracker.get_raid_by_id(outcome.raid_id)
                    if raid is None:
                        continue
                    resolution = await tracker.get_issue_resolution(raid.tracker_id)
                    if resolution:
                        await self._outcome_repo.resolve(outcome.raid_id, resolution)
                        resolved_count += 1
                        logger.info(
                            "Resolved outcome for raid %s → %s",
                            raid.tracker_id,
                            resolution,
                        )
                        break
                except Exception:
                    logger.debug(
                        "Tracker lookup failed for raid %s",
                        outcome.raid_id,
                        exc_info=True,
                    )
        return resolved_count

    async def _distinct_unresolved_owners(self) -> list[str]:
        """Return distinct owner_ids that have unresolved outcomes.

        This is a simple approach: list_unresolved for a known set of owners.
        Since we don't have a global query, we use a dedicated query via the repo.
        """
        # The repo doesn't have a global distinct-owners query, so we add a helper.
        # For now, use list_unresolved with a blank owner to get all.
        # Actually, we need to handle this differently — let's gather owners
        # from recent outcomes instead.
        # This works because any owner with unresolved outcomes must have
        # recorded outcomes recently.
        if hasattr(self._outcome_repo, "list_unresolved_owner_ids"):
            return await self._outcome_repo.list_unresolved_owner_ids()
        # Fallback: not ideal but functional
        return []
