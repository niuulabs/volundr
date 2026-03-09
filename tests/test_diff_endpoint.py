"""Tests for the diff API endpoint (NIU-55)."""

from __future__ import annotations

from uuid import uuid4

import pytest
import respx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from volundr.adapters.inbound.rest import create_router
from volundr.domain.models import Session, SessionStatus
from volundr.domain.services import SessionService


def _make_app(session_service: SessionService) -> FastAPI:
    router = create_router(session_service=session_service)
    app = FastAPI()
    app.include_router(router)
    return app


def _make_session(*, has_endpoint: bool = True) -> Session:
    return Session(
        id=uuid4(),
        name="test-session",
        model="claude-sonnet-4-6",
        repo="https://github.com/org/repo",
        branch="main",
        status=SessionStatus.RUNNING,
        chat_endpoint="wss://test-session.example.com/session" if has_endpoint else None,
        code_endpoint="https://test-session.example.com/" if has_endpoint else None,
    )


class TestDiffEndpoint:
    """Tests for GET /sessions/{session_id}/diff."""

    @pytest.mark.asyncio
    async def test_session_not_found_returns_404(
        self, repository, pod_manager,
    ):
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{uuid4()}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_invalid_base_returns_400(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "invalid-mode"},
            )

        assert resp.status_code == 400
        assert "Invalid base parameter" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_no_endpoint_returns_404(
        self, repository, pod_manager,
    ):
        session = _make_session(has_endpoint=False)
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 404
        assert "no active endpoint" in resp.json()["detail"]

    @pytest.mark.asyncio
    @respx.mock
    async def test_successful_diff_proxy(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        diff_response = {
            "files": [
                {
                    "path": "src/main.ts",
                    "status": "modified",
                    "additions": 5,
                    "deletions": 2,
                    "hunks": [],
                }
            ],
            "baseBranch": "main",
            "baseCommit": "abc123",
            "headCommit": "def456",
        }

        respx.get("https://test-session.example.com/api/diff").mock(
            return_value=Response(200, json=diff_response)
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["files"]) == 1
        assert data["files"][0]["path"] == "src/main.ts"
        assert data["baseBranch"] == "main"

    @pytest.mark.asyncio
    @respx.mock
    async def test_default_branch_mode(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        diff_data = {
            "files": [],
            "baseBranch": "main",
            "baseCommit": "abc",
            "headCommit": "def",
        }
        respx.get("https://test-session.example.com/api/diff").mock(
            return_value=Response(200, json=diff_data)
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "default-branch"},
            )

        assert resp.status_code == 200

    @pytest.mark.asyncio
    @respx.mock
    async def test_skuld_error_returns_502(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        respx.get("https://test-session.example.com/api/diff").mock(
            return_value=Response(500, text="Internal Server Error")
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 502

    @pytest.mark.asyncio
    @respx.mock
    async def test_connection_error_returns_502(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        import httpx
        respx.get("https://test-session.example.com/api/diff").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 502
        assert "Could not connect" in resp.json()["detail"]


class TestChronicleDiffEndpoint:
    """Tests for GET /chronicles/{session_id}/diff."""

    @pytest.mark.asyncio
    async def test_session_not_found_returns_404(
        self, repository, pod_manager,
    ):
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{uuid4()}/diff",
                params={"file": "src/main.py", "base": "last-commit"},
            )

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_invalid_base_returns_400(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"file": "src/main.py", "base": "invalid"},
            )

        assert resp.status_code == 400
        assert "Invalid base parameter" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_missing_file_param_returns_422(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"base": "last-commit"},
            )

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_no_endpoint_returns_404(
        self, repository, pod_manager,
    ):
        session = _make_session(has_endpoint=False)
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"file": "src/main.py", "base": "last-commit"},
            )

        assert resp.status_code == 404
        assert "no active endpoint" in resp.json()["detail"]

    @pytest.mark.asyncio
    @respx.mock
    async def test_successful_diff_proxy(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        diff_response = {
            "filePath": "src/main.py",
            "hunks": [
                {
                    "oldStart": 1,
                    "oldCount": 3,
                    "newStart": 1,
                    "newCount": 4,
                    "lines": [
                        {"type": "context", "content": "line1", "oldLine": 1, "newLine": 1},
                        {"type": "add", "content": "new", "newLine": 2},
                        {"type": "context", "content": "line2", "oldLine": 2, "newLine": 3},
                    ],
                }
            ],
        }

        respx.get("https://test-session.example.com/api/diff").mock(
            return_value=Response(200, json=diff_response)
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"file": "src/main.py", "base": "last-commit"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["filePath"] == "src/main.py"
        assert len(data["hunks"]) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_skuld_error_returns_502(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        respx.get("https://test-session.example.com/api/diff").mock(
            return_value=Response(500, text="Internal Server Error")
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"file": "src/main.py", "base": "last-commit"},
            )

        assert resp.status_code == 502

    @pytest.mark.asyncio
    @respx.mock
    async def test_connection_error_returns_502(
        self, repository, pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        import httpx
        respx.get("https://test-session.example.com/api/diff").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                f"/api/v1/volundr/chronicles/{session.id}/diff",
                params={"file": "src/main.py", "base": "last-commit"},
            )

        assert resp.status_code == 502
        assert "Could not connect" in resp.json()["detail"]
