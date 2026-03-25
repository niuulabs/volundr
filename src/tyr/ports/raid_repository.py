"""Raid repository port — persistence for raid state in the local DB."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from tyr.domain.models import ConfidenceEvent, Phase, Raid, RaidStatus, Saga


class RaidRepository(ABC):
    """Abstract persistence for raids and their confidence history."""

    @abstractmethod
    async def save_phase(self, phase: Phase, *, conn: Any | None = None) -> None:
        """Persist a new phase. Uses *conn* when inside a transaction."""
        ...

    @abstractmethod
    async def save_raid(self, raid: Raid, *, conn: Any | None = None) -> None:
        """Persist a new raid. Uses *conn* when inside a transaction."""
        ...

    @abstractmethod
    async def get_raid(self, raid_id: UUID) -> Raid | None:
        """Get a raid by its internal UUID."""
        ...

    @abstractmethod
    async def update_raid_status(
        self,
        raid_id: UUID,
        status: RaidStatus,
        *,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        """Update raid status (and optionally reason / retry_count). Returns updated raid."""
        ...

    @abstractmethod
    async def get_confidence_events(self, raid_id: UUID) -> list[ConfidenceEvent]:
        """Return all confidence events for a raid, ordered by created_at."""
        ...

    @abstractmethod
    async def add_confidence_event(self, event: ConfidenceEvent) -> None:
        """Persist a new confidence event and update the raid's confidence score."""
        ...

    @abstractmethod
    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        """Find a raid by its external tracker ID (e.g. NIU-221)."""
        ...

    @abstractmethod
    async def get_owner_for_raid(self, raid_id: UUID) -> str | None:
        """Resolve the owner_id for a raid (raid → phase → saga → owner_id)."""
        ...

    @abstractmethod
    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        """Resolve the parent saga for a given raid (raid -> phase -> saga)."""
        ...

    @abstractmethod
    async def get_phase_for_raid(self, raid_id: UUID) -> Phase | None:
        """Resolve the parent phase for a given raid."""
        ...

    @abstractmethod
    async def list_by_status(self, status: RaidStatus) -> list[Raid]:
        """Fetch all raids in a given state."""
        ...

    @abstractmethod
    async def update_raid_completion(
        self,
        raid_id: UUID,
        *,
        status: RaidStatus,
        chronicle_summary: str | None = None,
        pr_url: str | None = None,
        pr_id: str | None = None,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        """Update raid on completion detection — sets status plus optional fields."""
        ...

    @abstractmethod
    async def all_raids_merged(self, phase_id: UUID) -> bool:
        """Check whether every raid in the phase has status MERGED."""
        ...
