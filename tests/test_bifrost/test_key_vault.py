"""Tests for the key vault port and adapters."""

from __future__ import annotations

from bifrost.adapters.key_vault import EnvKeyVault, SecretsFileKeyVault, _read_secret_file
from bifrost.config import BifrostConfig, ProviderConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(providers: dict | None = None) -> BifrostConfig:
    return BifrostConfig(providers=providers or {})


# ---------------------------------------------------------------------------
# EnvKeyVault
# ---------------------------------------------------------------------------


class TestEnvKeyVault:
    def test_loads_key_from_env(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_KEY", "sk-ant-test")
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="ANTHROPIC_KEY")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "sk-ant-test"

    def test_returns_none_when_env_absent(self):
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="NONEXISTENT_VAR_99999")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") is None

    def test_returns_none_for_unknown_provider(self, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_KEY", "sk-ant-test")
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="ANTHROPIC_KEY")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("openai") is None

    def test_loads_multiple_providers(self, monkeypatch):
        monkeypatch.setenv("ANT_KEY", "ant-val")
        monkeypatch.setenv("OAI_KEY", "oai-val")
        cfg = _make_config(
            {
                "anthropic": ProviderConfig(api_key_env="ANT_KEY"),
                "openai": ProviderConfig(api_key_env="OAI_KEY"),
            }
        )
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "ant-val"
        assert vault.get_key("openai") == "oai-val"

    def test_reload_picks_up_new_value(self, monkeypatch):
        monkeypatch.setenv("ROTATING_KEY", "old-key")
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="ROTATING_KEY")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "old-key"

        monkeypatch.setenv("ROTATING_KEY", "new-key")
        vault.reload()
        assert vault.get_key("anthropic") == "new-key"

    def test_reload_clears_removed_key(self, monkeypatch):
        monkeypatch.setenv("TEMP_KEY", "temp-value")
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="TEMP_KEY")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "temp-value"

        monkeypatch.delenv("TEMP_KEY")
        vault.reload()
        assert vault.get_key("anthropic") is None

    def test_falls_back_to_api_key_file(self, tmp_path):
        secret_file = tmp_path / "api_key"
        secret_file.write_text("sk-from-file")
        cfg = _make_config(
            {"anthropic": ProviderConfig(api_key_env="", api_key_file=str(secret_file))}
        )
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "sk-from-file"

    def test_env_var_takes_priority_over_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ANT_KEY", "env-value")
        secret_file = tmp_path / "api_key"
        secret_file.write_text("file-value")
        cfg = _make_config(
            {"anthropic": ProviderConfig(api_key_env="ANT_KEY", api_key_file=str(secret_file))}
        )
        vault = EnvKeyVault(cfg)
        assert vault.get_key("anthropic") == "env-value"

    def test_provider_without_key_env_skipped(self):
        cfg = _make_config({"ollama": ProviderConfig(base_url="http://localhost:11434")})
        vault = EnvKeyVault(cfg)
        assert vault.get_key("ollama") is None

    def test_key_not_in_logs(self, monkeypatch, caplog):
        monkeypatch.setenv("SECRET_KEY", "very-secret-value-12345")
        cfg = _make_config({"anthropic": ProviderConfig(api_key_env="SECRET_KEY")})
        import logging

        with caplog.at_level(logging.DEBUG, logger="bifrost.adapters.key_vault"):
            vault = EnvKeyVault(cfg)
            vault.reload()

        for record in caplog.records:
            assert "very-secret-value-12345" not in record.message


# ---------------------------------------------------------------------------
# SecretsFileKeyVault
# ---------------------------------------------------------------------------


class TestSecretsFileKeyVault:
    def test_loads_keys_from_yaml_file(self, tmp_path):
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("anthropic: sk-ant-secret\nopenai: sk-oai-secret\n")
        vault = SecretsFileKeyVault(str(secrets))
        assert vault.get_key("anthropic") == "sk-ant-secret"
        assert vault.get_key("openai") == "sk-oai-secret"

    def test_returns_none_for_unknown_provider(self, tmp_path):
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("anthropic: sk-ant-secret\n")
        vault = SecretsFileKeyVault(str(secrets))
        assert vault.get_key("ollama") is None

    def test_missing_file_returns_none(self, tmp_path):
        vault = SecretsFileKeyVault(str(tmp_path / "nonexistent.yaml"))
        assert vault.get_key("anthropic") is None

    def test_reload_picks_up_new_keys(self, tmp_path):
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("anthropic: old-key\n")
        vault = SecretsFileKeyVault(str(secrets))
        assert vault.get_key("anthropic") == "old-key"

        secrets.write_text("anthropic: new-key\n")
        vault.reload()
        assert vault.get_key("anthropic") == "new-key"

    def test_malformed_file_returns_none(self, tmp_path):
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("not: valid: yaml: {[}")
        vault = SecretsFileKeyVault(str(secrets))
        assert vault.get_key("anthropic") is None

    def test_non_mapping_file_returns_none(self, tmp_path):
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("- item1\n- item2\n")
        vault = SecretsFileKeyVault(str(secrets))
        assert vault.get_key("anthropic") is None


# ---------------------------------------------------------------------------
# _read_secret_file helper
# ---------------------------------------------------------------------------


class TestReadSecretFile:
    def test_reads_file_content(self, tmp_path):
        f = tmp_path / "secret"
        f.write_text("  sk-ant-key  \n")
        assert _read_secret_file(str(f)) == "sk-ant-key"

    def test_returns_empty_on_missing_file(self, tmp_path):
        assert _read_secret_file(str(tmp_path / "missing")) == ""
