"""Tests for WorkspaceService."""

from __future__ import annotations

from uuid import uuid4

import pytest

from volundr.adapters.outbound.k8s_storage import InMemoryStorageAdapter
from volundr.domain.models import WorkspaceStatus
from volundr.domain.services.workspace import WorkspaceService


@pytest.fixture
def storage():
    return InMemoryStorageAdapter()


@pytest.fixture
def service(storage):
    return WorkspaceService(storage)


class TestWorkspaceServiceList:
    """Tests for listing workspaces."""

    async def test_list_empty(self, service):
        result = await service.list_workspaces("user-1")
        assert result == []

    async def test_list_workspaces_after_create(self, service, storage):
        sid = str(uuid4())
        await storage.create_session_workspace(sid, "user-1", "tenant-1")

        result = await service.list_workspaces("user-1")
        assert len(result) == 1
        assert result[0].user_id == "user-1"

    async def test_list_filters_by_user(self, service, storage):
        await storage.create_session_workspace(str(uuid4()), "user-1", "t")
        await storage.create_session_workspace(str(uuid4()), "user-2", "t")

        result = await service.list_workspaces("user-1")
        assert len(result) == 1

    async def test_list_filters_by_status(self, service, storage):
        sid_active = str(uuid4())
        sid_archived = str(uuid4())
        await storage.create_session_workspace(sid_active, "user-1", "t")
        await storage.create_session_workspace(sid_archived, "user-1", "t")
        await storage.archive_session_workspace(sid_archived)

        active = await service.list_workspaces("user-1", WorkspaceStatus.ACTIVE)
        assert len(active) == 1

        archived = await service.list_workspaces(
            "user-1",
            WorkspaceStatus.ARCHIVED,
        )
        assert len(archived) == 1

    async def test_list_all_workspaces(self, service, storage):
        await storage.create_session_workspace(str(uuid4()), "user-1", "t")
        await storage.create_session_workspace(str(uuid4()), "user-2", "t")

        result = await service.list_all_workspaces()
        assert len(result) == 2


class TestWorkspaceServiceDelete:
    """Tests for deleting a workspace."""

    async def test_delete_workspace(self, service, storage):
        sid = str(uuid4())
        await storage.create_session_workspace(sid, "user-1", "t")

        result = await service.delete_workspace_by_session(sid)
        assert result is True

        # Workspace should be gone
        remaining = await service.list_workspaces("user-1")
        assert len(remaining) == 0

    async def test_delete_nonexistent(self, service):
        result = await service.delete_workspace_by_session(str(uuid4()))
        assert result is False
