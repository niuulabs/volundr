"""MCP lifecycle phase and server health state tracking."""

from __future__ import annotations

from enum import StrEnum


class MCPLifecyclePhase(StrEnum):
    """Phases in the MCP server connection lifecycle."""

    CONFIG_LOAD = "config_load"
    SPAWN_CONNECT = "spawn_connect"
    INITIALIZE_HANDSHAKE = "initialize_handshake"
    TOOL_DISCOVERY = "tool_discovery"
    RESOURCE_DISCOVERY = "resource_discovery"
    REGISTRATION = "registration"
    READY = "ready"
    SHUTDOWN = "shutdown"


class MCPServerState(StrEnum):
    """Per-server health states."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    AUTH_REQUIRED = "auth_required"
    ERROR = "error"
