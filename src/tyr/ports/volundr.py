"""Volundr port — interface for session lifecycle management."""

from __future__ import annotations

from abc import ABC, abstractmethod

from tyr.domain.models import Raid, SessionInfo


class VolundrPort(ABC):
    """Abstract interface for Volundr session management."""

    @abstractmethod
    async def spawn_session(self, raid: Raid, branch: str) -> str: ...

    @abstractmethod
    async def get_session(self, session_id: str) -> SessionInfo: ...

    @abstractmethod
    async def stop_session(self, session_id: str) -> None: ...

    @abstractmethod
    async def get_chronicle_summary(self, session_id: str) -> str: ...
