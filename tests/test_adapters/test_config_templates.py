"""Tests for config-driven workspace template provider."""

from __future__ import annotations

import pytest

from volundr.adapters.outbound.config_templates import ConfigTemplateProvider
from volundr.config import TemplateConfig


@pytest.fixture
def sample_configs() -> list[TemplateConfig]:
    """Create sample template configs."""
    return [
        TemplateConfig(
            name="default-session",
            description="Default coding session",
            workload_type="session",
            model="claude-sonnet-4",
            system_prompt="You are helpful.",
            resource_config={"cpu": "500m", "memory": "1Gi"},
            mcp_servers=[{"name": "fs", "command": "mcp-fs"}],
            env_vars={"MY_VAR": "value"},
            env_secret_refs=["secret-1"],
            repos=[{"url": "https://github.com/org/repo", "branch": "main"}],
            setup_scripts=["pip install -r requirements.txt"],
            workspace_layout={"editor": "vscode"},
            is_default=True,
        ),
        TemplateConfig(
            name="data-science",
            description="Data science workspace",
            workload_type="session",
            model="claude-opus-4",
            resource_config={"cpu": "2", "memory": "8Gi"},
            repos=[],
            setup_scripts=["conda install numpy pandas"],
            workspace_layout={},
            is_default=False,
        ),
        TemplateConfig(
            name="minimal",
            description="Bare workspace",
        ),
    ]


@pytest.fixture
def provider(sample_configs) -> ConfigTemplateProvider:
    """Create a provider with sample configs."""
    return ConfigTemplateProvider(sample_configs)


class TestConfigTemplateProviderGet:
    """Tests for get method."""

    def test_get_returns_template_when_found(self, provider: ConfigTemplateProvider):
        """Get returns template when name matches."""
        result = provider.get("default-session")

        assert result is not None
        assert result.name == "default-session"
        assert result.description == "Default coding session"
        assert result.workload_type == "session"
        assert result.model == "claude-sonnet-4"
        assert result.system_prompt == "You are helpful."
        assert result.resource_config == {"cpu": "500m", "memory": "1Gi"}
        assert result.mcp_servers == [{"name": "fs", "command": "mcp-fs"}]
        assert result.env_vars == {"MY_VAR": "value"}
        assert result.env_secret_refs == ["secret-1"]
        assert result.repos == [{"url": "https://github.com/org/repo", "branch": "main"}]
        assert result.setup_scripts == ["pip install -r requirements.txt"]
        assert result.workspace_layout == {"editor": "vscode"}
        assert result.is_default is True

    def test_get_returns_none_when_not_found(self, provider: ConfigTemplateProvider):
        """Get returns None when name doesn't match."""
        result = provider.get("nonexistent")
        assert result is None

    def test_get_minimal_template(self, provider: ConfigTemplateProvider):
        """Get returns template with defaults for minimal config."""
        result = provider.get("minimal")

        assert result is not None
        assert result.name == "minimal"
        assert result.workload_type == "session"
        assert result.model is None
        assert result.system_prompt is None
        assert result.resource_config == {}
        assert result.mcp_servers == []
        assert result.env_vars == {}
        assert result.env_secret_refs == []
        assert result.repos == []
        assert result.setup_scripts == []
        assert result.workspace_layout == {}
        assert result.is_default is False


class TestConfigTemplateProviderList:
    """Tests for list method."""

    def test_list_returns_all_templates(self, provider: ConfigTemplateProvider):
        """List returns all templates sorted by name."""
        result = provider.list()

        assert len(result) == 3
        names = [t.name for t in result]
        assert names == ["data-science", "default-session", "minimal"]

    def test_list_filtered_by_workload_type(self, provider: ConfigTemplateProvider):
        """List filtered by workload_type returns matching templates."""
        result = provider.list(workload_type="session")

        assert len(result) == 3
        assert all(t.workload_type == "session" for t in result)

    def test_list_empty_when_no_match(self, provider: ConfigTemplateProvider):
        """List returns empty when no templates match filter."""
        result = provider.list(workload_type="nonexistent")
        assert result == []

    def test_list_empty_provider(self):
        """List returns empty list for provider with no configs."""
        provider = ConfigTemplateProvider([])
        result = provider.list()
        assert result == []
