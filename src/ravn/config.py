"""Configuration settings for Ravn.

Config file locations (first found wins):
- ~/.ravn/config.yaml
- ./ravn.yaml
- /etc/ravn/config.yaml

Environment variable override format (RAVN_ prefix, double underscore for nesting):
- RAVN_ANTHROPIC__API_KEY
- RAVN_AGENT__MODEL
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)


def _config_paths() -> list[Path]:
    env = os.environ.get("RAVN_CONFIG")
    if env:
        return [Path(env)]
    return [
        Path.home() / ".ravn" / "config.yaml",
        Path("./ravn.yaml"),
        Path("/etc/ravn/config.yaml"),
    ]


CONFIG_PATHS = _config_paths()


class AnthropicConfig(BaseModel):
    """Anthropic API configuration."""

    api_key: str = Field(default="", description="Anthropic API key (or set ANTHROPIC_API_KEY).")
    base_url: str = Field(default="https://api.anthropic.com")


class AgentConfig(BaseModel):
    """Core agent behaviour configuration."""

    model: str = Field(default="claude-sonnet-4-6")
    max_tokens: int = Field(default=8192)
    max_iterations: int = Field(default=20, description="Max tool-call iterations per turn.")
    system_prompt: str = Field(
        default=(
            "You are Ravn, a helpful AI assistant. "
            "Be concise, accurate, and use tools when they help."
        )
    )


class LLMAdapterConfig(BaseModel):
    """Dynamic LLM adapter configuration."""

    adapter: str = Field(
        default="ravn.adapters.anthropic_adapter.AnthropicAdapter",
        description="Fully-qualified class path for the LLM adapter.",
    )
    kwargs: dict[str, Any] = Field(default_factory=dict)
    max_retries: int = Field(default=3)
    retry_base_delay: float = Field(default=1.0)
    timeout: float = Field(default=120.0)


class PermissionConfig(BaseModel):
    """Permission enforcement configuration."""

    mode: str = Field(
        default="allow_all",
        description="Permission mode: allow_all, deny_all, or prompt.",
    )


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="warning")
    format: str = Field(default="text")


class Settings(BaseSettings):
    """Ravn application settings.

    Loaded from YAML with RAVN_ environment variable overrides.
    """

    model_config = SettingsConfigDict(
        yaml_file=CONFIG_PATHS,
        yaml_file_encoding="utf-8",
        env_prefix="RAVN_",
        env_nested_delimiter="__",
        extra="ignore",
    )

    anthropic: AnthropicConfig = Field(default_factory=AnthropicConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)
    llm_adapter: LLMAdapterConfig = Field(default_factory=LLMAdapterConfig)
    permission: PermissionConfig = Field(default_factory=PermissionConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

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
            file_secret_settings,
        )

    def effective_api_key(self) -> str:
        """Return the API key, preferring ANTHROPIC_API_KEY env var."""
        import os

        return os.environ.get("ANTHROPIC_API_KEY", "") or self.anthropic.api_key
