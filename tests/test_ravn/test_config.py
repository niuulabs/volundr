"""Tests for Ravn configuration."""

from __future__ import annotations

import os
from urllib.parse import urlparse
from unittest.mock import patch

from ravn.config import (
    AgentConfig,
    AnthropicConfig,
    ChannelConfig,
    ContextConfig,
    HookConfig,
    HooksConfig,
    LLMAdapterConfig,
    LLMConfig,
    LLMProviderConfig,
    LoggingConfig,
    MCPServerConfig,
    MemoryConfig,
    PermissionConfig,
    PermissionRuleConfig,
    Settings,
    ToolAdapterConfig,
    ToolsConfig,
)


class TestAnthropicConfig:
    def test_defaults(self) -> None:
        c = AnthropicConfig()
        assert c.api_key == ""
        assert urlparse(c.base_url).hostname == "api.anthropic.com"


class TestAgentConfig:
    def test_defaults(self) -> None:
        c = AgentConfig()
        assert "claude" in c.model
        assert c.max_tokens > 0
        assert c.max_iterations > 0
        assert c.system_prompt != ""


class TestLLMAdapterConfig:
    def test_defaults(self) -> None:
        c = LLMAdapterConfig()
        assert "AnthropicAdapter" in c.adapter
        assert c.max_retries >= 0
        assert c.timeout > 0


# ---------------------------------------------------------------------------
# New NIU-427 config section tests
# ---------------------------------------------------------------------------


class TestLLMProviderConfig:
    def test_defaults(self) -> None:
        c = LLMProviderConfig()
        assert "AnthropicAdapter" in c.adapter
        assert isinstance(c.kwargs, dict)
        assert isinstance(c.secret_kwargs_env, dict)

    def test_custom_adapter(self) -> None:
        c = LLMProviderConfig(adapter="mypackage.MyAdapter", kwargs={"timeout": 30})
        assert c.adapter == "mypackage.MyAdapter"
        assert c.kwargs["timeout"] == 30


class TestLLMConfig:
    def test_defaults(self) -> None:
        c = LLMConfig()
        assert "claude" in c.model
        assert c.max_tokens > 0
        assert c.max_retries >= 0
        assert c.timeout > 0
        assert isinstance(c.provider, LLMProviderConfig)
        assert c.fallbacks == []

    def test_fallback_chain(self) -> None:
        c = LLMConfig(
            fallbacks=[
                LLMProviderConfig(adapter="pkg.FallbackA"),
                LLMProviderConfig(adapter="pkg.FallbackB"),
            ]
        )
        assert len(c.fallbacks) == 2
        assert c.fallbacks[0].adapter == "pkg.FallbackA"


class TestToolAdapterConfig:
    def test_required_adapter(self) -> None:
        c = ToolAdapterConfig(adapter="mypkg.MyTool")
        assert c.adapter == "mypkg.MyTool"
        assert c.kwargs == {}

    def test_kwargs_and_secrets(self) -> None:
        c = ToolAdapterConfig(
            adapter="mypkg.MyTool",
            kwargs={"base_url": "http://example.com"},
            secret_kwargs_env={"api_key": "MY_TOOL_KEY"},
        )
        assert c.kwargs["base_url"] == "http://example.com"
        assert c.secret_kwargs_env["api_key"] == "MY_TOOL_KEY"


class TestToolsConfig:
    def test_defaults(self) -> None:
        c = ToolsConfig()
        assert c.enabled == []
        assert c.disabled == []
        assert c.custom == []

    def test_with_values(self) -> None:
        c = ToolsConfig(
            enabled=["bash", "read"],
            disabled=["write"],
            custom=[ToolAdapterConfig(adapter="mypkg.ExtraTool")],
        )
        assert "bash" in c.enabled
        assert "write" in c.disabled
        assert len(c.custom) == 1


class TestMemoryConfig:
    def test_defaults(self) -> None:
        c = MemoryConfig()
        assert c.backend == "sqlite"
        assert "ravn" in c.path
        assert c.dsn == ""
        assert c.dsn_env == ""

    def test_postgres_backend(self) -> None:
        c = MemoryConfig(backend="postgres", dsn="postgresql://localhost/ravn")
        assert c.backend == "postgres"
        assert "postgresql" in c.dsn

    def test_dsn_from_env(self) -> None:
        c = MemoryConfig(backend="postgres", dsn_env="DATABASE_URL")
        assert c.dsn_env == "DATABASE_URL"


