"""MCPTool — a ToolPort that proxies calls to an MCP server tool."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort

if TYPE_CHECKING:
    from ravn.adapters.mcp.client import MCPServerClient

logger = logging.getLogger(__name__)


class MCPTool(ToolPort):
    """A ToolPort whose execution is proxied to a remote MCP server tool.

    Registered in the Ravn tool registry under the prefixed name
    ``mcp__{server_name}__{original_tool_name}``.

    Args:
        server_client: The live MCPServerClient managing the connection.
        original_name: The tool name as advertised by the MCP server.
        prefixed_name: The prefixed name used in the Ravn registry.
        description: Tool description from the server.
        input_schema: JSON Schema from the server.
    """

    def __init__(
        self,
        server_client: MCPServerClient,
        original_name: str,
        prefixed_name: str,
        description: str,
        input_schema: dict[str, Any],
    ) -> None:
        self._server_client = server_client
        self._original_name = original_name
        self._prefixed_name = prefixed_name
        self._description = description
        self._input_schema = input_schema

    @property
    def name(self) -> str:
        return self._prefixed_name

    @property
    def description(self) -> str:
        return self._description

    @property
    def input_schema(self) -> dict:
        return self._input_schema

    @property
    def required_permission(self) -> str:
        return "mcp:call"

    async def execute(self, input: dict) -> ToolResult:
        return await self._server_client.call_tool(self._original_name, input)
