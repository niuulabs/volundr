"""Tests for BifrostConfig and ProviderConfig."""

from __future__ import annotations

from bifrost.config import BifrostConfig, ProviderConfig


class TestProviderConfig:
    def test_api_key_from_env(self, monkeypatch):
        monkeypatch.setenv("MY_KEY", "secret-123")
        cfg = ProviderConfig(api_key_env="MY_KEY")
        assert cfg.api_key == "secret-123"

    def test_api_key_missing_env(self):
        cfg = ProviderConfig(api_key_env="NONEXISTENT_KEY_12345")
        assert cfg.api_key == ""

    def test_api_key_no_env_var(self):
        cfg = ProviderConfig()
        assert cfg.api_key == ""

    def test_defaults(self):
        cfg = ProviderConfig()
        assert cfg.base_url == ""
        assert cfg.models == []
        assert cfg.timeout == 120.0


class TestBifrostConfig:
    def test_resolve_alias_known(self):
        cfg = BifrostConfig(aliases={"fast": "claude-haiku-4-5-20251001"})
        assert cfg.resolve_alias("fast") == "claude-haiku-4-5-20251001"

    def test_resolve_alias_passthrough(self):
        cfg = BifrostConfig(aliases={"fast": "claude-haiku-4-5-20251001"})
        assert cfg.resolve_alias("gpt-4o") == "gpt-4o"

    def test_provider_for_model_found(self):
        cfg = BifrostConfig(
            providers={
                "openai": ProviderConfig(models=["gpt-4o", "gpt-4o-mini"]),
                "anthropic": ProviderConfig(models=["claude-sonnet-4-20250514"]),
            }
        )
        assert cfg.provider_for_model("gpt-4o") == "openai"
        assert cfg.provider_for_model("claude-sonnet-4-20250514") == "anthropic"

    def test_provider_for_model_not_found(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig(models=["gpt-4o"])})
        assert cfg.provider_for_model("unknown-model") is None

    def test_effective_base_url_from_config(self):
        cfg = BifrostConfig(
            providers={"openai": ProviderConfig(base_url="https://custom.openai.com")}
        )
        assert cfg.effective_base_url("openai") == "https://custom.openai.com"

    def test_effective_base_url_default_anthropic(self):
        cfg = BifrostConfig(providers={"anthropic": ProviderConfig()})
        assert cfg.effective_base_url("anthropic") == "https://api.anthropic.com"

    def test_effective_base_url_default_openai(self):
        cfg = BifrostConfig(providers={"openai": ProviderConfig()})
        assert cfg.effective_base_url("openai") == "https://api.openai.com"

    def test_effective_base_url_default_ollama(self):
        cfg = BifrostConfig(providers={"ollama": ProviderConfig()})
        assert cfg.effective_base_url("ollama") == "http://localhost:11434"

    def test_effective_base_url_unknown_provider(self):
        cfg = BifrostConfig()
        assert cfg.effective_base_url("mystery") == ""

    def test_defaults(self):
        cfg = BifrostConfig()
        assert cfg.failover_enabled is True
        assert cfg.host == "0.0.0.0"
        assert cfg.port == 8088
        assert cfg.providers == {}
        assert cfg.aliases == {}

    def test_full_config(self):
        cfg = BifrostConfig.model_validate(
            {
                "providers": {
                    "anthropic": {
                        "api_key_env": "ANTHROPIC_API_KEY",
                        "models": ["claude-sonnet-4-20250514"],
                    },
                    "openai": {
                        "api_key_env": "OPENAI_API_KEY",
                        "models": ["gpt-4o"],
                    },
                    "ollama": {
                        "base_url": "http://localhost:11434",
                        "models": ["llama3.1:8b"],
                    },
                },
                "aliases": {
                    "fast": "claude-haiku-4-5-20251001",
                    "balanced": "claude-sonnet-4-20250514",
                    "local": "llama3.1:8b",
                },
            }
        )
        assert len(cfg.providers) == 3
        assert len(cfg.aliases) == 3
        assert cfg.provider_for_model("gpt-4o") == "openai"
        assert cfg.resolve_alias("local") == "llama3.1:8b"
