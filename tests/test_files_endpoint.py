"""Tests for the file browsing API endpoint (NIU-56)."""

from __future__ import annotations

from uuid import uuid4

import pytest
import respx
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from volundr.adapters.inbound.rest import create_router
from volundr.domain.models import GitSource, Session, SessionStatus
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
        source=GitSource(repo="https://github.com/org/repo", branch="main"),
        status=SessionStatus.RUNNING,
        chat_endpoint="wss://test-session.example.com/session" if has_endpoint else None,
        code_endpoint="https://test-session.example.com/" if has_endpoint else None,
    )


class TestFilesEndpoint:
    """Tests for GET /sessions/{session_id}/files."""

    @pytest.mark.asyncio
    async def test_session_not_found_returns_404(
        self,
        repository,
        pod_manager,
    ):
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{uuid4()}/files",
            )

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "../etc/passwd"},
            )

        assert resp.status_code == 400
        assert "cannot contain '..'" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_absolute_path_rejected(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "/etc/passwd"},
            )

        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_no_endpoint_returns_404(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session(has_endpoint=False)
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
            )

        assert resp.status_code == 404
        assert "no active endpoint" in resp.json()["detail"]

    @pytest.mark.asyncio
    @respx.mock
    async def test_successful_file_listing(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        files_response = {
            "path": "src",
            "entries": [
                {"name": "components", "type": "directory"},
                {"name": "App.tsx", "type": "file", "size": 2048},
                {"name": "index.ts", "type": "file", "size": 128},
            ],
        }

        respx.get("https://test-session.example.com/api/files").mock(
            return_value=Response(200, json=files_response)
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "src"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["path"] == "src"
        assert len(data["entries"]) == 3
        assert data["entries"][0]["type"] == "directory"

    @pytest.mark.asyncio
    @respx.mock
    async def test_root_listing_without_path(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        files_response = {
            "path": "",
            "entries": [
                {"name": "src", "type": "directory"},
                {"name": "README.md", "type": "file", "size": 512},
            ],
        }

        respx.get("https://test-session.example.com/api/files").mock(
            return_value=Response(200, json=files_response)
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
            )

        assert resp.status_code == 200

    @pytest.mark.asyncio
    @respx.mock
    async def test_skuld_error_returns_502(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        respx.get("https://test-session.example.com/api/files").mock(
            return_value=Response(500, text="Internal Server Error")
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "src"},
            )

        assert resp.status_code == 502

    @pytest.mark.asyncio
    @respx.mock
    async def test_connection_error_returns_502(
        self,
        repository,
        pod_manager,
    ):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        import httpx

        respx.get("https://test-session.example.com/api/files").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "src"},
            )

        assert resp.status_code == 502
        assert "Could not connect" in resp.json()["detail"]
