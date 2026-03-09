"""Tests for ConfigMCPServerProvider."""

from __future__ import annotations

import pytest

from volundr.adapters.outbound.config_mcp_servers import ConfigMCPServerProvider
from volundr.config import MCPServerEntry


@pytest.fixture
def sample_entries() -> list[MCPServerEntry]:
    """Create sample MCP server config entries."""
    return [
        MCPServerEntry(
            name="linear",
            type="stdio",
            command="npx",
            args=["-y", "@linear/mcp-server"],
            description="Linear issue tracking",
        ),
        MCPServerEntry(
            name="filesystem",
            type="stdio",
            command="mcp-fs",
            description="Local filesystem access",
        ),
        MCPServerEntry(
            name="api-server",
            type="sse",
            url="http://localhost:3000/sse",
            description="Custom API server",
        ),
    ]


@pytest.fixture
def provider(sample_entries) -> ConfigMCPServerProvider:
    """Create provider with sample data."""
    return ConfigMCPServerProvider(sample_entries)


class TestConfigMCPServerProviderList:
    """Tests for list method."""

    def test_list_returns_all(self, provider: ConfigMCPServerProvider):
        """List returns all configured servers."""
        result = provider.list()
        assert len(result) == 3

    def test_list_sorted_by_name(self, provider: ConfigMCPServerProvider):
        """List returns servers sorted by name."""
        result = provider.list()
        names = [s.name for s in result]
        assert names == ["api-server", "filesystem", "linear"]

    def test_list_empty_provider(self):
        """List returns empty list for empty config."""
        provider = ConfigMCPServerProvider([])
        assert provider.list() == []


class TestConfigMCPServerProviderGet:
    """Tests for get method."""

    def test_get_returns_server(self, provider: ConfigMCPServerProvider):
        """Get returns matching server config."""
        result = provider.get("linear")
        assert result is not None
        assert result.name == "linear"
        assert result.type == "stdio"
        assert result.command == "npx"
        assert list(result.args) == ["-y", "@linear/mcp-server"]
        assert result.description == "Linear issue tracking"

    def test_get_sse_server(self, provider: ConfigMCPServerProvider):
        """Get returns SSE-type server with url."""
        result = provider.get("api-server")
        assert result is not None
        assert result.type == "sse"
        assert result.url == "http://localhost:3000/sse"
        assert result.command is None

    def test_get_returns_none(self, provider: ConfigMCPServerProvider):
        """Get returns None for unknown name."""
        assert provider.get("nonexistent") is None
