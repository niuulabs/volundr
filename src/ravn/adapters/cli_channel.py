"""CliChannel — renders Ravn events to the terminal."""

from __future__ import annotations

import sys

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.ports.channel import ChannelPort


class CliChannel(ChannelPort):
    """Renders streaming text and tool use/results to stdout.

    Output is written synchronously to avoid interleaving with other async I/O.
    Each event type has a distinct visual treatment so the user can follow
    what the agent is doing in real time.
    """

    def __init__(self, *, file=None) -> None:
        self._file = file or sys.stdout
        self._in_response = False

    async def emit(self, event: RavnEvent) -> None:
        match event.type:
            case RavnEventType.THOUGHT:
                # Stream text deltas inline without a newline.
                print(event.data, end="", flush=True, file=self._file)
                self._in_response = True

            case RavnEventType.RESPONSE:
                # Final complete response — just print a newline to end the stream.
                if self._in_response:
                    print(file=self._file)
                    self._in_response = False

            case RavnEventType.TOOL_START:
                tool_name = event.data
                tool_input = event.metadata.get("input", {})
                if self._in_response:
                    print(file=self._file)
                    self._in_response = False
                print(f"\n⚙ {tool_name}({_format_input(tool_input)})", file=self._file)

            case RavnEventType.TOOL_RESULT:
                tool_name = event.metadata.get("tool_name", "")
                is_error = event.metadata.get("is_error", False)
                prefix = "✗" if is_error else "✓"
                content = event.data
                # Truncate very long results for readability.
                if len(content) > 500:
                    content = content[:500] + "…"
                print(f"{prefix} {tool_name}: {content}", file=self._file)

            case RavnEventType.ERROR:
                print(f"\n[error] {event.data}", file=self._file)

    def finish(self) -> None:
        """Ensure the terminal is in a clean state after output."""
        if self._in_response:
            print(file=self._file)
            self._in_response = False


def _format_input(tool_input: dict) -> str:
    """Format tool input for compact display."""
    if not tool_input:
        return ""
    parts = []
    for key, value in tool_input.items():
        value_str = str(value)
        if len(value_str) > 60:
            value_str = value_str[:60] + "…"
        parts.append(f"{key}={value_str!r}")
    return ", ".join(parts)
