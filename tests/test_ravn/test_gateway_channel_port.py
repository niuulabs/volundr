"""Tests for the GatewayChannelPort ABC and config models."""

from __future__ import annotations

import pytest

from ravn.config import (
    DiscordChannelConfig,
    MatrixChannelConfig,
    SlackChannelConfig,
    WhatsAppChannelConfig,
)
from ravn.ports.gateway_channel import (
    GatewayChannelPort,
    MessageHandler,
)

# ---------------------------------------------------------------------------
# GatewayChannelPort — abstract methods
# ---------------------------------------------------------------------------


def test_gateway_channel_port_cannot_be_instantiated():
    """GatewayChannelPort is abstract and cannot be directly instantiated."""
    with pytest.raises(TypeError):
        GatewayChannelPort()  # type: ignore[abstract]


def test_gateway_channel_port_must_implement_all_methods():
    """Partial implementation raises TypeError."""

    class Incomplete(GatewayChannelPort):
        async def start(self) -> None:
            pass

        # Missing stop, send_text, send_image, send_audio, on_message

    with pytest.raises(TypeError):
        Incomplete()


def test_gateway_channel_port_full_implementation_works():
    """A complete concrete implementation can be instantiated."""

    class Complete(GatewayChannelPort):
        async def start(self) -> None:
            pass

        async def stop(self) -> None:
            pass

        async def send_text(self, chat_id: str, text: str) -> None:
            pass

        async def send_image(self, chat_id: str, image: bytes, caption: str = "") -> None:
            pass

        async def send_audio(self, chat_id: str, audio: bytes) -> None:
            pass

        def on_message(self, handler: MessageHandler) -> None:
            pass

    obj = Complete()
    assert isinstance(obj, GatewayChannelPort)


# ---------------------------------------------------------------------------
# Config defaults
# ---------------------------------------------------------------------------


def test_discord_config_defaults():
    cfg = DiscordChannelConfig()
    assert cfg.enabled is False
    assert cfg.token_env == "DISCORD_BOT_TOKEN"
    assert cfg.message_max_chars == 2000
    assert cfg.retry_delay == 5.0


def test_slack_config_defaults():
    cfg = SlackChannelConfig()
    assert cfg.enabled is False
    assert cfg.bot_token_env == "SLACK_BOT_TOKEN"
    assert cfg.poll_interval == 2.0
    assert cfg.message_max_chars == 3000


def test_matrix_config_defaults():
    cfg = MatrixChannelConfig()
    assert cfg.enabled is False
    assert cfg.homeserver == "https://matrix.niuu.world"
    assert cfg.e2e is False
    assert cfg.sync_timeout_ms == 30000


def test_whatsapp_config_defaults():
    cfg = WhatsAppChannelConfig()
    assert cfg.enabled is False
    assert cfg.mode == "business_api"
    assert cfg.api_key_env == "WA_API_KEY"
    assert cfg.webhook_port == 7478


def test_gateway_channels_config_includes_new_platforms():
    from ravn.config import GatewayChannelsConfig

    cfg = GatewayChannelsConfig()
    assert hasattr(cfg, "discord")
    assert hasattr(cfg, "slack")
    assert hasattr(cfg, "matrix")
    assert hasattr(cfg, "whatsapp")
    assert isinstance(cfg.discord, DiscordChannelConfig)
    assert isinstance(cfg.slack, SlackChannelConfig)
    assert isinstance(cfg.matrix, MatrixChannelConfig)
    assert isinstance(cfg.whatsapp, WhatsAppChannelConfig)
