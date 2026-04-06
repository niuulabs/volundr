"""Key vault port — abstract interface for provider API key management.

Provider API keys must never be stored in agent configs or returned in
responses.  They are held exclusively by the vault, which is the single
source of truth for all outbound provider credentials.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class KeyVaultPort(ABC):
    """Abstract interface for reading and rotating provider API keys."""

    @abstractmethod
    def get_key(self, provider: str) -> str | None:
        """Return the API key for *provider*, or ``None`` if not configured.

        Implementors MUST ensure the returned value is never written to
        logs, response bodies, or any external system.
        """

    @abstractmethod
    def reload(self) -> None:
        """Reload all keys from their source (env vars, secrets file, etc.).

        Safe to call at runtime — e.g. from a SIGHUP handler or an admin
        endpoint — without restarting the process.
        """
