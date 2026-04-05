"""Tests for built-in permission adapters."""

from __future__ import annotations

from ravn.adapters.permission_adapter import (
    AllowAllPermission,
    AllowListPermission,
    DenyAllPermission,
)


class TestAllowAllPermission:
    async def test_allows_any(self) -> None:
        p = AllowAllPermission()
        assert await p.check("tool:anything") is True
        assert await p.check("some:random:permission") is True
        assert await p.check("") is True


class TestDenyAllPermission:
    async def test_denies_any(self) -> None:
        p = DenyAllPermission()
        assert await p.check("tool:anything") is False
        assert await p.check("") is False


class TestAllowListPermission:
    async def test_allows_listed(self) -> None:
        p = AllowListPermission({"tool:echo", "tool:read"})
        assert await p.check("tool:echo") is True
        assert await p.check("tool:read") is True

    async def test_denies_unlisted(self) -> None:
        p = AllowListPermission({"tool:echo"})
        assert await p.check("tool:write") is False

    async def test_empty_list(self) -> None:
        p = AllowListPermission(set())
        assert await p.check("tool:anything") is False
