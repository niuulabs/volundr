"""Tests for FileCredentialStore adapter."""

from __future__ import annotations

from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from volundr.adapters.outbound.file_credential_store import FileCredentialStore
from volundr.domain.models import SecretType


class TestFileCredentialStore:
    """CRUD and encryption tests for the file-based credential store."""

    @pytest.fixture()
    def store(self, tmp_path: Path) -> FileCredentialStore:
        return FileCredentialStore(base_dir=str(tmp_path))

    @pytest.fixture()
    def encrypted_store(self, tmp_path: Path) -> FileCredentialStore:
        key = Fernet.generate_key().decode()
        return FileCredentialStore(
            base_dir=str(tmp_path / "encrypted"),
            encryption_key=key,
        )

    # ------------------------------------------------------------------
    # Basic CRUD
    # ------------------------------------------------------------------

    @pytest.mark.asyncio()
    async def test_store_and_get(self, store: FileCredentialStore) -> None:
        cred = await store.store("user", "u1", "my-key", SecretType.API_KEY, {"token": "abc"})
        assert cred.name == "my-key"
        assert cred.secret_type == SecretType.API_KEY
        assert "token" in cred.keys
        assert cred.owner_id == "u1"
        assert cred.owner_type == "user"

        fetched = await store.get("user", "u1", "my-key")
        assert fetched is not None
        assert fetched.name == "my-key"
        assert fetched.id == cred.id

    @pytest.mark.asyncio()
    async def test_store_and_get_value(self, store: FileCredentialStore) -> None:
        await store.store("user", "u1", "my-key", SecretType.API_KEY, {"token": "secret-val"})
        value = await store.get_value("user", "u1", "my-key")
        assert value is not None
        assert value == {"token": "secret-val"}

    @pytest.mark.asyncio()
    async def test_store_overwrites_existing(self, store: FileCredentialStore) -> None:
        cred1 = await store.store("user", "u1", "my-key", SecretType.API_KEY, {"token": "v1"})
        cred2 = await store.store("user", "u1", "my-key", SecretType.API_KEY, {"token": "v2"})
        # Same id is preserved on overwrite
        assert cred2.id == cred1.id
        assert cred2.created_at == cred1.created_at
        assert cred2.updated_at >= cred1.updated_at

        value = await store.get_value("user", "u1", "my-key")
        assert value == {"token": "v2"}

    @pytest.mark.asyncio()
    async def test_get_nonexistent(self, store: FileCredentialStore) -> None:
        result = await store.get("user", "u1", "nope")
        assert result is None

    @pytest.mark.asyncio()
    async def test_get_value_nonexistent(self, store: FileCredentialStore) -> None:
        result = await store.get_value("user", "u1", "nope")
        assert result is None

    @pytest.mark.asyncio()
    async def test_delete_existing(self, store: FileCredentialStore) -> None:
        await store.store("user", "u1", "my-key", SecretType.API_KEY, {"token": "abc"})
        await store.delete("user", "u1", "my-key")
        assert await store.get("user", "u1", "my-key") is None
        assert await store.get_value("user", "u1", "my-key") is None

    @pytest.mark.asyncio()
    async def test_delete_nonexistent(self, store: FileCredentialStore) -> None:
        # delete is a no-op for missing credentials -- should not raise
        await store.delete("user", "u1", "nope")

    @pytest.mark.asyncio()
    async def test_list_all(self, store: FileCredentialStore) -> None:
        await store.store("user", "u1", "key-a", SecretType.API_KEY, {"k": "1"})
        await store.store("user", "u1", "key-b", SecretType.API_KEY, {"k": "2"})
        await store.store("user", "u1", "key-c", SecretType.GENERIC, {"k": "3"})

        results = await store.list("user", "u1")
        assert len(results) == 3
        assert [c.name for c in results] == ["key-a", "key-b", "key-c"]

    @pytest.mark.asyncio()
    async def test_list_filtered_by_type(self, store: FileCredentialStore) -> None:
        await store.store("user", "u1", "api", SecretType.API_KEY, {"k": "1"})
        await store.store("user", "u1", "ssh", SecretType.SSH_KEY, {"k": "2"})
        await store.store("user", "u1", "gen", SecretType.GENERIC, {"k": "3"})

        results = await store.list("user", "u1", secret_type=SecretType.API_KEY)
        assert len(results) == 1
        assert results[0].name == "api"

    @pytest.mark.asyncio()
    async def test_health_check_writable(self, store: FileCredentialStore) -> None:
        result = await store.health_check()
        assert result is True

    # ------------------------------------------------------------------
    # Encryption
    # ------------------------------------------------------------------

    @pytest.mark.asyncio()
    async def test_store_with_encryption(self, encrypted_store: FileCredentialStore) -> None:
        await encrypted_store.store(
            "user", "u1", "secret", SecretType.API_KEY, {"token": "plain-text"}
        )
        # Read the raw file -- it should NOT be valid JSON (it's encrypted)
        cred_file = encrypted_store._base_dir / "user" / "u1" / "credentials.json"
        raw = cred_file.read_bytes()
        assert b"plain-text" not in raw
        # Encrypted Fernet tokens start with 'gAAAAA'
        assert raw.startswith(b"gAAAAA")

    @pytest.mark.asyncio()
    async def test_store_and_get_with_encryption(
        self, encrypted_store: FileCredentialStore
    ) -> None:
        await encrypted_store.store(
            "user", "u1", "secret", SecretType.API_KEY, {"token": "my-secret"}
        )
        cred = await encrypted_store.get("user", "u1", "secret")
        assert cred is not None
        assert cred.name == "secret"

        value = await encrypted_store.get_value("user", "u1", "secret")
        assert value == {"token": "my-secret"}
