"""Raid repository port — persistence for raid state in the local DB."""

from __future__ import annotations

from abc import ABC, abstractmethod
from uuid import UUID

from tyr.domain.models import ConfidenceEvent, Phase, Raid, RaidStatus, Saga


class RaidRepository(ABC):
    """Abstract persistence for raids and their confidence history."""

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

    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        """Find a raid by its external tracker ID (e.g. NIU-221).

        Default returns None; adapters with tracker-id indexing should override.
        """
        return None

    @abstractmethod
    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        """Resolve the parent saga for a given raid (raid -> phase -> saga)."""
        ...

    @abstractmethod
    async def get_phase_for_raid(self, raid_id: UUID) -> Phase | None:
        """Resolve the parent phase for a given raid."""
        ...

    @abstractmethod
    async def all_raids_merged(self, phase_id: UUID) -> bool:
        """Check whether every raid in the phase has status MERGED."""
        ...
