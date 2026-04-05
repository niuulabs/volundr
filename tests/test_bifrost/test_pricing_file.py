"""Tests for pricing_file config option and app wiring."""

from __future__ import annotations

from pathlib import Path

from bifrost.app import _pricing_overrides
from bifrost.config import BifrostConfig, PricingOverride, ProviderConfig


def _make_config(**kwargs) -> BifrostConfig:
    return BifrostConfig(
        providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        **kwargs,
    )


class TestPricingFileConfig:
    def test_pricing_file_empty_returns_only_inline(self):
        config = _make_config(
            pricing={"claude-sonnet-4-6": PricingOverride(input_per_million=99.0)},
        )
        result = _pricing_overrides(config)
        assert "claude-sonnet-4-6" in result
        assert result["claude-sonnet-4-6"].input_per_million == 99.0

    def test_pricing_file_loaded_when_set(self, tmp_path: Path):
        yaml_content = "my-file-model:\n  output_per_million: 7.0\n"
        pricing_file = tmp_path / "pricing.yaml"
        pricing_file.write_text(yaml_content)

        config = _make_config(pricing_file=str(pricing_file))
        result = _pricing_overrides(config)
        assert "my-file-model" in result
        assert result["my-file-model"].output_per_million == 7.0

    def test_inline_overrides_pricing_file(self, tmp_path: Path):
        """Inline pricing takes precedence over the YAML file."""
        yaml_content = "claude-sonnet-4-6:\n  input_per_million: 1.00\n"
        pricing_file = tmp_path / "pricing.yaml"
        pricing_file.write_text(yaml_content)

        config = _make_config(
            pricing_file=str(pricing_file),
            pricing={"claude-sonnet-4-6": PricingOverride(input_per_million=50.0)},
        )
        result = _pricing_overrides(config)
        # Inline (50.0) beats the file (1.00).
        assert result["claude-sonnet-4-6"].input_per_million == 50.0

    def test_pricing_file_and_inline_merge(self, tmp_path: Path):
        """Both file and inline models appear in the merged result."""
        yaml_content = "file-model:\n  input_per_million: 2.0\n"
        pricing_file = tmp_path / "pricing.yaml"
        pricing_file.write_text(yaml_content)

        config = _make_config(
            pricing_file=str(pricing_file),
            pricing={"inline-model": PricingOverride(output_per_million=9.0)},
        )
        result = _pricing_overrides(config)
        assert "file-model" in result
        assert "inline-model" in result


class TestUsageStoreConfigDsn:
    def test_effective_dsn_uses_dsn_field(self):
        from bifrost.config import UsageStoreConfig
        cfg = UsageStoreConfig(adapter="postgres", dsn="postgresql://explicit/db")
        assert cfg.effective_dsn() == "postgresql://explicit/db"

    def test_effective_dsn_falls_back_to_env(self, monkeypatch):
        from bifrost.config import UsageStoreConfig
        monkeypatch.setenv("BIFROST_USAGE_DSN", "postgresql://from-env/db")
        cfg = UsageStoreConfig(adapter="postgres", dsn="")
        assert cfg.effective_dsn() == "postgresql://from-env/db"

    def test_effective_dsn_empty_when_no_env(self, monkeypatch):
        from bifrost.config import UsageStoreConfig
        monkeypatch.delenv("BIFROST_USAGE_DSN", raising=False)
        cfg = UsageStoreConfig(adapter="postgres", dsn="")
        assert cfg.effective_dsn() == ""
