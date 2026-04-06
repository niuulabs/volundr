"""Platform tools — Ravn tools for interacting with the Niuu platform.

These tools let the Ravn agent create/manage Volundr sessions, perform git
operations, decompose work into Tyr sagas, and track issues via Tyr's
tracker adapters.

All tools use the platform APIs (Volundr at /api/v1/volundr/, Tyr at
/api/v1/tyr/) rather than direct imports, preserving module boundaries.
"""

from __future__ import annotations

import logging

import httpx

from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort

logger = logging.getLogger(__name__)

_PERMISSION_PLATFORM = "platform:api"

_DEFAULT_BASE_URL = "http://localhost:8080"
_DEFAULT_TIMEOUT = 30.0


def _client(base_url: str, timeout: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)


def _ok(data: object) -> ToolResult:
    import json

    return ToolResult(tool_call_id="", content=json.dumps(data, default=str))


def _err(message: str) -> ToolResult:
    return ToolResult(tool_call_id="", content=message, is_error=True)


# ---------------------------------------------------------------------------
# volundr_session
# ---------------------------------------------------------------------------


class VolundrSessionTool(ToolPort):
    """Create, list, and stop Volundr coding sessions.

    Actions:
    - ``list``   — return all active sessions.
    - ``create`` — start a new session (requires ``name``).
    - ``stop``   — stop a session (requires ``session_id``).
    - ``delete`` — delete a session (requires ``session_id``).
    """

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout

    @property
    def name(self) -> str:
        return "volundr_session"

    @property
    def description(self) -> str:
        return (
            "Manage Volundr coding sessions. "
            "Actions: list, create (name required), stop (session_id required), "
            "delete (session_id required)."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "stop", "delete"],
                    "description": "Operation to perform.",
                },
                "name": {
                    "type": "string",
                    "description": "Session name (required for create).",
                },
                "session_id": {
                    "type": "string",
                    "description": "Session ID (required for stop and delete).",
                },
            },
            "required": ["action"],
        }

    @property
    def required_permission(self) -> str:
        return _PERMISSION_PLATFORM

    async def execute(self, input: dict) -> ToolResult:
        action = input.get("action", "")
        async with _client(self._base_url, self._timeout) as client:
            match action:
                case "list":
                    return await self._list(client)
                case "create":
                    return await self._create(client, input.get("name", ""))
                case "stop":
                    return await self._stop(client, input.get("session_id", ""))
                case "delete":
                    return await self._delete(client, input.get("session_id", ""))
                case _:
                    return _err(f"Unknown action: {action!r}")

    async def _list(self, client: httpx.AsyncClient) -> ToolResult:
        try:
            resp = await client.get("/api/v1/volundr/sessions")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to list sessions: {exc}")

    async def _create(self, client: httpx.AsyncClient, name: str) -> ToolResult:
        if not name:
            return _err("session name is required for create action")
        try:
            resp = await client.post("/api/v1/volundr/sessions", json={"name": name})
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to create session: {exc}")

    async def _stop(self, client: httpx.AsyncClient, session_id: str) -> ToolResult:
        if not session_id:
            return _err("session_id is required for stop action")
        try:
            resp = await client.post(f"/api/v1/volundr/sessions/{session_id}/stop")
            resp.raise_for_status()
            return _ok({"session_id": session_id, "status": "stopped"})
        except Exception as exc:
            return _err(f"Failed to stop session {session_id}: {exc}")

    async def _delete(self, client: httpx.AsyncClient, session_id: str) -> ToolResult:
        if not session_id:
            return _err("session_id is required for delete action")
        try:
            resp = await client.delete(f"/api/v1/volundr/sessions/{session_id}")
            resp.raise_for_status()
            return _ok({"session_id": session_id, "status": "deleted"})
        except Exception as exc:
            return _err(f"Failed to delete session {session_id}: {exc}")


# ---------------------------------------------------------------------------
# volundr_git
# ---------------------------------------------------------------------------


