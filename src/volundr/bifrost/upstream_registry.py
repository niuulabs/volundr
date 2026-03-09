"""Upstream registry — holds named upstream providers."""

from __future__ import annotations

import logging

from volundr.bifrost.ports import UpstreamProvider

logger = logging.getLogger(__name__)


class UpstreamRegistry:
    """Registry of named upstream providers.

    Falls back to ``"default"`` when a name is not found.
    """

    def __init__(self, providers: dict[str, UpstreamProvider]) -> None:
        self._providers = providers

    def get(self, name: str) -> UpstreamProvider:
        if name in self._providers:
            return self._providers[name]
        if "default" in self._providers:
            logger.warning(
                "Upstream '%s' not found, using 'default'",
                name,
            )
            return self._providers["default"]
        raise KeyError(f"No upstream named '{name}' and no default")

    @property
    def names(self) -> list[str]:
        return list(self._providers.keys())

    async def close_all(self) -> None:
        for name, provider in self._providers.items():
            try:
                await provider.close()
            except Exception:
                logger.exception("Error closing upstream '%s'", name)
