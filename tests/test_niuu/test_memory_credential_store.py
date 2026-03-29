"""Tests for MemoryCredentialStore."""

from __future__ import annotations

import pytest

from niuu.adapters.memory_credential_store import MemoryCredentialStore
from niuu.domain.models import SecretType


@pytest.fixture
def store() -> MemoryCredentialStore:
    return MemoryCredentialStore()


class TestStore:
    async def test_store_and_get(self, store: MemoryCredentialStore):
        cred = await store.store("user", "u1", "my-key", SecretType.API_KEY, {"api_key": "secret"})
        assert cred.name == "my-key"
        assert cred.secret_type == SecretType.API_KEY

    async def test_get_returns_stored(self, store: MemoryCredentialStore):
        await store.store("user", "u1", "k", SecretType.API_KEY, {"api_key": "x"})
        cred = await store.get("user", "u1", "k")
        assert cred is not None
        assert cred.name == "k"

    async def test_get_missing(self, store: MemoryCredentialStore):
        result = await store.get("user", "u1", "nope")
        assert result is None

    async def test_get_value(self, store: MemoryCredentialStore):
        await store.store("user", "u1", "k", SecretType.API_KEY, {"api_key": "val"})
        value = await store.get_value("user", "u1", "k")
        assert value == {"api_key": "val"}

    async def test_get_value_missing(self, store: MemoryCredentialStore):
        result = await store.get_value("user", "u1", "nope")
        assert result is None

    async def test_delete(self, store: MemoryCredentialStore):
        await store.store("user", "u1", "k", SecretType.API_KEY, {"x": "y"})
        await store.delete("user", "u1", "k")
        assert await store.get("user", "u1", "k") is None

    async def test_list(self, store: MemoryCredentialStore):
        await store.store("user", "u1", "a", SecretType.API_KEY, {"x": "1"})
        await store.store("user", "u1", "b", SecretType.SSH_KEY, {"x": "2"})
        all_creds = await store.list("user", "u1")
        assert len(all_creds) == 2

    async def test_list_filtered(self, store: MemoryCredentialStore):
        await store.store("user", "u1", "a", SecretType.API_KEY, {"x": "1"})
        await store.store("user", "u1", "b", SecretType.SSH_KEY, {"x": "2"})
        filtered = await store.list("user", "u1", secret_type=SecretType.API_KEY)
        assert len(filtered) == 1
        assert filtered[0].name == "a"

    async def test_health_check(self, store: MemoryCredentialStore):
        assert await store.health_check() is True
