"""Integration contributor — resolves integrations into MCP servers and env vars."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from volundr.domain.models import Session
from volundr.domain.ports import (
    SessionContext,
    SessionContribution,
    SessionContributor,
)

if TYPE_CHECKING:
    from volundr.domain.services.integration_registry import IntegrationRegistry
    from volundr.domain.services.user_integration import UserIntegrationService

logger = logging.getLogger(__name__)


class IntegrationContributor(SessionContributor):
    """Resolves user-selected integration connections into MCP server configs
    and/or environment variable injections.

    MCP integrations (those with an ``mcp_server`` spec) produce entries in
    ``mcpServers``.  Non-MCP integrations (e.g. ``ai_provider``) produce
    ``envSecrets`` entries so their credential values are injected as
    container env vars.
    """

    def __init__(
        self,
        *,
        integration_registry: IntegrationRegistry | None = None,
        user_integration: UserIntegrationService | None = None,
        **_extra: object,
    ):
        self._registry = integration_registry
        self._user_integration = user_integration

    @property
    def name(self) -> str:
        return "integrations"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        if not context.integration_connections:
            return SessionContribution()

        if self._registry is None:
            return SessionContribution()

        active = context.integration_connections

        # Fetch all credentials concurrently via UserIntegrationService
        if context.principal and self._user_integration:
            cred_results = await asyncio.gather(
                *(
                    self._user_integration.resolve_credentials(
                        context.principal.user_id,
                        c.credential_name,
                    )
                    for c in active
                ),
            )
        else:
            cred_results = [{}] * len(active)

        mcp_servers: list[dict[str, Any]] = []
        env_secrets: list[dict[str, str]] = []

        for conn, credentials in zip(active, cred_results):
            # MCP server integration
            server_config = self._registry.build_mcp_server_config(conn, credentials)
            if server_config is not None:
                mcp_servers.append(server_config)
                continue

            # Non-MCP integration — check for env_from_credentials on definition
            defn = self._registry.get_definition(conn.slug)
            if defn is None or not defn.env_from_credentials:
                continue

            for env_var, cred_field in defn.env_from_credentials.items():
                env_secrets.append(
                    {
                        "envVar": env_var,
                        "secretName": conn.credential_name,
                        "secretKey": cred_field,
                    }
                )

        values: dict[str, Any] = {}
        if mcp_servers:
            values["mcpServers"] = mcp_servers
        if env_secrets:
            values["envSecrets"] = env_secrets

        if not values:
            return SessionContribution()

        return SessionContribution(values=values)
