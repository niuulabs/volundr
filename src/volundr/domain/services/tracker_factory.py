"""Factory for creating issue tracker adapters from integration connections."""

from __future__ import annotations

import logging

from volundr.domain.models import IntegrationConnection
from volundr.domain.ports import IssueTrackerProvider, SecretRepository
from volundr.utils import import_class as _import_class

logger = logging.getLogger(__name__)


class TrackerFactory:
    """Creates IssueTrackerProvider instances from IntegrationConnection configs.

    Resolves the credential from the SecretRepository, imports the adapter
    class, and instantiates it with the merged credential + config kwargs.
    """

    def __init__(self, secret_repo: SecretRepository) -> None:
        self._secret_repo = secret_repo

    async def create(self, connection: IntegrationConnection) -> IssueTrackerProvider:
        """Create an IssueTrackerProvider from a connection definition.

        Args:
            connection: The integration connection with adapter class path,
                        credential name, and adapter-specific config.

        Returns:
            An instantiated IssueTrackerProvider.

        Raises:
            ValueError: If the credential is not found.
        """
        cred_path = f"users/{connection.user_id}/{connection.credential_name}"
        cred = await self._secret_repo.get_credential(cred_path)
        if cred is None:
            raise ValueError(
                f"Credential '{connection.credential_name}' not found "
                f"for user '{connection.user_id}'"
            )

        cls = _import_class(connection.adapter)
        kwargs = {**cred, **connection.config}
        instance = cls(**kwargs)
        logger.info(
            "Created tracker adapter: %s (user=%s)",
            connection.adapter.rsplit(".", 1)[-1],
            connection.user_id,
        )
        return instance
