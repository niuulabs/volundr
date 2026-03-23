"""Configuration settings for Tyr.

Configuration is loaded from YAML, with environment variables overriding.

Config file locations (first found wins):
- ./tyr.yaml
- /etc/tyr/config.yaml

Environment variable override format:
- Use double underscore for nested fields: DATABASE__HOST
"""

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

CONFIG_PATHS = [
    Path("./tyr.yaml"),
    Path("/etc/tyr/config.yaml"),
]


class DatabaseConfig(BaseModel):
    """PostgreSQL database configuration."""

    host: str = Field(default="localhost")
    port: int = Field(default=5432)
    user: str = Field(default="tyr")
    password: str = Field(default="tyr")
    name: str = Field(default="tyr")
    min_pool_size: int = Field(default=5)
    max_pool_size: int = Field(default=20)

    @property
    def dsn(self) -> str:
        """Return PostgreSQL connection string."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.name}"


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="info")
    format: str = Field(default="text")


class VolundrConfig(BaseModel):
    """Volundr API connection configuration."""

    url: str = Field(default="http://localhost:8000")


class CredentialStoreConfig(BaseModel):
    """Dynamic credential store adapter configuration."""

    adapter: str = Field(
        default="niuu.adapters.memory_credential_store.MemoryCredentialStore",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    secret_kwargs_env: dict[str, str] = Field(default_factory=dict)


class AIModelConfig(BaseModel):
    """Available AI model — configured via Helm values.

    Mirrors niuu.domain.models.AIModelConfig but as a pydantic model
    for settings deserialization.
    """

    id: str
    name: str


class DispatchConfig(BaseModel):
    """Dispatcher configuration."""

    default_system_prompt: str = Field(default="")
    default_model: str = Field(default="claude-sonnet-4-6")


class TrackerConfig(BaseModel):
    """Tracker adapter configuration."""

    cache_ttl_seconds: float = Field(default=30.0)
    rate_limit_max_retries: int = Field(default=3)


class Settings(BaseSettings):
    """Application settings.

    Loads configuration from YAML file with environment variable overrides.

    YAML file locations (first found wins):
    - ./tyr.yaml
    - /etc/tyr/config.yaml

    Environment variable overrides use double underscore for nesting:
    - DATABASE__HOST=myhost -> settings.database.host
    """

    model_config = SettingsConfigDict(
        yaml_file=CONFIG_PATHS,
        yaml_file_encoding="utf-8",
        env_nested_delimiter="__",
    )

    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    volundr: VolundrConfig = Field(default_factory=VolundrConfig)
    ai_models: list[AIModelConfig] = Field(default_factory=lambda: [
        AIModelConfig(id="claude-opus-4-6", name="Opus 4.6"),
        AIModelConfig(id="claude-sonnet-4-6", name="Sonnet 4.6"),
        AIModelConfig(id="claude-haiku-4-5-20251001", name="Haiku 4.5"),
    ])
    tracker: TrackerConfig = Field(default_factory=TrackerConfig)
    dispatch: DispatchConfig = Field(default_factory=DispatchConfig)
    credential_store: CredentialStoreConfig = Field(default_factory=CredentialStoreConfig)

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
        2. env_settings - environment variables
        3. yaml - YAML config file
        4. file_secret_settings - /run/secrets files
        """
        return (
            init_settings,
            env_settings,
            YamlConfigSettingsSource(settings_cls),
            file_secret_settings,
        )
