"""Tests for LinearTrackerAdapter."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest

from niuu.adapters.linear import GraphQLError
from tyr.adapters.linear import (
    _LINEAR_TO_RAID,
    _RAID_TO_LINEAR,
    LinearTrackerAdapter,
    _parse_progress,
)
from tyr.domain.models import (
    Phase,
    PhaseStatus,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter() -> LinearTrackerAdapter:
    adapter = LinearTrackerAdapter(
        api_key="test",
        team_id="team-1",
        api_url="https://test.linear.app/graphql",
    )
    return adapter


def _mock_response(json_data: dict, status_code: int = 200):
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.headers = {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}",
            request=MagicMock(spec=httpx.Request),
            response=resp,
        )
    else:
        resp.raise_for_status = MagicMock()
    return resp


def _project_node(**overrides) -> dict:
    defaults = {
        "id": "proj-1",
        "name": "Test Project",
        "description": "A test project",
        "state": "started",
        "url": "https://linear.app/test/project/proj-1",
        "projectMilestones": {"nodes": [{"id": "ms-1"}, {"id": "ms-2"}]},
        "issues": {"nodes": [{"id": "i-1"}, {"id": "i-2"}, {"id": "i-3"}]},
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


def _issue_node(**overrides) -> dict:
    defaults = {
        "id": "issue-1",
        "identifier": "TEST-1",
        "title": "Test Issue",
        "description": "A test issue",
        "state": {"name": "Todo"},
        "assignee": {"name": "Dev"},
        "labels": {"nodes": [{"name": "bug"}]},
        "priority": 2,
        "url": "https://linear.app/test/issue/TEST-1",
        "projectMilestone": {"id": "ms-1"},
    }
    defaults.update(overrides)
    return defaults


# ---------------------------------------------------------------------------
# list_projects
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
        assert projects[0].name == "Test Project"
        assert projects[0].milestone_count == 2
        assert projects[0].issue_count == 3

    async def test_empty(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projects": {"nodes": []}}}
        )

        projects = await adapter.list_projects()
        assert projects == []

    async def test_cached(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projects": {"nodes": [_project_node()]}}}
        )

        first = await adapter.list_projects()
        second = await adapter.list_projects()

        assert first == second
        assert adapter._gql._client.post.call_count == 1


# ---------------------------------------------------------------------------
# get_project
# ---------------------------------------------------------------------------


class TestGetProject:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"project": _project_node()}}
        )

        project = await adapter.get_project("proj-1")
        assert project.id == "proj-1"
        assert project.name == "Test Project"

    async def test_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"project": None}})

        with pytest.raises(GraphQLError, match="Project not found"):
            await adapter.get_project("nonexistent")


# ---------------------------------------------------------------------------
# list_milestones
# ---------------------------------------------------------------------------


class TestListMilestones:
    async def test_happy_path(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "project": {
                        "projectMilestones": {
                            "nodes": [_milestone_node(), _milestone_node(id="ms-2", name="Phase 2")]
                        }
                    }
                }
            }
        )

        milestones = await adapter.list_milestones("proj-1")
        assert len(milestones) == 2
        assert milestones[0].name == "Phase 1"
        assert milestones[0].project_id == "proj-1"

    async def test_empty(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"project": {"projectMilestones": {"nodes": []}}}}
        )

        milestones = await adapter.list_milestones("proj-1")
        assert milestones == []


# ---------------------------------------------------------------------------
# list_issues
# ---------------------------------------------------------------------------


class TestListIssues:
    async def test_all_issues(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"issues": {"nodes": [_issue_node(), _issue_node(id="issue-2")]}}}
        )

        issues = await adapter.list_issues("proj-1")
        assert len(issues) == 2
        assert issues[0].id == "issue-1"

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

        first = await adapter.list_issues("proj-1")
        second = await adapter.list_issues("proj-1")

        assert first == second
        assert adapter._gql._client.post.call_count == 1


# ---------------------------------------------------------------------------
# create_saga
# ---------------------------------------------------------------------------


class TestCreateSaga:
    async def test_success(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projectCreate": {"project": {"id": "new-proj"}, "success": True}}}
        )

        now = datetime.now(UTC)
        saga = Saga(
            id=uuid4(),
            tracker_id="",
            tracker_type="linear",
            slug="test-saga",
            name="Test Saga",
            repos=["org/repo"],
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

        result = await adapter.create_saga(saga)
        assert result == "new-proj"

    async def test_failure(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projectCreate": {"project": None, "success": False}}}
        )

        now = datetime.now(UTC)
        saga = Saga(
            id=uuid4(),
            tracker_id="",
            tracker_type="linear",
            slug="fail",
            name="Fail",
            repos=[],
            status=SagaStatus.ACTIVE,
            confidence=0.0,
            created_at=now,
        )

        with pytest.raises(GraphQLError, match="Failed to create Linear project"):
            await adapter.create_saga(saga)


# ---------------------------------------------------------------------------
# create_phase
# ---------------------------------------------------------------------------


class TestCreatePhase:
    async def test_success(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "projectMilestoneCreate": {
                        "projectMilestone": {"id": "new-ms"},
                        "success": True,
                    }
                }
            }
        )

        phase = Phase(
            id=uuid4(),
            saga_id=uuid4(),
            tracker_id="proj-1",
            number=1,
            name="Phase 1",
            status=PhaseStatus.PENDING,
            confidence=0.0,
        )

        result = await adapter.create_phase(phase)
        assert result == "new-ms"


# ---------------------------------------------------------------------------
# create_raid
# ---------------------------------------------------------------------------


class TestCreateRaid:
    async def test_success(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "issueCreate": {
                        "issue": {"id": "new-issue", "identifier": "TEST-99"},
                        "success": True,
                    }
                }
            }
        )

        now = datetime.now(UTC)
        raid = Raid(
            id=uuid4(),
            phase_id=uuid4(),
            tracker_id="proj-1",
            name="Test Raid",
            description="Do the thing",
            acceptance_criteria=[],
            declared_files=[],
            estimate_hours=None,
            status=RaidStatus.PENDING,
            confidence=0.0,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )

        result = await adapter.create_raid(raid)
        assert result == "new-issue"

    async def test_with_acceptance_criteria_and_declared_files(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "issueCreate": {
                        "issue": {"id": "new-issue", "identifier": "TEST-100"},
                        "success": True,
                    }
                }
            }
        )

        now = datetime.now(UTC)
        raid = Raid(
            id=uuid4(),
            phase_id=uuid4(),
            tracker_id="proj-1",
            name="Raid with extras",
            description="Base description",
            acceptance_criteria=["Tests pass", "No lint errors"],
            declared_files=["src/main.py", "tests/test_main.py"],
            estimate_hours=2.0,
            status=RaidStatus.PENDING,
            confidence=0.0,
            session_id=None,
            branch=None,
            chronicle_summary=None,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )

        result = await adapter.create_raid(raid)
        assert result == "new-issue"

        call_kwargs = adapter._gql._client.post.call_args
        payload = call_kwargs[1]["json"]
        desc = payload["variables"]["description"]
        assert "## Acceptance Criteria" in desc
        assert "- [ ] Tests pass" in desc
        assert "## Declared Files" in desc
        assert "- `src/main.py`" in desc


# ---------------------------------------------------------------------------
# update_raid_state
# ---------------------------------------------------------------------------


class TestUpdateRaidState:
    async def test_state_mapping(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()

        # Call 1: get issue team, Call 2: get team states, Call 3: update
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
                            "issue": {"id": "i-1", "state": {"name": "In Progress"}},
                            "success": True,
                        }
                    }
                }
            ),
        ]

        await adapter.update_raid_state("i-1", RaidStatus.RUNNING)
        assert adapter._gql._client.post.call_count == 3

    async def test_state_resolution_not_found(self):
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
                                ]
                            }
                        }
                    }
                }
            ),
        ]

        with pytest.raises(GraphQLError, match="State 'In Progress' not found"):
            await adapter.update_raid_state("i-1", RaidStatus.RUNNING)


# ---------------------------------------------------------------------------
# close_raid
# ---------------------------------------------------------------------------


class TestCloseRaid:
    async def test_close(self):
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
                            "issue": {"id": "i-1", "state": {"name": "Done"}},
                            "success": True,
                        }
                    }
                }
            ),
        ]

        await adapter.close_raid("i-1")
        assert adapter._gql._client.post.call_count == 3


# ---------------------------------------------------------------------------
# get_saga, get_phase, get_raid
# ---------------------------------------------------------------------------


class TestGetSaga:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"project": _project_node()}}
        )

        saga = await adapter.get_saga("proj-1")
        assert saga.tracker_id == "proj-1"
        assert saga.name == "Test Project"
        assert saga.status == SagaStatus.ACTIVE

    async def test_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"project": None}})

        with pytest.raises(GraphQLError, match="Project not found"):
            await adapter.get_saga("bad-id")


class TestGetPhase:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {
                "data": {
                    "projectMilestone": {
                        "id": "ms-1",
                        "name": "Phase 1",
                        "description": "desc",
                        "sortOrder": 1,
                        "progress": 0.5,
                        "project": {"id": "proj-1"},
                    }
                }
            }
        )

        phase = await adapter.get_phase("ms-1")
        assert phase.tracker_id == "ms-1"
        assert phase.name == "Phase 1"

    async def test_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response(
            {"data": {"projectMilestone": None}}
        )

        with pytest.raises(GraphQLError, match="Milestone not found"):
            await adapter.get_phase("bad-id")


class TestGetRaid:
    async def test_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"issue": _issue_node()}})

        raid = await adapter.get_raid("issue-1")
        assert raid.tracker_id == "issue-1"
        assert raid.name == "Test Issue"
        assert raid.status == RaidStatus.PENDING  # "Todo" maps to PENDING

    async def test_not_found(self):
        adapter = _make_adapter()
        adapter._gql._client = AsyncMock()
        adapter._gql._client.post.return_value = _mock_response({"data": {"issue": None}})

        with pytest.raises(GraphQLError, match="Issue not found"):
            await adapter.get_raid("bad-id")


# ---------------------------------------------------------------------------
# _parse_progress
# ---------------------------------------------------------------------------


class TestParseProgress:
    def test_none(self):
        assert _parse_progress(None) == 0.0

    def test_float(self):
        assert _parse_progress(0.75) == 0.0075

    def test_int(self):
        assert _parse_progress(1) == 0.01

    def test_percentage_string(self):
        assert _parse_progress("50%") == 0.5

    def test_unknown_type(self):
        assert _parse_progress([1, 2]) == 0.0


# ---------------------------------------------------------------------------
# State mapping tables
# ---------------------------------------------------------------------------


class TestStateMappings:
    def test_raid_to_linear_completeness(self):
        """Every RaidStatus should have a mapping."""
        for status in RaidStatus:
            assert status in _RAID_TO_LINEAR

    def test_linear_to_raid_known_states(self):
        expected = {"Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"}
        assert set(_LINEAR_TO_RAID.keys()) == expected

    def test_round_trip_running(self):
        linear_name = _RAID_TO_LINEAR[RaidStatus.RUNNING]
        assert _LINEAR_TO_RAID[linear_name] == RaidStatus.RUNNING

    def test_round_trip_merged(self):
        linear_name = _RAID_TO_LINEAR[RaidStatus.MERGED]
        assert _LINEAR_TO_RAID[linear_name] == RaidStatus.MERGED