class TestPermissionConfig:
    def test_defaults(self) -> None:
        c = PermissionConfig()
        assert c.mode == "workspace_write"
        assert c.allow == []
        assert c.deny == []
        assert c.ask == []
        assert c.rules == []

    def test_with_rules(self) -> None:
        c = PermissionConfig(
            mode="prompt",
            allow=["read_file"],
            deny=["delete_file"],
            ask=["write_file"],
            rules=[PermissionRuleConfig(pattern="net:*", action="deny")],
        )
        assert c.mode == "prompt"
        assert "read_file" in c.allow
        assert "delete_file" in c.deny
        assert "write_file" in c.ask
        assert c.rules[0].pattern == "net:*"
        assert c.rules[0].action == "deny"


class TestContextConfig:
    def test_defaults(self) -> None:
        c = ContextConfig()
        assert c.per_file_limit == 4096
        assert c.total_budget == 12288

    def test_custom_values(self) -> None:
        c = ContextConfig(per_file_limit=1024, total_budget=8192)
        assert c.per_file_limit == 1024
        assert c.total_budget == 8192


class TestPermissionRuleConfig:
    def test_defaults(self) -> None:
        r = PermissionRuleConfig(pattern="tool:*")
        assert r.pattern == "tool:*"
        assert r.action == "ask"

    def test_deny(self) -> None:
        r = PermissionRuleConfig(pattern="fs:write", action="deny")
        assert r.action == "deny"


class TestMCPServerConfig:
    def test_defaults(self) -> None:
        c = MCPServerConfig(name="my-server")
        assert c.name == "my-server"
        assert c.transport == "stdio"
        assert c.command == ""
        assert c.args == []
        assert c.env == {}
        assert c.url == ""
        assert c.enabled is True

    def test_stdio_config(self) -> None:
        c = MCPServerConfig(
            name="filesystem",
            transport="stdio",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem"],
        )
        assert c.command == "npx"
        assert len(c.args) == 2

    def test_http_config(self) -> None:
        c = MCPServerConfig(name="remote", transport="http", url="https://mcp.example.com")
        assert c.transport == "http"
        assert c.url == "https://mcp.example.com"

    def test_disabled(self) -> None:
        c = MCPServerConfig(name="disabled-server", enabled=False)
        assert c.enabled is False


class TestHookConfig:
    def test_defaults(self) -> None:
        c = HookConfig(adapter="mypkg.AuditHook")
        assert c.adapter == "mypkg.AuditHook"
        assert "pre_tool" in c.events
        assert "post_tool" in c.events

    def test_custom_events(self) -> None:
        c = HookConfig(adapter="mypkg.PreHook", events=["pre_tool"])
        assert c.events == ["pre_tool"]


class TestHooksConfig:
    def test_defaults(self) -> None:
        c = HooksConfig()
        assert c.pre_tool == []
        assert c.post_tool == []

    def test_with_hooks(self) -> None:
        c = HooksConfig(
            pre_tool=[HookConfig(adapter="mypkg.AuthHook", events=["pre_tool"])],
            post_tool=[HookConfig(adapter="mypkg.LogHook", events=["post_tool"])],
        )
        assert len(c.pre_tool) == 1
        assert len(c.post_tool) == 1


class TestChannelConfig:
    def test_defaults(self) -> None:
        c = ChannelConfig()
        assert "CliChannel" in c.adapter

    def test_custom_adapter(self) -> None:
        c = ChannelConfig(
            adapter="mypkg.SlackChannel",
            kwargs={"webhook": "https://hooks.slack.com/xxx"},
        )
        assert "Slack" in c.adapter
        assert "webhook" in c.kwargs


class TestLoggingConfig:
    def test_defaults(self) -> None:
        c = LoggingConfig()
        assert c.level in ("debug", "info", "warning", "error", "critical")


