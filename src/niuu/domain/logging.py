"""Shared logging configuration model."""

from pydantic import BaseModel, Field


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: str = Field(default="info")
    format: str = Field(default="text")
