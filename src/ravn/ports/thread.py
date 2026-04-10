"""Thread port — interface for thread persistence backends (NIU-555)."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ravn.domain.thread import RavnThread


class ThreadPort(ABC):
    """Abstract interface for thread storage and retrieval.

    Implementations persist :class:`~ravn.domain.thread.RavnThread` records
    and expose the weighted work queue consumed by the Vaka tick loop.
    """

    @abstractmethod
    async def upsert(self, thread: RavnThread) -> None:
        """Insert or update a thread record.

        Uses ``thread_id`` as the primary key.  All fields are overwritten on
        conflict so that weight updates propagate correctly.
        """
        ...

    @abstractmethod
    async def get(self, thread_id: str) -> RavnThread | None:
        """Return the thread with the given *thread_id*, or ``None``."""
        ...

    @abstractmethod
    async def get_by_path(self, page_path: str) -> RavnThread | None:
        """Return the open thread whose ``page_path`` matches, or ``None``."""
        ...

    @abstractmethod
    async def peek_queue(self, *, limit: int = 10) -> list[RavnThread]:
        """Return the top *limit* open threads ordered by weight descending.

        Does **not** dequeue; callers read-only.  Used by the Vaka tick loop
        in M2 to decide what to work on next.
        """
        ...

    @abstractmethod
    async def list_open(self, *, limit: int = 100) -> list[RavnThread]:
        """Return up to *limit* open threads, newest first."""
        ...

    @abstractmethod
    async def close(self, thread_id: str) -> None:
        """Mark a thread as closed (resolved / no longer relevant)."""
        ...

    @abstractmethod
    async def update_weight(self, thread_id: str, weight: float) -> None:
        """Update the composite weight for *thread_id*."""
        ...
