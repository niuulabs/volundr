"""Skuld broker configuration.

Skuld runs in a separate pod from Volundr, so it has its own settings class.
Configuration is loaded from YAML, with environment variables overriding.

Config file locations (first found wins):
- ./config.yaml
- /etc/skuld/config.yaml

Environment variable override format:
- Use SKULD__ prefix with double underscore nesting:
  SKULD__TRANSPORT=subprocess, SKULD__SESSION__MODEL=opus
- Flat legacy env vars are also supported for backward compatibility:
  SESSION_ID, MODEL, HOST, PORT, VOLUNDR_API_URL, SERVICE_USER_ID, WORKSPACE_DIR
"""

import os
from pathlib import Path

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)


# Config file search paths (in order of priority).
# NIUU_CONFIG env var (set by the CLI --config flag) takes precedence.
def _config_paths() -> list[Path]:
    env = os.environ.get("NIUU_CONFIG")
    if env:
        return [Path(env)]
    return [
        Path("./config.yaml"),
        Path("/etc/skuld/config.yaml"),
    ]


CONFIG_PATHS = _config_paths()


class TelegramConfig(BaseModel):
    """Telegram messaging channel configuration.

    When enabled, the Skuld broker will send CLI events to a Telegram
    chat in addition to the browser WebSocket. Requires the
    python-telegram-bot package to be installed.
    """

    enabled: bool = Field(default=False)
    bot_token: str = Field(default="")
    chat_id: str = Field(default="")
    notify_only: bool = Field(default=False)


class SkuldSessionConfig(BaseModel):
    """Per-session configuration (set by Volundr at pod creation)."""

    id: str = Field(default="unknown")
    name: str = Field(default="unknown")
    model: str = Field(default="claude-sonnet-4-6")
    workspace_dir: str | None = Field(default=None)
    system_prompt: str = Field(default="")
    initial_prompt: str = Field(default="")


class SkuldSettings(BaseSettings):
    """Skuld broker settings.

    Loads configuration from YAML file with environment variable overrides.

    YAML file locations (first found wins):
    - ./config.yaml
    - /etc/skuld/config.yaml

    Environment variable overrides use SKULD__ prefix with double underscore nesting:
    - SKULD__TRANSPORT=subprocess -> settings.transport
    - SKULD__SESSION__MODEL=opus -> settings.session.model

    Legacy flat env vars are also supported (lowest priority, backward compat):
    - SESSION_ID, SESSION_NAME, MODEL, HOST, PORT, VOLUNDR_API_URL,
      SERVICE_USER_ID, SERVICE_TENANT_ID, WORKSPACE_DIR
    """

    model_config = SettingsConfigDict(
        yaml_file=CONFIG_PATHS,
        yaml_file_encoding="utf-8",
        env_prefix="SKULD__",
        env_nested_delimiter="__",
        extra="ignore",
    )

    session: SkuldSessionConfig = Field(default_factory=SkuldSessionConfig)
    cli_type: str = Field(default="claude")  # "claude" | "codex"
    transport: str = Field(default="sdk")  # claude only: "sdk" | "subprocess"
    transport_adapter: str = Field(
        default="skuld.transports.sdk_websocket.SdkWebSocketTransport",
    )
    skip_permissions: bool = Field(default=True)
    agent_teams: bool = Field(default=False)
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8081)
    volundr_api_url: str = Field(default="")
    service_user_id: str = Field(default="skuld-broker")
    service_tenant_id: str = Field(default="default")
    persistence_mount_path: str = Field(default="/volundr/sessions")
    chronicle_watcher_enabled: bool = Field(default=True)
    chronicle_watcher_debounce_ms: int = Field(default=500)
    max_upload_size_bytes: int = Field(default=104_857_600)  # 100 MB
    telegram: TelegramConfig = Field(default_factory=TelegramConfig)

    @model_validator(mode="after")
    def _apply_legacy_env_vars(self) -> "SkuldSettings":
        """Apply flat legacy env vars as fallbacks.

        Only overrides fields that still hold their default values, so
        SKULD__* prefixed vars and YAML always take precedence.
        """
        if self.cli_type == "claude":
            val = os.environ.get("CLI_TYPE")
            if val:
                self.cli_type = val

        if self.session.id == "unknown":
            val = os.environ.get("SESSION_ID")
            if val:
                self.session.id = val

        if self.session.name == "unknown":
            val = os.environ.get("SESSION_NAME")
            if val:
                self.session.name = val

        if self.session.model == "claude-sonnet-4-6":
            val = os.environ.get("MODEL")
            if val:
                self.session.model = val

        if self.session.workspace_dir is None:
            val = os.environ.get("WORKSPACE_DIR")
            if val:
                self.session.workspace_dir = val

        if not self.session.system_prompt:
            val = os.environ.get("SESSION_SYSTEM_PROMPT")
            if val:
                self.session.system_prompt = val

        if not self.session.initial_prompt:
            val = os.environ.get("SESSION_INITIAL_PROMPT")
            if val:
                self.session.initial_prompt = val

        if self.host == "0.0.0.0":
            val = os.environ.get("HOST")
            if val:
                self.host = val

        if self.port == 8081:
            val = os.environ.get("PORT")
            if val:
                self.port = int(val)

        if self.volundr_api_url == "":
            val = os.environ.get("VOLUNDR_API_URL")
            if val:
                self.volundr_api_url = val

        if self.service_user_id == "skuld-broker":
            val = os.environ.get("SERVICE_USER_ID")
            if val:
                self.service_user_id = val

        if self.service_tenant_id == "default":
            val = os.environ.get("SERVICE_TENANT_ID")
            if val:
                self.service_tenant_id = val

        return self

    @model_validator(mode="after")
    def _resolve_transport_adapter(self) -> "SkuldSettings":
        """Map legacy cli_type/transport fields to transport_adapter.

        Only overrides transport_adapter when it still holds the default value,
        so an explicit transport_adapter always takes precedence.
        """
        default_adapter = "skuld.transports.sdk_websocket.SdkWebSocketTransport"
        if self.transport_adapter != default_adapter:
            return self

        if self.cli_type == "codex":
            self.transport_adapter = "skuld.transports.codex.CodexSubprocessTransport"
            return self

        if self.transport == "subprocess":
            self.transport_adapter = "skuld.transports.subprocess.SubprocessTransport"

        return self

    @property
    def workspace_path(self) -> str:
        """Resolved workspace directory path."""
        if self.session.workspace_dir:
            return self.session.workspace_dir
        return f"{self.persistence_mount_path}/{self.session.id}/workspace"

    @property
    def home_path(self) -> str:
        """Resolved home directory path for the session."""
        return f"{self.persistence_mount_path}/{self.session.id}/home"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Customize settings sources.

        Order (first wins):
        1. init_settings - explicit constructor arguments
        2. env_settings - SKULD__* environment variables
        3. yaml - YAML config file
        4. file_secret_settings - /run/secrets files
        """
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls),
            file_secret_settings,
        )
