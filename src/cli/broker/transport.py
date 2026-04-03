"""Transport protocol — abstraction for CLI communication."""

from __future__ import annotations

from typing import Any, Protocol


class Transport(Protocol):
    """Abstraction for sending messages to the Claude Code CLI process.

    In embedded mode, Volundr's SDK transport implements this.
    In standalone mode, a transport that spawns and manages the CLI
    process directly would implement this.
    """

    def send_user_message(self, content: Any, cli_session_id: str) -> None:
        """Send a user message to the CLI process.

        ``content`` can be a string or an array of content blocks.
        """
        ...

    def send_control_response(self, response: dict[str, Any]) -> None:
        """Send a control_response envelope to the CLI."""
        ...

    def cli_session_id(self) -> str:
        """Return the session ID reported by the CLI on init."""
        ...
