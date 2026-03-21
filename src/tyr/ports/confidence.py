"""Confidence port — interface for raid confidence scoring."""

from __future__ import annotations

from abc import ABC, abstractmethod

from tyr.domain.models import ConfidenceEvent, Raid


class ConfidencePort(ABC):
    """Abstract interface for confidence score management."""

    @abstractmethod
    async def score_initial(self, raid: Raid) -> float: ...

    @abstractmethod
    async def update_score(self, raid_id: str, event: ConfidenceEvent) -> float: ...

    @abstractmethod
    async def get_score(self, raid_id: str) -> float: ...
