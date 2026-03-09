"""Tests for InMemorySecretManager."""

from __future__ import annotations

import pytest

from volundr.adapters.outbound.memory_secrets import InMemorySecretManager, validate_k8s_name
from volundr.domain.models import SecretInfo
from volundr.domain.ports import SecretAlreadyExistsError, SecretValidationError


@pytest.fixture
def manager() -> InMemorySecretManager:
    """Create manager with sample secrets."""
    return InMemorySecretManager([
        SecretInfo(name="github-token", keys=["GITHUB_TOKEN"]),
        SecretInfo(name="api-key", keys=["API_KEY", "API_SECRET"]),
    ])


class TestValidateK8sName:
    """Tests for Kubernetes name validation."""

    def test_valid_names(self):
        """Valid k8s names pass validation."""
        for name in ["a", "my-secret", "secret-123", "a1b2c3"]:
            validate_k8s_name(name)  # Should not raise

    def test_invalid_empty(self):
        """Empty name fails validation."""
        with pytest.raises(SecretValidationError):
            validate_k8s_name("")

    def test_invalid_uppercase(self):
        """Uppercase name fails validation."""
        with pytest.raises(SecretValidationError):
            validate_k8s_name("MySecret")

    def test_invalid_underscore(self):
        """Name with underscore fails validation."""
        with pytest.raises(SecretValidationError):
            validate_k8s_name("my_secret")

    def test_invalid_starts_with_hyphen(self):
        """Name starting with hyphen fails validation."""
        with pytest.raises(SecretValidationError):
            validate_k8s_name("-my-secret")

    def test_invalid_ends_with_hyphen(self):
        """Name ending with hyphen fails validation."""
        with pytest.raises(SecretValidationError):
            validate_k8s_name("my-secret-")


class TestInMemorySecretManagerList:
    """Tests for list method."""

    async def test_list_returns_all(self, manager: InMemorySecretManager):
        """List returns all secrets."""
        result = await manager.list()
        assert len(result) == 2

    async def test_list_sorted_by_name(self, manager: InMemorySecretManager):
        """List returns secrets sorted by name."""
        result = await manager.list()
        names = [s.name for s in result]
        assert names == ["api-key", "github-token"]

    async def test_list_empty(self):
        """List returns empty list for empty manager."""
        manager = InMemorySecretManager()
        result = await manager.list()
        assert result == []


class TestInMemorySecretManagerGet:
    """Tests for get method."""

    async def test_get_returns_secret(self, manager: InMemorySecretManager):
        """Get returns matching secret metadata."""
        result = await manager.get("github-token")
        assert result is not None
        assert result.name == "github-token"
        assert list(result.keys) == ["GITHUB_TOKEN"]

    async def test_get_returns_none(self, manager: InMemorySecretManager):
        """Get returns None for unknown name."""
        result = await manager.get("nonexistent")
        assert result is None


class TestInMemorySecretManagerCreate:
    """Tests for create method."""

    async def test_create_success(self, manager: InMemorySecretManager):
        """Create returns new secret info."""
        result = await manager.create("new-secret", {"KEY": "value"})
        assert result.name == "new-secret"
        assert list(result.keys) == ["KEY"]

    async def test_create_appears_in_list(self, manager: InMemorySecretManager):
        """Created secret appears in list."""
        await manager.create("new-secret", {"KEY": "value"})
        result = await manager.list()
        names = [s.name for s in result]
        assert "new-secret" in names

    async def test_create_duplicate_raises(self, manager: InMemorySecretManager):
        """Create raises for duplicate name."""
        with pytest.raises(SecretAlreadyExistsError):
            await manager.create("github-token", {"KEY": "value"})

    async def test_create_invalid_name_raises(self, manager: InMemorySecretManager):
        """Create raises for invalid k8s name."""
        with pytest.raises(SecretValidationError):
            await manager.create("INVALID!", {"KEY": "value"})
