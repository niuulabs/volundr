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


# ---------------------------------------------------------------------------
# New config fields from review feedback
# ---------------------------------------------------------------------------


def test_discord_config_has_max_pending_approvals():
    cfg = DiscordChannelConfig()
    assert cfg.max_pending_approvals == 1000


def test_whatsapp_config_has_webhook_secret_env():
    cfg = WhatsAppChannelConfig()
    assert cfg.webhook_secret_env == "WA_WEBHOOK_SECRET"


# ---------------------------------------------------------------------------
# _slash_commands shared module
# ---------------------------------------------------------------------------


def test_shared_slash_prompts_contains_expected_keys():
    from ravn.adapters.channels._slash_commands import GATEWAY_SLASH_PROMPTS

    for key in ("/compact", "/budget", "/status", "/stop", "/todo"):
        assert key in GATEWAY_SLASH_PROMPTS
        assert GATEWAY_SLASH_PROMPTS[key]


def test_slack_slash_prompts_use_ravn_prefix():
    from ravn.adapters.channels.gateway_slack import _SLASH_PROMPTS as SLACK_PROMPTS

    for key in SLACK_PROMPTS:
        assert key.startswith("/ravn-"), f"{key!r} does not start with /ravn-"


def test_discord_slash_prompts_match_shared():
    from ravn.adapters.channels._slash_commands import GATEWAY_SLASH_PROMPTS
    from ravn.adapters.channels.gateway_discord import _SLASH_PROMPTS as DISCORD_PROMPTS

    assert DISCORD_PROMPTS is GATEWAY_SLASH_PROMPTS


def test_telegram_slash_prompts_match_shared():
    from ravn.adapters.channels._slash_commands import GATEWAY_SLASH_PROMPTS
    from ravn.adapters.channels.gateway_telegram import _SLASH_PROMPTS as TG_PROMPTS

    assert TG_PROMPTS is GATEWAY_SLASH_PROMPTS
