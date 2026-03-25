"""Volundr port — interface for session lifecycle management."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass

from tyr.domain.models import PRStatus


@dataclass(frozen=True)
class SpawnRequest:
    """Everything needed to spawn a Volundr session for a raid."""

    name: str
    repo: str
    branch: str
    model: str
    tracker_issue_id: str
    tracker_issue_url: str
    system_prompt: str
    initial_prompt: str
    base_branch: str = "main"


@dataclass(frozen=True)
class VolundrSession:
    """Minimal session info returned from Volundr."""

    id: str
    name: str
    status: str
    tracker_issue_id: str | None


@dataclass(frozen=True)
class ActivityEvent:
    """An activity or session lifecycle event received from Volundr SSE.

    For activity events: state is "active"/"idle"/"tool_executing", session_status is empty.
    For session lifecycle events: session_status is "stopped"/"failed"/etc., state is empty.
    """

    session_id: str
    state: str
    metadata: dict
    owner_id: str
    session_status: str = ""


class VolundrPort(ABC):
    """Abstract interface for Volundr session management."""

    @abstractmethod
    async def spawn_session(
        self,
        request: SpawnRequest,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession: ...

    @abstractmethod
    async def get_session(
        self,
        session_id: str,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession | None: ...

    @abstractmethod
    async def list_sessions(
        self,
        *,
        auth_token: str | None = None,
    ) -> list[VolundrSession]: ...

    @abstractmethod
    async def get_pr_status(self, session_id: str) -> PRStatus: ...

    @abstractmethod
    async def get_chronicle_summary(self, session_id: str) -> str: ...

    @abstractmethod
    async def send_message(
        self,
        session_id: str,
        message: str,
        *,
        auth_token: str | None = None,
    ) -> None:
        """Send a human message to a running Volundr session."""
        ...

    @abstractmethod
    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        """Subscribe to the Volundr SSE stream for session_activity events."""
        ...
        yield  # type: ignore[misc]  # pragma: no cover
