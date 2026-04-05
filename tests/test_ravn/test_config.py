"""Tests for Ravn configuration."""

from __future__ import annotations

import os
from unittest.mock import patch

from ravn.config import (
    AgentConfig,
    AnthropicConfig,
    LLMAdapterConfig,
    LoggingConfig,
    PermissionConfig,
    Settings,
)


class TestAnthropicConfig:
    def test_defaults(self) -> None:
        c = AnthropicConfig()
        assert c.api_key == ""
        assert "api.anthropic.com" in c.base_url


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


class TestPermissionConfig:
    def test_defaults(self) -> None:
        c = PermissionConfig()
        assert c.mode == "allow_all"


class TestLoggingConfig:
    def test_defaults(self) -> None:
        c = LoggingConfig()
        assert c.level in ("debug", "info", "warning", "error", "critical", "warning")


class TestSettings:
    def test_defaults(self) -> None:
        s = Settings()
        assert isinstance(s.anthropic, AnthropicConfig)
        assert isinstance(s.agent, AgentConfig)
        assert isinstance(s.llm_adapter, LLMAdapterConfig)
        assert isinstance(s.permission, PermissionConfig)
        assert isinstance(s.logging, LoggingConfig)

    def test_effective_api_key_from_env(self) -> None:
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-key"}):
            s = Settings()
            assert s.effective_api_key() == "env-key"

    def test_effective_api_key_from_config(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            # Remove env var if set.
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

    def test_config_path_resolved_at_instantiation(self, tmp_path) -> None:
        """RAVN_CONFIG set before Settings() is constructed is picked up."""
        cfg = tmp_path / "custom.yaml"
        cfg.write_text("agent:\n  model: claude-custom\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
            assert s.agent.model == "claude-custom"
