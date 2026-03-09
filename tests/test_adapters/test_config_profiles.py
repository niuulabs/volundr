"""Tests for config-driven forge profile provider."""

from __future__ import annotations

import pytest

from volundr.adapters.outbound.config_profiles import ConfigProfileProvider
from volundr.config import ProfileConfig


@pytest.fixture
def sample_configs() -> list[ProfileConfig]:
    """Create sample profile configs."""
    return [
        ProfileConfig(
            name="standard",
            description="Standard coding session",
            workload_type="session",
            model="claude-sonnet-4",
            system_prompt="You are helpful.",
            resource_config={"cpu": "500m", "memory": "1Gi"},
            mcp_servers=[{"name": "fs", "command": "mcp-fs"}],
            env_vars={"MY_VAR": "value"},
            env_secret_refs=["secret-1"],
            workload_config={"timeout": 300},
            is_default=True,
        ),
        ProfileConfig(
            name="gpu-heavy",
            description="GPU-accelerated workspace",
            workload_type="session",
            model="claude-opus-4",
            resource_config={"cpu": "2", "memory": "8Gi", "gpu": "1"},
            is_default=False,
        ),
        ProfileConfig(
            name="ovas-worker",
            description="OVAS background worker",
            workload_type="ovas",
        ),
    ]


@pytest.fixture
def provider(sample_configs) -> ConfigProfileProvider:
    """Create a provider with sample configs."""
    return ConfigProfileProvider(sample_configs)


class TestConfigProfileProviderGet:
    """Tests for get method."""

    def test_get_returns_profile_when_found(self, provider: ConfigProfileProvider):
        """Get returns profile when name matches."""
        result = provider.get("standard")

        assert result is not None
        assert result.name == "standard"
        assert result.description == "Standard coding session"
        assert result.workload_type == "session"
        assert result.model == "claude-sonnet-4"
        assert result.system_prompt == "You are helpful."
        assert result.resource_config == {"cpu": "500m", "memory": "1Gi"}
        assert result.mcp_servers == [{"name": "fs", "command": "mcp-fs"}]
        assert result.env_vars == {"MY_VAR": "value"}
        assert result.env_secret_refs == ["secret-1"]
        assert result.workload_config == {"timeout": 300}
        assert result.is_default is True

    def test_get_returns_none_when_not_found(self, provider: ConfigProfileProvider):
        """Get returns None when name doesn't match."""
        result = provider.get("nonexistent")
        assert result is None

    def test_get_minimal_profile(self, provider: ConfigProfileProvider):
        """Get returns profile with defaults for minimal config."""
        result = provider.get("ovas-worker")

        assert result is not None
        assert result.name == "ovas-worker"
        assert result.workload_type == "ovas"
        assert result.model is None
        assert result.system_prompt is None
        assert result.resource_config == {}
        assert result.mcp_servers == []
        assert result.env_vars == {}
        assert result.env_secret_refs == []
        assert result.workload_config == {}
        assert result.is_default is False


class TestConfigProfileProviderList:
    """Tests for list method."""

    def test_list_returns_all_profiles(self, provider: ConfigProfileProvider):
        """List returns all profiles sorted by name."""
        result = provider.list()

        assert len(result) == 3
        names = [p.name for p in result]
        assert names == ["gpu-heavy", "ovas-worker", "standard"]

    def test_list_filtered_by_workload_type(self, provider: ConfigProfileProvider):
        """List filtered by workload_type returns matching profiles."""
        result = provider.list(workload_type="session")

        assert len(result) == 2
        names = {p.name for p in result}
        assert names == {"standard", "gpu-heavy"}

    def test_list_filtered_returns_single(self, provider: ConfigProfileProvider):
        """List filtered by ovas workload returns single profile."""
        result = provider.list(workload_type="ovas")

        assert len(result) == 1
        assert result[0].name == "ovas-worker"

    def test_list_empty_when_no_match(self, provider: ConfigProfileProvider):
        """List returns empty when no profiles match filter."""
        result = provider.list(workload_type="nonexistent")
        assert result == []

    def test_list_empty_provider(self):
        """List returns empty list for provider with no configs."""
        provider = ConfigProfileProvider([])
        result = provider.list()
        assert result == []


class TestConfigProfileProviderGetDefault:
    """Tests for get_default method."""

    def test_get_default_returns_default_profile(self, provider: ConfigProfileProvider):
        """get_default returns the default profile for a workload type."""
        result = provider.get_default("session")

        assert result is not None
        assert result.name == "standard"
        assert result.is_default is True

    def test_get_default_returns_none_when_no_default(self, provider: ConfigProfileProvider):
        """get_default returns None when no default exists for the type."""
        result = provider.get_default("ovas")
        assert result is None

    def test_get_default_returns_none_for_unknown_type(self, provider: ConfigProfileProvider):
        """get_default returns None for unknown workload type."""
        result = provider.get_default("unknown")
        assert result is None
