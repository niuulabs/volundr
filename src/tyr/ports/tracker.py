"""Tracker port — interface for issue/work-item tracking systems."""

from __future__ import annotations

from abc import ABC, abstractmethod

from tyr.domain.models import Phase, Raid, RaidStatus, Saga


class TrackerPort(ABC):
    """Abstract interface for tracker integration (Linear, Jira, etc.)."""

    @abstractmethod
    async def create_saga(self, saga: Saga) -> str: ...

    @abstractmethod
    async def create_phase(self, phase: Phase) -> str: ...

    @abstractmethod
    async def create_raid(self, raid: Raid) -> str: ...

    @abstractmethod
    async def update_raid_state(self, raid_id: str, state: RaidStatus) -> None: ...

    @abstractmethod
    async def close_raid(self, raid_id: str) -> None: ...

    @abstractmethod
    async def get_saga(self, saga_id: str) -> Saga: ...

    @abstractmethod
    async def list_pending_raids(self, phase_id: str) -> list[Raid]: ...
