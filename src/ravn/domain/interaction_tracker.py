"""LastInteractionTracker — thin shared object for tracking operator activity.

Created once in daemon setup and passed to both the CLI interactive handler
and the WakefulnessTrigger.  The CLI calls ``touch()`` on every operator
message; the trigger reads ``last()`` to detect silence.
"""

from __future__ import annotations

import threading
from datetime import UTC, datetime


class LastInteractionTracker:
    """Thread-safe tracker for the most recent operator interaction timestamp.

    All methods are safe to call from any thread or asyncio task — internal
    state is protected by a :class:`threading.Lock`.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_interaction: datetime | None = None

    def touch(self) -> None:
        """Record the current UTC time as the most recent interaction."""
        with self._lock:
            self._last_interaction = datetime.now(UTC)

    def last(self) -> datetime | None:
        """Return the timestamp of the last interaction, or ``None`` if never touched."""
        with self._lock:
            return self._last_interaction
