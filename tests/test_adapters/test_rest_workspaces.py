"""Tests for workspace REST endpoints."""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import (
    InMemorySessionRepository,
    MockPodManager,
)
from volundr.adapters.inbound.auth import extract_principal
from volundr.adapters.inbound.rest import WorkspaceResponse, create_router
from volundr.adapters.outbound.k8s_storage import InMemoryStorageAdapter
from volundr.config import LocalMountsConfig
from volundr.domain.models import (
    GitSource,
    Principal,
    Session,
    Workspace,
)
from volundr.domain.services import SessionService
from volundr.domain.services.workspace import WorkspaceService

_PATCH_TARGET = "volundr.adapters.inbound.auth.extract_principal"


def _user_principal() -> Principal:
    return Principal(
        user_id="user-1",
        email="user@test.com",
        tenant_id="t1",
        roles=["volundr:user"],
    )


def _admin_principal() -> Principal:
    return Principal(
        user_id="admin-1",
        email="admin@test.com",
        tenant_id="t1",
        roles=["volundr:admin"],
    )


class _MockIdentity:
    async def get_or_provision_user(self, principal):
        pass


@pytest.fixture
def repository():
    return InMemorySessionRepository()


@pytest.fixture
def pod_manager():
    return MockPodManager()


@pytest.fixture
def session_service(repository, pod_manager):
    return SessionService(repository, pod_manager)


@pytest.fixture
def storage():
    return InMemoryStorageAdapter()


@pytest.fixture
def workspace_service(storage):
    return WorkspaceService(storage)


def _make_app(session_service, workspace_service, principal_fn):
    app = FastAPI()
    router = create_router(session_service)
    app.include_router(router)

    class _Stubs:
        local_mounts = LocalMountsConfig()

    app.state.settings = _Stubs()
    app.state.admin_settings = {}
    app.state.workspace_service = workspace_service
    app.state.session_service = session_service
    app.state.identity = _MockIdentity()
    app.dependency_overrides[extract_principal] = principal_fn
    return app


@pytest.fixture
def app(session_service, workspace_service):
    return _make_app(session_service, workspace_service, _user_principal)


@pytest.fixture
def admin_app(session_service, workspace_service):
    return _make_app(session_service, workspace_service, _admin_principal)


async def _extract_user(_request):
    return _user_principal()


async def _extract_admin(_request):
    return _admin_principal()


# ── WorkspaceResponse model tests ───────────────────────────────


class TestWorkspaceResponse:
    def test_without_session(self):
        ws = Workspace(
            id=uuid4(),
            session_id=uuid4(),
            user_id="user-1",
            tenant_id="t1",
            pvc_name="ws-pvc-001",
        )
        resp = WorkspaceResponse.from_workspace(ws)
        assert resp.session_name is None
        assert resp.source_url is None
        assert resp.source_ref is None
        assert resp.pvc_name == "ws-pvc-001"

    def test_with_git_session(self):
        sid = uuid4()
        ws = Workspace(id=uuid4(), session_id=sid, user_id="u", tenant_id="t", pvc_name="p")
        session = Session(
            id=sid,
            name="my-session",
            source=GitSource(repo="https://github.com/org/repo.git", branch="develop"),
        )
        resp = WorkspaceResponse.from_workspace(ws, session)
        assert resp.session_name == "my-session"
        assert resp.source_url == "https://github.com/org/repo.git"
        assert resp.source_ref == "develop"


# ── GET /workspaces ─────────────────────────────────────────────


class TestListWorkspaces:
    async def test_list_empty(self, app):
        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).get("/api/v1/volundr/workspaces")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_list_with_enrichment(self, app, storage, repository):
        session = Session(
            name="enriched-session",
            source=GitSource(repo="https://github.com/org/repo.git", branch="main"),
        )
        session = await repository.create(session)
        await storage.create_session_workspace(str(session.id), "user-1", "t1")

        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).get("/api/v1/volundr/workspaces")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["session_name"] == "enriched-session"
        assert data[0]["source_url"] == "https://github.com/org/repo.git"
        assert data[0]["source_ref"] == "main"

    async def test_list_with_status_filter(self, app):
        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).get("/api/v1/volundr/workspaces?status=archived")
        assert resp.status_code == 200
        assert resp.json() == []


