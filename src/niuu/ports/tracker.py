"""Unified tracker port — shared interface for issue/work-item tracking systems.

Combines project browsing (list projects, milestones, issues) with issue
search and status management.  Both Volundr and Tyr import this port.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from niuu.domain.models import (
    TrackerConnectionStatus,
    TrackerIssue,
    TrackerMilestone,
    TrackerProject,
)


class TrackerPort(ABC):
    """Unified tracker port for project browsing and issue management.

    Core methods (search, get, update) are abstract.  Project-hierarchy
    browsing methods have default implementations so that adapters which
    only support issue search (e.g. Jira) are not forced to implement them.
    """

    # -- Identity / health ------------------------------------------------

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the name of this provider (e.g. 'linear', 'jira')."""

    @abstractmethod
    async def check_connection(self) -> TrackerConnectionStatus:
        """Check the connection status to the issue tracker."""

    # -- Issue operations (required) --------------------------------------

    @abstractmethod
    async def search_issues(
        self,
        query: str,
        project_id: str | None = None,
    ) -> list[TrackerIssue]:
        """Search issues by query string."""

    @abstractmethod
    async def get_recent_issues(
        self,
        project_id: str,
        limit: int = 10,
    ) -> list[TrackerIssue]:
        """Get recent issues for a project."""

    @abstractmethod
    async def get_issue(self, issue_id: str) -> TrackerIssue | None:
        """Get a single issue by ID or identifier."""

    @abstractmethod
    async def update_issue_status(
        self,
        issue_id: str,
        status: str,
    ) -> TrackerIssue:
        """Update the status of an issue."""

    # -- Project browsing (optional — defaults return empty) ---------------

    async def list_projects(self) -> list[TrackerProject]:
        """List all projects.  Override for full browsing support."""
        return []

    async def get_project(self, project_id: str) -> TrackerProject:
        """Get a single project by ID."""
        raise NotImplementedError(f"{type(self).__name__} does not support get_project")

    async def list_milestones(self, project_id: str) -> list[TrackerMilestone]:
        """List milestones for a project."""
        return []

    async def list_issues(
        self,
        project_id: str,
        milestone_id: str | None = None,
    ) -> list[TrackerIssue]:
        """List issues for a project, optionally filtered by milestone."""
        return []
