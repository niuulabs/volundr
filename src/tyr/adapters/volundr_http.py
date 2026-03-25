"""Volundr HTTP adapter — calls the Volundr REST API."""

from __future__ import annotations

import logging

import httpx

from tyr.domain.models import PRStatus
from tyr.ports.volundr import SpawnRequest, VolundrPort, VolundrSession

logger = logging.getLogger(__name__)


class VolundrHTTPAdapter(VolundrPort):
    """Calls Volundr's REST API to manage sessions."""

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout

    def _headers(self, auth_token: str | None = None) -> dict[str, str]:
        token = auth_token or self._api_key
        if token:
            return {"Authorization": f"Bearer {token}"}
        return {}

    async def spawn_session(
        self,
        request: SpawnRequest,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/api/v1/volundr/sessions",
                headers=self._headers(auth_token),
                json={
                    "name": request.name,
                    "model": request.model,
                    "source": {
                        "type": "git",
                        "repo": request.repo,
                        "branch": request.branch,
                        "base_branch": request.base_branch,
                    },
                    "system_prompt": request.system_prompt,
                    "initial_prompt": request.initial_prompt,
                    "issue_id": request.tracker_issue_id,
                    "issue_url": request.tracker_issue_url,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return VolundrSession(
                id=data["id"],
                name=data["name"],
                status=data["status"],
                tracker_issue_id=data.get("tracker_issue_id"),
            )

    async def get_session(
        self,
        session_id: str,
        *,
        auth_token: str | None = None,
    ) -> VolundrSession | None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/api/v1/volundr/sessions/{session_id}",
                headers=self._headers(auth_token),
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            return VolundrSession(
                id=data["id"],
                name=data["name"],
                status=data["status"],
                tracker_issue_id=data.get("tracker_issue_id"),
            )

    async def list_sessions(
        self,
        *,
        auth_token: str | None = None,
    ) -> list[VolundrSession]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/api/v1/volundr/sessions",
                headers=self._headers(auth_token),
            )
            resp.raise_for_status()
            return [
                VolundrSession(
                    id=s["id"],
                    name=s["name"],
                    status=s["status"],
                    tracker_issue_id=s.get("tracker_issue_id"),
                )
                for s in resp.json()
            ]

    async def get_pr_status(self, session_id: str) -> PRStatus:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/api/v1/volundr/sessions/{session_id}/pr",
                headers=self._headers(),
            )
            resp.raise_for_status()
            data = resp.json()
            return PRStatus(
                pr_id=data["pr_id"],
                url=data.get("url", ""),
                state=data["state"],
                mergeable=data["mergeable"],
                ci_passed=data.get("ci_passed"),
            )

    async def get_chronicle_summary(self, session_id: str) -> str:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.get(
                f"{self._base_url}/api/v1/volundr/sessions/{session_id}/chronicle",
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json().get("summary", "")
