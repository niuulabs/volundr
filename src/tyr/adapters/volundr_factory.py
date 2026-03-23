"""Factory for resolving per-owner VolundrHTTPAdapter instances."""

from __future__ import annotations

from niuu.domain.models import IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from tyr.adapters.volundr_http import VolundrHTTPAdapter

DEFAULT_VOLUNDR_URL = "http://volundr:8000"


class VolundrAdapterFactory:
    """Resolves a VolundrHTTPAdapter for a specific owner from stored credentials."""

    def __init__(
        self,
        integration_repo: IntegrationRepository,
        credential_store: CredentialStorePort,
    ) -> None:
        self._integration_repo = integration_repo
        self._credential_store = credential_store

    async def for_owner(self, owner_id: str) -> VolundrHTTPAdapter | None:
        """Return a VolundrHTTPAdapter with stored PAT, or None if not configured."""
        connections = await self._integration_repo.list_connections(
            owner_id,
            integration_type=IntegrationType.CODE_FORGE,
        )
        conn = next((c for c in connections if c.enabled), None)
        if conn is None:
            return None

        cred = await self._credential_store.get_value("user", owner_id, conn.credential_name)
        if cred is None:
            return None

        return VolundrHTTPAdapter(
            base_url=conn.config.get("url", DEFAULT_VOLUNDR_URL),
            api_key=cred.get("api_key"),
        )
