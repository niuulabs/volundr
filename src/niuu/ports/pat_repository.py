"""Port for personal access token persistence operations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from niuu.domain.models import PersonalAccessToken


class PATRepository(ABC):
    """Port for personal access token persistence operations."""

    @abstractmethod
    async def create(self, owner_id: str, name: str, token_hash: str) -> PersonalAccessToken:
        """Persist a new PAT record."""

    @abstractmethod
    async def list(self, owner_id: str) -> list[PersonalAccessToken]:
        """List all PATs for an owner."""

    @abstractmethod
    async def get(self, pat_id: UUID, owner_id: str) -> PersonalAccessToken | None:
        """Retrieve a PAT by ID scoped to an owner."""

    @abstractmethod
    async def delete(self, pat_id: UUID, owner_id: str) -> bool:
        """Delete a PAT. Returns True if deleted."""
