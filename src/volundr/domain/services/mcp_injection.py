"""MCP auto-injection for session startup.

Collects enabled ``IntegrationConnection`` objects for a user,
resolves their credentials, and builds MCP server config dicts
ready to merge into ``task_args["mcpServers"]``.
"""

from __future__ import annotations

import logging

from volundr.domain.ports import CredentialStorePort, IntegrationRepository
from volundr.domain.services.integration_registry import IntegrationRegistry

logger = logging.getLogger(__name__)


class MCPInjectionService:
    """Builds MCP server configs from user integrations."""

    def __init__(
        self,
        registry: IntegrationRegistry,
        integration_repo: IntegrationRepository,
        credential_store: CredentialStorePort,
    ) -> None:
        self._registry = registry
        self._integration_repo = integration_repo
        self._credential_store = credential_store

    async def collect_mcp_servers(
        self,
        user_id: str,
    ) -> list[dict]:
        """Return MCP server config dicts for all enabled integrations.

        Each dict is suitable for inclusion in ``task_args["mcpServers"]``.
        Integrations without an MCP server spec are silently skipped.
        Credential lookup failures are logged and skipped (best-effort).
        """
        connections = await self._integration_repo.list_connections(user_id)
        servers: list[dict] = []

        for conn in connections:
            if not conn.enabled:
                continue

            if not conn.slug:
                continue

            defn = self._registry.get_definition(conn.slug)
            if defn is None or defn.mcp_server is None:
                continue

            creds = await self._credential_store.get_value(
                "user",
                user_id,
                conn.credential_name,
            )
            if creds is None:
                logger.warning(
                    "Skipping MCP injection for %s: credential '%s' not found",
                    conn.slug,
                    conn.credential_name,
                )
                continue

            server_cfg = self._registry.build_mcp_server_config(conn, creds)
            if server_cfg is not None:
                servers.append(server_cfg)
                logger.debug(
                    "MCP auto-inject: %s for user %s",
                    server_cfg["name"],
                    user_id,
                )

        return servers
