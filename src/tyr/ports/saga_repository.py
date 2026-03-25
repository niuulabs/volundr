"""Saga repository port — persistence for saga references only.

The tracker (Linear, etc.) is the source of truth for project structure
(milestones, issues, names, statuses). This repo stores only the link
between a tracker project and Tyr's execution context.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from tyr.domain.models import Saga


class SagaRepository(ABC):
    """Abstract persistence for saga references."""

    @abstractmethod
    async def save_saga(self, saga: Saga, *, conn: Any | None = None) -> None:
        """Persist a saga reference. Uses *conn* when inside a transaction."""
        ...

    @abstractmethod
    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        """List all saga references, optionally filtered by owner."""
        ...

    @abstractmethod
    async def get_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> Saga | None:
        """Get a saga by ID, optionally scoped to an owner."""
        ...

    @abstractmethod
    async def get_saga_by_slug(self, slug: str) -> Saga | None:
        """Get a saga by its slug. Returns None if no saga with that slug exists."""
        ...

    @abstractmethod
    async def delete_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> bool:
        """Delete a saga, optionally scoped to an owner. Returns True if deleted."""
        ...

    @asynccontextmanager
    async def begin(self) -> AsyncIterator[Any]:
        """Yield a transactional connection.

        The default implementation yields ``None`` (no-op), suitable for
        in-memory or mock repositories. The Postgres adapter overrides this
        to acquire a real connection and start a transaction.
        """
        yield None
