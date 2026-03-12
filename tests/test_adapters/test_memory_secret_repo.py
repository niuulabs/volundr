"""Tests for InMemorySecretRepository adapter."""

from __future__ import annotations

import json

import pytest

from volundr.adapters.outbound.memory_secret_repo import (
    InMemorySecretRepository,
)
from volundr.domain.models import MountType, SecretMountSpec


@pytest.fixture
def repo() -> InMemorySecretRepository:
    """Create a fresh in-memory secret repository."""
    return InMemorySecretRepository()


class TestStoreAndGetCredential:
    """Tests for store_credential / get_credential roundtrip."""

    async def test_roundtrip(self, repo: InMemorySecretRepository):
        data = {"api_key": "secret-123", "host": "example.com"}
        await repo.store_credential("users/u1/keys/my-cred", data)

        result = await repo.get_credential("users/u1/keys/my-cred")
        assert result == data

    async def test_get_missing_returns_none(
        self,
        repo: InMemorySecretRepository,
    ):
        result = await repo.get_credential("nonexistent/path")
        assert result is None

    async def test_overwrite_existing(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.store_credential("p", {"k": "v1"})
        await repo.store_credential("p", {"k": "v2"})

        result = await repo.get_credential("p")
        assert result == {"k": "v2"}


class TestDeleteCredential:
    """Tests for delete_credential."""

    async def test_delete_existing_returns_true(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.store_credential("p", {"k": "v"})
        assert await repo.delete_credential("p") is True
        assert await repo.get_credential("p") is None

    async def test_delete_missing_returns_false(
        self,
        repo: InMemorySecretRepository,
    ):
        assert await repo.delete_credential("missing") is False


class TestListCredentials:
    """Tests for list_credentials with prefix filtering."""

    async def test_empty_store(
        self,
        repo: InMemorySecretRepository,
    ):
        result = await repo.list_credentials("users/u1/keys")
        assert result == []

    async def test_prefix_filtering(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.store_credential(
            "users/u1/keys/cred-a",
            {"k": "v"},
        )
        await repo.store_credential(
            "users/u1/keys/cred-b",
            {"k": "v"},
        )
        await repo.store_credential(
            "users/u2/keys/cred-c",
            {"k": "v"},
        )

        result = await repo.list_credentials("users/u1/keys")
        assert sorted(result) == ["cred-a", "cred-b"]

    async def test_nested_keys_return_directory_suffix(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.store_credential(
            "a/b/c/d",
            {"k": "v"},
        )

        result = await repo.list_credentials("a/b")
        assert result == ["c/"]


class TestProvisionUser:
    """Tests for provision_user."""

    async def test_creates_policy_and_role(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.provision_user("user-42", "tenant-1")

        policy_name = "volundr-user-user-42"
        assert policy_name in repo._policies
        assert repo._policies[policy_name] == "tenant-1"

        assert policy_name in repo._k8s_roles
        role = repo._k8s_roles[policy_name]
        assert role["policies"] == [policy_name]
        assert "volundr-session-user-user-42-*" in role["bound_service_account_names"]


class TestDeprovisionUser:
    """Tests for deprovision_user."""

    async def test_removes_policy_and_role(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.provision_user("user-42", "tenant-1")
        await repo.deprovision_user("user-42")

        assert "volundr-user-user-42" not in repo._policies
        assert "volundr-user-user-42" not in repo._k8s_roles

    async def test_deprovision_nonexistent_is_noop(
        self,
        repo: InMemorySecretRepository,
    ):
        await repo.deprovision_user("ghost")
        assert "volundr-user-ghost" not in repo._policies


class TestSessionSecrets:
    """Tests for create_session_secrets / delete_session_secrets."""

    async def test_create_session_secrets(
        self,
        repo: InMemorySecretRepository,
    ):
        mounts = [
            SecretMountSpec(
                secret_path="users/u1/keys/api",
                mount_type=MountType.ENV_FILE,
                destination="/home/volundr/.env",
            ),
        ]
        await repo.create_session_secrets("s1", "u1", mounts)

        manifest_data = await repo.get_credential(
            "sessions/s1/manifest",
        )
        assert manifest_data is not None
        manifest = json.loads(manifest_data["manifest"])
        assert manifest["user_id"] == "u1"
        assert len(manifest["mounts"]) == 1
        assert manifest["mounts"][0]["mount_type"] == "env_file"

    async def test_delete_session_secrets(
        self,
        repo: InMemorySecretRepository,
    ):
        mounts = [
            SecretMountSpec(
                secret_path="users/u1/keys/api",
                mount_type=MountType.FILE,
                destination="/run/secrets/api",
            ),
        ]
        await repo.create_session_secrets("s2", "u1", mounts)
        await repo.delete_session_secrets("s2")

        result = await repo.get_credential(
            "sessions/s2/manifest",
        )
        assert result is None
