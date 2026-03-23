"""Factory for resolving per-owner TrackerPort adapter instances."""

from __future__ import annotations

import logging

from niuu.domain.models import IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from niuu.utils import import_class
from tyr.ports.tracker import TrackerPort

logger = logging.getLogger(__name__)


class TrackerAdapterFactory:
    """Resolves tracker adapters for a specific owner from stored credentials."""

    def __init__(
        self,
        integration_repo: IntegrationRepository,
        credential_store: CredentialStorePort,
    ) -> None:
        self._integration_repo = integration_repo
        self._credential_store = credential_store

    async def for_owner(self, owner_id: str) -> list[TrackerPort]:
        """Return all enabled TrackerPort adapters for the owner.

        Uses the dynamic adapter pattern: import_class(conn.adapter)(**kwargs).
        """
        connections = await self._integration_repo.list_connections(
            owner_id,
            integration_type=IntegrationType.ISSUE_TRACKER,
        )
        adapters: list[TrackerPort] = []
        for conn in connections:
            if not conn.enabled:
                continue
            try:
                cred = await self._credential_store.get_value(
                    "user",
                    owner_id,
                    conn.credential_name,
                )
                if cred is None:
                    continue

                cls = import_class(conn.adapter)
                kwargs = {**cred, **conn.config}
                adapters.append(cls(**kwargs))
            except Exception:
                logger.warning(
                    "Failed to create tracker adapter for connection %s",
                    conn.id,
                    exc_info=True,
                )
        return adapters
