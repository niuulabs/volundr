"""ThreadQueueTrigger — feeds open threads into the Vaka drive loop (NIU-555).

This trigger reads the weighted work queue from :class:`~ravn.ports.thread.ThreadPort`
and enqueues the highest-priority threads as :class:`~ravn.domain.models.AgentTask`
objects for the drive loop to process.

In **M1** (this milestone) the trigger exists but the drive loop does not
activate autonomous ticks — it only runs on operator input.  The trigger is
wired into the initiative config so that M2 can enable it by flipping
``initiative.enabled = true`` without any code changes.

The trigger runs on a configurable interval.  Each cycle it:

1. Calls :meth:`~ravn.ports.thread.ThreadPort.peek_queue` to get the top-N
   open threads by weight.
2. Closes threads whose composite weight has decayed below ``weight_floor``.
3. Enqueues the surviving threads as ``AgentTask`` objects.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from ravn.domain.models import AgentTask, OutputMode
from ravn.domain.thread import compute_weight
from ravn.ports.thread import ThreadPort
from ravn.ports.trigger import TriggerPort

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL_SECONDS = 300.0
_DEFAULT_BATCH_SIZE = 10
_DEFAULT_WEIGHT_FLOOR = 0.05
_DEFAULT_HALF_LIFE_DAYS = 7.0


class ThreadQueueTrigger(TriggerPort):
    """Drive-loop trigger that surfaces threads from the work queue.

    Parameters
    ----------
    thread_store:
        :class:`~ravn.ports.thread.ThreadPort` backing the queue.
    interval_seconds:
        Seconds between queue sweeps.
    batch_size:
        Maximum threads enqueued per cycle.
    weight_floor:
        Threads with composite weight below this value are closed automatically.
    half_life_days:
        Used to recompute current weight for decay-floor checks.
    """

    def __init__(
        self,
        thread_store: ThreadPort,
        *,
        interval_seconds: float = _DEFAULT_INTERVAL_SECONDS,
        batch_size: int = _DEFAULT_BATCH_SIZE,
        weight_floor: float = _DEFAULT_WEIGHT_FLOOR,
        half_life_days: float = _DEFAULT_HALF_LIFE_DAYS,
    ) -> None:
        self._store = thread_store
        self._interval = interval_seconds
        self._batch = batch_size
        self._floor = weight_floor
        self._half_life = half_life_days

    @property
    def name(self) -> str:
        return "thread_queue"

    async def run(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        """Run forever.  Sweeps the thread queue every *interval_seconds*."""
        while True:
            await asyncio.sleep(self._interval)
            await self._sweep(enqueue)

    async def _sweep(self, enqueue: Callable[[AgentTask], Awaitable[None]]) -> None:
        """One queue sweep: recompute weights, prune decayed threads, enqueue rest."""
        try:
            threads = await self._store.peek_queue(limit=self._batch)
        except Exception:
            logger.warning("ThreadQueueTrigger: queue peek failed", exc_info=True)
            return

        now = datetime.now(UTC)
        for thread in threads:
            tw = compute_weight(
                base_score=thread.weight,
                importance_factor=1.0,
                created_at=thread.created_at,
                half_life_days=self._half_life,
                reference_time=now,
            )
            if tw.composite < self._floor:
                await self._store.close(thread.thread_id)
                logger.info(
                    "ThreadQueueTrigger: auto-closed decayed thread %s (weight=%.4f)",
                    thread.thread_id,
                    tw.composite,
                )
                continue

            await self._store.update_weight(thread.thread_id, tw.composite)
            task_id = f"task_{int(time.time() * 1000):x}_thread_{thread.thread_id[:8]}"
            task = AgentTask(
                task_id=task_id,
                title=f"Thread follow-up: {thread.title}",
                initiative_context=(
                    f"Thread follow-up: {thread.title}\n"
                    f"Page: {thread.page_path}\n"
                    f"Action: {thread.next_action}"
                ),
                triggered_by=self.name,
                output_mode=OutputMode.SILENT,
            )
            await enqueue(task)
            logger.debug(
                "ThreadQueueTrigger: enqueued thread %s (weight=%.4f)",
                thread.thread_id,
                tw.composite,
            )
