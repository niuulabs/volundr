"""Tests for the Bifröst model router."""

from __future__ import annotations

from volundr.bifrost.models import ParsedRequest
from volundr.bifrost.router import ModelRouter, RouteConfig


def _make_request(
    *,
    model: str = "claude-sonnet-4-5-20250929",
    tools: list | None = None,
) -> ParsedRequest:
    return ParsedRequest(
        model=model,
        messages=[{"role": "user", "content": "hi"}],
        stream=False,
        tools=tools or [],
        thinking_enabled=False,
        max_tokens=4096,
        system=None,
        raw_body=b"{}",
    )


class TestModelRouter:
    def test_routes_known_label(self):
        router = ModelRouter(
            {
                "think": RouteConfig(upstream="anthropic", model="claude-opus-4-5-20250929"),
                "default": RouteConfig(),
            }
        )
        req = _make_request()
        decision = router.route("think", req)

        assert decision.upstream_name == "anthropic"
        assert decision.model == "claude-opus-4-5-20250929"
        assert decision.label == "think"

    def test_falls_back_to_default_for_unknown_label(self):
        router = ModelRouter(
            {
                "default": RouteConfig(upstream="anthropic", model="sonnet"),
            }
        )
        req = _make_request()
        decision = router.route("unknown_label", req)

        assert decision.upstream_name == "anthropic"
        assert decision.model == "sonnet"
        assert decision.label == "default"

    def test_tool_capability_guard(self):
        router = ModelRouter(
            {
                "background": RouteConfig(
                    upstream="ollama",
                    model="qwen3-coder",
                    tool_capable=False,
                ),
                "default": RouteConfig(upstream="anthropic"),
            }
        )
        req = _make_request(tools=[{"name": "bash", "input_schema": {}}])
        decision = router.route("background", req)

        # Should fall back to default because background is not tool-capable
        assert decision.upstream_name == "anthropic"
        assert decision.label == "default"

    def test_tool_guard_not_triggered_without_tools(self):
        router = ModelRouter(
            {
                "background": RouteConfig(
                    upstream="ollama",
                    model="qwen3-coder",
                    tool_capable=False,
                ),
                "default": RouteConfig(upstream="anthropic"),
            }
        )
        req = _make_request(tools=[])
        decision = router.route("background", req)

        # No tools → no guard
        assert decision.upstream_name == "ollama"
        assert decision.model == "qwen3-coder"

    def test_no_default_route_returns_safe_defaults(self):
        router = ModelRouter(
            {
                "think": RouteConfig(upstream="anthropic"),
            }
        )
        req = _make_request()
        decision = router.route("unknown", req)

        assert decision.upstream_name == "default"
        assert decision.model is None
        assert decision.enrich is True

    def test_enrich_flag_propagated(self):
        router = ModelRouter(
            {
                "tool_passthrough": RouteConfig(
                    upstream="anthropic",
                    enrich=False,
                ),
                "default": RouteConfig(enrich=True),
            }
        )
        req = _make_request()
        decision = router.route("tool_passthrough", req)

        assert decision.enrich is False

    def test_default_route_config_values(self):
        config = RouteConfig()
        assert config.upstream == "default"
        assert config.model is None
        assert config.enrich is True
        assert config.tool_capable is True
