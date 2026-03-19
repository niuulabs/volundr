"""Tests for the file manager API proxy endpoints."""

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
    app = FastAPI()
    app.state.admin_settings = {"storage": {"file_manager_enabled": True}}
    router = create_router(session_service=session_service)
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


class TestDownloadProxy:
    """Tests for GET /sessions/{id}/files/download."""

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files/download",
                params={"path": "../etc/passwd"},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_invalid_root_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files/download",
                params={"path": "test.txt", "root": "invalid"},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_session_not_found(self, repository, pod_manager):
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{uuid4()}/files/download",
                params={"path": "test.txt"},
            )
        assert resp.status_code == 404


class TestUploadProxy:
    """Tests for POST /sessions/{id}/files/upload."""

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/api/v1/volundr/sessions/{session.id}/files/upload",
                params={"path": "../etc"},
                files=[("files", ("test.txt", b"data", "text/plain"))],
            )
        assert resp.status_code == 400


class TestMkdirProxy:
    """Tests for POST /sessions/{id}/files/mkdir."""

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/api/v1/volundr/sessions/{session.id}/files/mkdir",
                json={"path": "../evil", "root": "workspace"},
            )
        assert resp.status_code == 400


class TestDeleteProxy:
    """Tests for DELETE /sessions/{id}/files."""

    @pytest.mark.asyncio
    async def test_path_traversal_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "../etc/passwd"},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_path_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": ""},
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_invalid_root_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.delete(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"path": "test.txt", "root": "invalid"},
            )
        assert resp.status_code == 400


class TestFileListingWithRoot:
    """Tests for GET /sessions/{id}/files with root parameter."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_root_param_passed_to_skuld(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        route = respx.get("https://test-session.example.com/api/files").mock(
            return_value=Response(200, json={"entries": []})
        )

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"root": "home"},
            )

        assert resp.status_code == 200
        assert route.called
        # Verify root was passed
        last_request = route.calls.last.request
        assert "root=home" in str(last_request.url)

    @pytest.mark.asyncio
    async def test_invalid_root_rejected(self, repository, pod_manager):
        session = _make_session()
        await repository.create(session)
        service = SessionService(repository=repository, pod_manager=pod_manager)
        app = _make_app(service)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(
                f"/api/v1/volundr/sessions/{session.id}/files",
                params={"root": "invalid"},
            )
        assert resp.status_code == 400
