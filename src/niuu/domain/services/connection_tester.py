"""Shared connection testing for integration types.

Tests connections by calling the appropriate health/identity endpoints.
Used by both Tyr and Volundr integration management APIs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ConnectionTestResult:
    """Result of testing an integration connection."""

    success: bool
    message: str
    provider: str = ""
    user: str = ""


async def test_code_forge(url: str, token: str) -> ConnectionTestResult:
    """Test a Volundr/code forge connection via /me endpoint."""
    url = url.rstrip("/")
    if not url:
        return ConnectionTestResult(success=False, message="No URL configured")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{url}/api/v1/volundr/me",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                user = data.get("email") or data.get("user_id") or "authenticated"
                return ConnectionTestResult(
                    success=True,
                    message=f"Connected as {user}",
                    provider="volundr",
                    user=user,
                )
            return ConnectionTestResult(
                success=False,
                message=f"Authentication failed (HTTP {resp.status_code})",
                provider="volundr",
            )
    except httpx.ConnectError:
        return ConnectionTestResult(
            success=False, message=f"Cannot reach {url}", provider="volundr"
        )
    except Exception as e:
        return ConnectionTestResult(
            success=False, message=str(e), provider="volundr"
        )


async def test_telegram_bot(bot_token: str) -> ConnectionTestResult:
    """Test a Telegram bot token via getMe endpoint."""
    if not bot_token:
        return ConnectionTestResult(success=False, message="No bot token")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.telegram.org/bot{bot_token}/getMe"
            )
            if resp.status_code == 200 and resp.json().get("ok"):
                bot_name = resp.json()["result"].get("username", "bot")
                return ConnectionTestResult(
                    success=True,
                    message=f"Connected as @{bot_name}",
                    provider="telegram",
                    user=f"@{bot_name}",
                )
            return ConnectionTestResult(
                success=False,
                message="Invalid bot token",
                provider="telegram",
            )
    except Exception as e:
        return ConnectionTestResult(
            success=False, message=str(e), provider="telegram"
        )


async def test_connection(
    integration_type: str,
    config: dict,
    credentials: dict[str, str],
) -> ConnectionTestResult:
    """Test a connection based on its integration type.

    Args:
        integration_type: The type (code_forge, messaging, source_control, etc.)
        config: Adapter-specific config (e.g. {"url": "http://volundr"})
        credentials: Resolved credential values (e.g. {"token": "...", "bot_token": "..."})
    """
    if integration_type == "code_forge":
        return await test_code_forge(
            url=config.get("url", ""),
            token=credentials.get("token", ""),
        )

    if integration_type == "messaging":
        return await test_telegram_bot(
            bot_token=credentials.get("bot_token") or credentials.get("token", ""),
        )

    # For other types, just confirm credentials exist
    if credentials:
        return ConnectionTestResult(
            success=True, message="Credentials stored", provider=integration_type
        )
    return ConnectionTestResult(
        success=False, message="No credentials found", provider=integration_type
    )
