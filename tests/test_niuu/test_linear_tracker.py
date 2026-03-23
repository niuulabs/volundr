"""Tests for the shared LinearTrackerBase adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest

from niuu.adapters.linear import GraphQLError
from niuu.adapters.linear_tracker import (
    LinearTrackerBase,
    node_to_tracker_issue,
    node_to_tracker_milestone,
    node_to_tracker_project,
    parse_progress,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter() -> LinearTrackerBase:
    return LinearTrackerBase(
        api_key="test-key",
        api_url="https://test.linear.app/graphql",
    )


def _mock_response(json_data: dict, status_code: int = 200):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.raise_for_status = MagicMock()
    return resp


def _issue_node(**overrides) -> dict:
    defaults = {
        "id": str(uuid4()),
        "identifier": "TEST-1",
        "title": "Test Issue",
        "description": "A test issue",
        "state": {"name": "Todo", "type": "unstarted"},
        "assignee": {"name": "Test User"},
        "labels": {"nodes": [{"name": "bug"}]},
        "priority": 2,
        "priorityLabel": "High",
        "estimate": 3.0,
        "url": "https://linear.app/test/issue/TEST-1",
        "projectMilestone": {"id": "ms-1"},
    }
    defaults.update(overrides)
    return defaults


def _project_node(**overrides) -> dict:
    defaults = {
        "id": "proj-1",
        "name": "Test Project",
        "description": "A test project",
        "state": "started",
        "url": "https://linear.app/test/project/proj-1",
        "projectMilestones": {"nodes": [{"id": "ms-1"}, {"id": "ms-2"}]},
        "issues": {"nodes": [{"id": "i-1"}, {"id": "i-2"}]},
    }
    defaults.update(overrides)
    return defaults


def _milestone_node(**overrides) -> dict:
    defaults = {
        "id": "ms-1",
        "name": "Phase 1",
        "description": "First phase",
        "sortOrder": 1,
        "progress": 0.5,
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# parse_progress
# ---------------------------------------------------------------------------


class TestParseProgress:
    def test_none(self):
        assert parse_progress(None) == 0.0

    def test_float(self):
        assert parse_progress(0.75) == 0.0075

    def test_int(self):
        assert parse_progress(1) == 0.01

    def test_percentage_string(self):
        assert parse_progress("50%") == 0.5

    def test_unknown_type(self):
        assert parse_progress([1, 2]) == 0.0


# ---------------------------------------------------------------------------
# Node converters
# ---------------------------------------------------------------------------


class TestNodeToTrackerProject:
    def test_basic(self):
        project = node_to_tracker_project(_project_node())
        assert project.id == "proj-1"
        assert project.name == "Test Project"
        assert project.milestone_count == 2
        assert project.issue_count == 2

    def test_empty_milestones(self):
        project = node_to_tracker_project(_project_node(projectMilestones={"nodes": []}))
        assert project.milestone_count == 0


class TestNodeToTrackerMilestone:
    def test_basic(self):
        milestone = node_to_tracker_milestone(_milestone_node(), "proj-1")
        assert milestone.id == "ms-1"
        assert milestone.name == "Phase 1"
        assert milestone.project_id == "proj-1"
        assert milestone.sort_order == 1


class TestNodeToTrackerIssue:
    def test_full_node(self):
        issue = node_to_tracker_issue(_issue_node())
        assert issue.identifier == "TEST-1"
        assert issue.title == "Test Issue"
        assert issue.status == "Todo"
        assert issue.status_type == "unstarted"
        assert issue.assignee == "Test User"
        assert issue.labels == ["bug"]
        assert issue.priority == 2
        assert issue.priority_label == "High"
        assert issue.estimate == 3.0
        assert issue.milestone_id == "ms-1"

    def test_missing_assignee(self):
        issue = node_to_tracker_issue(_issue_node(assignee=None))
        assert issue.assignee is None

    def test_missing_labels(self):
        issue = node_to_tracker_issue(_issue_node(labels=None))
        assert issue.labels == []

    def test_missing_state(self):
        issue = node_to_tracker_issue(_issue_node(state={}))
        assert issue.status == "Unknown"

    def test_missing_milestone(self):
        issue = node_to_tracker_issue(_issue_node(projectMilestone=None))
        assert issue.milestone_id is None


# ---------------------------------------------------------------------------
# LinearTrackerBase — provider_name
# ---------------------------------------------------------------------------


class TestProviderName:
    def test_returns_linear(self):
        adapter = _make_adapter()
        assert adapter.provider_name == "linear"


# ---------------------------------------------------------------------------
# LinearTrackerBase — check_connection
# ---------------------------------------------------------------------------


class TestCheckConnection:
    async def test_successful(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "viewer": {"id": "1", "name": "Test", "email": "t@t.com"},
                    "organization": {"id": "org1", "name": "TestOrg"},
                }
            }
        )

        result = await adapter.check_connection()
        assert result.connected is True
        assert result.workspace == "TestOrg"
        assert result.user == "Test"

    async def test_cached(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "viewer": {"id": "1", "name": "T", "email": "t@t.com"},
                    "organization": {"id": "o", "name": "Org"},
                }
            }
        )

        await adapter.check_connection()
        result = await adapter.check_connection()
        assert result.connected is True
        assert adapter._gql._client.post.call_count == 1

    async def test_failure(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.side_effect = Exception("Connection refused")

        result = await adapter.check_connection()
        assert result.connected is False


# ---------------------------------------------------------------------------
# LinearTrackerBase — search_issues
# ---------------------------------------------------------------------------


class TestSearchIssues:
    async def test_search(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"searchIssues": {"nodes": [_issue_node()]}}}
        )

        issues = await adapter.search_issues("test")
        assert len(issues) == 1
        assert issues[0].identifier == "TEST-1"

    async def test_search_with_project(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"searchIssues": {"nodes": []}}}
        )

        issues = await adapter.search_issues("test", project_id="proj-1")
        assert len(issues) == 0

        call_args = adapter._gql._client.post.call_args
        payload = call_args[1]["json"]
        assert "project:proj-1" in payload["variables"]["term"]


# ---------------------------------------------------------------------------
# LinearTrackerBase — get_recent_issues
# ---------------------------------------------------------------------------


class TestGetRecentIssues:
    async def test_get_recent(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"issues": {"nodes": [_issue_node(), _issue_node(identifier="TEST-2")]}}}
        )

        issues = await adapter.get_recent_issues("proj-1")
        assert len(issues) == 2


# ---------------------------------------------------------------------------
# LinearTrackerBase — get_issue
# ---------------------------------------------------------------------------


class TestGetIssue:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"issue": _issue_node()}})

        issue = await adapter.get_issue("issue-1")
        assert issue is not None
        assert issue.identifier == "TEST-1"

    async def test_missing(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"issue": None}})

        issue = await adapter.get_issue("nonexistent")
        assert issue is None

    async def test_graphql_error(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"errors": [{"message": "Not found"}]}
        )

        issue = await adapter.get_issue("bad-id")
        assert issue is None


# ---------------------------------------------------------------------------
# LinearTrackerBase — update_issue_status
# ---------------------------------------------------------------------------


class TestUpdateIssueStatus:
    async def test_success(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()

        adapter._gql._client.post.side_effect = [
            _mock_response({"data": {"issue": {"team": {"id": "team-1"}}}}),
            _mock_response(
                {
                    "data": {
                        "team": {
                            "states": {
                                "nodes": [
                                    {"id": "s1", "name": "Todo"},
                                    {"id": "s2", "name": "In Progress"},
                                    {"id": "s3", "name": "Done"},
                                ]
                            }
                        }
                    }
                }
            ),
            _mock_response(
                {
                    "data": {
                        "issueUpdate": {
                            "issue": _issue_node(state={"name": "Done", "type": "completed"})
                        }
                    }
                }
            ),
        ]

        adapter._gql.set_cached("search:test:None", [], ttl=60.0)
        adapter._gql.set_cached("recent:proj:10", [], ttl=60.0)
        adapter._gql.set_cached("connection", "keep", ttl=60.0)

        issue = await adapter.update_issue_status("issue-1", "Done")
        assert issue.status == "Done"

        assert adapter._gql.get_cached("search:test:None") is None
        assert adapter._gql.get_cached("recent:proj:10") is None
        assert adapter._gql.get_cached("connection") == "keep"

    async def test_issue_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"issue": None}})

        with pytest.raises(GraphQLError, match="Issue not found"):
            await adapter.update_issue_status("bad-id", "Done")

    async def test_status_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.side_effect = [
            _mock_response({"data": {"issue": {"team": {"id": "team-1"}}}}),
            _mock_response(
                {
                    "data": {
                        "team": {
                            "states": {
                                "nodes": [
                                    {"id": "s1", "name": "Todo"},
                                    {"id": "s2", "name": "Done"},
                                ]
                            }
                        }
                    }
                }
            ),
        ]

        with pytest.raises(GraphQLError, match="State 'Invalid' not found"):
            await adapter.update_issue_status("issue-1", "Invalid")


# ---------------------------------------------------------------------------
# LinearTrackerBase — project browsing
# ---------------------------------------------------------------------------


class TestListProjects:
    async def test_happy_path(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projects": {"nodes": [_project_node()]}}}
        )

        projects = await adapter.list_projects()
        assert len(projects) == 1
        assert projects[0].id == "proj-1"

    async def test_cached(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projects": {"nodes": [_project_node()]}}}
        )

        await adapter.list_projects()
        await adapter.list_projects()
        assert adapter._gql._client.post.call_count == 1


class TestGetProject:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"project": _project_node()}}
        )

        project = await adapter.get_project("proj-1")
        assert project.id == "proj-1"

    async def test_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"project": None}})

        with pytest.raises(GraphQLError, match="Project not found"):
            await adapter.get_project("nonexistent")


class TestListMilestones:
    async def test_happy_path(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "project": {
                        "projectMilestones": {
                            "nodes": [
                                _milestone_node(),
                                _milestone_node(id="ms-2", name="Phase 2"),
                            ]
                        }
                    }
                }
            }
        )

        milestones = await adapter.list_milestones("proj-1")
        assert len(milestones) == 2
        assert milestones[0].project_id == "proj-1"


class TestListIssues:
    async def test_all_issues(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"issues": {"nodes": [_issue_node(), _issue_node(id="issue-2")]}}}
        )

        issues = await adapter.list_issues("proj-1")
        assert len(issues) == 2

    async def test_filtered_by_milestone(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"issues": {"nodes": [_issue_node()]}}}
        )

        issues = await adapter.list_issues("proj-1", milestone_id="ms-1")
        assert len(issues) == 1

        call_kwargs = adapter._gql._client.post.call_args
        payload = call_kwargs[1]["json"]
        assert "milestoneId" in payload["variables"]

    async def test_cached(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"issues": {"nodes": [_issue_node()]}}}
        )

        await adapter.list_issues("proj-1")
        await adapter.list_issues("proj-1")
        assert adapter._gql._client.post.call_count == 1


# ---------------------------------------------------------------------------
# LinearTrackerBase — close
# ---------------------------------------------------------------------------


class TestClose:
    async def test_close(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        await adapter.close()
        adapter._gql._client.aclose.assert_called_once()


# ---------------------------------------------------------------------------
# LinearTrackerBase — constructor
# ---------------------------------------------------------------------------


class TestConstructor:
    def test_extra_kwargs_ignored(self):
        adapter = LinearTrackerBase(
            api_key="test-key",
            api_url="https://api.linear.app/graphql",
            name="linear-prod",
            some_other="value",
        )
        assert adapter.provider_name == "linear"
