"""MimirSourceTrigger — enqueues synthesis tasks for unprocessed raw sources.

Polls the Mímir adapter for raw sources that have been ingested but not yet
referenced in any wiki page.  For each unprocessed source, a synthesis task
is enqueued for the mimir-curator persona.

Implements ``TriggerPort`` (``ravn.ports.trigger``).

TODO (dynamic trigger loading): This trigger should eventually be loadable
from config YAML using the same fully-qualified class path pattern as adapters:

    mimir:
      triggers:
        - trigger: "ravn.adapters.triggers.mimir_source.MimirSourceTrigger"
          poll_interval_seconds: 60

See ``rules/dynamic-adapters.md`` for the pattern.  Until dynamic loading is
implemented, this trigger is wired explicitly in ``cli/commands.py``.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from niuu.ports.mimir import MimirPort
from ravn.config import MimirSourceTriggerConfig
from ravn.domain.models import AgentTask, OutputMode

logger = logging.getLogger(__name__)


class MimirSourceTrigger:
    """TriggerPort implementation that synthesises unprocessed Mímir sources.

    Args:
        mimir:  The Mímir adapter to poll for unprocessed sources.
        config: Source trigger configuration (poll interval, persona).
    """

    def __init__(self, mimir: MimirPort, config: MimirSourceTriggerConfig) -> None:
        self._mimir = mimir
        self._config = config
        self._enqueued: set[str] = set()

    @property
    def name(self) -> str:
        return "mimir_source"

    async def run(
        self,
        enqueue: Callable[[AgentTask], Awaitable[None]],
    ) -> None:
        """Poll loop — runs until cancelled by the DriveLoop."""
        logger.info(
            "MimirSourceTrigger: starting (poll_interval=%ds, persona=%s)",
            self._config.poll_interval_seconds,
            self._config.persona,
        )

        while True:
            try:
                await self._poll_once(enqueue)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("MimirSourceTrigger: poll error: %s", exc)

            await asyncio.sleep(self._config.poll_interval_seconds)

    async def _poll_once(
        self,
        enqueue: Callable[[AgentTask], Awaitable[None]],
    ) -> None:
        sources = await self._mimir.list_sources(unprocessed_only=True)
        for src in sources:
            if src.source_id in self._enqueued:
                continue
            self._enqueued.add(src.source_id)

            context = (
                f"A new raw source has been ingested into Mímir and requires synthesis.\n\n"
                f"Source ID: {src.source_id}\n"
                f"Title: {src.title}\n"
                f"Type: {src.source_type}\n"
                f"Ingested: {src.ingested_at.isoformat()}\n\n"
                f"Follow the synthesis workflow in MIMIR.md:\n"
                f"1. Call mimir_query on the source topic to check for existing pages.\n"
                f"2. Call mimir_ingest is already done (source_id: {src.source_id}).\n"
                f"3. Read the source via the raw/ directory and synthesise wiki pages.\n"
                f"4. Optionally run targeted web searches if recency matters.\n"
                f"5. Write pages with mimir_write, cross-link, update log."
            )

            task_id = f"task_{int(time.time() * 1000):x}_{src.source_id[:8]}"
            task = AgentTask(
                task_id=task_id,
                title=f"Synthesise Mímir source: {src.title}",
                initiative_context=context,
                triggered_by=self.name,
                output_mode=OutputMode.SILENT,
                persona=self._config.persona,
                priority=8,
            )
            logger.info(
                "MimirSourceTrigger: enqueuing synthesis for source %r (%s)",
                src.source_id,
                src.title,
            )
            await enqueue(task)
