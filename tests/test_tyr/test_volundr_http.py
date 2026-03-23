"""Tests for VolundrHTTPAdapter with respx-mocked httpx calls."""

from __future__ import annotations

import httpx
import pytest
import respx

from tyr.adapters.volundr_http import VolundrHTTPAdapter
from tyr.ports.volundr import SpawnRequest

BASE_URL = "http://volundr.test:8000"
SESSIONS_URL = f"{BASE_URL}/api/v1/volundr/sessions"


@pytest.fixture
def adapter() -> VolundrHTTPAdapter:
    return VolundrHTTPAdapter(base_url=BASE_URL, timeout=5.0)


# -------------------------------------------------------------------
# set_auth_token / _headers
# -------------------------------------------------------------------


class TestAuthHeaders:
    def test_no_token_by_default(self, adapter: VolundrHTTPAdapter):
        assert adapter._headers() == {}

    def test_set_token(self, adapter: VolundrHTTPAdapter):
        adapter.set_auth_token("tok-123")
        headers = adapter._headers()
        assert headers["Authorization"] == "Bearer tok-123"

    def test_overwrite_token(self, adapter: VolundrHTTPAdapter):
        adapter.set_auth_token("old")
        adapter.set_auth_token("new")
        assert adapter._headers()["Authorization"] == "Bearer new"

    def test_api_key_provides_header(self):
        adapter = VolundrHTTPAdapter(base_url=BASE_URL, api_key="pat-abc")
        assert adapter._headers()["Authorization"] == "Bearer pat-abc"

    def test_runtime_token_overrides_api_key(self):
        adapter = VolundrHTTPAdapter(base_url=BASE_URL, api_key="pat-abc")
        adapter.set_auth_token("runtime-tok")
        assert adapter._headers()["Authorization"] == "Bearer runtime-tok"

    def test_clear_auth_token_restores_api_key(self):
        adapter = VolundrHTTPAdapter(base_url=BASE_URL, api_key="pat-abc")
        adapter.set_auth_token("runtime-tok")
        adapter.clear_auth_token()
        assert adapter._headers()["Authorization"] == "Bearer pat-abc"

    def test_clear_auth_token_no_api_key(self, adapter: VolundrHTTPAdapter):
        adapter.set_auth_token("runtime-tok")
        adapter.clear_auth_token()
        assert adapter._headers() == {}

    def test_set_auth_token_no_api_key(self, adapter: VolundrHTTPAdapter):
        adapter.set_auth_token("runtime-tok")
        assert adapter._headers()["Authorization"] == "Bearer runtime-tok"


# -------------------------------------------------------------------
# spawn_session
# -------------------------------------------------------------------


class TestSpawnSession:
    @pytest.mark.asyncio
    @respx.mock
    async def test_success(self, adapter: VolundrHTTPAdapter):
        respx.post(SESSIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "ses-1",
                    "name": "my-session",
                    "status": "creating",
                    "tracker_issue_id": "ALPHA-1",
                },
            )
        )

        req = SpawnRequest(
            name="my-session",
            repo="org/repo",
            branch="feat/alpha",
            model="claude-sonnet-4-6",
            tracker_issue_id="ALPHA-1",
            tracker_issue_url="https://linear.app/i-1",
            system_prompt="Be helpful.",
            initial_prompt="Do the thing.",
        )
        session = await adapter.spawn_session(req)

        assert session.id == "ses-1"
        assert session.name == "my-session"
        assert session.status == "creating"
        assert session.tracker_issue_id == "ALPHA-1"

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_correct_payload(self, adapter: VolundrHTTPAdapter):
        route = respx.post(SESSIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "ses-2",
                    "name": "n",
                    "status": "creating",
                },
            )
        )

        req = SpawnRequest(
            name="n",
            repo="org/repo",
            branch="main",
            model="claude-opus-4-6",
            tracker_issue_id="X-1",
            tracker_issue_url="https://example.com/X-1",
            system_prompt="prompt",
            initial_prompt="go",
        )
        await adapter.spawn_session(req)

        sent = route.calls[0].request
        import json

        body = json.loads(sent.content)
        assert body["name"] == "n"
        assert body["model"] == "claude-opus-4-6"
        assert body["source"]["type"] == "git"
        assert body["source"]["repo"] == "org/repo"
        assert body["source"]["branch"] == "main"
        assert body["system_prompt"] == "prompt"
        assert body["initial_prompt"] == "go"
        assert body["issue_id"] == "X-1"
        assert body["issue_url"] == "https://example.com/X-1"

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_auth_header(self, adapter: VolundrHTTPAdapter):
        route = respx.post(SESSIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "ses-3",
                    "name": "n",
                    "status": "creating",
                },
            )
        )
        adapter.set_auth_token("my-token")

        req = SpawnRequest(
            name="n",
            repo="r",
            branch="b",
            model="m",
            tracker_issue_id="X",
            tracker_issue_url="",
            system_prompt="",
            initial_prompt="",
        )
        await adapter.spawn_session(req)

        sent = route.calls[0].request
        assert sent.headers["Authorization"] == "Bearer my-token"

    @pytest.mark.asyncio
    @respx.mock
    async def test_raises_on_error(self, adapter: VolundrHTTPAdapter):
        respx.post(SESSIONS_URL).mock(return_value=httpx.Response(500, text="Internal error"))

        req = SpawnRequest(
            name="n",
            repo="r",
            branch="b",
            model="m",
            tracker_issue_id="X",
            tracker_issue_url="",
            system_prompt="",
            initial_prompt="",
        )
        with pytest.raises(httpx.HTTPStatusError):
            await adapter.spawn_session(req)


