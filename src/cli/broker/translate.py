"""Pure message-translation functions between Skuld (browser) and SDK (CLI) protocols."""

from __future__ import annotations

import uuid
from typing import Any


def skuld_to_sdk_permission(msg: dict[str, Any]) -> dict[str, Any]:
    """Translate a browser ``permission_response`` into an SDK control response.

    Browser format::

        {type: "permission_response", request_id, behavior, updated_input, updated_permissions}

    SDK format::

        {subtype: "success", request_id, response: {behavior, updatedInput, updatedPermissions}}
    """
    request_id = msg.get("request_id", "")
    behavior = msg.get("behavior", "")
    updated_input = msg.get("updated_input") or {}
    updated_permissions = msg.get("updated_permissions") or []

    return {
        "subtype": "success",
        "request_id": request_id,
        "response": {
            "behavior": behavior,
            "updatedInput": updated_input,
            "updatedPermissions": updated_permissions,
        },
    }


def skuld_to_sdk_control(msg_type: str, msg: dict[str, Any]) -> dict[str, Any]:
    """Translate a browser control message into an SDK control response.

    Handles: interrupt, set_model, set_max_thinking_tokens,
    set_permission_mode, rewind_files, mcp_set_servers.
    """
    resp: dict[str, Any] = {
        "subtype": msg_type,
        "request_id": str(uuid.uuid4()),
    }

    match msg_type:
        case "set_model":
            resp["model"] = msg.get("model", "")
        case "set_max_thinking_tokens":
            resp["max_thinking_tokens"] = msg.get("max_thinking_tokens")
        case "set_permission_mode":
            resp["mode"] = msg.get("mode", "")
        case "mcp_set_servers":
            resp["servers"] = msg.get("servers")

    return resp


def filter_cli_event(data: dict[str, Any]) -> bool:
    """Return True if the event should be forwarded to browsers.

    Drops ``keep_alive`` and ``content_block_delta`` with empty content.
    """
    msg_type = data.get("type", "")

    if msg_type == "keep_alive":
        return False

    if msg_type == "content_block_delta":
        delta = data.get("delta")
        if not isinstance(delta, dict):
            return False
        text = delta.get("text", "")
        thinking = delta.get("thinking", "")
        partial_json = delta.get("partial_json", "")
        if not text and not thinking and not partial_json:
            return False

    return True
