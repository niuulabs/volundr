"""Built-in permission adapter implementations."""

from __future__ import annotations

from ravn.ports.permission import PermissionPort


class AllowAllPermission(PermissionPort):
    """Grants every permission — suitable for trusted/local contexts."""

    async def check(self, permission: str) -> bool:
        return True


class DenyAllPermission(PermissionPort):
    """Denies every permission — used to block all tool execution."""

    async def check(self, permission: str) -> bool:
        return False


class AllowListPermission(PermissionPort):
    """Grants only the permissions in a fixed allow-list."""

    def __init__(self, allowed: set[str]) -> None:
        self._allowed = allowed

    async def check(self, permission: str) -> bool:
        return permission in self._allowed
