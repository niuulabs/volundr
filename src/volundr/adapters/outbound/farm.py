"""Farm ITaaS adapter for pod management.

Uses the Farm Tasks Service API for task submission and management.
API spec: nv.svc.farm-tasks v0.13.4

Constructor accepts plain kwargs (dynamic adapter pattern).
"""

import asyncio
import logging

import httpx

from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import PodManager, PodStartResult

logger = logging.getLogger(__name__)


class FarmApiError(Exception):
    """Raised when Farm API returns an error."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"Farm API error ({status_code}): {message}")


class FarmPodManager(PodManager):
    """Farm ITaaS implementation of PodManager.

    Uses the Farm Tasks Service API to submit, cancel, and query tasks.
    Farm assigns its own task_id on submission (ignoring any task_id we pass),
    so we resolve the Farm task_id by listing tasks of our configured task_type
    and matching the session ID in task_args.

    Constructor accepts plain kwargs (dynamic adapter pattern):
        adapter: "volundr.adapters.outbound.farm.FarmPodManager"
        base_url: "http://farm-tasks.default.svc.cluster.local"
        token: null
        timeout: 30
        task_type: "skuld"
        user: "volundr"
        labels: ["session"]
        base_domain: "volundr.local"
        chat_scheme: "wss"
        code_scheme: "https"
        chat_path: "/session"
        code_path: "/"
    """

    # Map Farm task statuses to SessionStatus
    # From OpenAPI spec: Status enum
    STATUS_MAP = {
        "submitted": SessionStatus.STARTING,
        "waiting": SessionStatus.STARTING,
        "starting": SessionStatus.STARTING,
        "pending": SessionStatus.STARTING,
        "unscheduled": SessionStatus.STARTING,
        "running": SessionStatus.RUNNING,
        "finished": SessionStatus.STOPPED,
        "cancelled": SessionStatus.STOPPED,
        "archived": SessionStatus.STOPPED,
        "paused": SessionStatus.STOPPED,
        "errored": SessionStatus.FAILED,
        "unschedulable": SessionStatus.FAILED,
        "cancelling": SessionStatus.STOPPING,
        "pausing": SessionStatus.STOPPING,
    }

    def __init__(
        self,
        *,
        base_url: str = "http://farm-tasks.default.svc.cluster.local",
        token: str | None = None,
        timeout: float = 30.0,
        task_type: str = "skuld",
        user: str = "volundr",
        labels: list[str] | None = None,
        base_domain: str = "volundr.local",
        chat_scheme: str = "wss",
        code_scheme: str = "https",
        chat_path: str = "/session",
        code_path: str = "/",
        gateway_domain: str | None = None,
        poll_interval: float = 2.0,
        client: httpx.AsyncClient | None = None,
        **_extra: object,
    ):
        self._base_url = base_url
        self._token = token
        self._timeout = timeout
        self._task_type = task_type
        self._user = user
        self._labels = labels if labels is not None else ["session"]
        self._base_domain = base_domain
        self._chat_scheme = chat_scheme
        self._code_scheme = code_scheme
        self._chat_path = chat_path
        self._code_path = code_path
        self._gateway_domain = gateway_domain
        self._poll_interval = poll_interval
        self._client = client
        self._owns_client = client is None

    def _session_host(self, session_name: str) -> str:
        return f"{session_name}.{self._base_domain}"

    def _chat_endpoint(self, session_name: str, session_id: str = "") -> str:
        if self._gateway_domain:
            return f"wss://{self._gateway_domain}/s/{session_id}/session"
        return f"{self._chat_scheme}://{self._session_host(session_name)}{self._chat_path}"

    def _code_endpoint(self, session_name: str, session_id: str = "") -> str:
        if self._gateway_domain:
            return f"https://{self._gateway_domain}/s/{session_id}/"
        return f"{self._code_scheme}://{self._session_host(session_name)}{self._code_path}"

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None:
            headers = {}
            if self._token:
                headers["Authorization"] = f"Bearer {self._token}"
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=headers,
                timeout=self._timeout,
            )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client if we own it."""
        if self._client and self._owns_client:
            await self._client.aclose()
            self._client = None

    async def start(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> PodStartResult:
        """Start pods for a session via Farm Tasks API."""
        client = await self._get_client()
        session_id = str(session.id)

        payload: dict = {
            "task_type": self._task_type,
            "task_args": spec.values,
            "user": self._user,
            "task_id": session_id,
            "labels": self._labels,
        }

        response = await client.post(
            "/queue/management/tasks/submit",
            json=payload,
        )

        if response.status_code >= 400:
            raise FarmApiError(response.status_code, response.text)

        chat_endpoint = self._chat_endpoint(session.name, session_id)
        code_endpoint = self._code_endpoint(session.name, session_id)

        data = response.json() if response.content else {}
        pod_name = data.get("pod_name", f"volundr-{session_id}")

        return PodStartResult(
            chat_endpoint=chat_endpoint,
            code_endpoint=code_endpoint,
            pod_name=pod_name,
        )

    # All Farm task statuses to query when resolving task IDs.
    ALL_STATUSES = [
        "submitted",
        "waiting",
        "starting",
        "running",
        "finished",
        "pausing",
        "paused",
        "errored",
        "cancelling",
        "cancelled",
        "pending",
        "unscheduled",
        "unschedulable",
        "archived",
    ]

    async def _resolve_farm_task_id(self, session_id: str) -> str | None:
        """Resolve the Farm-assigned task_id for a given session ID.

        Farm generates its own task_id on submission, which differs from
        the session_id we pass. This queries the task list endpoint and
        finds the task whose task_args.session.id matches.

        Args:
            session_id: The Volundr session ID to look up.

        Returns:
            The Farm-assigned task_id, or None if no matching task found.
        """
        client = await self._get_client()

        # Build params with multiple status and field values.
        params = [("status", s) for s in self.ALL_STATUSES]
        params.extend([("field", "task_id"), ("field", "task_args")])

        response = await client.get(
            "/queue/management/tasks/list",
            params=params,
        )

        if response.status_code >= 400:
            logger.warning(
                "Farm API returned %d when listing tasks to resolve session %s: %s",
                response.status_code,
                session_id,
                response.text,
            )
            return None

        # Response is a dict keyed by "(task_type, task_function)" strings,
        # with each value being a list of tasks.
        data = response.json()
        task_count = 0
        for _group_key, task_group in data.items():
            for task in task_group:
                task_count += 1
                task_args = task.get("task_args", {})
                session_info = task_args.get("session", {})
                task_session_id = session_info.get("id")
                if task_session_id == session_id:
                    farm_task_id = task.get("task_id")
                    logger.debug(
                        "Resolved session %s to Farm task_id %s",
                        session_id,
                        farm_task_id,
                    )
                    return farm_task_id
                logger.debug(
                    "Farm task %s has session_id=%s (looking for %s)",
                    task.get("task_id"),
                    task_session_id,
                    session_id,
                )

        logger.warning(
            "No Farm task found matching session %s (searched %d tasks across %d groups)",
            session_id,
            task_count,
            len(data),
        )
        return None

    async def stop(self, session: Session) -> bool:
        """Stop pods for a session via Farm Tasks API.

        Resolves the Farm-assigned task_id (which differs from session_id),
        then cancels the task.

        Returns:
            True if cancelled successfully, False if task not found or already stopped.

        Note:
            This method treats 404 and 500 errors as "task not found" cases since
            Farm may return 500 when the task doesn't exist or has already been
            cleaned up. Other errors are still raised as FarmApiError.
        """
        client = await self._get_client()
        session_id = str(session.id)

        # Farm assigns its own task_id, different from session_id.
        # Look up the actual Farm task_id by searching for our session.
        farm_task_id = await self._resolve_farm_task_id(session_id)
        if farm_task_id is None:
            logger.debug(
                "No matching Farm task found for session %s, treating as already stopped",
                session_id,
            )
            return False

        payload = {
            "task_id": farm_task_id,
            "userid": self._user,
        }

        response = await client.post(
            "/queue/management/tasks/cancel",
            json=payload,
        )

        # 404 means task not found - already stopped/never existed
        if response.status_code == 404:
            logger.debug(
                "Task not found in Farm (404) for session %s (farm task %s), "
                "treating as already stopped",
                session_id,
                farm_task_id,
            )
            return False

        # 500 often means task doesn't exist or has already been cleaned up in Farm.
        # Treat this as "not found" rather than a hard error, since our goal is to
        # ensure the task is stopped (which it effectively is if Farm can't find it).
        if response.status_code == 500:
            logger.warning(
                "Farm API returned 500 when cancelling session %s (farm task %s): %s. "
                "Treating as task not found (already stopped or never existed).",
                session_id,
                farm_task_id,
                response.text,
            )
            return False

        if response.status_code >= 400:
            raise FarmApiError(response.status_code, response.text)

        return True

    async def status(self, session: Session) -> SessionStatus:
        """Get the current status of session pods from Farm Tasks API."""
        client = await self._get_client()
        session_id = str(session.id)

        farm_task_id = await self._resolve_farm_task_id(session_id)
        if farm_task_id is None:
            return SessionStatus.STOPPED

        response = await client.get(
            f"/queue/management/tasks/info/{farm_task_id}",
        )

        # 404 means task not found - treat as stopped
        if response.status_code == 404:
            return SessionStatus.STOPPED

        if response.status_code >= 400:
            raise FarmApiError(response.status_code, response.text)

        data = response.json()
        farm_status = data.get("status", "unknown")

        return self._map_farm_status(farm_status)

    async def get_endpoint(self, session: Session) -> tuple[str | None, str | None]:
        """Get the endpoint URL for a running task from Farm.

        Returns (chat_endpoint, code_endpoint) or (None, None) if not ready.
        Farm returns 202 Accepted when task is not yet running.

        Falls back to client-side endpoint generation if Farm endpoint is null.
        """
        client = await self._get_client()
        session_id = str(session.id)

        farm_task_id = await self._resolve_farm_task_id(session_id)
        if farm_task_id is None:
            return (None, None)

        response = await client.get(
            f"/queue/management/tasks/tasks/{farm_task_id}/endpoint",
        )

        # 202 means task not ready yet
        if response.status_code == 202:
            return (None, None)

        # 404 means task not found
        if response.status_code == 404:
            return (None, None)

        if response.status_code >= 400:
            raise FarmApiError(response.status_code, response.text)

        data = response.json()
        endpoint = data.get("endpoint")

        # If Farm provides endpoint, use it; otherwise fall back to client-side
        if endpoint:
            # Farm returns single endpoint; we derive chat/code from it
            # Assuming Farm returns the base host, we append paths
            chat_endpoint = f"{endpoint}/session"
            code_endpoint = f"{endpoint}/"
            return (chat_endpoint, code_endpoint)

        # Fall back to client-side generation
        chat_endpoint = self._chat_endpoint(session.name, session_id)
        code_endpoint = self._code_endpoint(session.name, session_id)
        return (chat_endpoint, code_endpoint)

    async def wait_for_ready(self, session: Session, timeout: float) -> SessionStatus:
        """Poll Farm status until infrastructure is ready or failed."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            current = await self.status(session)
            if current == SessionStatus.RUNNING:
                return SessionStatus.RUNNING
            if current in (SessionStatus.FAILED, SessionStatus.STOPPED):
                return SessionStatus.FAILED
            await asyncio.sleep(self._poll_interval)
        return SessionStatus.FAILED

    def _map_farm_status(self, farm_status: str) -> SessionStatus:
        """Map Farm task status to SessionStatus."""
        return self.STATUS_MAP.get(farm_status, SessionStatus.FAILED)
