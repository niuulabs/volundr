"""Port interface for read-only git provider operations."""

from __future__ import annotations

from abc import ABC, abstractmethod

from niuu.domain.models import GitProviderType, RepoInfo


class GitProvider(ABC):
    """Port for read-only git repository operations.

    Each instance represents a single git provider endpoint (e.g., github.com,
    gitlab.com, or a self-hosted GitLab instance). Multiple instances can be
    registered to support multiple providers/instances simultaneously.

    Write operations (create_branch, merge, PRs) live in the extended
    GitWorkflowProvider port in Volundr.
    """

    @property
    @abstractmethod
    def provider_type(self) -> GitProviderType:
        """Return the type of this git provider."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Return a human-readable name for this provider instance.

        Examples: 'GitHub', 'GitLab', 'GitLab (self-hosted)'
        """

    @property
    @abstractmethod
    def base_url(self) -> str:
        """Return the base URL for this provider instance."""

    @abstractmethod
    async def list_repos(self, org: str) -> list[RepoInfo]:
        """List all repositories in an organization/group.

        Args:
            org: Organization or group name.

        Returns:
            List of repositories in the organization.
        """

    @abstractmethod
    async def list_branches(self, repo_url: str) -> list[str]:
        """List all branches for a specific repository.

        Args:
            repo_url: Repository URL or shorthand.

        Returns:
            List of branch names.
        """