# -------------------------------------------------------------------
# get_session
# -------------------------------------------------------------------


class TestGetSession:
    @pytest.mark.asyncio
    @respx.mock
    async def test_found(self, adapter: VolundrHTTPAdapter):
        respx.get(f"{SESSIONS_URL}/ses-1").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "ses-1",
                    "name": "my-session",
                    "status": "running",
                    "tracker_issue_id": "ALPHA-1",
                },
            )
        )

        session = await adapter.get_session("ses-1")
        assert session is not None
        assert session.id == "ses-1"
        assert session.name == "my-session"
        assert session.status == "running"
        assert session.tracker_issue_id == "ALPHA-1"

    @pytest.mark.asyncio
    @respx.mock
    async def test_not_found(self, adapter: VolundrHTTPAdapter):
        respx.get(f"{SESSIONS_URL}/nonexistent").mock(return_value=httpx.Response(404))

        session = await adapter.get_session("nonexistent")
        assert session is None

    @pytest.mark.asyncio
    @respx.mock
    async def test_raises_on_server_error(self, adapter: VolundrHTTPAdapter):
        respx.get(f"{SESSIONS_URL}/ses-1").mock(return_value=httpx.Response(500, text="error"))

        with pytest.raises(httpx.HTTPStatusError):
            await adapter.get_session("ses-1")

    @pytest.mark.asyncio
    @respx.mock
    async def test_no_tracker_issue_id(self, adapter: VolundrHTTPAdapter):
        respx.get(f"{SESSIONS_URL}/ses-2").mock(
            return_value=httpx.Response(
                200,
                json={
                    "id": "ses-2",
                    "name": "plain",
                    "status": "running",
                },
            )
        )

        session = await adapter.get_session("ses-2")
        assert session is not None
        assert session.tracker_issue_id is None


# -------------------------------------------------------------------
# list_sessions
# -------------------------------------------------------------------


class TestListSessions:
    @pytest.mark.asyncio
    @respx.mock
    async def test_returns_sessions(self, adapter: VolundrHTTPAdapter):
        respx.get(SESSIONS_URL).mock(
            return_value=httpx.Response(
                200,
                json=[
                    {
                        "id": "ses-1",
                        "name": "first",
                        "status": "running",
                        "tracker_issue_id": "A-1",
                    },
                    {
                        "id": "ses-2",
                        "name": "second",
                        "status": "stopped",
                    },
                ],
            )
        )

        sessions = await adapter.list_sessions()
        assert len(sessions) == 2
        assert sessions[0].id == "ses-1"
        assert sessions[0].tracker_issue_id == "A-1"
        assert sessions[1].id == "ses-2"
        assert sessions[1].tracker_issue_id is None

    @pytest.mark.asyncio
    @respx.mock
    async def test_empty_list(self, adapter: VolundrHTTPAdapter):
        respx.get(SESSIONS_URL).mock(return_value=httpx.Response(200, json=[]))

        sessions = await adapter.list_sessions()
        assert sessions == []

    @pytest.mark.asyncio
    @respx.mock
    async def test_raises_on_error(self, adapter: VolundrHTTPAdapter):
        respx.get(SESSIONS_URL).mock(return_value=httpx.Response(503, text="unavailable"))

        with pytest.raises(httpx.HTTPStatusError):
            await adapter.list_sessions()

    @pytest.mark.asyncio
    @respx.mock
    async def test_sends_auth_header(self, adapter: VolundrHTTPAdapter):
        route = respx.get(SESSIONS_URL).mock(return_value=httpx.Response(200, json=[]))
        adapter.set_auth_token("list-tok")

        await adapter.list_sessions()

        sent = route.calls[0].request
        assert sent.headers["Authorization"] == "Bearer list-tok"


# -------------------------------------------------------------------
# Constructor
# -------------------------------------------------------------------


class TestConstructor:
    def test_strips_trailing_slash(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com/")
        assert adapter._base_url == "http://example.com"

    def test_default_timeout(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com")
        assert adapter._timeout == 30.0

    def test_custom_timeout(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com", timeout=10.0)
        assert adapter._timeout == 10.0

    def test_default_api_key_is_none(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com")
        assert adapter._api_key is None

    def test_custom_api_key(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com", api_key="pat-xyz")
        assert adapter._api_key == "pat-xyz"

    def test_api_key_with_timeout(self):
        adapter = VolundrHTTPAdapter(base_url="http://example.com", api_key="pat-xyz", timeout=15.0)
        assert adapter._api_key == "pat-xyz"
        assert adapter._timeout == 15.0