# ── DELETE /workspaces/{session_id} ─────────────────────────────


class TestDeleteWorkspace:
    async def test_delete_workspace(self, app, storage):
        sid = str(uuid4())
        await storage.create_session_workspace(sid, "user-1", "t1")

        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).delete(f"/api/v1/volundr/workspaces/{sid}")
        assert resp.status_code == 204

    async def test_delete_nonexistent(self, app):
        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).delete(f"/api/v1/volundr/workspaces/{uuid4()}")
        assert resp.status_code == 404


# ── POST /workspaces/bulk-delete ────────────────────────────────


class TestBulkDeleteWorkspaces:
    async def test_empty_list(self, app):
        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).post(
                "/api/v1/volundr/workspaces/bulk-delete",
                json={"session_ids": []},
            )
        assert resp.status_code == 200
        assert resp.json() == {"deleted": 0, "failed": []}

    async def test_delete_owned(self, app, storage):
        sid1 = str(uuid4())
        sid2 = str(uuid4())
        await storage.create_session_workspace(sid1, "user-1", "t1")
        await storage.create_session_workspace(sid2, "user-1", "t1")

        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).post(
                "/api/v1/volundr/workspaces/bulk-delete",
                json={"session_ids": [sid1, sid2]},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] == 2
        assert data["failed"] == []

    async def test_delete_not_owned(self, app, storage):
        sid = str(uuid4())
        await storage.create_session_workspace(sid, "other-user", "t1")

        with patch(_PATCH_TARGET, _extract_user):
            resp = TestClient(app).post(
                "/api/v1/volundr/workspaces/bulk-delete",
                json={"session_ids": [sid]},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] == 0
        assert len(data["failed"]) == 1
        assert data["failed"][0]["error"] == "Not found or not owned"


# ── POST /admin/workspaces/bulk-delete ──────────────────────────


class TestAdminBulkDelete:
    async def test_empty_list(self, admin_app):
        with patch(_PATCH_TARGET, _extract_admin):
            resp = TestClient(admin_app).post(
                "/api/v1/volundr/admin/workspaces/bulk-delete",
                json={"session_ids": []},
            )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 0

    async def test_delete_any_user(self, admin_app, storage):
        sid = str(uuid4())
        await storage.create_session_workspace(sid, "any-user", "t1")

        with patch(_PATCH_TARGET, _extract_admin):
            resp = TestClient(admin_app).post(
                "/api/v1/volundr/admin/workspaces/bulk-delete",
                json={"session_ids": [sid]},
            )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

    async def test_delete_nonexistent(self, admin_app):
        with patch(_PATCH_TARGET, _extract_admin):
            resp = TestClient(admin_app).post(
                "/api/v1/volundr/admin/workspaces/bulk-delete",
                json={"session_ids": [str(uuid4())]},
            )
        data = resp.json()
        assert data["deleted"] == 0
        assert len(data["failed"]) == 1


# ── GET /admin/workspaces ───────────────────────────────────────


class TestAdminListWorkspaces:
    async def test_list_all_enriched(self, admin_app, storage, repository):
        session = Session(
            name="admin-session",
            source=GitSource(repo="https://github.com/org/repo.git", branch="dev"),
        )
        session = await repository.create(session)
        await storage.create_session_workspace(str(session.id), "any-user", "t1")

        with patch(_PATCH_TARGET, _extract_admin):
            resp = TestClient(admin_app).get("/api/v1/volundr/admin/workspaces")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["session_name"] == "admin-session"
        assert data[0]["source_url"] == "https://github.com/org/repo.git"
        assert data[0]["source_ref"] == "dev"

    async def test_list_filtered_by_user(self, admin_app, storage):
        await storage.create_session_workspace(str(uuid4()), "user-a", "t1")
        await storage.create_session_workspace(str(uuid4()), "user-b", "t1")

        with patch(_PATCH_TARGET, _extract_admin):
            resp = TestClient(admin_app).get("/api/v1/volundr/admin/workspaces?user_id=user-a")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
