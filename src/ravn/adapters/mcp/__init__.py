"""MCP (Model Context Protocol) client adapter for Ravn.

Implements the full MCP lifecycle:
  ConfigLoad → SpawnConnect → InitializeHandshake → ToolDiscovery
  → ResourceDiscovery → Registration → Invocation → Shutdown

Supports stdio and SSE/HTTP transports.
"""

from ravn.adapters.mcp.lifecycle import MCPLifecyclePhase, MCPServerState
from ravn.adapters.mcp.manager import MCPManager
from ravn.adapters.mcp.tool import MCPTool

__all__ = [
    "MCPLifecyclePhase",
    "MCPManager",
    "MCPServerState",
    "MCPTool",
]
