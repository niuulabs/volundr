"""Tracker port — Tyr-specific extension of the shared TrackerPort.

Adds saga/phase/raid CRUD operations on top of the shared browsing and
issue management interface from niuu.
"""

from __future__ import annotations

from abc import abstractmethod

from niuu.ports.tracker import TrackerPort as _NiuuTrackerPort
from tyr.domain.models import (
    Phase,
    Raid,
    RaidStatus,
    Saga,
)


class TrackerPort(_NiuuTrackerPort):
    """Tyr tracker port — extends the shared TrackerPort with saga CRUD."""

    # -- CRUD: create entities in the external tracker --

    @abstractmethod
    async def create_saga(self, saga: Saga) -> str: ...

    @abstractmethod
    async def create_phase(self, phase: Phase) -> str: ...

    @abstractmethod
    async def create_raid(self, raid: Raid) -> str: ...

    # -- CRUD: update / close --

    @abstractmethod
    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None: ...

    @abstractmethod
    async def close_raid(self, raid_id: str) -> None: ...

    # -- Read: fetch domain entities by tracker ID --

    @abstractmethod
    async def get_saga(self, saga_id: str) -> Saga: ...

    @abstractmethod
    async def get_phase(self, tracker_id: str) -> Phase: ...

    @abstractmethod
    async def get_raid(self, tracker_id: str) -> Raid: ...

    @abstractmethod
    async def list_pending_raids(self, phase_id: str) -> list[Raid]: ...