class TestSettings:
    def test_defaults(self) -> None:
        s = Settings()
        assert isinstance(s.anthropic, AnthropicConfig)
        assert isinstance(s.agent, AgentConfig)
        assert isinstance(s.llm_adapter, LLMAdapterConfig)
        assert isinstance(s.permission, PermissionConfig)
        assert isinstance(s.logging, LoggingConfig)
        # NIU-427 new sections
        assert isinstance(s.context, ContextConfig)
        assert isinstance(s.llm, LLMConfig)
        assert isinstance(s.tools, ToolsConfig)
        assert isinstance(s.memory, MemoryConfig)
        assert isinstance(s.hooks, HooksConfig)
        assert s.mcp_servers == []
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            assert s.channels == []

    def test_effective_api_key_from_env(self) -> None:
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-key"}):
            s = Settings()
            assert s.effective_api_key() == "env-key"

    def test_effective_api_key_from_config(self) -> None:
        env_without_key = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch.dict(os.environ, env_without_key, clear=True):
            s = Settings(anthropic=AnthropicConfig(api_key="config-key"))
            assert s.effective_api_key() == "config-key"

    def test_effective_api_key_env_takes_precedence(self) -> None:
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-key"}):
            s = Settings(anthropic=AnthropicConfig(api_key="config-key"))
            assert s.effective_api_key() == "env-key"

    def test_env_override(self) -> None:
        with patch.dict(os.environ, {"RAVN_AGENT__MODEL": "claude-haiku-4-5-20251001"}):
            s = Settings()
            assert s.agent.model == "claude-haiku-4-5-20251001"

    def test_env_override_llm_model(self) -> None:
        with patch.dict(os.environ, {"RAVN_LLM__MODEL": "claude-opus-4-6"}):
            s = Settings()
            assert s.llm.model == "claude-opus-4-6"

    def test_env_override_memory_backend(self) -> None:
        with patch.dict(os.environ, {"RAVN_MEMORY__BACKEND": "postgres"}):
            s = Settings()
            assert s.memory.backend == "postgres"

    def test_env_override_permission_mode(self) -> None:
        with patch.dict(os.environ, {"RAVN_PERMISSION__MODE": "deny_all"}):
            s = Settings()
            assert s.permission.mode == "deny_all"

    def test_config_path_resolved_at_instantiation(self, tmp_path) -> None:
        """RAVN_CONFIG set before Settings() is constructed is picked up."""
        cfg = tmp_path / "custom.yaml"
        cfg.write_text("agent:\n  model: claude-custom\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert s.agent.model == "claude-custom"

    def test_yaml_llm_section(self, tmp_path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text(
            "llm:\n"
            "  model: claude-test\n"
            "  max_tokens: 4096\n"
            "  provider:\n"
            "    adapter: mypkg.TestAdapter\n"
        )
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert s.llm.model == "claude-test"
            assert s.llm.max_tokens == 4096
            assert s.llm.provider.adapter == "mypkg.TestAdapter"

    def test_yaml_mcp_servers(self, tmp_path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text(
            "mcp_servers:\n"
            "  - name: filesystem\n"
            "    transport: stdio\n"
            "    command: npx\n"
            "    args:\n"
            "      - -y\n"
            "      - '@modelcontextprotocol/server-filesystem'\n"
        )
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert len(s.mcp_servers) == 1
            assert s.mcp_servers[0].name == "filesystem"
            assert s.mcp_servers[0].command == "npx"

    def test_yaml_hooks_section(self, tmp_path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text(
            "hooks:\n  pre_tool:\n    - adapter: mypkg.AuditHook\n      events: [pre_tool]\n"
        )
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert len(s.hooks.pre_tool) == 1
            assert s.hooks.pre_tool[0].adapter == "mypkg.AuditHook"

    def test_yaml_tools_section(self, tmp_path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text("tools:\n  enabled:\n    - bash\n    - read\n  disabled:\n    - write\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert "bash" in s.tools.enabled
            assert "write" in s.tools.disabled

    def test_yaml_channels_section(self, tmp_path) -> None:
        import warnings

        cfg = tmp_path / "ravn.yaml"
        cfg.write_text(
            "channels:\n"
            "  - adapter: ravn.adapters.cli_channel.CliChannel\n"
            "    kwargs:\n"
            "      result_truncation_limit: 200\n"
        )
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                assert len(s.channels) == 1
                assert s.channels[0].kwargs["result_truncation_limit"] == 200

    def test_yaml_context_section(self, tmp_path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text("context:\n  per_file_limit: 2048\n  total_budget: 6144\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert s.context.per_file_limit == 2048
            assert s.context.total_budget == 6144