class VolundrGitTool(ToolPort):
    """Perform git operations via the Volundr API.

    Actions:
    - ``list_repos``    — list configured repositories.
    - ``create_branch`` — create a new branch (requires ``repo``, ``branch``).
    - ``create_pr``     — open a pull request (requires ``repo``, ``branch``,
                          ``title``, optionally ``body``).
    - ``ci_status``     — get CI status for a branch (requires ``repo``,
                          ``branch``).
    """

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout

    @property
    def name(self) -> str:
        return "volundr_git"

    @property
    def description(self) -> str:
        return "Git operations via Volundr: list_repos, create_branch, create_pr, ci_status."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list_repos", "create_branch", "create_pr", "ci_status"],
                    "description": "Operation to perform.",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name or URL.",
                },
                "branch": {
                    "type": "string",
                    "description": "Branch name.",
                },
                "title": {
                    "type": "string",
                    "description": "Pull request title.",
                },
                "body": {
                    "type": "string",
                    "description": "Pull request description body.",
                },
                "base_branch": {
                    "type": "string",
                    "description": "Base branch for PR (defaults to main).",
                },
            },
            "required": ["action"],
        }

    @property
    def required_permission(self) -> str:
        return _PERMISSION_PLATFORM

    async def execute(self, input: dict) -> ToolResult:
        action = input.get("action", "")
        async with _client(self._base_url, self._timeout) as client:
            match action:
                case "list_repos":
                    return await self._list_repos(client)
                case "create_branch":
                    return await self._create_branch(client, input)
                case "create_pr":
                    return await self._create_pr(client, input)
                case "ci_status":
                    return await self._ci_status(client, input)
                case _:
                    return _err(f"Unknown action: {action!r}")

    async def _list_repos(self, client: httpx.AsyncClient) -> ToolResult:
        try:
            resp = await client.get("/api/v1/volundr/git/repos")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to list repos: {exc}")

    async def _create_branch(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        repo = input.get("repo", "")
        branch = input.get("branch", "")
        if not repo or not branch:
            return _err("repo and branch are required for create_branch")
        try:
            resp = await client.post(
                "/api/v1/volundr/git/branches",
                json={"repo": repo, "branch": branch},
            )
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to create branch: {exc}")

    async def _create_pr(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        repo = input.get("repo", "")
        branch = input.get("branch", "")
        title = input.get("title", "")
        if not repo or not branch or not title:
            return _err("repo, branch, and title are required for create_pr")
        try:
            resp = await client.post(
                "/api/v1/volundr/git/pull-requests",
                json={
                    "repo": repo,
                    "branch": branch,
                    "title": title,
                    "body": input.get("body", ""),
                    "base_branch": input.get("base_branch", "main"),
                },
            )
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to create PR: {exc}")

    async def _ci_status(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        repo = input.get("repo", "")
        branch = input.get("branch", "")
        if not repo or not branch:
            return _err("repo and branch are required for ci_status")
        try:
            resp = await client.get(
                "/api/v1/volundr/git/ci-status",
                params={"repo": repo, "branch": branch},
            )
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to get CI status: {exc}")


# ---------------------------------------------------------------------------
# tyr_saga
# ---------------------------------------------------------------------------


class TyrSagaTool(ToolPort):
    """Decompose specs and manage Tyr sagas.

    Actions:
    - ``list``     — list active sagas.
    - ``create``   — create a new saga (requires ``name``).
    - ``dispatch`` — dispatch a saga for execution (requires ``saga_id``).
    - ``status``   — get saga status (requires ``saga_id``).
    - ``raids``    — list active raids for a saga (requires ``saga_id``).
    """

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout

    @property
    def name(self) -> str:
        return "tyr_saga"

    @property
    def description(self) -> str:
        return (
            "Manage Tyr sagas and raids: list, create (name required), "
            "dispatch (saga_id required), status (saga_id required), "
            "raids (saga_id required)."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "dispatch", "status", "raids"],
                    "description": "Operation to perform.",
                },
                "name": {
                    "type": "string",
                    "description": "Saga name (required for create).",
                },
                "saga_id": {
                    "type": "string",
                    "description": "Saga ID (required for dispatch, status, raids).",
                },
                "spec": {
                    "type": "string",
                    "description": "Saga specification / description (optional for create).",
                },
            },
            "required": ["action"],
        }

    @property
    def required_permission(self) -> str:
        return _PERMISSION_PLATFORM

    async def execute(self, input: dict) -> ToolResult:
        action = input.get("action", "")
        async with _client(self._base_url, self._timeout) as client:
            match action:
                case "list":
                    return await self._list(client)
                case "create":
                    return await self._create(client, input)
                case "dispatch":
                    return await self._dispatch(client, input.get("saga_id", ""))
                case "status":
                    return await self._status(client, input.get("saga_id", ""))
                case "raids":
                    return await self._raids(client, input.get("saga_id", ""))
                case _:
                    return _err(f"Unknown action: {action!r}")

    async def _list(self, client: httpx.AsyncClient) -> ToolResult:
        try:
            resp = await client.get("/api/v1/tyr/sagas")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to list sagas: {exc}")

    async def _create(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        name = input.get("name", "")
        if not name:
            return _err("name is required for create action")
        body: dict = {"name": name}
        if spec := input.get("spec"):
            body["spec"] = spec
        try:
            resp = await client.post("/api/v1/tyr/sagas/commit", json=body)
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to create saga: {exc}")

    async def _dispatch(self, client: httpx.AsyncClient, saga_id: str) -> ToolResult:
        if not saga_id:
            return _err("saga_id is required for dispatch action")
        try:
            resp = await client.post(
                "/api/v1/tyr/dispatch/approve",
                json={"saga_id": saga_id},
            )
            resp.raise_for_status()
            return _ok({"saga_id": saga_id, "status": "dispatched"})
        except Exception as exc:
            return _err(f"Failed to dispatch saga {saga_id}: {exc}")

    async def _status(self, client: httpx.AsyncClient, saga_id: str) -> ToolResult:
        if not saga_id:
            return _err("saga_id is required for status action")
        try:
            resp = await client.get(f"/api/v1/tyr/sagas/{saga_id}")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to get saga status {saga_id}: {exc}")

    async def _raids(self, client: httpx.AsyncClient, saga_id: str) -> ToolResult:
        if not saga_id:
            return _err("saga_id is required for raids action")
        try:
            resp = await client.get(f"/api/v1/tyr/sagas/{saga_id}/raids")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to list raids for saga {saga_id}: {exc}")


# ---------------------------------------------------------------------------
# tracker_issue
# ---------------------------------------------------------------------------


class TrackerIssueTool(ToolPort):
    """Create and update issues via Tyr's tracker adapters (Linear, Jira, etc.).

    Actions:
    - ``create`` — create a new issue (requires ``title``; optionally ``description``,
                   ``project``, ``priority``, ``assignee``).
    - ``update`` — update an existing issue (requires ``issue_id``; optionally
                   ``title``, ``description``, ``status``, ``priority``).
    - ``get``    — fetch issue details (requires ``issue_id``).
    """

    def __init__(
        self,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url
        self._timeout = timeout

    @property
    def name(self) -> str:
        return "tracker_issue"

    @property
    def description(self) -> str:
        return (
            "Create and update issues in Linear, Jira, or other connected trackers "
            "via Tyr's tracker adapters. Actions: create, update, get."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["create", "update", "get"],
                    "description": "Operation to perform.",
                },
                "issue_id": {
                    "type": "string",
                    "description": "Issue ID (required for update and get).",
                },
                "title": {
                    "type": "string",
                    "description": "Issue title (required for create).",
                },
                "description": {
                    "type": "string",
                    "description": "Issue description / body.",
                },
                "project": {
                    "type": "string",
                    "description": "Project or team identifier.",
                },
                "priority": {
                    "type": "string",
                    "enum": ["urgent", "high", "medium", "low"],
                    "description": "Issue priority.",
                },
                "status": {
                    "type": "string",
                    "description": "Issue status (e.g. 'In Progress', 'Done').",
                },
                "assignee": {
                    "type": "string",
                    "description": "Assignee user ID or email.",
                },
            },
            "required": ["action"],
        }

    @property
    def required_permission(self) -> str:
        return _PERMISSION_PLATFORM

    async def execute(self, input: dict) -> ToolResult:
        action = input.get("action", "")
        async with _client(self._base_url, self._timeout) as client:
            match action:
                case "create":
                    return await self._create(client, input)
                case "update":
                    return await self._update(client, input)
                case "get":
                    return await self._get(client, input.get("issue_id", ""))
                case _:
                    return _err(f"Unknown action: {action!r}")

    async def _create(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        title = input.get("title", "")
        if not title:
            return _err("title is required for create action")
        body: dict = {"title": title}
        for key in ("description", "project", "priority", "assignee"):
            if value := input.get(key):
                body[key] = value
        try:
            resp = await client.post("/api/v1/tyr/tracker/issues", json=body)
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to create issue: {exc}")

    async def _update(self, client: httpx.AsyncClient, input: dict) -> ToolResult:
        issue_id = input.get("issue_id", "")
        if not issue_id:
            return _err("issue_id is required for update action")
        body: dict = {}
        for key in ("title", "description", "status", "priority", "assignee"):
            if value := input.get(key):
                body[key] = value
        if not body:
            return _err("at least one field to update must be provided")
        try:
            resp = await client.patch(f"/api/v1/tyr/tracker/issues/{issue_id}", json=body)
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to update issue {issue_id}: {exc}")

    async def _get(self, client: httpx.AsyncClient, issue_id: str) -> ToolResult:
        if not issue_id:
            return _err("issue_id is required for get action")
        try:
            resp = await client.get(f"/api/v1/tyr/tracker/issues/{issue_id}")
            resp.raise_for_status()
            return _ok(resp.json())
        except Exception as exc:
            return _err(f"Failed to get issue {issue_id}: {exc}")
