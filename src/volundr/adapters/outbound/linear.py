"""Linear issue tracker adapter for Volundr.

Thin wrapper around the shared LinearTrackerBase from niuu.
All browsing, search, and status management is inherited.
"""

from __future__ import annotations

from niuu.adapters.linear import GraphQLError  # noqa: F401 — re-exported
from niuu.adapters.linear_tracker import LinearTrackerBase
from niuu.domain.models import CacheEntry as _CacheEntry  # noqa: F401 — re-exported for tests

# Keep backward-compatible alias
LinearAPIError = GraphQLError


class LinearAdapter(LinearTrackerBase):
    """Linear issue tracker adapter for Volundr.

    Inherits all functionality from LinearTrackerBase.
    Kept as a named subclass for wiring clarity and backward compatibility.
    """

    # -- Delegate cache/query to shared client for test access --

    def _get_cached(self, key: str) -> object | None:
        return self._gql.get_cached(key)

    def _set_cached(self, key: str, value: object, ttl: float) -> None:
        self._gql.set_cached(key, value, ttl)

    async def _graphql(
        self,
        query: str,
        variables: dict | None = None,
    ) -> dict:
        return await self._gql.query(query, variables)
