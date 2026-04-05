"""Permission port — interface for tool execution authorization."""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum


class PermissionMode(StrEnum):
    """Built-in permission modes."""

    ALLOW_ALL = "allow_all"
    DENY_ALL = "deny_all"
    PROMPT = "prompt"


class PermissionPort(ABC):
    """Abstract interface for checking tool execution permissions."""

    @abstractmethod
    async def check(self, permission: str) -> bool:
        """Return True if the given permission is granted, False to deny."""
        ...
