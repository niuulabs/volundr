"""Tests for Ravn platform tools (volundr_session, volundr_git, tyr_saga, tracker_issue)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from ravn.adapters.tools.platform_tools import (
    TrackerIssueTool,
    TyrSagaTool,
    VolundrGitTool,
    VolundrSessionTool,
)

BASE_URL = "http://localhost:8080"


# ===========================================================================
# VolundrSessionTool
# ===========================================================================


class TestVolundrSessionTool:
    def setup_method(self):
        self.tool = VolundrSessionTool(base_url=BASE_URL)

    def test_name(self):
        assert self.tool.name == "volundr_session"

    def test_description_mentions_sessions(self):
        assert "session" in self.tool.description.lower()

    def test_input_schema_has_action(self):
        assert "action" in self.tool.input_schema["properties"]

    def test_required_permission(self):
        assert self.tool.required_permission == "platform:api"

    @pytest.mark.asyncio
    @respx.mock
    async def test_list_sessions(self):
        respx.get(f"{BASE_URL}/api/v1/volundr/sessions").mock(
            return_value=httpx.Response(200, json=[{"id": "abc"}])
        )
        result = await self.tool.execute({"action": "list"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data[0]["id"] == "abc"

    @pytest.mark.asyncio
    @respx.mock
    async def test_create_session(self):
        respx.post(f"{BASE_URL}/api/v1/volundr/sessions").mock(
            return_value=httpx.Response(200, json={"id": "new-session"})
        )
        result = await self.tool.execute({"action": "create", "name": "my-session"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["id"] == "new-session"

    @pytest.mark.asyncio
    async def test_create_session_missing_name(self):
        result = await self.tool.execute({"action": "create"})
        assert result.is_error
        assert "name" in result.content

    @pytest.mark.asyncio
    @respx.mock
    async def test_stop_session(self):
        session_id = "sess-123"
        respx.post(f"{BASE_URL}/api/v1/volundr/sessions/{session_id}/stop").mock(
            return_value=httpx.Response(200, json={})
        )
        result = await self.tool.execute({"action": "stop", "session_id": session_id})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["status"] == "stopped"

    @pytest.mark.asyncio
    async def test_stop_session_missing_id(self):
        result = await self.tool.execute({"action": "stop"})
        assert result.is_error
        assert "session_id" in result.content

    @pytest.mark.asyncio
    @respx.mock
    async def test_delete_session(self):
        session_id = "sess-456"
        respx.delete(f"{BASE_URL}/api/v1/volundr/sessions/{session_id}").mock(
            return_value=httpx.Response(200, json={})
        )
        result = await self.tool.execute({"action": "delete", "session_id": session_id})
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        result = await self.tool.execute({"action": "explode"})
        assert result.is_error
        assert "Unknown action" in result.content

    @pytest.mark.asyncio
    @respx.mock
    async def test_api_error_returns_error_result(self):
        respx.get(f"{BASE_URL}/api/v1/volundr/sessions").mock(
            return_value=httpx.Response(500, text="internal error")
        )
        result = await self.tool.execute({"action": "list"})
        assert result.is_error


# ===========================================================================
# VolundrGitTool
# ===========================================================================


class TestVolundrGitTool:
    def setup_method(self):
        self.tool = VolundrGitTool(base_url=BASE_URL)

    def test_name(self):
        assert self.tool.name == "volundr_git"

    def test_required_permission(self):
        assert self.tool.required_permission == "platform:api"

    @pytest.mark.asyncio
    @respx.mock
    async def test_list_repos(self):
        respx.get(f"{BASE_URL}/api/v1/volundr/git/repos").mock(
            return_value=httpx.Response(200, json=[{"name": "myrepo"}])
        )
        result = await self.tool.execute({"action": "list_repos"})
        assert not result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_create_branch(self):
        respx.post(f"{BASE_URL}/api/v1/volundr/git/branches").mock(
            return_value=httpx.Response(200, json={"branch": "feature/x"})
        )
        result = await self.tool.execute(
            {"action": "create_branch", "repo": "myrepo", "branch": "feature/x"}
        )
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_create_branch_missing_fields(self):
        result = await self.tool.execute({"action": "create_branch", "repo": "r"})
        assert result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_create_pr(self):
        respx.post(f"{BASE_URL}/api/v1/volundr/git/pull-requests").mock(
            return_value=httpx.Response(200, json={"url": "https://github.com/pr/1"})
        )
        result = await self.tool.execute(
            {
                "action": "create_pr",
                "repo": "myrepo",
                "branch": "feature/x",
                "title": "My PR",
            }
        )
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_create_pr_missing_title(self):
        result = await self.tool.execute({"action": "create_pr", "repo": "r", "branch": "b"})
        assert result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_ci_status(self):
        respx.get(f"{BASE_URL}/api/v1/volundr/git/ci-status").mock(
            return_value=httpx.Response(200, json={"status": "passing"})
        )
        result = await self.tool.execute(
            {"action": "ci_status", "repo": "myrepo", "branch": "main"}
        )
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        result = await self.tool.execute({"action": "unknown"})
        assert result.is_error


# ===========================================================================
# TyrSagaTool
# ===========================================================================


class TestTyrSagaTool:
    def setup_method(self):
        self.tool = TyrSagaTool(base_url=BASE_URL)

    def test_name(self):
        assert self.tool.name == "tyr_saga"

    def test_required_permission(self):
        assert self.tool.required_permission == "platform:api"

    @pytest.mark.asyncio
    @respx.mock
    async def test_list_sagas(self):
        respx.get(f"{BASE_URL}/api/v1/tyr/sagas").mock(return_value=httpx.Response(200, json=[]))
        result = await self.tool.execute({"action": "list"})
        assert not result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_create_saga(self):
        respx.post(f"{BASE_URL}/api/v1/tyr/sagas/commit").mock(
            return_value=httpx.Response(200, json={"id": "saga-1"})
        )
        result = await self.tool.execute(
            {"action": "create", "name": "my saga", "spec": "do the thing"}
        )
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_create_saga_missing_name(self):
        result = await self.tool.execute({"action": "create"})
        assert result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_dispatch_saga(self):
        respx.post(f"{BASE_URL}/api/v1/tyr/dispatch/approve").mock(
            return_value=httpx.Response(200, json={})
        )
        result = await self.tool.execute({"action": "dispatch", "saga_id": "saga-1"})
        assert not result.is_error
        data = json.loads(result.content)
        assert data["status"] == "dispatched"

    @pytest.mark.asyncio
    async def test_dispatch_missing_saga_id(self):
        result = await self.tool.execute({"action": "dispatch"})
        assert result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_saga_status(self):
        respx.get(f"{BASE_URL}/api/v1/tyr/sagas/saga-1").mock(
            return_value=httpx.Response(200, json={"id": "saga-1", "status": "ACTIVE"})
        )
        result = await self.tool.execute({"action": "status", "saga_id": "saga-1"})
        assert not result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_saga_raids(self):
        respx.get(f"{BASE_URL}/api/v1/tyr/sagas/saga-1/raids").mock(
            return_value=httpx.Response(200, json=[])
        )
        result = await self.tool.execute({"action": "raids", "saga_id": "saga-1"})
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        result = await self.tool.execute({"action": "nope"})
        assert result.is_error


# ===========================================================================
# TrackerIssueTool
# ===========================================================================


class TestTrackerIssueTool:
    def setup_method(self):
        self.tool = TrackerIssueTool(base_url=BASE_URL)

    def test_name(self):
        assert self.tool.name == "tracker_issue"

    def test_required_permission(self):
        assert self.tool.required_permission == "platform:api"

    @pytest.mark.asyncio
    @respx.mock
    async def test_create_issue(self):
        respx.post(f"{BASE_URL}/api/v1/tyr/tracker/issues").mock(
            return_value=httpx.Response(200, json={"id": "NIU-1", "title": "Fix bug"})
        )
        result = await self.tool.execute(
            {"action": "create", "title": "Fix bug", "priority": "high"}
        )
        assert not result.is_error
        data = json.loads(result.content)
        assert data["id"] == "NIU-1"

    @pytest.mark.asyncio
    async def test_create_issue_missing_title(self):
        result = await self.tool.execute({"action": "create"})
        assert result.is_error
        assert "title" in result.content

    @pytest.mark.asyncio
    @respx.mock
    async def test_update_issue(self):
        respx.patch(f"{BASE_URL}/api/v1/tyr/tracker/issues/NIU-1").mock(
            return_value=httpx.Response(200, json={"id": "NIU-1", "status": "Done"})
        )
        result = await self.tool.execute(
            {"action": "update", "issue_id": "NIU-1", "status": "Done"}
        )
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_update_issue_missing_id(self):
        result = await self.tool.execute({"action": "update", "status": "Done"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_update_issue_no_fields(self):
        result = await self.tool.execute({"action": "update", "issue_id": "NIU-1"})
        assert result.is_error

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_issue(self):
        respx.get(f"{BASE_URL}/api/v1/tyr/tracker/issues/NIU-1").mock(
            return_value=httpx.Response(200, json={"id": "NIU-1"})
        )
        result = await self.tool.execute({"action": "get", "issue_id": "NIU-1"})
        assert not result.is_error

    @pytest.mark.asyncio
    async def test_get_issue_missing_id(self):
        result = await self.tool.execute({"action": "get"})
        assert result.is_error

    @pytest.mark.asyncio
    async def test_unknown_action(self):
        result = await self.tool.execute({"action": "unknown"})
        assert result.is_error
