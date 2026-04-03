"""Tests for cli.broker.translate — message translation functions."""

from __future__ import annotations

from cli.broker.translate import (
    filter_cli_event,
    skuld_to_sdk_control,
    skuld_to_sdk_permission,
)


class TestSkuldToSdkPermission:
    def test_translates_permission_response(self) -> None:
        msg = {
            "type": "permission_response",
            "request_id": "req-1",
            "behavior": "allow",
            "updated_input": {"path": "/tmp"},
            "updated_permissions": ["read"],
        }
        result = skuld_to_sdk_permission(msg)
        assert result["subtype"] == "success"
        assert result["request_id"] == "req-1"
        assert result["response"]["behavior"] == "allow"
        assert result["response"]["updatedInput"] == {"path": "/tmp"}
        assert result["response"]["updatedPermissions"] == ["read"]

    def test_defaults_for_missing_fields(self) -> None:
        msg = {"type": "permission_response"}
        result = skuld_to_sdk_permission(msg)
        assert result["request_id"] == ""
        assert result["response"]["behavior"] == ""
        assert result["response"]["updatedInput"] == {}
        assert result["response"]["updatedPermissions"] == []


class TestSkuldToSdkControl:
    def test_interrupt(self) -> None:
        result = skuld_to_sdk_control("interrupt", {})
        assert result["subtype"] == "interrupt"
        assert "request_id" in result

    def test_set_model(self) -> None:
        result = skuld_to_sdk_control("set_model", {"model": "opus"})
        assert result["subtype"] == "set_model"
        assert result["model"] == "opus"

    def test_set_max_thinking_tokens(self) -> None:
        result = skuld_to_sdk_control("set_max_thinking_tokens", {"max_thinking_tokens": 1024})
        assert result["max_thinking_tokens"] == 1024

    def test_set_permission_mode(self) -> None:
        result = skuld_to_sdk_control("set_permission_mode", {"mode": "auto"})
        assert result["mode"] == "auto"

    def test_mcp_set_servers(self) -> None:
        servers = [{"name": "s1"}]
        result = skuld_to_sdk_control("mcp_set_servers", {"servers": servers})
        assert result["servers"] == servers

    def test_rewind_files(self) -> None:
        result = skuld_to_sdk_control("rewind_files", {})
        assert result["subtype"] == "rewind_files"

    def test_unknown_type_returns_basic_response(self) -> None:
        result = skuld_to_sdk_control("unknown_type", {"foo": "bar"})
        assert result["subtype"] == "unknown_type"


class TestFilterCliEvent:
    def test_drops_keep_alive(self) -> None:
        assert filter_cli_event({"type": "keep_alive"}) is False

    def test_drops_empty_content_block_delta(self) -> None:
        assert (
            filter_cli_event(
                {
                    "type": "content_block_delta",
                    "delta": {"text": "", "thinking": "", "partial_json": ""},
                }
            )
            is False
        )

    def test_drops_delta_without_dict(self) -> None:
        assert filter_cli_event({"type": "content_block_delta", "delta": "bad"}) is False

    def test_keeps_delta_with_text(self) -> None:
        assert (
            filter_cli_event(
                {
                    "type": "content_block_delta",
                    "delta": {"text": "hello"},
                }
            )
            is True
        )

    def test_keeps_delta_with_thinking(self) -> None:
        assert (
            filter_cli_event(
                {
                    "type": "content_block_delta",
                    "delta": {"thinking": "hmm"},
                }
            )
            is True
        )

    def test_keeps_delta_with_partial_json(self) -> None:
        assert (
            filter_cli_event(
                {
                    "type": "content_block_delta",
                    "delta": {"partial_json": "{"},
                }
            )
            is True
        )

    def test_keeps_user_event(self) -> None:
        assert filter_cli_event({"type": "user"}) is True

    def test_keeps_result_event(self) -> None:
        assert filter_cli_event({"type": "result"}) is True

    def test_keeps_assistant_event(self) -> None:
        assert filter_cli_event({"type": "assistant"}) is True

    def test_keeps_system_event(self) -> None:
        assert filter_cli_event({"type": "system", "subtype": "init"}) is True
