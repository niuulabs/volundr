"""Unit tests for Ravn configuration loading."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

from ravn.config import (
    AgentConfig,
    AnthropicConfig,
    LLMAdapterConfig,
    LoggingConfig,
    PermissionConfig,
    Settings,
    _config_paths,
)


class TestConfigPaths:
    def test_default_paths_returned_when_no_env_var(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            env_without_config = {k: v for k, v in os.environ.items() if k != "RAVN_CONFIG"}
            with patch.dict(os.environ, env_without_config, clear=True):
                paths = _config_paths()
        assert len(paths) > 1
        assert any("ravn" in str(p).lower() for p in paths)

    def test_ravn_config_env_overrides_path(self, tmp_path: Path) -> None:
        cfg = tmp_path / "my.yaml"
        cfg.write_text("")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            paths = _config_paths()
        assert list(paths) == [cfg]


class TestAnthropicConfig:
    def test_defaults(self) -> None:
        c = AnthropicConfig()
        assert c.api_key == ""
        assert "api.anthropic.com" in c.base_url

    def test_api_key_set(self) -> None:
        c = AnthropicConfig(api_key="sk-test")
        assert c.api_key == "sk-test"


class TestAgentConfig:
    def test_defaults(self) -> None:
        c = AgentConfig()
        assert "claude" in c.model
        assert c.max_tokens > 0
        assert c.max_iterations > 0
        assert c.system_prompt != ""

    def test_override_model(self) -> None:
        c = AgentConfig(model="claude-custom")
        assert c.model == "claude-custom"


class TestLLMAdapterConfig:
    def test_defaults(self) -> None:
        c = LLMAdapterConfig()
        assert "AnthropicAdapter" in c.adapter
        assert c.max_retries >= 0
        assert c.retry_base_delay > 0
        assert c.timeout > 0

    def test_kwargs_default_empty(self) -> None:
        c = LLMAdapterConfig()
        assert c.kwargs == {}


class TestPermissionConfig:
    def test_default_mode(self) -> None:
        c = PermissionConfig()
        assert c.mode == "allow_all"

    def test_custom_mode(self) -> None:
        c = PermissionConfig(mode="deny_all")
        assert c.mode == "deny_all"


class TestLoggingConfig:
    def test_default_level(self) -> None:
        c = LoggingConfig()
        assert c.level in ("debug", "info", "warning", "error", "critical")


class TestSettings:
    def test_defaults_instantiate(self) -> None:
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
        env_without_key = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        with patch.dict(os.environ, env_without_key, clear=True):
            s = Settings(anthropic=AnthropicConfig(api_key="config-key"))
            assert s.effective_api_key() == "config-key"

    def test_env_var_takes_precedence_over_config(self) -> None:
        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "env-key"}):
            s = Settings(anthropic=AnthropicConfig(api_key="config-key"))
            assert s.effective_api_key() == "env-key"

    def test_env_override_agent_model(self) -> None:
        with patch.dict(os.environ, {"RAVN_AGENT__MODEL": "claude-haiku-4-5-20251001"}):
            s = Settings()
            assert s.agent.model == "claude-haiku-4-5-20251001"

    def test_yaml_loading_from_file(self, tmp_path: Path) -> None:
        cfg = tmp_path / "ravn.yaml"
        cfg.write_text("agent:\n  model: claude-custom-yaml\n  max_tokens: 4096\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
        assert s.agent.model == "claude-custom-yaml"
        assert s.agent.max_tokens == 4096

    def test_missing_config_file_falls_back_to_defaults(self, tmp_path: Path) -> None:
        nonexistent = tmp_path / "does_not_exist.yaml"
        with patch.dict(os.environ, {"RAVN_CONFIG": str(nonexistent)}):
            # pydantic-settings silently ignores missing YAML files — defaults apply
            s = Settings()
        assert s.agent.model != ""

    def test_partial_yaml_merges_with_defaults(self, tmp_path: Path) -> None:
        cfg = tmp_path / "partial.yaml"
        cfg.write_text("agent:\n  max_tokens: 512\n")
        with patch.dict(os.environ, {"RAVN_CONFIG": str(cfg)}):
            s = Settings()
        assert s.agent.max_tokens == 512
        # model should still be the default
        assert "claude" in s.agent.model

    def test_env_override_permission_mode(self) -> None:
        with patch.dict(os.environ, {"RAVN_PERMISSION__MODE": "deny_all"}):
            s = Settings()
            assert s.permission.mode == "deny_all"

    def test_env_override_logging_level(self) -> None:
        with patch.dict(os.environ, {"RAVN_LOGGING__LEVEL": "debug"}):
            s = Settings()
            assert s.logging.level == "debug"
