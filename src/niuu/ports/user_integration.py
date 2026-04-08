"""Port for user-scoped integration lookups.

This port is defined in niuu so that `RepoService` can accept a
user-integration dependency without importing from volundr.
Volundr's `UserIntegrationService` satisfies this interface.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from niuu.ports.git import GitProvider


class UserIntegrationPort(ABC):
    """Port for user-scoped git provider lookups."""

    @abstractmethod
    async def get_git_providers(self, user_id: str) -> list[GitProvider]:
        """Return all git providers available to the given user."""

    @abstractmethod
    async def find_git_provider_for(
        self,
        repo_url: str,
        user_id: str,
    ) -> GitProvider | None:
        """Return the first git provider that supports *repo_url* for *user_id*."""
