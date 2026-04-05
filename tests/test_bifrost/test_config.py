"""Tests for BifrostConfig and ProviderConfig."""

from __future__ import annotations

from bifrost.config import BifrostConfig, ProviderConfig, RoutingStrategy


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
        assert cfg.routing_strategy == RoutingStrategy.FAILOVER
        assert cfg.host == "0.0.0.0"
        assert cfg.port == 8088
        assert cfg.providers == {}
        assert cfg.aliases == {}

    def test_routing_strategy_field(self):
        cfg = BifrostConfig(routing_strategy=RoutingStrategy.ROUND_ROBIN)
        assert cfg.routing_strategy == RoutingStrategy.ROUND_ROBIN

    def test_routing_strategy_from_string(self):
        cfg = BifrostConfig.model_validate({"routing_strategy": "cost_optimised"})
        assert cfg.routing_strategy == RoutingStrategy.COST_OPTIMISED

    def test_providers_for_model_returns_all_matching(self):
        cfg = BifrostConfig(
            providers={
                "a": ProviderConfig(models=["gpt-4o"]),
                "b": ProviderConfig(models=["gpt-4o", "gpt-4o-mini"]),
                "c": ProviderConfig(models=["claude-sonnet-4-20250514"]),
            }
        )
        providers = cfg.providers_for_model("gpt-4o")
        assert providers == ["a", "b"]

    def test_providers_for_model_empty_when_none_match(self):
        cfg = BifrostConfig(providers={"a": ProviderConfig(models=["gpt-4o"])})
        assert cfg.providers_for_model("unknown") == []

    def test_cost_per_token_default(self):
        cfg = ProviderConfig()
        assert cfg.cost_per_token == 0.0

    def test_latency_ewma_alpha_default(self):
        cfg = BifrostConfig()
        assert cfg.latency_ewma_alpha == 0.2

    def test_latency_ewma_alpha_configurable(self):
        cfg = BifrostConfig.model_validate({"latency_ewma_alpha": 0.5})
        assert cfg.latency_ewma_alpha == 0.5

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
