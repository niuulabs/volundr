"""Volundr HTTP adapter — calls the Volundr REST API."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator

import httpx

from tyr.domain.models import PRStatus
from tyr.ports.volundr import ActivityEvent, SpawnRequest, VolundrPort, VolundrSession

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
                chat_endpoint=data.get("chat_endpoint"),
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
                chat_endpoint=data.get("chat_endpoint"),
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

    async def send_message(
        self,
        session_id: str,
        message: str,
        *,
        auth_token: str | None = None,
    ) -> None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/api/v1/volundr/sessions/{session_id}/messages",
                headers=self._headers(auth_token),
                json={"content": message},
            )
            resp.raise_for_status()

    async def stop_session(
        self,
        session_id: str,
        *,
        auth_token: str | None = None,
    ) -> None:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.delete(
                f"{self._base_url}/api/v1/volundr/sessions/{session_id}",
                headers=self._headers(auth_token),
            )
            if resp.status_code == 404:
                return
            resp.raise_for_status()

    async def subscribe_activity(self) -> AsyncGenerator[ActivityEvent, None]:
        """Subscribe to the Volundr SSE stream and yield activity + session lifecycle events."""
        url = f"{self._base_url}/api/v1/volundr/sessions/stream"
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url, headers=self._headers()) as resp:
                resp.raise_for_status()
                event_type = ""
                async for line in resp.aiter_lines():
                    if line.startswith("event:"):
                        event_type = line[len("event:") :].strip()
                    elif line.startswith("data:"):
                        raw = line[len("data:") :].strip()
                        if event_type == "session_activity":
                            try:
                                data = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            yield ActivityEvent(
                                session_id=data.get("session_id", ""),
                                state=data.get("state", ""),
                                metadata=data.get("metadata", {}),
                                owner_id=data.get("owner_id", ""),
                            )
                        elif event_type == "session_updated":
                            try:
                                data = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            status = data.get("status", "")
                            if status in ("stopped", "failed"):
                                yield ActivityEvent(
                                    session_id=data.get("id", ""),
                                    state="",
                                    metadata={},
                                    owner_id=data.get("owner_id", ""),
                                    session_status=status,
                                )
                        event_type = ""
                    elif line == "":
                        event_type = ""
