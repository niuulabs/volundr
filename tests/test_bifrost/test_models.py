"""Tests for ParsedRequest, parse_request, and related models."""

from __future__ import annotations

import json

from volundr.bifrost.models import (
    ParsedRequest,
    RequestContext,
    RouteDecision,
    parse_request,
)


def _make_request(**kwargs) -> ParsedRequest:
    defaults = {
        "model": "claude-sonnet-4-5-20250929",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
        "tools": [],
        "thinking_enabled": False,
        "max_tokens": 4096,
        "system": None,
        "raw_body": b"{}",
    }
    defaults.update(kwargs)
    return ParsedRequest(**defaults)


class TestParseRequest:
    def test_parses_minimal_body(self):
        body = json.dumps(
            {
                "model": "claude-sonnet-4-5-20250929",
                "messages": [{"role": "user", "content": "hello"}],
            }
        ).encode()
        req = parse_request(body)

        assert req.model == "claude-sonnet-4-5-20250929"
        assert len(req.messages) == 1
        assert req.stream is False
        assert req.thinking_enabled is False

    def test_parses_stream_flag(self):
        body = json.dumps({"model": "m", "messages": [], "stream": True}).encode()
        req = parse_request(body)
        assert req.stream is True

    def test_parses_tools(self):
        body = json.dumps(
            {
                "model": "m",
                "messages": [],
                "tools": [{"name": "bash"}],
            }
        ).encode()
        req = parse_request(body)
        assert len(req.tools) == 1

    def test_parses_thinking_enabled(self):
        body = json.dumps(
            {
                "model": "m",
                "messages": [],
                "thinking": {"budget_tokens": 5000},
            }
        ).encode()
        req = parse_request(body)
        assert req.thinking_enabled is True

    def test_thinking_disabled_when_zero_budget(self):
        body = json.dumps(
            {
                "model": "m",
                "messages": [],
                "thinking": {"budget_tokens": 0},
            }
        ).encode()
        req = parse_request(body)
        assert req.thinking_enabled is False

    def test_parses_system_string(self):
        body = json.dumps(
            {
                "model": "m",
                "messages": [],
                "system": "You are helpful.",
            }
        ).encode()
        req = parse_request(body)
        assert req.system == "You are helpful."

    def test_parses_system_list(self):
        body = json.dumps(
            {
                "model": "m",
                "messages": [],
                "system": [
                    {"type": "text", "text": "Part 1."},
                    {"type": "text", "text": "Part 2."},
                ],
            }
        ).encode()
        req = parse_request(body)
        assert req.system == "Part 1. Part 2."

    def test_handles_malformed_json(self):
        req = parse_request(b"not json at all")
        assert req.model == "unknown"
        assert req.messages == []

    def test_preserves_raw_body(self):
        body = b'{"model":"m","messages":[]}'
        req = parse_request(body)
        assert req.raw_body == body


class TestParsedRequestProperties:
    def test_last_message_role(self):
        req = _make_request(
            messages=[
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
        )
        assert req.last_message_role == "assistant"

    def test_last_message_role_empty(self):
        req = _make_request(messages=[])
        assert req.last_message_role is None

    def test_last_message_is_tool_result_true(self):
        req = _make_request(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"},
                    ],
                },
            ],
        )
        assert req.last_message_is_tool_result is True

    def test_last_message_is_tool_result_false_for_text(self):
        req = _make_request()
        assert req.last_message_is_tool_result is False

    def test_last_message_is_tool_result_false_for_wrong_role(self):
        req = _make_request(
            messages=[
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"},
                    ],
                },
            ],
        )
        assert req.last_message_is_tool_result is False

    def test_last_message_is_tool_result_false_for_empty_content(self):
        req = _make_request(
            messages=[{"role": "user", "content": []}],
        )
        assert req.last_message_is_tool_result is False

    def test_last_message_is_tool_result_false_string_content(self):
        req = _make_request(
            messages=[{"role": "user", "content": "hello"}],
        )
        assert req.last_message_is_tool_result is False

    def test_has_tools_true(self):
        req = _make_request(tools=[{"name": "bash"}])
        assert req.has_tools is True

    def test_has_tools_false(self):
        req = _make_request(tools=[])
        assert req.has_tools is False

    def test_estimated_tokens_text(self):
        # "hello" = 5 chars, / 4 = 1
        req = _make_request(
            messages=[{"role": "user", "content": "hello"}],
        )
        assert req.estimated_tokens == 1

    def test_estimated_tokens_blocks(self):
        # text block with 100 chars = 25 tokens
        req = _make_request(
            messages=[
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "x" * 100}],
                }
            ],
        )
        assert req.estimated_tokens == 25

    def test_estimated_tokens_includes_system(self):
        req = _make_request(
            messages=[{"role": "user", "content": "hi"}],
            system="x" * 100,
        )
        # "hi" = 2 chars + 100 system chars = 102, / 4 = 25
        assert req.estimated_tokens == 25

    def test_estimated_tokens_includes_tool_input(self):
        req = _make_request(
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "content": "x" * 40,
                            "input": "y" * 40,
                        }
                    ],
                }
            ],
        )
        # content: 40 chars + input: 40 chars = 80 / 4 = 20
        assert req.estimated_tokens == 20


class TestRequestContext:
    def test_holds_request(self):
        req = _make_request()
        ctx = RequestContext(request=req)
        assert ctx.request is req


class TestRouteDecision:
    def test_is_frozen(self):
        d = RouteDecision(
            upstream_name="anthropic",
            model="sonnet",
            enrich=True,
            label="default",
        )
        assert d.upstream_name == "anthropic"
        assert d.model == "sonnet"
        assert d.enrich is True
        assert d.label == "default"
