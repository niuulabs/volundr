"""Tests for the shared TrackerPort interface."""

from __future__ import annotations

import pytest

from niuu.domain.models import (
    TrackerConnectionStatus,
    TrackerIssue,
)
from niuu.ports.tracker import TrackerPort


class TestTrackerPortAbstract:
    def test_cannot_instantiate(self):
        """TrackerPort is abstract and cannot be instantiated directly."""
        with pytest.raises(TypeError):
            TrackerPort()  # type: ignore[abstract]

    def test_has_required_abstract_methods(self):
        expected = {
            "provider_name",
            "check_connection",
            "search_issues",
            "get_recent_issues",
            "get_issue",
            "update_issue_status",
        }
        actual = set(TrackerPort.__abstractmethods__)
        assert actual == expected

    def test_browsing_methods_have_defaults(self):
        """Browsing methods should NOT be abstract — they have defaults."""
        for method_name in (
            "list_projects",
            "get_project",
            "list_milestones",
            "list_issues",
        ):
            assert method_name not in TrackerPort.__abstractmethods__


class ConcreteTracker(TrackerPort):
    """Minimal concrete implementation for contract testing."""

    @property
    def provider_name(self) -> str:
        return "test"

    async def check_connection(self) -> TrackerConnectionStatus:
        return TrackerConnectionStatus(connected=True, provider="test")

    async def search_issues(self, query: str, project_id: str | None = None) -> list[TrackerIssue]:
        return []

    async def get_recent_issues(self, project_id: str, limit: int = 10) -> list[TrackerIssue]:
        return []

    async def get_issue(self, issue_id: str) -> TrackerIssue | None:
        return None

    async def update_issue_status(self, issue_id: str, status: str) -> TrackerIssue:
        return TrackerIssue(id=issue_id, identifier="T-1", title="t", status=status)


class TestConcreteTracker:
    def test_can_instantiate(self):
        tracker = ConcreteTracker()
        assert isinstance(tracker, TrackerPort)

    def test_provider_name(self):
        tracker = ConcreteTracker()
        assert tracker.provider_name == "test"

    async def test_check_connection(self):
        tracker = ConcreteTracker()
        result = await tracker.check_connection()
        assert result.connected is True
        assert result.provider == "test"

    async def test_search_issues(self):
        tracker = ConcreteTracker()
        result = await tracker.search_issues("query")
        assert result == []

    async def test_get_issue(self):
        tracker = ConcreteTracker()
        result = await tracker.get_issue("id-1")
        assert result is None

    async def test_update_issue_status(self):
        tracker = ConcreteTracker()
        result = await tracker.update_issue_status("id-1", "Done")
        assert result.status == "Done"

    async def test_default_list_projects(self):
        tracker = ConcreteTracker()
        result = await tracker.list_projects()
        assert result == []

    async def test_default_get_project_raises(self):
        tracker = ConcreteTracker()
        with pytest.raises(NotImplementedError):
            await tracker.get_project("proj-1")

    async def test_default_list_milestones(self):
        tracker = ConcreteTracker()
        result = await tracker.list_milestones("proj-1")
        assert result == []

    async def test_default_list_issues(self):
        tracker = ConcreteTracker()
        result = await tracker.list_issues("proj-1")
        assert result == []
