"""Factory for resolving per-owner notification channel instances."""

from __future__ import annotations

import logging

from niuu.domain.models import IntegrationType
from niuu.ports.credentials import CredentialStorePort
from niuu.ports.integrations import IntegrationRepository
from niuu.utils import import_class
from tyr.ports.notification_channel import NotificationChannel

logger = logging.getLogger(__name__)


class NotificationChannelFactory:
    """Resolves notification channels for a specific owner from stored config.

    Uses the dynamic adapter pattern: each IntegrationConnection with
    integration_type=MESSAGING becomes a NotificationChannel instance.
    The ``adapter`` field is a fully-qualified class path, and ``config``
    provides kwargs (e.g. chat_id, min_urgency).
    """

    def __init__(
        self,
        integration_repo: IntegrationRepository,
        credential_store: CredentialStorePort,
    ) -> None:
        self._integration_repo = integration_repo
        self._credential_store = credential_store

    async def for_owner(self, owner_id: str) -> list[NotificationChannel]:
        """Return all enabled NotificationChannel adapters for the owner."""
        connections = await self._integration_repo.list_connections(
            owner_id,
            integration_type=IntegrationType.MESSAGING,
        )
        channels: list[NotificationChannel] = []
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
                    logger.debug(
                        "No credential found for connection %s, skipping",
                        conn.id,
                    )
                    continue

                cls = import_class(conn.adapter)
                kwargs = {**cred, **conn.config}
                channels.append(cls(**kwargs))
            except (ImportError, TypeError, ValueError, AttributeError) as exc:
                logger.error(
                    "Failed to create notification channel for connection %s: %s",
                    conn.id,
                    exc,
                )
            except Exception:
                logger.error(
                    "Unexpected error creating notification channel for connection %s",
                    conn.id,
                    exc_info=True,
                )
        return channels
