"""Tests for Skuld configuration."""

import pytest

from volundr.skuld.config import SkuldSessionConfig, SkuldSettings


class TestSkuldSessionConfig:
    """Tests for SkuldSessionConfig defaults."""

    def test_defaults(self):
        config = SkuldSessionConfig()
        assert config.id == "unknown"
        assert config.name == "unknown"
        assert config.model == "claude-sonnet-4-20250514"
        assert config.workspace_dir is None

    def test_explicit_values(self):
        config = SkuldSessionConfig(
            id="sess-1", name="my-session", model="opus", workspace_dir="/tmp/ws"
        )
        assert config.id == "sess-1"
        assert config.name == "my-session"
        assert config.model == "opus"
        assert config.workspace_dir == "/tmp/ws"


class TestSkuldSettings:
    """Tests for SkuldSettings."""

    def test_defaults(self, monkeypatch):
        """Test all default values when no env vars or config files."""
        # Clear any env vars that might interfere
        for var in [
            "SESSION_ID",
            "SESSION_NAME",
            "MODEL",
            "HOST",
            "PORT",
            "VOLUNDR_API_URL",
            "WORKSPACE_DIR",
            "SKULD__TRANSPORT",
            "SKULD__HOST",
            "SKULD__PORT",
            "SKULD__SESSION__ID",
            "SKULD__SESSION__MODEL",
        ]:
            monkeypatch.delenv(var, raising=False)

        s = SkuldSettings()
        assert s.transport == "sdk"
        assert s.host == "0.0.0.0"
        assert s.port == 8081
        assert s.volundr_api_url == ""
        assert s.session.id == "unknown"
        assert s.session.name == "unknown"
        assert s.session.model == "claude-sonnet-4-20250514"
        assert s.persistence_mount_path == "/volundr/sessions"

    def test_workspace_path_computed(self, monkeypatch):
        """Test workspace_path computed from session ID when workspace_dir is None."""
        monkeypatch.delenv("WORKSPACE_DIR", raising=False)
        monkeypatch.setenv("SKULD__SESSION__ID", "sess-42")

        s = SkuldSettings()
        assert s.workspace_path == "/volundr/sessions/sess-42/workspace"

    def test_workspace_path_explicit(self, monkeypatch):
        """Test workspace_path returns explicit workspace_dir when set."""
        monkeypatch.setenv("SKULD__SESSION__WORKSPACE_DIR", "/custom/path")

        s = SkuldSettings()
        assert s.workspace_path == "/custom/path"

    def test_prefixed_env_vars(self, monkeypatch):
        """Test SKULD__ prefixed env vars override defaults."""
        monkeypatch.setenv("SKULD__TRANSPORT", "subprocess")
        monkeypatch.setenv("SKULD__HOST", "127.0.0.1")
        monkeypatch.setenv("SKULD__PORT", "9999")

        s = SkuldSettings()
        assert s.transport == "subprocess"
        assert s.host == "127.0.0.1"
        assert s.port == 9999

    def test_nested_env_vars(self, monkeypatch):
        """Test SKULD__SESSION__* nested env vars."""
        monkeypatch.setenv("SKULD__SESSION__ID", "nested-id")
        monkeypatch.setenv("SKULD__SESSION__MODEL", "opus")

        s = SkuldSettings()
        assert s.session.id == "nested-id"
        assert s.session.model == "opus"

    def test_legacy_flat_env_vars(self, monkeypatch):
        """Test backward-compatible flat env vars."""
        # Clear any SKULD__ prefixed vars
        for var in [
            "SKULD__SESSION__ID",
            "SKULD__SESSION__MODEL",
            "SKULD__HOST",
            "SKULD__PORT",
        ]:
            monkeypatch.delenv(var, raising=False)

        monkeypatch.setenv("SESSION_ID", "legacy-id")
        monkeypatch.setenv("MODEL", "legacy-model")
        monkeypatch.setenv("HOST", "10.0.0.1")
        monkeypatch.setenv("PORT", "7777")
        monkeypatch.setenv("VOLUNDR_API_URL", "http://volundr:80")

        s = SkuldSettings()
        assert s.session.id == "legacy-id"
        assert s.session.model == "legacy-model"
        assert s.host == "10.0.0.1"
        assert s.port == 7777
        assert s.volundr_api_url == "http://volundr:80"

    def test_prefixed_takes_precedence_over_legacy(self, monkeypatch):
        """Test SKULD__ env vars take precedence over flat legacy vars."""
        monkeypatch.setenv("SESSION_ID", "legacy")
        monkeypatch.setenv("SKULD__SESSION__ID", "prefixed")
        monkeypatch.setenv("SKULD__TRANSPORT", "subprocess")

        s = SkuldSettings()
        assert s.session.id == "prefixed"
        assert s.transport == "subprocess"

    def test_yaml_config_loading(self, tmp_path, monkeypatch):
        """Test loading configuration from a YAML file."""
        config_file = tmp_path / "config.yaml"
        config_file.write_text(
            "transport: subprocess\n"
            "host: 192.168.1.1\n"
            "port: 5555\n"
            "session:\n"
            "  id: yaml-session\n"
            "  model: haiku\n"
        )

        # Clear env vars
        for var in [
            "SESSION_ID",
            "MODEL",
            "HOST",
            "PORT",
            "SKULD__TRANSPORT",
            "SKULD__HOST",
            "SKULD__PORT",
            "SKULD__SESSION__ID",
            "SKULD__SESSION__MODEL",
        ]:
            monkeypatch.delenv(var, raising=False)

        # Patch model_config directly — yaml_file is baked at class definition
        # time, so monkeypatching CONFIG_PATHS has no effect.
        monkeypatch.setitem(SkuldSettings.model_config, "yaml_file", [config_file])

        s = SkuldSettings()
        assert s.transport == "subprocess"
        assert s.host == "192.168.1.1"
        assert s.port == 5555
        assert s.session.id == "yaml-session"
        assert s.session.model == "haiku"

    @pytest.mark.parametrize("transport", ["sdk", "subprocess"])
    def test_valid_transport_values(self, transport, monkeypatch):
        """Test both valid transport values are accepted."""
        monkeypatch.setenv("SKULD__TRANSPORT", transport)
        s = SkuldSettings()
        assert s.transport == transport

    def test_init_kwargs(self, monkeypatch):
        """Test explicit constructor arguments take highest priority."""
        monkeypatch.setenv("SKULD__TRANSPORT", "subprocess")

        s = SkuldSettings(transport="sdk")
        assert s.transport == "sdk"

    def test_skip_permissions_default(self):
        s = SkuldSettings()
        assert s.skip_permissions is True

    def test_skip_permissions_false(self, monkeypatch):
        monkeypatch.setenv("SKULD__SKIP_PERMISSIONS", "false")
        s = SkuldSettings()
        assert s.skip_permissions is False

    def test_agent_teams_default(self):
        s = SkuldSettings()
        assert s.agent_teams is False

    def test_agent_teams_enabled(self, monkeypatch):
        monkeypatch.setenv("SKULD__AGENT_TEAMS", "true")
        s = SkuldSettings()
        assert s.agent_teams is True
