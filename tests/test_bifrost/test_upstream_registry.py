"""Tests for the Bifröst upstream registry."""

from __future__ import annotations

import pytest

from volundr.bifrost.upstream_registry import UpstreamRegistry

from .conftest import MockUpstreamProvider


class TestUpstreamRegistry:
    def test_get_known_name(self):
        provider = MockUpstreamProvider()
        registry = UpstreamRegistry({"anthropic": provider})

        assert registry.get("anthropic") is provider

    def test_get_falls_back_to_default(self):
        default = MockUpstreamProvider()
        registry = UpstreamRegistry({"default": default})

        result = registry.get("unknown_name")
        assert result is default

    def test_get_raises_when_no_default(self):
        provider = MockUpstreamProvider()
        registry = UpstreamRegistry({"ollama": provider})

        with pytest.raises(KeyError, match="No upstream named"):
            registry.get("unknown_name")

    def test_names_property(self):
        registry = UpstreamRegistry(
            {
                "anthropic": MockUpstreamProvider(),
                "ollama": MockUpstreamProvider(),
            }
        )

        names = registry.names
        assert "anthropic" in names
        assert "ollama" in names
        assert len(names) == 2

    async def test_close_all(self):
        p1 = MockUpstreamProvider()
        p2 = MockUpstreamProvider()
        registry = UpstreamRegistry({"a": p1, "b": p2})

        await registry.close_all()

        assert p1.closed is True
        assert p2.closed is True

    async def test_close_all_handles_errors(self):
        class FailingProvider(MockUpstreamProvider):
            async def close(self) -> None:
                raise RuntimeError("close failed")

        p1 = FailingProvider()
        p2 = MockUpstreamProvider()
        registry = UpstreamRegistry({"a": p1, "b": p2})

        # Should not raise — errors are swallowed
        await registry.close_all()
        assert p2.closed is True
