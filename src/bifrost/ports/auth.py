"""Authentication port — abstract interface for agent identity extraction."""

from __future__ import annotations

from abc import ABC, abstractmethod

from fastapi import Request

from bifrost.auth import AgentIdentity


class AuthPort(ABC):
    """Extract a verified ``AgentIdentity`` from an incoming HTTP request."""

    @abstractmethod
    def extract(self, request: Request) -> AgentIdentity:
        """Return the caller's verified identity.

        Raises:
            HTTPException(401): When the request cannot be authenticated.
        """
