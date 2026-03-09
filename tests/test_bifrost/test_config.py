"""Tests for Bifröst configuration loading."""

from __future__ import annotations

import textwrap

from volundr.bifrost.config import (
    BifrostConfig,
    UpstreamAuthConfig,
    UpstreamEntryConfig,
    load_config,
)


class TestUpstreamAuthConfig:
    def test_resolve_key_none(self):
        auth = UpstreamAuthConfig(mode="passthrough")
        assert auth.resolve_key() is None

    def test_resolve_key_literal(self):
        auth = UpstreamAuthConfig(mode="api_key", key="sk-123")
        assert auth.resolve_key() == "sk-123"

    def test_resolve_key_env_var(self, monkeypatch):
        monkeypatch.setenv("MY_KEY", "resolved-value")
        auth = UpstreamAuthConfig(mode="api_key", key="${MY_KEY}")
        assert auth.resolve_key() == "resolved-value"

    def test_resolve_key_missing_env_var(self, monkeypatch):
        monkeypatch.delenv("NONEXISTENT_KEY", raising=False)
        auth = UpstreamAuthConfig(mode="api_key", key="${NONEXISTENT_KEY}")
        assert auth.resolve_key() is None


class TestBifrostConfig:
    def test_defaults(self):
        config = BifrostConfig()
        assert config.server.host == "127.0.0.1"
        assert config.server.port == 8200
        assert config.upstream.url == "https://api.anthropic.com"
        assert config.upstreams == {}
        assert config.rules == []
        assert config.routing == {}

    def test_multi_upstream(self):
        config = BifrostConfig(
            upstreams={
                "anthropic": UpstreamEntryConfig(
                    adapter="anthropic_direct",
                    url="https://api.anthropic.com",
                ),
                "ollama": UpstreamEntryConfig(
                    adapter="anthropic_direct",
                    url="http://localhost:11434",
                    tool_capable=False,
                ),
            }
        )
        assert len(config.upstreams) == 2
        assert config.upstreams["ollama"].tool_capable is False


class TestLoadConfig:
    def test_loads_from_yaml(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            server:
              host: 0.0.0.0
              port: 9000
            upstream:
              url: https://custom.api.com
        """)
        config_file = tmp_path / "bifrost.yaml"
        config_file.write_text(yaml_content)

        config = load_config(str(config_file))

        assert config.server.host == "0.0.0.0"
        assert config.server.port == 9000
        assert config.upstream.url == "https://custom.api.com"

    def test_loads_with_upstreams(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            upstreams:
              anthropic:
                adapter: anthropic_direct
                url: https://api.anthropic.com
              ollama:
                adapter: anthropic_direct
                url: http://localhost:11434
                tool_capable: false
        """)
        config_file = tmp_path / "bifrost.yaml"
        config_file.write_text(yaml_content)

        config = load_config(str(config_file))

        assert len(config.upstreams) == 2
        assert config.upstreams["ollama"].tool_capable is False

    def test_backwards_compat_promotes_single_upstream(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            upstream:
              url: https://custom.api.com
              timeout_s: 120
        """)
        config_file = tmp_path / "bifrost.yaml"
        config_file.write_text(yaml_content)

        config = load_config(str(config_file))

        assert "default" in config.upstreams
        assert config.upstreams["default"].url == "https://custom.api.com"
        assert config.upstreams["default"].timeout_s == 120

    def test_loads_with_rules_and_routing(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            rules:
              - rule: BackgroundRule
              - rule: DefaultRule
            routing:
              background:
                upstream: ollama
                model: qwen3-coder
                enrich: false
              default:
                upstream: anthropic
        """)
        config_file = tmp_path / "bifrost.yaml"
        config_file.write_text(yaml_content)

        config = load_config(str(config_file))

        assert len(config.rules) == 2
        assert config.rules[0].rule == "BackgroundRule"
        assert len(config.routing) == 2
        assert config.routing["background"].upstream == "ollama"

    def test_defaults_when_no_file(self, tmp_path, monkeypatch):
        # Point to nonexistent path
        monkeypatch.chdir(tmp_path)
        config = load_config(str(tmp_path / "nonexistent.yaml"))
        assert config.server.port == 8200

    def test_env_override(self, tmp_path, monkeypatch):
        yaml_content = textwrap.dedent("""\
            server:
              port: 8200
        """)
        config_file = tmp_path / "bifrost.yaml"
        config_file.write_text(yaml_content)

        monkeypatch.setenv("BIFROST__SERVER__PORT", "9999")
        config = load_config(str(config_file))

        assert config.server.port == 9999  # Pydantic coerces string to int
