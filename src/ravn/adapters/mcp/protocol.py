"""MCP JSON-RPC 2.0 protocol helpers.

Handles message construction and response parsing for the MCP wire protocol.
"""

from __future__ import annotations

import itertools
from typing import Any

# MCP protocol version advertised during handshake.
MCP_PROTOCOL_VERSION = "2024-11-05"

_id_counter = itertools.count(1)


def next_id() -> int:
    return next(_id_counter)


def make_request(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a JSON-RPC 2.0 request."""
    msg: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": next_id(),
        "method": method,
    }
    if params is not None:
        msg["params"] = params
    return msg


def make_notification(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a JSON-RPC 2.0 notification (no id, no response expected)."""
    msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    return msg


def make_initialize_request() -> dict[str, Any]:
    return make_request(
        "initialize",
        {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}, "resources": {}},
            "clientInfo": {"name": "ravn", "version": "1.0.0"},
        },
    )


def make_initialized_notification() -> dict[str, Any]:
    return make_notification("notifications/initialized")


def make_tools_list_request() -> dict[str, Any]:
    return make_request("tools/list")


def make_resources_list_request() -> dict[str, Any]:
    return make_request("resources/list")


def make_tool_call_request(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return make_request("tools/call", {"name": name, "arguments": arguments})


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


class MCPProtocolError(Exception):
    """Raised when the server returns a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        self.code = code
        self.data = data
        super().__init__(f"MCP error {code}: {message}")


def extract_result(response: dict[str, Any]) -> Any:
    """Return the ``result`` field or raise MCPProtocolError on error."""
    if "error" in response:
        err = response["error"]
        raise MCPProtocolError(
            code=err.get("code", -1),
            message=err.get("message", "unknown error"),
            data=err.get("data"),
        )
    return response.get("result")


def parse_tool_definitions(result: Any) -> list[dict[str, Any]]:
    """Extract the list of tool defs from a ``tools/list`` result."""
    if not isinstance(result, dict):
        return []
    return list(result.get("tools", []))


def parse_tool_call_result(result: Any) -> tuple[str, bool]:
    """Return (content_text, is_error) from a ``tools/call`` result."""
    if not isinstance(result, dict):
        return (str(result), False)

    is_error: bool = bool(result.get("isError", False))
    content_blocks = result.get("content", [])

    if not content_blocks:
        return ("", is_error)

    parts: list[str] = []
    for block in content_blocks:
        if isinstance(block, dict):
            block_type = block.get("type", "text")
            if block_type == "text":
                parts.append(str(block.get("text", "")))
            elif block_type == "image":
                parts.append(f"[image: {block.get('mimeType', 'unknown')}]")
            else:
                parts.append(str(block.get("text", str(block))))
        else:
            parts.append(str(block))

    return ("\n".join(parts), is_error)
