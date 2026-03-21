"""Tests for Tyr configuration."""

from tyr.config import DatabaseConfig, LoggingConfig, Settings


def test_default_settings() -> None:
    """Default settings are created without errors."""
    settings = Settings()

    assert settings.database.host == "localhost"
    assert settings.database.port == 5432
    assert settings.database.name == "tyr"
    assert settings.logging.level == "info"
    assert settings.logging.format == "text"


def test_database_dsn() -> None:
    """Database DSN is correctly formatted."""
    config = DatabaseConfig(
        host="db.example.com",
        port=5433,
        user="myuser",
        password="mypass",
        name="mydb",
    )

    assert config.dsn == "postgresql://myuser:mypass@db.example.com:5433/mydb"


def test_logging_config_defaults() -> None:
    """Logging config has sensible defaults."""
    config = LoggingConfig()

    assert config.level == "info"
    assert config.format == "text"
