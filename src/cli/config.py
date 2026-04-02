"""CLI configuration — pydantic-settings with ~/.niuu/config.yaml."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)

DEFAULT_CONFIG_DIR = Path.home() / ".niuu"
DEFAULT_CONFIG_FILE = DEFAULT_CONFIG_DIR / "config.yaml"

CONFIG_PATHS = [
    DEFAULT_CONFIG_FILE,
    Path("/etc/niuu/config.yaml"),
]


class PerServiceConfig(BaseModel):
    """Per-service enabled/port overrides."""

    enabled: bool | None = Field(
        default=None,
        description="Override whether this service is enabled. None = use plugin default.",
    )
    port: int | None = Field(
        default=None,
        description="Override the listen port. None = use plugin default.",
    )


class PluginConfig(BaseModel):
    """Per-plugin enable/disable configuration."""

    enabled: dict[str, bool] = Field(
        default_factory=dict,
        description="Map of plugin name to enabled status.",
    )
    extra: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Extra plugins loaded via dynamic adapter pattern.",
    )


class DatabaseConfig(BaseModel):
    """Database configuration for mini mode."""

    mode: str = Field(
        default="embedded",
        description="Database mode: 'embedded' (pgserver) or 'external'.",
    )
    dsn: str = Field(
        default="",
        description="Database DSN for external mode.",
    )


class PodManagerConfig(BaseModel):
    """Pod manager configuration for mini mode."""

    adapter: str = Field(
        default="volundr.adapters.outbound.local_process.LocalProcessPodManager",
        description="Fully-qualified class path for the pod manager adapter.",
    )
    workspaces_dir: str = Field(
        default="~/.niuu/workspaces",
        description="Directory for session workspaces.",
    )
    claude_binary: str = Field(
        default="claude",
        description="Path or name of the claude binary.",
    )
    max_concurrent: int = Field(
        default=4,
        description="Maximum concurrent sessions.",
    )


class ServerConfig(BaseModel):
    """Server configuration — single port for all services."""

    host: str = Field(
        default="127.0.0.1",
        description="Host to bind the server to.",
    )
    port: int = Field(
        default=8080,
        description="Single port for all services (Volundr, Tyr, Web UI).",
    )


class ServiceConfig(BaseModel):
    """Service management configuration."""

    health_check_interval_seconds: float = Field(
        default=2.0,
        description="Interval between health check polls.",
    )
    health_check_timeout_seconds: float = Field(
        default=30.0,
        description="Max time to wait for a service to become healthy.",
    )
    health_check_max_retries: int = Field(
        default=15,
        description="Max retries for health checks before declaring failure.",
    )


class TUIConfig(BaseModel):
    """TUI appearance configuration."""

    theme: str = Field(
        default="textual-dark",
        description="Textual theme name.",
    )


class CLISettings(BaseSettings):
    """Root configuration for the niuu CLI."""

    model_config = SettingsConfigDict(
        env_prefix="NIUU_",
        env_nested_delimiter="__",
        yaml_file=[str(p) for p in CONFIG_PATHS],
        yaml_file_encoding="utf-8",
        extra="ignore",
    )

    mode: str = Field(
        default="mini",
        description="Operating mode: 'mini' (local) or 'cluster'.",
    )
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    pod_manager: PodManagerConfig = Field(default_factory=PodManagerConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    plugins: PluginConfig = Field(default_factory=PluginConfig)
    services: ServiceConfig = Field(default_factory=ServiceConfig)
    service_overrides: dict[str, PerServiceConfig] = Field(
        default_factory=dict,
        description="Per-service enabled/port overrides keyed by service name.",
    )
    tui: TUIConfig = Field(default_factory=TUIConfig)
    context: str = Field(
        default="local",
        description="Active context (local, remote, etc.).",
    )
    version: str = Field(default="0.1.0")

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls),
        )
