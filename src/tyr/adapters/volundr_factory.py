"""Factory for resolving per-owner VolundrHTTPAdapter instances.

Supports multiple Volundr connections per user (multi-cluster).  Each enabled
CODE_FORGE IntegrationConnection becomes a separate VolundrHTTPAdapter.
A global fallback URL is used when the user has no per-user connections.
"""

from __future__ import annotations

import logging

from niuu.domain.models import IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from tyr.adapters.volundr_http import VolundrHTTPAdapter
from tyr.ports.volundr import VolundrPort

logger = logging.getLogger(__name__)

DEFAULT_VOLUNDR_URL = "http://volundr:8000"


class VolundrAdapterFactory:
    """Resolves VolundrHTTPAdapter instances for a specific owner.

    Returns all enabled CODE_FORGE connections as adapters.  When no
    per-user connections exist, the global ``fallback_url`` (from config)
    is returned as a single unauthenticated adapter so that system-level
    operations (watcher, queue listing) still work.
    """

    def __init__(
        self,
        integration_repo: IntegrationRepository,
        credential_store: CredentialStorePort,
        fallback_url: str = DEFAULT_VOLUNDR_URL,
    ) -> None:
        self._integration_repo = integration_repo
        self._credential_store = credential_store
        self._fallback_url = fallback_url

    async def for_owner(self, owner_id: str) -> list[VolundrPort]:
        """Return all configured VolundrHTTPAdapter instances for *owner_id*.

        Falls back to a single unauthenticated adapter using the global
        ``fallback_url`` when the user has no CODE_FORGE connections.
        """
        adapters = await self._resolve_connections(owner_id)
        if adapters:
            return adapters
        return [VolundrHTTPAdapter(base_url=self._fallback_url, name="default")]

    async def primary_for_owner(self, owner_id: str) -> VolundrPort | None:
        """Return the first (primary) adapter for *owner_id*, or ``None``.

        Unlike ``for_owner`` this does **not** fall back to the global URL —
        callers that need an authenticated adapter use this method.
        """
        adapters = await self._resolve_connections(owner_id)
        if adapters:
            return adapters[0]
        return None

    async def _resolve_connections(self, owner_id: str) -> list[VolundrPort]:
        """Resolve all enabled CODE_FORGE connections into adapters."""
        connections = await self._integration_repo.list_connections(
            owner_id,
            integration_type=IntegrationType.CODE_FORGE,
        )
        adapters: list[VolundrPort] = []
        for conn in connections:
            if not conn.enabled:
                continue
            try:
                cred = await self._credential_store.get_value(
                    "user", owner_id, conn.credential_name
                )
                if cred is None:
                    continue
                adapter_name = conn.config.get("name", "") or conn.slug or conn.id
                adapters.append(
                    VolundrHTTPAdapter(
                        base_url=conn.config.get("url", DEFAULT_VOLUNDR_URL),
                        api_key=cred.get("token"),
                        name=adapter_name,
                    )
                )
            except Exception:
                logger.error(
                    "Failed to create Volundr adapter for connection %s",
                    conn.id,
                    exc_info=True,
                )
        return adapters
